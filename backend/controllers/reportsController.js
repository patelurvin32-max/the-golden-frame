const { Bill, Payment } = require('../models/Billing');
const { Expense } = require('../models/Operations');
const Session = require('../models/Session');
const Table = require('../models/Table');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const WalletTransaction = require('../models/WalletTransaction');
const asyncHandler = require('../utils/asyncHandler');
const ExcelJS = require('exceljs');
const { ROLES } = require('../config/constants');

const mongoose = require('mongoose');

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

const { getBusinessDayStart } = require('../utils/businessDay');

const getCollectionTotals = async (matchBranch, from, to) => {
  // Helper to extract a cash or upi amount from a payment doc (handles mixed breakdown)
  const cashExpr = {
    $cond: [
      { $eq: ['$method', 'cash'] },
      '$amount',
      { $reduce: { input: { $filter: { input: { $ifNull: ['$breakdown', []] }, cond: { $eq: ['$$this.method', 'cash'] } } }, initialValue: 0, in: { $add: ['$$value', '$$this.amount'] } } }
    ]
  };
  const onlineExpr = {
    $cond: [
      { $eq: ['$method', 'upi'] },
      '$amount',
      { $reduce: { input: { $filter: { input: { $ifNull: ['$breakdown', []] }, cond: { $eq: ['$$this.method', 'upi'] } } }, initialValue: 0, in: { $add: ['$$value', '$$this.amount'] } } }
    ]
  };

  const [billPayments, directPayments, orderPayments] = await Promise.all([
    Bill.aggregate([
      { $match: { ...matchBranch, createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: null,
          cash: { $sum: '$cashAmount' },
          online: { $sum: '$onlineAmount' }
        }
      }
    ]),
    Payment.aggregate([
      { $match: { ...matchBranch, createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: null,
          cash: { $sum: cashExpr },
          online: { $sum: onlineExpr }
        }
      }
    ]),
    Order.aggregate([
      { $match: { ...matchBranch, session: { $exists: false }, createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: null,
          cash: { $sum: '$cashAmount' },
          online: { $sum: '$onlineAmount' }
        }
      }
    ])
  ]);

  const totalCash = (billPayments[0]?.cash || 0) + (directPayments[0]?.cash || 0) + (orderPayments[0]?.cash || 0);
  const totalOnline = (billPayments[0]?.online || 0) + (directPayments[0]?.online || 0) + (orderPayments[0]?.online || 0);

  return { totalCash, totalOnline };
};

