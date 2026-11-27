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
const PaymentHistory = require('../models/PaymentHistory');
const asyncHandler = require('../utils/asyncHandler');
const ExcelJS = require('exceljs');
const { ROLES } = require('../config/constants');

const mongoose = require('mongoose');
const {
  parseDateRange,
  calculateReportMetrics,
  calculateOutstandingPendingSummary,
  resolveOrderPaymentBreakdown,
  resolveBillPaymentBreakdown,
  formatDateKeyIST,
  formatDisplayDateIST,
  enumerateDateKeysIST,
  formatPaymentMethodDisplay,
  formatPaymentStatusDisplay,
  round2,
  TIMEZONE_OFFSET,
} = require('../utils/reportMetricsHelper');

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
 * Calculate daily metrics for date-wise Excel report using IST (+05:30) boundaries
 * and single-source-of-truth payment/pending helpers.
 */
const calculateDailyMetrics = async (matchBranch, from, to) => {
  const dailyData = [];
  const dateKeys = enumerateDateKeysIST(from, to);
  const dateMap = {};

  dateKeys.forEach((dateKey) => {
    dateMap[dateKey] = {
      totalBillAmount: 0,
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
  });

  // Fetch all data for the date range and pending balances up to `to`
  const [bills, directOrders, tournamentParticipants, expenses, billPayments, pendingSummary] = await Promise.all([
    Bill.find({
      ...matchBranch,
      createdAt: { $gte: from, $lte: to },
      order: { $in: [null, undefined] },
      paymentStatus: { $nin: ['refunded', 'cancelled'] },
    }).lean(),
    Order.find({
      ...matchBranch,
      isActive: { $ne: false },
      createdAt: { $gte: from, $lte: to },
      session: { $in: [null, undefined] },
      paymentStatus: { $nin: ['refunded', 'cancelled'] },
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
    calculateOutstandingPendingSummary(matchBranch, from, to),
  ]);

  const directOrderIds = directOrders.map((o) => o._id);
  const directOrderIdSet = new Set(directOrderIds.map((id) => String(id)));

  const [inRangeOrderSubsequentPH, olderOrderSubsequentPHInRange] = await Promise.all([
    PaymentHistory.find({
      order: { $in: directOrderIds },
      paymentNumber: { $gt: 1 },
    }).lean(),
    PaymentHistory.find({
      ...matchBranch,
      paymentNumber: { $gt: 1 },
      createdAt: { $gte: from, $lte: to },
      order: { $type: 'objectId', $nin: directOrderIds },
    }).lean(),
  ]);

  const phByInRangeOrder = new Map();
  inRangeOrderSubsequentPH.forEach((ph) => {
    const key = String(ph.order);
    if (!phByInRangeOrder.has(key)) phByInRangeOrder.set(key, []);
    phByInRangeOrder.get(key).push(ph);
  });

  const billIds = new Set(bills.map((b) => String(b._id)));
  const billPaymentsByBill = new Map();
  billPayments.forEach((p) => {
    const bKey = String(p.bill);
    if (!billIds.has(bKey)) return;
    if (!billPaymentsByBill.has(bKey)) billPaymentsByBill.set(bKey, []);
    billPaymentsByBill.get(bKey).push(p);
  });

  // Process bills
  bills.forEach((b) => {
    const dateKey = formatDateKeyIST(b.createdAt);
    if (!dateMap[dateKey]) return;

    const bd = resolveBillPaymentBreakdown(b, {
      asOfDate: to,
      payments: billPaymentsByBill.get(String(b._id)) || [],
    });

    dateMap[dateKey].totalBillAmount += bd.collectibleBill;
    dateMap[dateKey].totalRevenue += bd.collectedTowardBill;
    dateMap[dateKey].totalCash += bd.cashAmount;
    dateMap[dateKey].totalOnline += bd.onlineAmount;

    if (b.customer) dateMap[dateKey].totalCustomers.add(String(b.customer));

    if (Array.isArray(b.items) && b.items.length > 0) {
      b.items.forEach((it) => {
        if (it.type === 'inventory') {
          const cleanName = (it.description || 'Item').replace(/^[^-]+-\s*/, '').trim();
          dateMap[dateKey].itemCounts[cleanName] = (dateMap[dateKey].itemCounts[cleanName] || 0) + (Number(it.quantity) || 1);
        }
      });
    }
  });

  // Process direct orders (attribute initial payment on order creation date, subsequent payments on their payment date)
  directOrders.forEach((o) => {
    const dateKey = formatDateKeyIST(o.createdAt);
    if (!dateMap[dateKey]) return;

    const subsequentPH = phByInRangeOrder.get(String(o._id)) || [];
    // Compute initial payment as of order creation by subtracting all subsequent paymentNumber > 1
    const initialBd = resolveOrderPaymentBreakdown(o, {
      asOfDate: new Date(o.createdAt),
      laterPayments: subsequentPH,
    });

    dateMap[dateKey].totalBillAmount += initialBd.collectibleBill;
    dateMap[dateKey].totalRevenue += initialBd.collectedTowardBill;
    dateMap[dateKey].totalCash += initialBd.cashAmount;
    dateMap[dateKey].totalOnline += initialBd.onlineAmount;

    // Attribute subsequent partial/final payments inside [from, to] to the date each payment was received
    subsequentPH.forEach((ph) => {
      const phDate = new Date(ph.createdAt);
      if (phDate < from || phDate > to) return;
      const phKey = formatDateKeyIST(phDate);
      if (!dateMap[phKey]) return;
      const paid = Number(ph.totalPaid) || 0;
      let cash = Number(ph.cashAmount) || 0;
      let online = Number(ph.onlineAmount) || 0;
      if (ph.paymentMethod === 'cash' && cash === 0 && paid > 0) cash = paid;
      if ((ph.paymentMethod === 'upi' || ph.paymentMethod === 'card') && online === 0 && paid > 0) online = paid;
      dateMap[phKey].totalRevenue += paid;
      dateMap[phKey].totalCash += cash;
      dateMap[phKey].totalOnline += online;
    });

    if (o.customer) dateMap[dateKey].totalCustomers.add(String(o.customer));

    if (!o.parentOrder) {
      if (o.menuItemId) {
        const name = o.menuItemId?.name || o.menuItem || 'Menu Item';
        dateMap[dateKey].itemCounts[name] = (dateMap[dateKey].itemCounts[name] || 0) + 1;
      }
      if (Array.isArray(o.addedItems) && o.addedItems.length > 0) {
        o.addedItems.forEach((ai) => {
          const name = ai.itemName || 'Item';
          dateMap[dateKey].itemCounts[name] = (dateMap[dateKey].itemCounts[name] || 0) + (Number(ai.quantity) || 1);
        });
      }
    }
  });

  // Payments received in [from, to] for orders created before `from`
  olderOrderSubsequentPHInRange.forEach((ph) => {
    if (ph.order && directOrderIdSet.has(String(ph.order))) return;
    const phKey = formatDateKeyIST(ph.createdAt);
    if (!dateMap[phKey]) return;
    const paid = Number(ph.totalPaid) || 0;
    let cash = Number(ph.cashAmount) || 0;
    let online = Number(ph.onlineAmount) || 0;
    if (ph.paymentMethod === 'cash' && cash === 0 && paid > 0) cash = paid;
    if ((ph.paymentMethod === 'upi' || ph.paymentMethod === 'card') && online === 0 && paid > 0) online = paid;
    dateMap[phKey].totalRevenue += paid;
    dateMap[phKey].totalCash += cash;
    dateMap[phKey].totalOnline += online;
  });

  // Process tournament participants
  tournamentParticipants.forEach((t) => {
    const dateKey = formatDateKeyIST(t.createdAt);
    if (!dateMap[dateKey]) return;

    dateMap[dateKey].totalBillAmount += (t.paidAmount || 0);
    dateMap[dateKey].totalRevenue += (t.paidAmount || 0);
    dateMap[dateKey].totalCash += (t.cashAmount || 0);
    dateMap[dateKey].totalOnline += (t.onlineAmount || 0);
  });

  // Process expenses
  expenses.forEach((e) => {
    const dateKey = formatDateKeyIST(e.date);
    if (!dateMap[dateKey]) return;

    dateMap[dateKey].totalExpenses += (e.amount || 0);
  });

  // Fetch registered customers for each date
  const registeredCustomers = await Customer.find({
    ...matchBranch,
    createdAt: { $gte: from, $lte: to },
  }).select('_id createdAt').lean();

  registeredCustomers.forEach((c) => {
    const dateKey = formatDateKeyIST(c.createdAt);
    if (dateMap[dateKey]) {
      dateMap[dateKey].totalCustomers.add(String(c._id));
    }
  });

  dateKeys.forEach((dateKey) => {
    const day = dateMap[dateKey];
    const totalItemsSold = Object.values(day.itemCounts).reduce((sum, count) => sum + count, 0);
    const netProfit = day.totalRevenue - day.totalExpenses;
    const totalPendingAmount = pendingSummary.pendingByDateKey[dateKey] || 0;

    dailyData.push({
      date: formatDisplayDateIST(dateKey),
      totalBillAmount: round2(day.totalBillAmount),
      totalRevenue: round2(day.totalRevenue),
      totalExpenses: round2(day.totalExpenses),
      netProfit: round2(netProfit),
      totalCash: round2(day.totalCash),
      totalOnline: round2(day.totalOnline),
      totalPendingAmount: round2(totalPendingAmount),
      totalCustomers: day.totalCustomers.size,
      totalItemsSold,
    });
  });

  return {
    dailyData,
    priorPendingAmount: pendingSummary.priorPendingAmount,
    periodPendingAmount: pendingSummary.periodPendingAmount,
    totalPendingAmount: pendingSummary.totalPendingAmount,
  };
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
  const [billStats, orderStats, expenseStats, tables, todayCustomers, walletResult, walletTxStats, todayColl, monthColl, tournamentStats, outstandingSummary] =
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
      calculateOutstandingPendingSummary(matchBranch, null, now),
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
        outstandingBalance: outstandingSummary.totalPendingAmount,
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
      { $match: { ...matchBranch, paymentStatus: { $in: ['paid', 'partial'] }, createdAt: { $gte: from, $lte: to }, order: { $in: [null, undefined] } } },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt', timezone: TIMEZONE_OFFSET } },
          total: {
            $sum: {
              $cond: [
                { $eq: ['$paymentStatus', 'paid'] },
                '$total',
                { $max: [0, { $ifNull: ['$amountReceived', { $subtract: ['$total', { $ifNull: ['$pendingPaymentAmount', 0] }] }] }] },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Order.aggregate([
      { $match: { ...matchBranch, session: { $in: [null, undefined] }, isActive: { $ne: false }, paymentStatus: { $in: ['paid', 'partial'] }, createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt', timezone: TIMEZONE_OFFSET } },
          total: {
            $sum: {
              $min: [
                '$billAmount',
                {
                  $max: [
                    { $ifNull: ['$totalPaid', 0] },
                    { $ifNull: ['$amountReceived', 0] },
                    { $add: [{ $ifNull: ['$cashAmount', 0] }, { $ifNull: ['$onlineAmount', 0] }, { $ifNull: ['$walletAmount', 0] }] },
                  ],
                },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
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
        totalBillAmount: metrics.totalBillAmount,
        totalRevenue: metrics.totalRevenue,
        totalExpenses: metrics.totalExpenses,
        netProfit: metrics.netProfit,
        totalCash: metrics.totalCash,
        totalOnline: metrics.totalOnline,
        totalCustomers: metrics.totalCustomers,
        totalPendingAmount: metrics.totalPendingAmount,
        periodPendingAmount: metrics.periodPendingAmount,
        priorPendingAmount: metrics.priorPendingAmount,
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

    const fromDateLabel = formatDisplayDateIST(from);
    const toDateLabel = formatDisplayDateIST(to);

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
    summarySheet.addRow({ metric: 'Total Bill Amount', value: metrics.totalBillAmount });
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
      { header: 'Total Bill Amount', key: 'totalBillAmount', width: 18 },
      { header: 'Total Revenue', key: 'totalRevenue', width: 18 },
      { header: 'Total Expenses', key: 'totalExpenses', width: 18 },
      { header: 'Net Profit', key: 'netProfit', width: 15 },
      { header: 'Total Cash Received', key: 'totalCash', width: 20 },
      { header: 'Total Online Payments', key: 'totalOnline', width: 22 },
      { header: 'Total Pending Amount', key: 'totalPendingAmount', width: 22 },
      { header: 'Total Customers', key: 'totalCustomers', width: 18 },
      { header: 'Total Items Sold', key: 'totalItemsSold', width: 18 },
    ];

    const {
      dailyData: dailyMetrics,
      periodPendingAmount,
    } = await calculateDailyMetrics(matchBranch, from, to);

    const periodTotal = {
      totalBillAmount: 0,
      totalRevenue: 0,
      totalExpenses: 0,
      netProfit: 0,
      totalCash: 0,
      totalOnline: 0,
      totalPendingAmount: 0,
      totalItemsSold: 0,
    };

    dailyMetrics.forEach((day, index) => {
      dailySheet.addRow({
        srNo: index + 1,
        date: day.date,
        totalBillAmount: day.totalBillAmount,
        totalRevenue: day.totalRevenue,
        totalExpenses: day.totalExpenses,
        netProfit: day.netProfit,
        totalCash: day.totalCash,
        totalOnline: day.totalOnline,
        totalPendingAmount: day.totalPendingAmount,
        totalCustomers: day.totalCustomers,
        totalItemsSold: day.totalItemsSold,
      });

      periodTotal.totalBillAmount += day.totalBillAmount;
      periodTotal.totalRevenue += day.totalRevenue;
      periodTotal.totalExpenses += day.totalExpenses;
      periodTotal.netProfit += day.netProfit;
      periodTotal.totalCash += day.totalCash;
      periodTotal.totalOnline += day.totalOnline;
      periodTotal.totalPendingAmount += day.totalPendingAmount;
      periodTotal.totalItemsSold += day.totalItemsSold;
    });

    // Add Grand Total row matching Summary Report
    const grandTotalRow = dailySheet.addRow({
      srNo: 'Grand Total',
      date: '',
      totalBillAmount: round2(metrics.totalBillAmount),
      totalRevenue: round2(metrics.totalRevenue),
      totalExpenses: round2(metrics.totalExpenses),
      netProfit: round2(metrics.netProfit),
      totalCash: round2(metrics.totalCash),
      totalOnline: round2(metrics.totalOnline),
      totalPendingAmount: round2(periodPendingAmount),
      totalCustomers: metrics.totalCustomers,
      totalItemsSold: periodTotal.totalItemsSold,
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
      date: formatDisplayDateIST(b.createdAt),
      customer: b.customer?.name || b.customerName || 'Walk-in',
      phone: b.customer?.phone || b.customerPhone || '',
      branch: b.branch?.name || '',
      total: b.total,
      method: b.paymentMethod || '—',
      status: b.paymentStatus,
    }));

    ordersList.forEach(o => revSheet.addRow({
      number: o.orderId,
      type: 'Direct Order',
      date: formatDisplayDateIST(o.createdAt),
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
      date: formatDisplayDateIST(e.date),
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
    const pendingCandidateOrders = await Order.find({
      ...matchBranch,
      isActive: { $ne: false },
      createdAt: { $gte: from, $lte: to },
      $or: [{ paymentStatus: { $in: ['unpaid', 'partial'] } }, { pendingPaymentAmount: { $gt: 0 } }],
    })
      .populate('customer', 'name phone')
      .populate('branch', 'name')
      .sort('-createdAt')
      .lean();
    pendingCandidateOrders.forEach(p => {
      const bd = resolveOrderPaymentBreakdown(p, { asOfDate: to });
      if (bd.pendingAmount <= 0) return;
      pendSheet.addRow({
        number: p.orderId,
        customer: p.customer?.name || 'Walk-in',
        phone: p.customer?.phone || '',
        branch: p.branch?.name || '',
        billAmount: bd.billAmount,
        amountPaid: bd.totalReceived,
        pendingAmount: bd.pendingAmount,
        method: bd.paymentMethod || '—',
        date: formatDisplayDateIST(p.createdAt),
      });
    });

    // Sheet 6: Items Sold
    const itemSheet = workbook.addWorksheet('Items Sold');
    itemSheet.columns = [
      { header: 'Item Name', key: 'name', width: 30 },
      { header: 'Quantity Sold', key: 'quantity', width: 16 },
    ];
    Object.entries(metrics.itemCounts || {})
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => itemSheet.addRow({ name, quantity: count }));

    // Sheet 7: Order Details (complete order-level breakdown, all records in range)
    const { rows: allOrderDetailRows, summary: orderPaySummary } = await buildOrderDetailsRows(
      matchBranch,
      { createdAt: { $gte: from, $lte: to } },
      to
    );

    const orderDetailsSheet = workbook.addWorksheet('Order Details');
    orderDetailsSheet.columns = [
      { header: 'Invoice / Order #', key: 'number', width: 22 },
      { header: 'Type', key: 'type', width: 16 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Customer', key: 'customer', width: 22 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Branch', key: 'branch', width: 16 },
      { header: 'Total Bill Amount', key: 'billAmount', width: 18 },
      { header: 'Cash Received', key: 'cashAmount', width: 16 },
      { header: 'Online/UPI Received', key: 'onlineAmount', width: 20 },
      { header: 'Wallet Received', key: 'walletUsed', width: 16 },
      { header: 'Pending Amount', key: 'pendingAmount', width: 16 },
      { header: 'Payment Method', key: 'method', width: 16 },
      { header: 'Status', key: 'status', width: 16 },
    ];

    const currencyFmt = '₹#,##0.00';
    allOrderDetailRows.forEach((r) => {
      const row = orderDetailsSheet.addRow({
        number: r.orderId,
        type: r.recordType,
        date: formatDisplayDateIST(r.createdAt),
        customer: r.customerName,
        phone: r.mobileNumber || '',
        branch: r.branchName || '',
        billAmount: r.billAmount,
        cashAmount: r.cashAmount,
        onlineAmount: r.onlineAmount,
        walletUsed: r.walletUsed,
        pendingAmount: r.pendingAmount,
        method: r.paymentMethodDisplay,
        status: r.paymentStatusDisplay,
      });
      ['billAmount', 'cashAmount', 'onlineAmount', 'walletUsed', 'pendingAmount'].forEach((colKey) => {
        row.getCell(colKey).numFmt = currencyFmt;
      });
    });

    const orderDetailsTotalRow = orderDetailsSheet.addRow({
      number: 'Grand Total',
      type: `${orderPaySummary.totalOrders} Orders`,
      date: '',
      customer: '',
      phone: '',
      branch: '',
      billAmount: orderPaySummary.totalBilled,
      cashAmount: orderPaySummary.totalCash,
      onlineAmount: orderPaySummary.totalOnline,
      walletUsed: orderPaySummary.totalWallet,
      pendingAmount: orderPaySummary.totalPending,
      method: '',
      status: '',
    });
    orderDetailsTotalRow.font = { bold: true };
    orderDetailsTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    ['billAmount', 'cashAmount', 'onlineAmount', 'walletUsed', 'pendingAmount'].forEach((colKey) => {
      orderDetailsTotalRow.getCell(colKey).numFmt = currencyFmt;
    });

    // Sheet 8: Payment Summary
    const paymentSummarySheet = workbook.addWorksheet('Payment Summary');
    paymentSummarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 32 },
      { header: 'Value', key: 'value', width: 28 },
    ];
    paymentSummarySheet.addRow({ metric: 'Report Type', value: 'Order & Payment Breakdown Summary' });
    paymentSummarySheet.addRow({ metric: 'Branch', value: branchLabel });
    paymentSummarySheet.addRow({ metric: 'From Date', value: fromDateLabel });
    paymentSummarySheet.addRow({ metric: 'To Date', value: toDateLabel });
    paymentSummarySheet.addRow({ metric: 'Generated At', value: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) });
    paymentSummarySheet.addRow({ metric: '', value: '' });
    paymentSummarySheet.addRow({ metric: 'Total Orders', value: orderPaySummary.totalOrders });
    const payBillRow = paymentSummarySheet.addRow({ metric: 'Total Bill Amount', value: orderPaySummary.totalBilled });
    const payRevRow = paymentSummarySheet.addRow({ metric: 'Total Revenue', value: orderPaySummary.totalRevenue });
    const payCashRow = paymentSummarySheet.addRow({ metric: 'Total Cash Received', value: orderPaySummary.totalCash });
    const payOnlineRow = paymentSummarySheet.addRow({ metric: 'Total Online/UPI Received', value: orderPaySummary.totalOnline });
    const payWalletRow = paymentSummarySheet.addRow({ metric: 'Total Wallet Payments', value: orderPaySummary.totalWallet });
    const payPendRow = paymentSummarySheet.addRow({ metric: 'Total Pending Amount', value: orderPaySummary.totalPending });
    [payBillRow, payRevRow, payCashRow, payOnlineRow, payWalletRow, payPendRow].forEach((r) => {
      r.getCell('value').numFmt = currencyFmt;
    });
    paymentSummarySheet.addRow({ metric: '', value: '' });
    paymentSummarySheet.addRow({ metric: 'Paid Orders Count', value: orderPaySummary.paidOrdersCount });
    paymentSummarySheet.addRow({ metric: 'Partially Paid Orders Count', value: orderPaySummary.partialOrdersCount });
    paymentSummarySheet.addRow({ metric: 'Unpaid Orders Count', value: orderPaySummary.unpaidOrdersCount });

    [summarySheet, dailySheet, revSheet, orderDetailsSheet, paymentSummarySheet, expSheet, pendSheet, itemSheet].forEach(s => {
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
    const matchStage = {
      isActive: { $ne: false },
      $or: [{ paymentStatus: { $in: ['unpaid', 'partial'] } }, { pendingPaymentAmount: { $gt: 0 } }],
    };
    if (bf) {
      matchStage.branch = bf;
    }
    let toBound = null;
    if (req.query.from || req.query.to) {
      const parsed = parseDateRange(req.query.from, req.query.to);
      matchStage.createdAt = {};
      if (req.query.from) matchStage.createdAt.$gte = parsed.from;
      if (req.query.to) {
        matchStage.createdAt.$lte = parsed.to;
        toBound = parsed.to;
      }
    }

    const pendingOrders = await Order.find(matchStage)
      .populate('customer', 'name phone')
      .populate('branch', 'name')
      .sort({ createdAt: -1 })
      .lean();

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

    pendingOrders.forEach((o) => {
      const bd = resolveOrderPaymentBreakdown(o, { asOfDate: toBound });
      if (bd.pendingAmount <= 0) return;
      sheet.addRow({
        orderId: o.orderId,
        customerName: o.customer?.name || 'Walk-in',
        mobileNumber: o.customer?.phone || '',
        branchName: o.branch?.name || '',
        billAmount: bd.billAmount,
        amountPaid: bd.totalReceived,
        pendingAmount: bd.pendingAmount,
        paymentMethod: bd.paymentMethod || '—',
        createdAt: o.createdAt ? new Date(o.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—',
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

/**
 * Shared helper to fetch and normalize Direct Orders and unlinked Table Session Bills
 * with accurate Cash, Online/UPI, Wallet, Pending, and Payment History details.
 */
const buildOrderDetailsRows = async (matchBranch, dateFilter, toBound) => {
  const [orders, sessionBills] = await Promise.all([
    Order.find({
      ...matchBranch,
      ...dateFilter,
      isActive: { $ne: false },
      session: { $in: [null, undefined] },
      paymentStatus: { $nin: ['refunded', 'cancelled'] },
    })
      .populate('customer', 'name phone customerId')
      .populate('branch', 'name')
      .populate('menuCategoryId', 'name')
      .populate('menuItemId', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean(),
    Bill.find({
      ...matchBranch,
      ...dateFilter,
      order: { $in: [null, undefined] },
      paymentStatus: { $nin: ['refunded', 'cancelled'] },
    })
      .populate('customer', 'name phone customerId')
      .populate('branch', 'name')
      .populate('menuCategoryId', 'name')
      .populate('menuItemId', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const orderIds = orders.map((o) => o._id);
  const billIds = sessionBills.map((b) => b._id);

  const [paymentHistories, billPayments, subOrders] = await Promise.all([
    orderIds.length
      ? PaymentHistory.find({ order: { $in: orderIds } })
        .populate('createdBy', 'name')
        .sort({ paymentNumber: 1, createdAt: 1 })
        .lean()
      : [],
    billIds.length
      ? Payment.find({ bill: { $in: billIds } })
        .populate('receivedBy', 'name')
        .sort({ createdAt: 1 })
        .lean()
      : [],
    orderIds.length
      ? Order.find({ parentOrder: { $in: orderIds }, isActive: { $ne: false } })
        .select('parentOrder billAmount')
        .lean()
      : [],
  ]);

  const phByOrder = new Map();
  paymentHistories.forEach((ph) => {
    const key = String(ph.order);
    if (!phByOrder.has(key)) phByOrder.set(key, []);
    phByOrder.get(key).push(ph);
  });

  const paymentsByBill = new Map();
  billPayments.forEach((p) => {
    const key = String(p.bill);
    if (!paymentsByBill.has(key)) paymentsByBill.set(key, []);
    paymentsByBill.get(key).push(p);
  });

  const subAllocByParent = new Map();
  subOrders.forEach((so) => {
    const key = String(so.parentOrder);
    subAllocByParent.set(key, (subAllocByParent.get(key) || 0) + (Number(so.billAmount) || 0));
  });

  const rows = [];
  const summary = {
    totalOrders: 0,
    totalBilled: 0,
    totalRevenue: 0,
    totalCash: 0,
    totalOnline: 0,
    totalWallet: 0,
    totalPending: 0,
    paidOrdersCount: 0,
    partialOrdersCount: 0,
    unpaidOrdersCount: 0,
  };

  orders.forEach((o) => {
    const phList = phByOrder.get(String(o._id)) || [];
    const subAlloc = o.parentOrder ? 0 : (subAllocByParent.get(String(o._id)) ?? null);
    const bd = resolveOrderPaymentBreakdown(o, {
      asOfDate: toBound,
      laterPayments: phList,
      subOrdersAllocated: subAlloc,
    });

    const historyEntries = phList.map((ph) => ({
      paymentNumber: ph.paymentNumber,
      paymentMethod: formatPaymentMethodDisplay(ph.paymentMethod),
      cashAmount: round2(ph.cashAmount || 0),
      onlineAmount: round2(ph.onlineAmount || 0),
      walletAmount: round2(ph.walletAmount || 0),
      totalPaid: round2(ph.totalPaid || 0),
      pendingAmount: round2(ph.pendingAmount || 0),
      paymentStatus: formatPaymentStatusDisplay(ph.paymentStatus),
      notes: ph.notes || '',
      createdBy: ph.createdBy?.name || 'Staff',
      createdAt: ph.createdAt,
    }));

    summary.totalOrders += 1;
    summary.totalBilled += bd.collectibleBill;
    summary.totalRevenue += bd.collectedTowardBill;
    summary.totalCash += bd.cashAmount;
    summary.totalOnline += bd.onlineAmount;
    summary.totalWallet += bd.walletAmount;
    summary.totalPending += bd.pendingAmount;
    if (bd.paymentStatus === 'paid') summary.paidOrdersCount += 1;
    else if (bd.paymentStatus === 'partial') summary.partialOrdersCount += 1;
    else summary.unpaidOrdersCount += 1;

    rows.push({
      _id: o._id,
      recordType: 'Direct Order',
      orderId: o.orderId,
      customerId: o.customer?.customerId || '—',
      customerName: o.customer?.name || 'Walk-in',
      mobileNumber: o.customer?.phone || '',
      branchName: o.branch?.name || '',
      menuCategory: o.menuCategoryId?.name || '',
      menuItem: o.menuItemId?.name || '',
      addedItems: o.addedItems || [],
      quantity: 1 + (Array.isArray(o.addedItems) ? o.addedItems.reduce((s, it) => s + (Number(it.quantity) || 1), 0) : 0),
      billAmount: bd.billAmount,
      amountReceived: bd.totalReceived,
      totalPaid: bd.totalReceived,
      totalReceived: bd.totalReceived,
      cashAmount: bd.cashAmount,
      onlineAmount: bd.onlineAmount,
      walletUsed: bd.walletAmount,
      walletAdded: bd.totalReceived > bd.billAmount ? round2(bd.totalReceived - bd.billAmount) : 0,
      pendingAmount: bd.pendingAmount,
      paymentMethod: bd.paymentMethod,
      paymentMethodDisplay: bd.paymentMethodDisplay,
      paymentStatus: bd.paymentStatus,
      paymentStatusDisplay: bd.paymentStatusDisplay,
      paymentHistory: historyEntries,
      notes: o.notes || '',
      createdBy: o.createdBy?.name || '—',
      createdAt: o.createdAt,
    });
  });

  sessionBills.forEach((b) => {
    const pList = paymentsByBill.get(String(b._id)) || [];
    const bd = resolveBillPaymentBreakdown(b, {
      asOfDate: toBound,
      payments: pList,
    });

    const historyEntries = pList.map((p, idx) => {
      let cash = 0;
      let online = 0;
      let wallet = 0;
      if (p.method === 'cash') cash = p.amount || 0;
      else if (p.method === 'upi' || p.method === 'card') online = p.amount || 0;
      else if (p.method === 'wallet') wallet = p.amount || 0;
      else if (p.method === 'mixed' && Array.isArray(p.breakdown)) {
        p.breakdown.forEach((item) => {
          if (item.method === 'cash') cash += item.amount || 0;
          else if (item.method === 'upi' || item.method === 'card') online += item.amount || 0;
          else if (item.method === 'wallet') wallet += item.amount || 0;
        });
      }
      return {
        paymentNumber: idx + 1,
        paymentMethod: formatPaymentMethodDisplay(p.method),
        cashAmount: round2(cash),
        onlineAmount: round2(online),
        walletAmount: round2(wallet),
        totalPaid: round2(p.amount || 0),
        pendingAmount: bd.pendingAmount,
        paymentStatus: bd.paymentStatusDisplay,
        notes: p.transactionRef || '',
        createdBy: p.receivedBy?.name || 'Staff',
        createdAt: p.createdAt,
      };
    });

    summary.totalOrders += 1;
    summary.totalBilled += bd.collectibleBill;
    summary.totalRevenue += bd.collectedTowardBill;
    summary.totalCash += bd.cashAmount;
    summary.totalOnline += bd.onlineAmount;
    summary.totalWallet += bd.walletAmount;
    summary.totalPending += bd.pendingAmount;
    if (bd.paymentStatus === 'paid') summary.paidOrdersCount += 1;
    else if (bd.paymentStatus === 'partial') summary.partialOrdersCount += 1;
    else summary.unpaidOrdersCount += 1;

    rows.push({
      _id: b._id,
      recordType: 'Table Session',
      orderId: b.invoiceNumber,
      customerId: b.customer?.customerId || '—',
      customerName: b.customer?.name || b.customerName || 'Walk-in',
      mobileNumber: b.customer?.phone || b.customerPhone || '',
      branchName: b.branch?.name || '',
      menuCategory: b.menuCategoryId?.name || b.menuCategory || '',
      menuItem: b.menuItemId?.name || b.menuItem || '',
      addedItems: b.items || [],
      quantity: Array.isArray(b.items) ? b.items.reduce((s, it) => s + (Number(it.quantity) || 1), 0) : 1,
      billAmount: bd.billAmount,
      amountReceived: bd.totalReceived,
      totalPaid: bd.totalReceived,
      totalReceived: bd.totalReceived,
      cashAmount: bd.cashAmount,
      onlineAmount: bd.onlineAmount,
      walletUsed: bd.walletAmount,
      walletAdded: 0,
      pendingAmount: bd.pendingAmount,
      paymentMethod: bd.paymentMethod,
      paymentMethodDisplay: bd.paymentMethodDisplay,
      paymentStatus: bd.paymentStatus,
      paymentStatusDisplay: bd.paymentStatusDisplay,
      paymentHistory: historyEntries,
      notes: b.notes || '',
      createdBy: b.createdBy?.name || '—',
      createdAt: b.createdAt,
    });
  });

  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  summary.totalBilled = round2(summary.totalBilled);
  summary.totalRevenue = round2(summary.totalRevenue);
  summary.totalCash = round2(summary.totalCash);
  summary.totalOnline = round2(summary.totalOnline);
  summary.totalWallet = round2(summary.totalWallet);
  summary.totalPending = round2(summary.totalPending);

  return { rows, summary };
};

// GET /api/reports/orders?from=&to=&branch=&page=&limit=&search=&sortBy=&sortOrder=
exports.getOrderDetailsReport = asyncHandler(async (req, res, next) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};

  let dateFilter = {};
  let toBound = null;
  if (req.query.from || req.query.to) {
    const { from, to } = parseDateRange(req.query.from, req.query.to);
    dateFilter = { createdAt: { $gte: from, $lte: to } };
    if (req.query.to) toBound = to;
  }

  let { rows } = await buildOrderDetailsRows(matchBranch, dateFilter, toBound);

  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    rows = rows.filter((r) =>
      searchRegex.test(r.orderId || '') ||
      searchRegex.test(r.customerName || '') ||
      searchRegex.test(r.mobileNumber || '') ||
      searchRegex.test(r.branchName || '') ||
      searchRegex.test(r.menuCategory || '') ||
      searchRegex.test(r.menuItem || '') ||
      searchRegex.test(r.paymentMethodDisplay || '') ||
      searchRegex.test(r.paymentStatusDisplay || '')
    );
  }

  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (sortBy === 'createdAt') {
      const diff = new Date(av).getTime() - new Date(bv).getTime();
      return diff !== 0 ? diff * sortOrder : String(b._id).localeCompare(String(a._id));
    }
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * sortOrder;
    }
    return String(av || '').localeCompare(String(bv || '')) * sortOrder;
  });

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const total = rows.length;
  const skip = (page - 1) * limit;
  const data = rows.slice(skip, skip + limit);

  res.status(200).json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit),
    limit,
    data,
    pagination: { total, page, pages: Math.ceil(total / limit), limit },
  });
});

// GET /api/reports/orders-summary?from=&to=&branch=
exports.getOrderSummaryReport = asyncHandler(async (req, res, next) => {
  const bf = branchFilter(req);
  const matchStage = {
    isActive: { $ne: false },
    session: { $in: [null, undefined] },
    paymentStatus: { $nin: ['refunded', 'cancelled'] },
  };
  if (bf) {
    matchStage.branch = bf;
  }

  let toBound = null;
  if (req.query.from || req.query.to) {
    const { from, to } = parseDateRange(req.query.from, req.query.to);
    matchStage.createdAt = { $gte: from, $lte: to };
    if (req.query.to) toBound = to;
  }

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

  const [ordersInPeriod, topSellingResult, walletTransactions] = await Promise.all([
    Order.find(matchStage)
      .populate('customer', 'name phone')
      .sort({ createdAt: -1 })
      .lean(),
    Order.aggregate(topSellingPipeline),
    WalletTransaction.find(walletMatch)
      .select('orderId customerName customerPhone type amount balance createdAt')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const orderIds = ordersInPeriod.map((o) => o._id);
  const [subOrders, laterPaymentHistories] = await Promise.all([
    orderIds.length
      ? Order.find({ parentOrder: { $in: orderIds }, isActive: { $ne: false } }).select('parentOrder billAmount').lean()
      : [],
    orderIds.length
      ? PaymentHistory.find({ order: { $in: orderIds }, paymentNumber: { $gt: 1 } }).select('order paymentNumber totalPaid cashAmount onlineAmount walletAmount createdAt').lean()
      : [],
  ]);

  const subAllocByParent = new Map();
  subOrders.forEach((so) => {
    const key = String(so.parentOrder);
    subAllocByParent.set(key, (subAllocByParent.get(key) || 0) + (Number(so.billAmount) || 0));
  });

  const laterPHByOrder = new Map();
  laterPaymentHistories.forEach((ph) => {
    const key = String(ph.order);
    if (!laterPHByOrder.has(key)) laterPHByOrder.set(key, []);
    laterPHByOrder.get(key).push(ph);
  });

  const summary = {
    totalOrders: ordersInPeriod.length,
    totalBilled: 0,
    totalRevenue: 0,
    totalCashCollection: 0,
    totalUPICollection: 0,
    totalWalletPayments: 0,
    totalPendingAmount: 0,
  };
  const pendingResult = [];

  ordersInPeriod.forEach((o) => {
    const subAlloc = o.parentOrder ? 0 : (subAllocByParent.get(String(o._id)) ?? null);
    const bd = resolveOrderPaymentBreakdown(o, {
      asOfDate: toBound,
      laterPayments: laterPHByOrder.get(String(o._id)) || [],
      subOrdersAllocated: subAlloc,
    });
    summary.totalBilled += bd.collectibleBill;
    summary.totalRevenue += bd.collectedTowardBill;
    summary.totalCashCollection += bd.cashAmount;
    summary.totalUPICollection += bd.onlineAmount;
    summary.totalWalletPayments += bd.walletAmount;
    summary.totalPendingAmount += bd.pendingAmount;

    if (bd.pendingAmount > 0) {
      pendingResult.push({
        orderId: o.orderId,
        customerName: o.customer?.name || 'Walk-in',
        mobileNumber: o.customer?.phone || '',
        billAmount: bd.billAmount,
        amountPaid: bd.totalReceived,
        pendingAmount: bd.pendingAmount,
        paymentMethod: bd.paymentMethod,
        createdAt: o.createdAt,
      });
    }
  });

  summary.totalBilled = round2(summary.totalBilled);
  summary.totalRevenue = round2(summary.totalRevenue);
  summary.totalCashCollection = round2(summary.totalCashCollection);
  summary.totalUPICollection = round2(summary.totalUPICollection);
  summary.totalWalletPayments = round2(summary.totalWalletPayments);
  summary.totalPendingAmount = round2(summary.totalPendingAmount);

  const reconciliation = {
    totalBilled: summary.totalBilled,
    totalCollected: summary.totalRevenue,
    totalPending: summary.totalPendingAmount,
    channelSum: round2(summary.totalCashCollection + summary.totalUPICollection + summary.totalWalletPayments),
    isBalanced: Math.abs((summary.totalRevenue + summary.totalPendingAmount) - summary.totalBilled) < 0.01 &&
      Math.abs((summary.totalCashCollection + summary.totalUPICollection + summary.totalWalletPayments) - summary.totalRevenue) < 0.01,
  };

  const averageOrderValue = summary.totalOrders > 0 ? round2(summary.totalRevenue / summary.totalOrders) : 0;

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
      reconciliation,
      pendingPayments: pendingResult,
      walletTransactions: walletTransactionsData,
      topSellingItems,
    },
  });
});
