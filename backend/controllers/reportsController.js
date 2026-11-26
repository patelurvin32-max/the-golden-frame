const { Bill, Payment } = require('../models/Billing');
const { Expense } = require('../models/Operations');
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
const { parseDateRange, calculateReportMetrics, TIMEZONE_OFFSET } = require('../utils/reportMetricsHelper');

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
  const metrics = await calculateReportMetrics(matchBranch, from, to);
  return { totalCash: metrics.totalCash, totalOnline: metrics.totalOnline };
};

/**
 * Calculate daily metrics for date-wise Excel report
 */
const calculateDailyMetrics = async (matchBranch, from, to) => {
  const dailyData = [];
  const currentDate = new Date(from);
  currentDate.setHours(0, 0, 0, 0);
  const endDate = new Date(to);
  endDate.setHours(23, 59, 59, 999);

  // Fetch all data for the entire date range at once
  const [bills, directOrders, tournamentParticipants, expenses, billPayments] = await Promise.all([
    Bill.find({
      ...matchBranch,
      createdAt: { $gte: from, $lte: to },
      order: { $in: [null, undefined] },
    }).lean(),
    Order.find({
      ...matchBranch,
      isActive: { $ne: false },
      createdAt: { $gte: from, $lte: to },
      session: { $in: [null, undefined] },
    }).populate('menuItemId', 'name').lean(),
    TournamentParticipant.find({
      ...matchBranch,
      createdAt: { $gte: from, $lte: to },
      paymentStatus: { $in: ['paid', 'partial'] },
    }).lean(),
    Expense.find({
      ...matchBranch,
      date: { $gte: from, $lte: to },
    }).lean(),
    Payment.find({
      ...matchBranch,
      createdAt: { $gte: from, $lte: to },
    }).lean(),
  ]);

  const billIds = bills.map(b => b._id);
  const billPaymentsFiltered = billPayments.filter(p => billIds.includes(p.bill));
  const billsWithPaymentDoc = new Set(billPaymentsFiltered.map(p => String(p.bill)));

  // Create date-based maps
  const dateFormat = (date) => date.toISOString().split('T')[0];

  const dateMap = {};

  // Initialize all dates in range
  while (currentDate <= endDate) {
    const dateKey = dateFormat(currentDate);
    dateMap[dateKey] = {
      totalRevenue: 0,
      totalExpenses: 0,
      netProfit: 0,
      totalCash: 0,
      totalOnline: 0,
      totalPendingAmount: 0,
      totalCustomers: new Set(),
      totalItemsSold: 0,
      itemCounts: {},
    };
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Process bills
  bills.forEach(b => {
    const dateKey = dateFormat(new Date(b.createdAt));
    if (!dateMap[dateKey]) return;

    let revenue = 0;
    if (b.paymentStatus === 'paid') revenue = b.total || 0;
    else if (b.paymentStatus === 'partial') revenue = Math.max(0, (b.total || 0) - (b.pendingPaymentAmount || 0));

    dateMap[dateKey].totalRevenue += revenue;

    // Cash/Online from bills
    if (!billsWithPaymentDoc.has(String(b._id))) {
      if (b.paymentMethod === 'cash') {
        dateMap[dateKey].totalCash += (b.cashAmount || (b.paymentStatus === 'paid' ? b.total : b.amountReceived) || 0);
      } else if (b.paymentMethod === 'upi' || b.paymentMethod === 'card') {
        dateMap[dateKey].totalOnline += (b.onlineAmount || (b.paymentStatus === 'paid' ? b.total : b.amountReceived) || 0);
      } else if (b.paymentMethod === 'mixed') {
        dateMap[dateKey].totalCash += (b.cashAmount || 0);
        dateMap[dateKey].totalOnline += (b.onlineAmount || 0);
      }
    }

    // Pending amount
    if (b.paymentStatus !== 'paid') {
      dateMap[dateKey].totalPendingAmount += (b.pendingPaymentAmount || Math.max(0, (b.total || 0) - (b.amountReceived || 0)));
    }

    // Customers
    if (b.customer) dateMap[dateKey].totalCustomers.add(String(b.customer));

    // Items from bills
    if (Array.isArray(b.items) && b.items.length > 0) {
      b.items.forEach(it => {
        if (it.type === 'inventory') {
          const cleanName = (it.description || 'Item').replace(/^[^-]+-\s*/, '').trim();
          dateMap[dateKey].itemCounts[cleanName] = (dateMap[dateKey].itemCounts[cleanName] || 0) + (Number(it.quantity) || 1);
        }
      });
    }
  });

  // Process bill payments
  billPaymentsFiltered.forEach(p => {
    const dateKey = dateFormat(new Date(p.createdAt));
    if (!dateMap[dateKey]) return;

    if (p.method === 'cash') {
      dateMap[dateKey].totalCash += (p.amount || 0);
    } else if (p.method === 'upi' || p.method === 'card') {
      dateMap[dateKey].totalOnline += (p.amount || 0);
    } else if (p.method === 'mixed') {
      if (p.breakdown && p.breakdown.length > 0) {
        p.breakdown.forEach(b => {
          if (b.method === 'cash') dateMap[dateKey].totalCash += (b.amount || 0);
          if (b.method === 'upi' || b.method === 'card') dateMap[dateKey].totalOnline += (b.amount || 0);
        });
      } else {
        dateMap[dateKey].totalCash += (p.amount || 0);
      }
    }
  });

  // Process direct orders
  directOrders.forEach(o => {
    const dateKey = dateFormat(new Date(o.createdAt));
    if (!dateMap[dateKey]) return;

    let revenue = 0;
    if (o.paymentStatus === 'paid') revenue = o.billAmount || o.totalPaid || 0;
    else if (o.paymentStatus === 'partial') revenue = o.totalPaid || o.amountReceived || Math.max(0, (o.billAmount || 0) - (o.pendingPaymentAmount || 0));

    dateMap[dateKey].totalRevenue += revenue;

    // Cash/Online from orders
    if (o.paymentMethod === 'cash') {
      const paid = Math.max(o.cashAmount || 0, o.totalPaid || o.amountReceived || (o.paymentStatus === 'paid' ? o.billAmount : 0) || 0);
      dateMap[dateKey].totalCash += paid;
    } else if (o.paymentMethod === 'upi' || o.paymentMethod === 'card') {
      const paid = Math.max(o.onlineAmount || 0, o.totalPaid || o.amountReceived || (o.paymentStatus === 'paid' ? o.billAmount : 0) || 0);
      dateMap[dateKey].totalOnline += paid;
    } else if (o.paymentMethod === 'mixed') {
      dateMap[dateKey].totalCash += (o.cashAmount || 0);
      dateMap[dateKey].totalOnline += (o.onlineAmount || 0);
    }

    // Pending amount
    dateMap[dateKey].totalPendingAmount += (o.pendingPaymentAmount || 0);

    // Customers
    if (o.customer) dateMap[dateKey].totalCustomers.add(String(o.customer));

    // Items from orders
    if (o.menuItemId) {
      const name = o.menuItemId?.name || o.menuItem || 'Menu Item';
      dateMap[dateKey].itemCounts[name] = (dateMap[dateKey].itemCounts[name] || 0) + 1;
    }
    if (Array.isArray(o.addedItems) && o.addedItems.length > 0) {
      o.addedItems.forEach(ai => {
        const name = ai.itemName || 'Item';
        dateMap[dateKey].itemCounts[name] = (dateMap[dateKey].itemCounts[name] || 0) + (Number(ai.quantity) || 1);
      });
    }
  });

  // Process tournament participants
  tournamentParticipants.forEach(t => {
    const dateKey = dateFormat(new Date(t.createdAt));
    if (!dateMap[dateKey]) return;

    dateMap[dateKey].totalRevenue += (t.paidAmount || 0);
    dateMap[dateKey].totalCash += (t.cashAmount || 0);
    dateMap[dateKey].totalOnline += (t.onlineAmount || 0);
  });

  // Process expenses
  expenses.forEach(e => {
    const dateKey = dateFormat(new Date(e.date));
    if (!dateMap[dateKey]) return;

    dateMap[dateKey].totalExpenses += (e.amount || 0);
  });

  // Fetch registered customers for each date
  const registeredCustomers = await Customer.find({
    ...matchBranch,
    createdAt: { $gte: from, $lte: to },
  }).select('_id createdAt').lean();

  registeredCustomers.forEach(c => {
    const dateKey = dateFormat(new Date(c.createdAt));
    if (dateMap[dateKey]) {
      dateMap[dateKey].totalCustomers.add(String(c._id));
    }
  });

  // Build final daily data array
  const sortedDates = Object.keys(dateMap).sort();
  sortedDates.forEach(dateKey => {
    const day = dateMap[dateKey];
    const totalItemsSold = Object.values(day.itemCounts).reduce((sum, count) => sum + count, 0);
    const netProfit = day.totalRevenue - day.totalExpenses;

    dailyData.push({
      date: new Date(dateKey).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      totalRevenue: Math.round(day.totalRevenue * 100) / 100,
      totalExpenses: Math.round(day.totalExpenses * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      totalCash: Math.round(day.totalCash * 100) / 100,
      totalOnline: Math.round(day.totalOnline * 100) / 100,
      totalPendingAmount: Math.round(day.totalPendingAmount * 100) / 100,
      totalCustomers: day.totalCustomers.size,
      totalItemsSold: totalItemsSold,
    });
  });

  return dailyData;
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
  const [billStats, orderStats, expenseStats, tables, todayCustomers, walletResult, walletTxStats, todayColl, monthColl, tournamentStats] =
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
      TournamentParticipant.aggregate([
        {
          $lookup: {
            from: 'tournaments',
            localField: 'tournament',
            foreignField: '_id',
            as: 'tournamentInfo'
          }
        },
        { $unwind: '$tournamentInfo' },
        { $match: { ...matchBranch, paymentStatus: { $in: ['paid', 'partial'] } } },
        {
          $facet: {
            todayRevenue: [{ $match: { 'tournamentInfo.createdAt': { $gte: todayStart } } }, { $group: { _id: null, v: { $sum: '$paidAmount' } } }],
            monthRevenue: [{ $match: { 'tournamentInfo.createdAt': { $gte: monthStart } } }, { $group: { _id: null, v: { $sum: '$paidAmount' } } }],
            yearRevenue:  [{ $match: { 'tournamentInfo.createdAt': { $gte: yearStart  } } }, { $group: { _id: null, v: { $sum: '$paidAmount' } } }],
          },
        },
      ]),
    ]);

  // Helper to extract a facet value safely
  const fv = (facetResult, key, field = 'v') => facetResult[0]?.[key]?.[0]?.[field] ?? 0;

  const runningTables   = tables.filter((t) => t.status === 'running').length;
  const availableTables = tables.filter((t) => t.status === 'available').length;

  const todayRev  = fv(billStats, 'todayRevenue') + fv(orderStats, 'todayRevenue') + fv(tournamentStats, 'todayRevenue');
  const monthRev  = fv(billStats, 'monthRevenue') + fv(orderStats, 'monthRevenue') + fv(tournamentStats, 'monthRevenue');
  const yearRev   = fv(billStats, 'yearRevenue')  + fv(orderStats, 'yearRevenue')  + fv(tournamentStats, 'yearRevenue');
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

  const { from, to } = parseDateRange(req.query.from, req.query.to);

  const groupBy = req.query.groupBy || 'day';
  const dateFormat = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-%U' : '%Y-%m-%d';

  const [metrics, revenueBills, revenueOrders, revenueTournaments, expenses] = await Promise.all([
    calculateReportMetrics(matchBranch, from, to),
    Bill.aggregate([
      { $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: from, $lte: to }, order: { $in: [null, undefined] } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$createdAt', timezone: TIMEZONE_OFFSET } }, total: { $sum: '$total' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { ...matchBranch, session: { $in: [null, undefined] }, isActive: { $ne: false }, paymentStatus: 'paid', createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$createdAt', timezone: TIMEZONE_OFFSET } }, total: { $sum: '$billAmount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    TournamentParticipant.aggregate([
      {
        $lookup: {
          from: 'tournaments',
          localField: 'tournament',
          foreignField: '_id',
          as: 'tournamentInfo'
        }
      },
      { $unwind: '$tournamentInfo' },
      { $match: { ...matchBranch, paymentStatus: { $in: ['paid', 'partial'] }, 'tournamentInfo.createdAt': { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$tournamentInfo.createdAt', timezone: TIMEZONE_OFFSET } }, total: { $sum: '$paidAmount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([
      { $match: { ...matchBranch, date: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$date', timezone: TIMEZONE_OFFSET } }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  // Merge revenue from Bills, Orders, and Tournaments by date
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
  revenueTournaments.forEach((r) => {
    if (revenueMap[r._id]) {
      revenueMap[r._id].total += r.total;
      revenueMap[r._id].count += r.count;
    } else {
      revenueMap[r._id] = { _id: r._id, total: r.total, count: r.count };
    }
  });
  // Ensure dates with only expenses are also included
  expenses.forEach((e) => {
    if (!revenueMap[e._id]) {
      revenueMap[e._id] = { _id: e._id, total: 0, count: 0 };
    }
  });
  const mergedRevenue = Object.values(revenueMap).sort((a, b) => a._id.localeCompare(b._id));

  res.status(200).json({
    success: true,
    data: {
      revenue: mergedRevenue,
      expenses,
      summary: {
        totalRevenue: metrics.totalRevenue,
        totalExpenses: metrics.totalExpenses,
        netProfit: metrics.netProfit,
        totalCash: metrics.totalCash,
        totalOnline: metrics.totalOnline,
        totalCustomers: metrics.totalCustomers,
        totalPendingAmount: metrics.totalPendingAmount,
        totalItemsSold: metrics.totalItemsSold,
        highestSellingItem: metrics.highestSellingItem,
        totalCashCollection: metrics.totalCash,
        totalUPICollection: metrics.totalOnline,
      }
    }
  });
});

// GET /api/reports/table-usage?branch=&from=&to=
exports.getTableUsageReport = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};

  const { from, to } = parseDateRange(req.query.from, req.query.to);

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

// GET /api/reports/branch-comparison?from=&to=
exports.getBranchComparison = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    return res.status(403).json({ success: false, message: 'Access denied. You do not have permission to view branch comparisons.' });
  }

  const { from, to } = parseDateRange(req.query.from, req.query.to);

  try {
    const [revenueByBranch, expenseByBranch, orderRevenueByBranch, branches] = await Promise.all([
      Bill.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: from, $lte: to }, order: { $in: [null, undefined] } } },
        { $group: { _id: '$branch', revenue: { $sum: '$total' }, bills: { $sum: 1 } } },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: from, $lte: to } } },
        { $group: { _id: '$branch', expenses: { $sum: '$amount' } } },
      ]),
      Order.aggregate([
        { $match: { isActive: { $ne: false }, paymentStatus: 'paid', createdAt: { $gte: from, $lte: to }, session: { $in: [null, undefined] } } },
        { $group: { _id: '$branch', revenue: { $sum: '$billAmount' }, bills: { $sum: 1 } } },
      ]),
      Branch.find({ isActive: true }).select('name code').lean(),
    ]);

    const branchNameMap = Object.fromEntries(branches.map(b => [b._id.toString(), b.name]));
    const expenseMap = Object.fromEntries(expenseByBranch.map((e) => [e._id?.toString() || 'unknown', e.expenses || 0]));

    const branchMap = {};

    revenueByBranch.forEach(b => {
      const bId = b._id?.toString() || 'unknown';
      branchMap[bId] = {
        _id: b._id,
        branchName: branchNameMap[bId] || 'Unknown',
        revenue: (branchMap[bId]?.revenue || 0) + (b.revenue || 0),
        bills: (branchMap[bId]?.bills || 0) + (b.bills || 0),
        expenses: expenseMap[bId] || 0,
      };
    });

    orderRevenueByBranch.forEach(o => {
      const bId = o._id?.toString() || 'unknown';
      if (branchMap[bId]) {
        branchMap[bId].revenue += (o.revenue || 0);
        branchMap[bId].bills += (o.bills || 0);
      } else {
        branchMap[bId] = {
          _id: o._id,
          branchName: branchNameMap[bId] || 'Unknown',
          revenue: o.revenue || 0,
          bills: o.bills || 0,
          expenses: expenseMap[bId] || 0,
        };
      }
    });

    expenseByBranch.forEach(e => {
      const bId = e._id?.toString() || 'unknown';
      if (!branchMap[bId]) {
        branchMap[bId] = {
          _id: e._id,
          branchName: branchNameMap[bId] || 'Unknown',
          revenue: 0,
          bills: 0,
          expenses: e.expenses || 0,
        };
      }
    });

    const comparison = Object.values(branchMap).map((b) => ({
      ...b,
      profit: Math.round((b.revenue - b.expenses) * 100) / 100,
    })).sort((a, b) => b.revenue - a.revenue);

    res.status(200).json({ success: true, data: { comparison } });
  } catch (error) {
    console.error('❌ Branch comparison error:', error);
    res.status(200).json({ 
      success: true, 
      data: { comparison: [] },
      warning: 'Could not generate branch comparison. Returning empty results.'
    });
  }
});