// GET /api/reports/dashboard?branch=
exports.getDashboardStats = asyncHandler(async (req, res) => {
  // Deny Staff access to dashboard
  if (req.user.role === ROLES.STAFF) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};

  const now = new Date();
  const todayStart = getBusinessDayStart(now);
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const yearStart  = new Date(now.getFullYear(), 0, 1);

  // ── 1 query for all Bill stats ──
  const billStatsPromise = Bill.aggregate([
    { $match: { ...matchBranch } },
    {
      $facet: {
        todayRevenue:  [{ $match: { paymentStatus: 'paid',    createdAt: { $gte: todayStart } } }, { $group: { _id: null, v: { $sum: '$total' } } }],
        monthRevenue:  [{ $match: { paymentStatus: 'paid',    createdAt: { $gte: monthStart } } }, { $group: { _id: null, v: { $sum: '$total' } } }],
        yearRevenue:   [{ $match: { paymentStatus: 'paid',    createdAt: { $gte: yearStart  } } }, { $group: { _id: null, v: { $sum: '$total' } } }],
        todayPaid:     [{ $match: { paymentStatus: 'paid',    createdAt: { $gte: todayStart } } }, { $count: 'n' }],
        todayPartial:  [{ $match: { paymentStatus: 'partial', createdAt: { $gte: todayStart } } }, { $count: 'n' }],
        todayUnpaid:   [{ $match: { paymentStatus: 'unpaid',  createdAt: { $gte: todayStart } } }, { $count: 'n' }],
        outstanding:   [{ $match: { paymentStatus: { $in: ['unpaid', 'partial'] } } }, { $group: { _id: null, v: { $sum: '$total' } } }],
      },
    },
  ]);

  // ── 1 query for all Order stats (excluding session duplicates) ──
  const orderStatsPromise = Order.aggregate([
    { $match: { ...matchBranch, session: { $exists: false } } },
    {
      $facet: {
        todayRevenue: [{ $match: { paymentStatus: 'paid', createdAt: { $gte: todayStart } } }, { $group: { _id: null, v: { $sum: '$billAmount' } } }],
        monthRevenue: [{ $match: { paymentStatus: 'paid', createdAt: { $gte: monthStart } } }, { $group: { _id: null, v: { $sum: '$billAmount' } } }],
        yearRevenue:  [{ $match: { paymentStatus: 'paid', createdAt: { $gte: yearStart  } } }, { $group: { _id: null, v: { $sum: '$billAmount' } } }],
        outstanding:  [{ $match: { paymentStatus: { $in: ['unpaid', 'partial'] } } }, { $group: { _id: null, v: { $sum: '$pendingPaymentAmount' } } }],
      }
    }
  ]);

  // ── 1 query for all Expense stats ──
  const expenseStatsPromise = Expense.aggregate([
    { $match: { ...matchBranch } },
    {
      $facet: {
        today: [{ $match: { date: { $gte: todayStart } } }, { $group: { _id: null, v: { $sum: '$amount' } } }],
        month: [{ $match: { date: { $gte: monthStart } } }, { $group: { _id: null, v: { $sum: '$amount' } } }],
      },
    },
  ]);

  // ── Remaining simple lookups, all run in parallel ──
  const [billStats, orderStats, expenseStats, tables, todayCustomers, walletResult, walletTxStats, todayColl, monthColl] =
    await Promise.all([
      billStatsPromise,
      orderStatsPromise,
      expenseStatsPromise,
      Table.find({ ...(bf ? { branch: bf } : {}), isActive: true }).select('status').lean(),
      Session.countDocuments({ ...matchBranch, startTime: { $gte: todayStart } }),
      Customer.aggregate([{ $match: { ...matchBranch, isActive: true } }, { $group: { _id: null, total: { $sum: '$walletBalance' } } }]),
      WalletTransaction.aggregate([
        { $match: { ...matchBranch, createdAt: { $gte: todayStart } } },
        {
          $facet: {
            credits: [{ $match: { type: 'credit' } }, { $group: { _id: null, v: { $sum: '$amount' } } }],
            debits:  [{ $match: { type: 'debit'  } }, { $group: { _id: null, v: { $sum: '$amount' } } }],
          },
        },
      ]),
      getCollectionTotals(matchBranch, todayStart, now),
      getCollectionTotals(matchBranch, monthStart, now),
    ]);

  // Helper to extract a facet value safely
  const fv = (facetResult, key, field = 'v') => facetResult[0]?.[key]?.[0]?.[field] ?? 0;

  const runningTables   = tables.filter((t) => t.status === 'running').length;
  const availableTables = tables.filter((t) => t.status === 'available').length;

  const todayRev  = fv(billStats, 'todayRevenue') + fv(orderStats, 'todayRevenue');
  const monthRev  = fv(billStats, 'monthRevenue') + fv(orderStats, 'monthRevenue');
  const yearRev   = fv(billStats, 'yearRevenue')  + fv(orderStats, 'yearRevenue');
  const todayExp  = fv(expenseStats, 'today');
  const monthExp  = fv(expenseStats, 'month');
  const todayCash    = todayColl.totalCash;
  const monthCash    = monthColl.totalCash;
  const todayOnline  = todayColl.totalOnline;
  const monthOnline  = monthColl.totalOnline;

  res.status(200).json({
    success: true,
    data: {
      revenue:  { today: todayRev, month: monthRev, year: yearRev },
      expenses: { today: todayExp, month: monthExp },
      profit:   { today: todayRev - todayExp, month: monthRev - monthExp },
      tables:   { running: runningTables, available: availableTables },
      customersToday: todayCustomers,
      collection: {
        cash:   { today: todayCash,   month: monthCash   },
        online: { today: todayOnline, month: monthOnline },
      },
      wallet: {
        totalBalance:  walletResult[0]?.total ?? 0,
        todayCredits:  fv(walletTxStats, 'credits'),
        todayDebits:   fv(walletTxStats, 'debits'),
      },
      paymentStatus: {
        paid:               fv(billStats, 'todayPaid',    'n'),
        partial:            fv(billStats, 'todayPartial', 'n'),
        unpaid:             fv(billStats, 'todayUnpaid',  'n'),
        outstandingBalance: fv(billStats, 'outstanding') + fv(orderStats, 'outstanding'),
      },
    },
  });
});

