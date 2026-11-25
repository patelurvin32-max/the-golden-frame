const { Bill, Payment } = require('../models/Billing');
const { Expense, MenuItem, MenuCategory } = require('../models/Operations');
const Session = require('../models/Session');
const Table = require('../models/Table');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const WalletTransaction = require('../models/WalletTransaction');
const TournamentParticipant = require('../models/TournamentParticipant');
const Tournament = require('../models/Tournament');
const Branch = require('../models/Branch');
const asyncHandler = require('../utils/asyncHandler');
const ExcelJS = require('exceljs');
const { ROLES } = require('../config/constants');
const mongoose = require('mongoose');
const { getBusinessDayStart } = require('../utils/businessDay');

const TIMEZONE_OFFSET = '+05:30';

/**
 * Standard date range parser respecting Asia/Kolkata (+05:30) timezone
 */
const parseDateRange = (fromStr, toStr) => {
  let from, to;
  if (fromStr) {
    const match = String(fromStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      from = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000${TIMEZONE_OFFSET}`);
    } else {
      from = new Date(fromStr);
    }
  } else {
    from = new Date(Date.now() - 30 * 86400000);
  }

  if (toStr) {
    const match = String(toStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      to = new Date(`${match[1]}-${match[2]}-${match[3]}T23:59:59.999${TIMEZONE_OFFSET}`);
    } else {
      to = new Date(toStr);
    }
  } else {
    to = new Date();
  }
  return { from, to };
};

const branchFilter = (req) => {
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    if (req.query.branch && userBranchIds.includes(req.query.branch.toString())) {
      return new mongoose.Types.ObjectId(req.query.branch.toString());
    }
    return { $in: userBranchIds.map(id => new mongoose.Types.ObjectId(id)) };
  }
  return req.query.branch ? new mongoose.Types.ObjectId(req.query.branch.toString()) : undefined;
};

/**
 * Single source of truth calculation for report metrics without double counting
 */
const calculateReportMetrics = async (matchBranch, from, to) => {
  // 1. Fetch Bills in range (exclude bills created from orders to prevent double counting with Orders)
  const bills = await Bill.find({
    ...matchBranch,
    createdAt: { $gte: from, $lte: to },
    order: { $in: [null, undefined] },
  }).lean();

  // 2. Fetch Direct Orders in range (exclude orders created for table sessions to prevent double counting with session Bills)
  const directOrders = await Order.find({
    ...matchBranch,
    isActive: { $ne: false },
    createdAt: { $gte: from, $lte: to },
    session: { $in: [null, undefined] },
  }).populate('menuItemId', 'name').lean();

  // 3. Fetch Tournament participants in range
  const tournamentParticipants = await TournamentParticipant.find({
    ...matchBranch,
    createdAt: { $gte: from, $lte: to },
    paymentStatus: { $in: ['paid', 'partial'] },
  }).lean();

  // 4. Fetch Expenses in range
  const expenses = await Expense.find({
    ...matchBranch,
    date: { $gte: from, $lte: to },
  }).lean();

  // Revenue calculation:
  // Paid bills + partial amounts collected on bills
  const billRevenue = bills.reduce((sum, b) => {
    if (b.paymentStatus === 'paid') return sum + (b.total || 0);
    if (b.paymentStatus === 'partial') return sum + Math.max(0, (b.total || 0) - (b.pendingPaymentAmount || 0));
    return sum;
  }, 0);

  // Paid direct orders + partial amounts collected on direct orders
  const orderRevenue = directOrders.reduce((sum, o) => {
    if (o.paymentStatus === 'paid') return sum + (o.billAmount || o.totalPaid || 0);
    if (o.paymentStatus === 'partial') return sum + (o.totalPaid || o.amountReceived || Math.max(0, (o.billAmount || 0) - (o.pendingPaymentAmount || 0)));
    return sum;
  }, 0);

  // Tournament revenue
  const tournamentRevenue = tournamentParticipants.reduce((sum, t) => sum + (t.paidAmount || 0), 0);

  const totalRevenue = Math.round((billRevenue + orderRevenue + tournamentRevenue) * 100) / 100;
  const totalExpenses = Math.round(expenses.reduce((sum, e) => sum + (e.amount || 0), 0) * 100) / 100;
  const netProfit = Math.round((totalRevenue - totalExpenses) * 100) / 100;

  // Payments for bills
  const billIds = bills.map(b => b._id);
  const billPayments = await Payment.find({
    bill: { $in: billIds },
    createdAt: { $gte: from, $lte: to },
  }).lean();

  const billsWithPaymentDoc = new Set(billPayments.map(p => String(p.bill)));

  let totalCash = 0;
  let totalOnline = 0;

  // Process bill payments
  billPayments.forEach(p => {
    if (p.method === 'cash') {
      totalCash += (p.amount || 0);
    } else if (p.method === 'upi' || p.method === 'card') {
      totalOnline += (p.amount || 0);
    } else if (p.method === 'mixed') {
      if (p.breakdown && p.breakdown.length > 0) {
        p.breakdown.forEach(b => {
          if (b.method === 'cash') totalCash += (b.amount || 0);
          if (b.method === 'upi' || b.method === 'card') totalOnline += (b.amount || 0);
        });
      } else {
        totalCash += (p.amount || 0);
      }
    }
  });

  // Fallback for bills paid directly without separate Payment documents
  bills.forEach(b => {
    if (!billsWithPaymentDoc.has(String(b._id))) {
      if (b.paymentMethod === 'cash') {
        totalCash += (b.cashAmount || (b.paymentStatus === 'paid' ? b.total : b.amountReceived) || 0);
      } else if (b.paymentMethod === 'upi' || b.paymentMethod === 'card') {
        totalOnline += (b.onlineAmount || (b.paymentStatus === 'paid' ? b.total : b.amountReceived) || 0);
      } else if (b.paymentMethod === 'mixed') {
        totalCash += (b.cashAmount || 0);
        totalOnline += (b.onlineAmount || 0);
      }
    }
  });

  // Process direct orders payments (cash, upi, mixed)
  directOrders.forEach(o => {
    if (o.paymentMethod === 'cash') {
      const paid = Math.max(o.cashAmount || 0, o.totalPaid || o.amountReceived || (o.paymentStatus === 'paid' ? o.billAmount : 0) || 0);
      totalCash += paid;
    } else if (o.paymentMethod === 'upi' || o.paymentMethod === 'card') {
      const paid = Math.max(o.onlineAmount || 0, o.totalPaid || o.amountReceived || (o.paymentStatus === 'paid' ? o.billAmount : 0) || 0);
      totalOnline += paid;
    } else if (o.paymentMethod === 'mixed') {
      totalCash += (o.cashAmount || 0);
      totalOnline += (o.onlineAmount || 0);
    }
  });

  // Tournament payments
  tournamentParticipants.forEach(t => {
    totalCash += (t.cashAmount || 0);
    totalOnline += (t.onlineAmount || 0);
  });

  totalCash = Math.round(totalCash * 100) / 100;
  totalOnline = Math.round(totalOnline * 100) / 100;

  // Total Customers in range
  const customerIdSet = new Set();
  bills.forEach(b => { if (b.customer) customerIdSet.add(String(b.customer)); });
  directOrders.forEach(o => { if (o.customer) customerIdSet.add(String(o.customer)); });
  const registeredCustomers = await Customer.find({
    ...matchBranch,
    createdAt: { $gte: from, $lte: to },
  }).select('_id').lean();
  registeredCustomers.forEach(c => customerIdSet.add(String(c._id)));

  // Total Pending Amount:
  // Actual remaining unpaid balances
  const allPendingOrders = await Order.find({
    ...matchBranch,
    isActive: { $ne: false },
    createdAt: { $gte: from, $lte: to },
    pendingPaymentAmount: { $gt: 0 },
  }).lean();

  const directPendingTotal = allPendingOrders.reduce((sum, o) => sum + (o.pendingPaymentAmount || 0), 0);

  // Also check unpaid bills that do NOT have a linked Order
  const sessionIdsWithOrder = new Set(allPendingOrders.map(o => o.session ? String(o.session) : null).filter(Boolean));
  const unlinkedPendingBills = bills.filter(b => 
    b.paymentStatus !== 'paid' && 
    (!b.session || !sessionIdsWithOrder.has(String(b.session)))
  );
  const unlinkedPendingTotal = unlinkedPendingBills.reduce((sum, b) => 
    sum + (b.pendingPaymentAmount || Math.max(0, (b.total || 0) - (b.amountReceived || 0))), 0);

  const totalPendingAmount = Math.round((directPendingTotal + unlinkedPendingTotal) * 100) / 100;

  // Total Items Sold and Highest-Selling Item
  const itemCounts = {};

  directOrders.forEach(o => {
    // Primary item
    if (o.menuItemId) {
      const name = o.menuItemId?.name || o.menuItem || 'Menu Item';
      itemCounts[name] = (itemCounts[name] || 0) + 1;
    }
    // Added items
    if (Array.isArray(o.addedItems) && o.addedItems.length > 0) {
      o.addedItems.forEach(ai => {
        const name = ai.itemName || 'Item';
        itemCounts[name] = (itemCounts[name] || 0) + (Number(ai.quantity) || 1);
      });
    }
  });

  // Bills inventory items
  bills.forEach(b => {
    if (Array.isArray(b.items) && b.items.length > 0) {
      b.items.forEach(it => {
        if (it.type === 'inventory') {
          const cleanName = (it.description || 'Item').replace(/^[^-]+-\s*/, '').trim();
          itemCounts[cleanName] = (itemCounts[cleanName] || 0) + (Number(it.quantity) || 1);
        }
      });
    }
  });

  const totalItemsSold = Object.values(itemCounts).reduce((sum, count) => sum + count, 0);
  const sortedItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]);

  const highestSellingItem = sortedItems.length > 0
    ? { name: sortedItems[0][0], quantitySold: sortedItems[0][1] }
    : { name: 'None', quantitySold: 0 };

  return {
    totalRevenue,
    totalExpenses,
    netProfit,
    totalCash,
    totalOnline,
    totalCustomers: customerIdSet.size,
    totalPendingAmount,
    totalItemsSold,
    highestSellingItem,
    itemCounts,
  };
};

module.exports = {
  TIMEZONE_OFFSET,
  parseDateRange,
  branchFilter,
  calculateReportMetrics,
};
