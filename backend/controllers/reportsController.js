const { Bill, Payment } = require('../models/Billing');
const { Expense } = require('../models/Operations');
const Session = require('../models/Session');
const Table = require('../models/Table');
const Customer = require('../models/Customer');
const asyncHandler = require('../utils/asyncHandler');
const ExcelJS = require('exceljs');
const { ROLES } = require('../config/constants');

const branchFilter = (req) => {
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches?.length) {
    return { $in: req.user.branches };
  }
  return req.query.branch ? req.query.branch : undefined;
};

// GET /api/reports/dashboard?branch=
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  const [
    todayRevenue,
    monthRevenue,
    yearRevenue,
    todayExpenses,
    monthExpenses,
    runningTables,
    availableTables,
    todayCustomers,
  ] = await Promise.all([
    Bill.aggregate([{ $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    Bill.aggregate([{ $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    Bill.aggregate([{ $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: yearStart } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    Expense.aggregate([{ $match: { ...matchBranch, date: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Expense.aggregate([{ $match: { ...matchBranch, date: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Table.countDocuments({ ...(bf ? { branch: bf } : {}), status: 'running', isActive: true }),
    Table.countDocuments({ ...(bf ? { branch: bf } : {}), status: 'available', isActive: true }),
    Session.countDocuments({ ...(matchBranch), startTime: { $gte: todayStart } }),
  ]);

  const todayRev = todayRevenue[0]?.total || 0;
  const monthRev = monthRevenue[0]?.total || 0;
  const yearRev = yearRevenue[0]?.total || 0;
  const todayExp = todayExpenses[0]?.total || 0;
  const monthExp = monthExpenses[0]?.total || 0;

  res.status(200).json({
    success: true,
    data: {
      revenue: { today: todayRev, month: monthRev, year: yearRev },
      expenses: { today: todayExp, month: monthExp },
      profit: { today: todayRev - todayExp, month: monthRev - monthExp },
      tables: { running: runningTables, available: availableTables },
      customersToday: todayCustomers,
    },
  });
});

// GET /api/reports/revenue?branch=&from=&to=&groupBy=day|week|month
exports.getRevenueReport = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const groupBy = req.query.groupBy || 'day';

  const dateFormat = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-%U' : '%Y-%m-%d';

  const [revenue, expenses] = await Promise.all([
    Bill.aggregate([
      { $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$createdAt' } }, total: { $sum: '$total' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.aggregate([
      { $match: { ...matchBranch, date: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: dateFormat, date: '$date' } }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.status(200).json({ success: true, data: { revenue, expenses } });
});

// GET /api/reports/table-usage?branch=&from=&to=
exports.getTableUsageReport = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
  const to = req.query.to ? new Date(req.query.to) : new Date();

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
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

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
});

// GET /api/reports/export/excel?branch=&from=&to=&type=revenue|expenses|sessions
exports.exportExcel = asyncHandler(async (req, res) => {
  const bf = branchFilter(req);
  const matchBranch = bf ? { branch: bf } : {};
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
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