// GET /api/reports/revenue?branch=&from=&to=&groupBy=day|week|month
exports.getRevenueReport = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};

  let from = new Date(Date.now() - 30 * 86400000);
  if (req.query.from) {
    from = new Date(req.query.from);
    from.setHours(0, 0, 0, 0);
  }
  let to = new Date();
  if (req.query.to) {
    to = new Date(req.query.to);
    to.setHours(23, 59, 59, 999);
  }

  const groupBy = req.query.groupBy || 'day';
  const dateFormat = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-%U' : '%Y-%m-%d';

  const [revenueBills, revenueOrders, expenses, customerCount, collections] = await Promise.all([
    Bill.aggregate([
      { $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$createdAt' } }, total: { $sum: '$total' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { ...matchBranch, session: { $exists: false }, paymentStatus: 'paid', createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$createdAt' } }, total: { $sum: '$billAmount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([
      { $match: { ...matchBranch, date: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$date' } }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
    Customer.countDocuments({ ...matchBranch, createdAt: { $gte: from, $lte: to } }),
    getCollectionTotals(matchBranch, from, to)
  ]);

  // Merge revenue from Bills and Orders by date
  const revenueMap = {};
  revenueBills.forEach((r) => {
    revenueMap[r._id] = { _id: r._id, total: r.total, count: r.count };
  });
  revenueOrders.forEach((r) => {
    if (revenueMap[r._id]) {
      revenueMap[r._id].total += r.total;
      revenueMap[r._id].count += r.count;
    } else {
      revenueMap[r._id] = { _id: r._id, total: r.total, count: r.count };
    }
  });
  const mergedRevenue = Object.values(revenueMap).sort((a, b) => a._id.localeCompare(b._id));

  res.status(200).json({
    success: true,
    data: {
      revenue: mergedRevenue,
      expenses,
      summary: {
        totalCash: collections.totalCash,
        totalOnline: collections.totalOnline,
        totalCustomers: customerCount,
      }
    }
  });
});

// GET /api/reports/table-usage?branch=&from=&to=
exports.getTableUsageReport = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};

  let from = new Date(Date.now() - 30 * 86400000);
  if (req.query.from) {
    from = new Date(req.query.from);
    from.setHours(0, 0, 0, 0);
  }
  let to = new Date();
  if (req.query.to) {
    to = new Date(req.query.to);
    to.setHours(23, 59, 59, 999);
  }

  const usage = await Session.aggregate([
    { $match: { ...matchBranch, status: 'completed', startTime: { $gte: from, $lte: to } } },
    { $lookup: { from: 'tables', localField: 'table', foreignField: '_id', as: 'tableInfo' } },
    { $unwind: '$tableInfo' },
    {
      $group: {
        _id: { tableId: '$table', tableName: '$tableInfo.name', type: '$tableInfo.type' },
        totalSessions: { $sum: 1 },
        totalMinutes: { $sum: '$billableMinutes' },
        totalRevenue: { $sum: '$amount' },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  res.status(200).json({ success: true, data: { usage } });
});

// GET /api/reports/branch-comparison
exports.getBranchComparison = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ success: false, message: 'Access denied. You do not have permission to view branch comparisons.' });
  }

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  try {
    const [revenueByBranch, expenseByBranch] = await Promise.all([
      Bill.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: monthStart } } },
        { $group: { _id: '$branch', revenue: { $sum: '$total' }, bills: { $sum: 1 } } },
        {
          $lookup: {
            from: 'branches',
            let: { branchId: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$branchId'] } } },
              { $project: { name: 1 } }
            ],
            as: 'branchInfo'
          }
        },
        { $unwind: { path: '$branchInfo', preserveNullAndEmptyArrays: true } },
        { $project: { branchName: { $ifNull: ['$branchInfo.name', 'Unknown'] }, revenue: 1, bills: 1 } },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: monthStart } } },
        { $group: { _id: '$branch', expenses: { $sum: '$amount' } } },
      ]),
    ]);

    const expenseMap = Object.fromEntries(expenseByBranch.map((e) => [e._id.toString(), e.expenses]));
    const comparison = revenueByBranch.map((b) => ({
      ...b,
      expenses: expenseMap[b._id.toString()] || 0,
      profit: b.revenue - (expenseMap[b._id.toString()] || 0),
    }));

    res.status(200).json({ success: true, data: { comparison } });
  } catch (error) {
    console.error('❌ Branch comparison error:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    // Return empty comparison instead of 500 error
    res.status(200).json({ 
      success: true, 
      data: { comparison: [] },
      warning: 'Could not generate branch comparison. Returning empty results.'
    });
  }
});