// GET /api/reports/export/excel?branch=&from=&to=&type=revenue|expenses|orders|pending_payments|complete
exports.exportExcel = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};
  const { from, to } = parseDateRange(req.query.from, req.query.to);
  const type = req.query.type || 'complete';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'The Golden Frame';

  if (type === 'complete' || type === 'all') {
    const metrics = await calculateReportMetrics(matchBranch, from, to);

    let branchLabel = 'All Branches';
    if (bf) {
      const bDoc = await Branch.findById(bf).select('name').lean();
      if (bDoc) branchLabel = bDoc.name;
    }

    const fromDateLabel = from.toLocaleDateString('en-IN');
    const toDateLabel = to.toLocaleDateString('en-IN');

    // Sheet 1: Summary
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 30 },
    ];
    summarySheet.addRow({ metric: 'Report Type', value: 'Complete Business & Analytics Report' });
    summarySheet.addRow({ metric: 'Branch', value: branchLabel });
    summarySheet.addRow({ metric: 'From Date', value: fromDateLabel });
    summarySheet.addRow({ metric: 'To Date', value: toDateLabel });
    summarySheet.addRow({ metric: 'Generated At', value: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) });
    summarySheet.addRow({ metric: '', value: '' });
    summarySheet.addRow({ metric: 'Total Revenue', value: metrics.totalRevenue });
    summarySheet.addRow({ metric: 'Total Expenses', value: metrics.totalExpenses });
    summarySheet.addRow({ metric: 'Net Profit', value: metrics.netProfit });
    summarySheet.addRow({ metric: 'Total Cash Received', value: metrics.totalCash });
    summarySheet.addRow({ metric: 'Total Online Payments', value: metrics.totalOnline });
    summarySheet.addRow({ metric: 'Total Customers', value: metrics.totalCustomers });
    summarySheet.addRow({ metric: 'Total Pending Amount', value: metrics.totalPendingAmount });
    summarySheet.addRow({ metric: 'Total Items Sold', value: metrics.totalItemsSold });
    summarySheet.addRow({
      metric: 'Highest-Selling Item',
      value: `${metrics.highestSellingItem.name} (${metrics.highestSellingItem.quantitySold} sold)`
    });

    // Sheet 2: Date-wise Summary
    const dailySheet = workbook.addWorksheet('Date-wise Summary');
    dailySheet.columns = [
      { header: 'Sr. No.', key: 'srNo', width: 10 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Total Revenue', key: 'totalRevenue', width: 18 },
      { header: 'Total Expenses', key: 'totalExpenses', width: 18 },
      { header: 'Net Profit', key: 'netProfit', width: 15 },
      { header: 'Total Cash Received', key: 'totalCash', width: 20 },
      { header: 'Total Online Payments', key: 'totalOnline', width: 22 },
      { header: 'Total Pending Amount', key: 'totalPendingAmount', width: 22 },
      { header: 'Total Customers', key: 'totalCustomers', width: 18 },
      { header: 'Total Items Sold', key: 'totalItemsSold', width: 18 },
    ];

    const dailyMetrics = await calculateDailyMetrics(matchBranch, from, to);

    let grandTotal = {
      totalRevenue: 0,
      totalExpenses: 0,
      netProfit: 0,
      totalCash: 0,
      totalOnline: 0,
      totalPendingAmount: 0,
      totalCustomers: 0,
      totalItemsSold: 0,
    };

    dailyMetrics.forEach((day, index) => {
      dailySheet.addRow({
        srNo: index + 1,
        date: day.date,
        totalRevenue: day.totalRevenue,
        totalExpenses: day.totalExpenses,
        netProfit: day.netProfit,
        totalCash: day.totalCash,
        totalOnline: day.totalOnline,
        totalPendingAmount: day.totalPendingAmount,
        totalCustomers: day.totalCustomers,
        totalItemsSold: day.totalItemsSold,
      });

      grandTotal.totalRevenue += day.totalRevenue;
      grandTotal.totalExpenses += day.totalExpenses;
      grandTotal.netProfit += day.netProfit;
      grandTotal.totalCash += day.totalCash;
      grandTotal.totalOnline += day.totalOnline;
      grandTotal.totalPendingAmount += day.totalPendingAmount;
      grandTotal.totalCustomers += day.totalCustomers;
      grandTotal.totalItemsSold += day.totalItemsSold;
    });

    // Add Grand Total row
    const grandTotalRow = dailySheet.addRow({
      srNo: 'Grand Total',
      date: '',
      totalRevenue: Math.round(grandTotal.totalRevenue * 100) / 100,
      totalExpenses: Math.round(grandTotal.totalExpenses * 100) / 100,
      netProfit: Math.round(grandTotal.netProfit * 100) / 100,
      totalCash: Math.round(grandTotal.totalCash * 100) / 100,
      totalOnline: Math.round(grandTotal.totalOnline * 100) / 100,
      totalPendingAmount: Math.round(grandTotal.totalPendingAmount * 100) / 100,
      totalCustomers: grandTotal.totalCustomers,
      totalItemsSold: grandTotal.totalItemsSold,
    });

    // Style the Grand Total row
    grandTotalRow.font = { bold: true };
    grandTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

    // Sheet 3: Revenue & Invoices
    const revSheet = workbook.addWorksheet('Revenue & Invoices');
    revSheet.columns = [
      { header: 'Invoice / Order #', key: 'number', width: 22 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Customer', key: 'customer', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Branch', key: 'branch', width: 16 },
      { header: 'Total Amount', key: 'total', width: 14 },
      { header: 'Payment Method', key: 'method', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
    ];

    const [billsList, ordersList] = await Promise.all([
      Bill.find({ ...matchBranch, createdAt: { $gte: from, $lte: to }, order: { $in: [null, undefined] } })
        .populate('customer', 'name phone')
        .populate('branch', 'name')
        .sort('-createdAt')
        .lean(),
      Order.find({ ...matchBranch, isActive: { $ne: false }, createdAt: { $gte: from, $lte: to }, session: { $in: [null, undefined] } })
        .populate('customer', 'name phone')
        .populate('branch', 'name')
        .sort('-createdAt')
        .lean(),
    ]);

    billsList.forEach(b => revSheet.addRow({
      number: b.invoiceNumber,
      type: 'Table Session',
      date: new Date(b.createdAt).toLocaleDateString('en-IN'),
      customer: b.customer?.name || b.customerName || 'Walk-in',
      phone: b.customer?.phone || b.customerPhone || '',
      branch: b.branch?.name || '',
      total: b.total,
      method: b.paymentMethod || 'cash',
      status: b.paymentStatus,
    }));

    ordersList.forEach(o => revSheet.addRow({
      number: o.orderId,
      type: 'Direct Order',
      date: new Date(o.createdAt).toLocaleDateString('en-IN'),
      customer: o.customer?.name || 'Walk-in',
      phone: o.customer?.phone || '',
      branch: o.branch?.name || '',
      total: o.billAmount,
      method: o.paymentMethod || '—',
      status: o.paymentStatus,
    }));

    // Sheet 4: Expenses
    const expSheet = workbook.addWorksheet('Expenses');
    expSheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Title', key: 'title', width: 25 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Branch', key: 'branch', width: 16 },
      { header: 'Notes', key: 'notes', width: 30 },
    ];
    const expList = await Expense.find({ ...matchBranch, date: { $gte: from, $lte: to } })
      .populate('branch', 'name').sort('-date').lean();
    expList.forEach(e => expSheet.addRow({
      date: new Date(e.date).toLocaleDateString('en-IN'),
      title: e.title,
      category: e.category,
      amount: e.amount,
      branch: e.branch?.name || '',
      notes: e.notes || '',
    }));

    // Sheet 5: Pending Payments
    const pendSheet = workbook.addWorksheet('Pending Payments');
    pendSheet.columns = [
      { header: 'Order / Invoice #', key: 'number', width: 22 },
      { header: 'Customer', key: 'customer', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Branch', key: 'branch', width: 16 },
      { header: 'Bill Amount', key: 'billAmount', width: 14 },
      { header: 'Amount Paid', key: 'amountPaid', width: 14 },
      { header: 'Pending Amount', key: 'pendingAmount', width: 16 },
      { header: 'Payment Method', key: 'method', width: 16 },
      { header: 'Date', key: 'date', width: 16 },
    ];
    const pendingOrdersList = await Order.find({ ...matchBranch, isActive: { $ne: false }, pendingPaymentAmount: { $gt: 0 }, createdAt: { $gte: from, $lte: to } })
      .populate('customer', 'name phone')
      .populate('branch', 'name')
      .sort('-createdAt')
      .lean();
    pendingOrdersList.forEach(p => pendSheet.addRow({
      number: p.orderId,
      customer: p.customer?.name || 'Walk-in',
      phone: p.customer?.phone || '',
      branch: p.branch?.name || '',
      billAmount: p.billAmount,
      amountPaid: p.totalPaid || p.amountReceived || 0,
      pendingAmount: p.pendingPaymentAmount,
      method: p.paymentMethod || '—',
      date: new Date(p.createdAt).toLocaleDateString('en-IN'),
    }));

    // Sheet 6: Items Sold
    const itemSheet = workbook.addWorksheet('Items Sold');
    itemSheet.columns = [
      { header: 'Item Name', key: 'name', width: 30 },
      { header: 'Quantity Sold', key: 'quantity', width: 16 },
    ];
    Object.entries(metrics.itemCounts || {})
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => itemSheet.addRow({ name, quantity: count }));

    [summarySheet, dailySheet, revSheet, expSheet, pendSheet, itemSheet].forEach(s => {
      s.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      s.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    });

    const filename = `thegoldenframe-complete-report-${req.query.from || 'start'}-to-${req.query.to || 'end'}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    await workbook.xlsx.write(res);
    return res.end();
  }

  const sheet = workbook.addWorksheet(type.charAt(0).toUpperCase() + type.slice(1));

  if (type === 'revenue') {
    const [bills, orders] = await Promise.all([
      Bill.find({ ...matchBranch, createdAt: { $gte: from, $lte: to }, order: { $in: [null, undefined] } })
        .populate('customer', 'name phone')
        .populate('branch', 'name')
        .sort('-createdAt')
        .lean(),
      Order.find({ ...matchBranch, isActive: { $ne: false }, createdAt: { $gte: from, $lte: to }, session: { $in: [null, undefined] } })
        .populate('customer', 'name phone')
        .populate('branch', 'name')
        .sort('-createdAt')
        .lean(),
    ]);

    sheet.columns = [
      { header: 'Invoice / Order #', key: 'invoice', width: 22 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Customer', key: 'customer', width: 20 },
      { header: 'Branch', key: 'branch', width: 15 },
      { header: 'Total', key: 'total', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    bills.forEach((b) => sheet.addRow({
      invoice: b.invoiceNumber,
      type: 'Table Session',
      date: new Date(b.createdAt).toLocaleDateString('en-IN'),
      customer: b.customer?.name || b.customerName || 'Walk-in',
      branch: b.branch?.name || '',
      total: b.total,
      status: b.paymentStatus,
    }));

    orders.forEach((o) => sheet.addRow({
      invoice: o.orderId,
      type: 'Direct Order',
      date: new Date(o.createdAt).toLocaleDateString('en-IN'),
      customer: o.customer?.name || 'Walk-in',
      branch: o.branch?.name || '',
      total: o.billAmount,
      status: o.paymentStatus,
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
    const { from, to } = parseDateRange(req.query.from, req.query.to);
    matchStage.createdAt = { $gte: from, $lte: to };
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
    const { from, to } = parseDateRange(req.query.from, req.query.to);
    matchStage.createdAt = { $gte: from, $lte: to };
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
    const { from, to } = parseDateRange(req.query.from, req.query.to);
    walletMatch.createdAt = { $gte: from, $lte: to };
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