// GET /api/reports/export/excel?branch=&from=&to=&type=revenue|expenses|sessions
exports.exportExcel = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};
  let from = new Date(Date.now() - 30 * 86400000);
  if (req.query.from) {
    from = new Date(req.query.from);
    from.setHours(0, 0, 0, 0);
  }
  let to = new Date();
  if (req.query.to) {
    to = new Date(req.query.to);
    to.setHours(23, 59, 59, 999);
  }
  const type = req.query.type || 'revenue';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'The Golden Frame';
  const sheet = workbook.addWorksheet(type.charAt(0).toUpperCase() + type.slice(1));

  if (type === 'revenue') {
    const bills = await Bill.find({ ...matchBranch, createdAt: { $gte: from, $lte: to } })
      .populate('customer', 'name phone')
      .populate('branch', 'name')
      .sort('-createdAt');

    sheet.columns = [
      { header: 'Invoice #', key: 'invoice', width: 20 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Customer', key: 'customer', width: 20 },
      { header: 'Branch', key: 'branch', width: 15 },
      { header: 'Subtotal', key: 'subtotal', width: 12 },
      { header: 'Discount', key: 'discount', width: 12 },
      { header: 'Tax', key: 'tax', width: 10 },
      { header: 'Total', key: 'total', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
    ];
    bills.forEach((b) => sheet.addRow({
      invoice: b.invoiceNumber,
      date: b.createdAt.toLocaleDateString('en-IN'),
      customer: b.customer?.name || 'Walk-in',
      branch: b.branch?.name || '',
      subtotal: b.subtotal,
      discount: b.discountAmount + b.membershipDiscount,
      tax: b.tax,
      total: b.total,
      status: b.paymentStatus,
    }));
  } else if (type === 'expenses') {
    const expenses = await Expense.find({ ...matchBranch, date: { $gte: from, $lte: to } })
      .populate('branch', 'name').sort('-date');

    sheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Title', key: 'title', width: 25 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Amount', key: 'amount', width: 12 },
      { header: 'Branch', key: 'branch', width: 15 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];
    expenses.forEach((e) => sheet.addRow({
      date: e.date.toLocaleDateString('en-IN'),
      title: e.title,
      category: e.category,
      amount: e.amount,
      branch: e.branch?.name || '',
      notes: e.notes || '',
    }));
  } else if (type === 'orders') {
    const bf = branchFilter(req);
    const matchStage = { isActive: { $ne: false } };
    if (bf) {
      matchStage.branch = bf;
    }
    if (req.query.from || req.query.to) {
      matchStage.createdAt = {};
      if (req.query.from) {
        const fromDate = new Date(req.query.from);
        fromDate.setHours(0, 0, 0, 0);
        matchStage.createdAt.$gte = fromDate;
      }
      if (req.query.to) {
        const toDate = new Date(req.query.to);
        toDate.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = toDate;
      }
    }

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'customers',
          localField: 'customer',
          foreignField: '_id',
          as: 'customerDoc',
        },
      },
      { $unwind: { path: '$customerDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'branches',
          localField: 'branch',
          foreignField: '_id',
          as: 'branchDoc',
        },
      },
      { $unwind: { path: '$branchDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'tables',
          localField: 'table',
          foreignField: '_id',
          as: 'tableDoc',
        },
      },
      { $unwind: { path: '$tableDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'menucategories',
          localField: 'menuCategoryId',
          foreignField: '_id',
          as: 'menuCategoryDoc',
        },
      },
      { $unwind: { path: '$menuCategoryDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'menuitems',
          localField: 'menuItemId',
          foreignField: '_id',
          as: 'menuItemDoc',
        },
      },
      { $unwind: { path: '$menuItemDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'createdByDoc',
        },
      },
      { $unwind: { path: '$createdByDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          orderId: 1,
          customerName: { $ifNull: ['$customerDoc.name', 'Walk-in'] },
          mobileNumber: { $ifNull: ['$customerDoc.phone', ''] },
          branchName: { $ifNull: ['$branchDoc.name', ''] },
          tableName: { $ifNull: ['$tableDoc.name', '—'] },
          menuCategory: { $ifNull: ['$menuCategoryDoc.name', '—'] },
          menuItem: { $ifNull: ['$menuItemDoc.name', '—'] },
          quantity: { $ifNull: ['$quantity', 1] },
          billAmount: 1,
          amountReceived: 1,
          pendingAmount: '$pendingPaymentAmount',
          walletUsed: '$walletAmount',
          walletAdded: {
            $cond: [
              { $gt: ['$amountReceived', '$billAmount'] },
              { $subtract: ['$amountReceived', '$billAmount'] },
              0,
            ],
          },
          paymentMethod: 1,
          paymentStatus: 1,
          createdBy: { $ifNull: ['$createdByDoc.name', '—'] },
          startTime: 1,
          endTime: 1,
          createdAt: 1,
        },
      },
    ];

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      pipeline.push({
        $match: {
          $or: [
            { orderId: searchRegex },
            { customerName: searchRegex },
            { mobileNumber: searchRegex },
            { branchName: searchRegex },
            { tableName: searchRegex },
            { menuCategory: searchRegex },
            { menuItem: searchRegex },
          ],
        },
      });
    }

    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    pipeline.push({ $sort: { [sortBy]: sortOrder, _id: -1 } });

    const orders = await Order.aggregate(pipeline).allowDiskUse(true);

    sheet.columns = [
      { header: 'Order ID', key: 'orderId', width: 20 },
      { header: 'Customer Name', key: 'customerName', width: 20 },
      { header: 'Mobile Number', key: 'mobileNumber', width: 15 },
      { header: 'Branch Name', key: 'branchName', width: 15 },
      { header: 'Table Name', key: 'tableName', width: 15 },
      { header: 'Menu Category', key: 'menuCategory', width: 15 },
      { header: 'Menu Item', key: 'menuItem', width: 20 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Bill Amount', key: 'billAmount', width: 12 },
      { header: 'Amount Received', key: 'amountReceived', width: 15 },
      { header: 'Pending Amount', key: 'pendingAmount', width: 15 },
      { header: 'Wallet Used', key: 'walletUsed', width: 12 },
      { header: 'Wallet Added', key: 'walletAdded', width: 12 },
      { header: 'Payment Method', key: 'paymentMethod', width: 15 },
      { header: 'Payment Status', key: 'paymentStatus', width: 15 },
      { header: 'Created By', key: 'createdBy', width: 15 },
      { header: 'Start Time', key: 'startTime', width: 20 },
      { header: 'End Time', key: 'endTime', width: 20 },
      { header: 'Created At', key: 'createdAt', width: 20 },
    ];

    orders.forEach((o) => {
      sheet.addRow({
        orderId: o.orderId,
        customerName: o.customerName,
        mobileNumber: o.mobileNumber,
        branchName: o.branchName,
        tableName: o.tableName,
        menuCategory: o.menuCategory,
        menuItem: o.menuItem,
        quantity: o.quantity,
        billAmount: o.billAmount,
        amountReceived: o.amountReceived,
        pendingAmount: o.pendingAmount || 0,
        walletUsed: o.walletUsed || 0,
        walletAdded: o.walletAdded || 0,
        paymentMethod: o.paymentMethod || '—',
        paymentStatus: o.paymentStatus,
        createdBy: o.createdBy,
        startTime: o.startTime ? new Date(o.startTime).toLocaleString('en-IN') : '—',
        endTime: o.endTime ? new Date(o.endTime).toLocaleString('en-IN') : '—',
        createdAt: o.createdAt ? new Date(o.createdAt).toLocaleString('en-IN') : '—',
      });
    });
  } else if (type === 'pending_payments') {
    const bf = branchFilter(req);
    const matchStage = { isActive: { $ne: false }, pendingPaymentAmount: { $gt: 0 } };
    if (bf) {
      matchStage.branch = bf;
    }
    if (req.query.from || req.query.to) {
      matchStage.createdAt = {};
      if (req.query.from) {
        const fromDate = new Date(req.query.from);
        fromDate.setHours(0, 0, 0, 0);
        matchStage.createdAt.$gte = fromDate;
      }
      if (req.query.to) {
        const toDate = new Date(req.query.to);
        toDate.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = toDate;
      }
    }

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'customers',
          localField: 'customer',
          foreignField: '_id',
          as: 'customerDoc',
        },
      },
      { $unwind: { path: '$customerDoc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'branches',
          localField: 'branch',
          foreignField: '_id',
          as: 'branchDoc',
        },
      },
      { $unwind: { path: '$branchDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          orderId: 1,
          customerName: { $ifNull: ['$customerDoc.name', 'Walk-in'] },
          mobileNumber: { $ifNull: ['$customerDoc.phone', ''] },
          branchName: { $ifNull: ['$branchDoc.name', ''] },
          billAmount: 1,
          amountPaid: '$amountReceived',
          pendingAmount: '$pendingPaymentAmount',
          paymentMethod: 1,
          createdAt: 1,
        },
      },
      { $sort: { createdAt: -1 } }
    ];

    const pending = await Order.aggregate(pipeline).allowDiskUse(true);

    sheet.columns = [
      { header: 'Order ID', key: 'orderId', width: 20 },
      { header: 'Customer Name', key: 'customerName', width: 20 },
      { header: 'Mobile Number', key: 'mobileNumber', width: 15 },
      { header: 'Branch Name', key: 'branchName', width: 15 },
      { header: 'Bill Amount', key: 'billAmount', width: 12 },
      { header: 'Amount Paid', key: 'amountPaid', width: 12 },
      { header: 'Pending Amount', key: 'pendingAmount', width: 15 },
      { header: 'Payment Method', key: 'paymentMethod', width: 15 },
      { header: 'Created At', key: 'createdAt', width: 20 },
    ];

    pending.forEach((p) => {
      sheet.addRow({
        orderId: p.orderId,
        customerName: p.customerName,
        mobileNumber: p.mobileNumber,
        branchName: p.branchName,
        billAmount: p.billAmount,
        amountPaid: p.amountPaid,
        pendingAmount: p.pendingAmount,
        paymentMethod: p.paymentMethod || '—',
        createdAt: p.createdAt ? new Date(p.createdAt).toLocaleString('en-IN') : '—',
      });
    });
  }

  // Style header row
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="thegoldenframe-${type}-report.xlsx"`,
  });
  await workbook.xlsx.write(res);
  res.end();
});

// GET /api/reports/orders?from=&to=&branch=&page=&limit=&search=&sortBy=&sortOrder=
exports.getOrderDetailsReport = asyncHandler(async (req, res, next) => {
  const bf = branchFilter(req);
  const matchStage = { isActive: { $ne: false } };
  if (bf) {
    matchStage.branch = bf;
  }

  if (req.query.from || req.query.to) {
    matchStage.createdAt = {};
    if (req.query.from) {
      const fromDate = new Date(req.query.from);
      fromDate.setHours(0, 0, 0, 0);
      matchStage.createdAt.$gte = fromDate;
    }
    if (req.query.to) {
      const toDate = new Date(req.query.to);
      toDate.setHours(23, 59, 59, 999);
      matchStage.createdAt.$lte = toDate;
    }
  }

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'customers',
        localField: 'customer',
        foreignField: '_id',
        as: 'customerDoc',
      },
    },
    { $unwind: { path: '$customerDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'branches',
        localField: 'branch',
        foreignField: '_id',
        as: 'branchDoc',
      },
    },
    { $unwind: { path: '$branchDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'menucategories',
        localField: 'menuCategoryId',
        foreignField: '_id',
        as: 'menuCategoryDoc',
      },
    },
    { $unwind: { path: '$menuCategoryDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'menuitems',
        localField: 'menuItemId',
        foreignField: '_id',
        as: 'menuItemDoc',
      },
    },
    { $unwind: { path: '$menuItemDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'users',
        localField: 'createdBy',
        foreignField: '_id',
        as: 'createdByDoc',
      },
    },
    { $unwind: { path: '$createdByDoc', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        orderId: 1,
        customerName: { $ifNull: ['$customerDoc.name', 'Walk-in'] },
        mobileNumber: { $ifNull: ['$customerDoc.phone', ''] },
        branchName: { $ifNull: ['$branchDoc.name', ''] },
        menuCategory: { $ifNull: ['$menuCategoryDoc.name', ''] },
        menuItem: { $ifNull: ['$menuItemDoc.name', ''] },
        quantity: { $literal: 1 },
        billAmount: 1,
        amountReceived: 1,
        walletUsed: '$walletAmount',
        walletAdded: {
          $cond: [
            { $gt: ['$amountReceived', '$billAmount'] },
            { $subtract: ['$amountReceived', '$billAmount'] },
            0,
          ],
        },
        paymentMethod: 1,
        paymentStatus: 1,
        createdBy: { $ifNull: ['$createdByDoc.name', '—'] },
        createdAt: 1,
      },
    },
  ];

  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    pipeline.push({
      $match: {
        $or: [
          { orderId: searchRegex },
          { customerName: searchRegex },
          { mobileNumber: searchRegex },
          { branchName: searchRegex },
          { menuCategory: searchRegex },
          { menuItem: searchRegex },
        ],
      },
    });
  }

  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  pipeline.push({ $sort: { [sortBy]: sortOrder, _id: -1 } });

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  pipeline.push({
    $facet: {
      metadata: [{ $count: 'total' }],
      data: [{ $skip: skip }, { $limit: limit }],
    },
  });

  const results = await Order.aggregate(pipeline).allowDiskUse(true);
  const total = results[0]?.metadata[0]?.total || 0;
  const data = results[0]?.data || [];

  res.status(200).json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit),
    limit,
    data: { orders: data },
  });
});

// GET /api/reports/orders-summary?from=&to=&branch=
exports.getOrderSummaryReport = asyncHandler(async (req, res, next) => {
  const bf = branchFilter(req);
  const matchStage = { isActive: { $ne: false } };
  if (bf) {
    matchStage.branch = bf;
  }

  if (req.query.from || req.query.to) {
    matchStage.createdAt = {};
    if (req.query.from) {
      const fromDate = new Date(req.query.from);
      fromDate.setHours(0, 0, 0, 0);
      matchStage.createdAt.$gte = fromDate;
    }
    if (req.query.to) {
      const toDate = new Date(req.query.to);
      toDate.setHours(23, 59, 59, 999);
      matchStage.createdAt.$lte = toDate;
    }
  }

  // 1. Summary totals
  const summaryPipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$billAmount' },
        totalCashCollection: {
          $sum: {
            $cond: [
              { $in: ['$paymentMethod', ['cash', 'mixed']] },
              '$cashAmount',
              0,
            ],
          },
        },
        totalUPICollection: {
          $sum: {
            $cond: [
              { $in: ['$paymentMethod', ['upi', 'mixed']] },
              '$onlineAmount',
              0,
            ],
          },
        },
        totalWalletPayments: { $sum: '$walletAmount' },
        totalPendingAmount: { $sum: '$pendingPaymentAmount' },
      },
    },
  ];

  // 2. Pending Payments Details
  const pendingPipeline = [
    { $match: { ...matchStage, pendingPaymentAmount: { $gt: 0 } } },
    {
      $lookup: {
        from: 'customers',
        localField: 'customer',
        foreignField: '_id',
        as: 'customerDoc',
      },
    },
    { $unwind: { path: '$customerDoc', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        orderId: 1,
        customerName: { $ifNull: ['$customerDoc.name', 'Walk-in'] },
        mobileNumber: { $ifNull: ['$customerDoc.phone', ''] },
        billAmount: 1,
        amountPaid: '$amountReceived',
        pendingAmount: '$pendingPaymentAmount',
        paymentMethod: 1,
        createdAt: 1,
      },
    },
    { $sort: { createdAt: -1 } },
  ];

  // 3. Top Selling Items
  const topSellingPipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: 'menucategories',
        localField: 'menuCategoryId',
        foreignField: '_id',
        as: 'categoryDoc',
      },
    },
    { $unwind: { path: '$categoryDoc', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'menuitems',
        localField: 'menuItemId',
        foreignField: '_id',
        as: 'itemDoc',
      },
    },
    { $unwind: { path: '$itemDoc', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          categoryName: '$categoryDoc.name',
          itemName: '$itemDoc.name',
        },
        quantitySold: { $sum: 1 },
      },
    },
    { $sort: { quantitySold: -1 } },
    { $limit: 10 },
  ];

  // 4. Wallet Transactions
  const walletMatch = {};
  if (bf) {
    walletMatch.branch = bf;
  }
  if (req.query.from || req.query.to) {
    walletMatch.createdAt = {};
    if (req.query.from) {
      walletMatch.createdAt.$gte = new Date(req.query.from);
    }
    if (req.query.to) {
      const toDate = new Date(req.query.to);
      toDate.setHours(23, 59, 59, 999);
      walletMatch.createdAt.$lte = toDate;
    }
  }

  const [summaryResult, pendingResult, topSellingResult, walletTransactions] = await Promise.all([
    Order.aggregate(summaryPipeline),
    Order.aggregate(pendingPipeline),
    Order.aggregate(topSellingPipeline),
    WalletTransaction.find(walletMatch)
      .select('orderId customerName customerPhone type amount balance createdAt')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const summary = summaryResult[0] || {
    totalOrders: 0,
    totalRevenue: 0,
    totalCashCollection: 0,
    totalUPICollection: 0,
    totalWalletPayments: 0,
    totalPendingAmount: 0,
  };

  const averageOrderValue = summary.totalOrders > 0 ? (summary.totalRevenue / summary.totalOrders) : 0;

  const topSellingItems = topSellingResult.map((item) => {
    const categoryName = item._id.categoryName || 'Menu';
    const itemName = item._id.itemName || categoryName || 'Unknown';
    return {
      name: itemName,
      category: categoryName,
      quantitySold: item.quantitySold,
    };
  });

  const walletTransactionsData = walletTransactions.map((tx) => ({
    orderId: tx.orderId || '—',
    customerName: tx.customerName || '—',
    mobileNumber: tx.customerPhone || '—',
    walletCredit: tx.type === 'credit' ? tx.amount : 0,
    walletDebit: tx.type === 'debit' ? tx.amount : 0,
    remainingBalance: tx.balance,
    createdAt: tx.createdAt,
  }));

  res.status(200).json({
    success: true,
    data: {
      summary: {
        ...summary,
        averageOrderValue,
      },
      pendingPayments: pendingResult,
      walletTransactions: walletTransactionsData,
      topSellingItems,
    },
  });
});
