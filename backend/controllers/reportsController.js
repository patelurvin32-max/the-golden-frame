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
    todayCashCollection,
    monthCashCollection,
    todayOnlineCollection,
    monthOnlineCollection,
    todayExpenses,
    monthExpenses,
    runningTables,
    availableTables,
    todayCustomers,
    totalWalletBalance,
    todayWalletCredits,
    todayWalletDebits,
    todayPaidOrders,
    todayPartialOrders,
    todayUnpaidOrders,
    totalOutstandingBalance,
  ] = await Promise.all([
    Bill.aggregate([{ $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    Bill.aggregate([{ $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    Bill.aggregate([{ $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: yearStart } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    // Cash collection (including mixed payments)
    Payment.aggregate([
      { $match: { ...matchBranch, createdAt: { $gte: todayStart } } },
      {
        $addFields: {
          cashAmount: {
            $cond: [
              { $eq: ['$method', 'mixed'] },
              { $arrayElemAt: [{ $filter: { input: '$breakdown', cond: { $eq: ['$$this.method', 'cash'] } } }, 0] },
              { $cond: [{ $eq: ['$method', 'cash'] }, { amount: '$amount' }, { amount: 0 }]
              }
            ]
          }
        }
      },
      { $group: { _id: null, total: { $sum: '$cashAmount.amount' } } }
    ]),
    Payment.aggregate([
      { $match: { ...matchBranch, createdAt: { $gte: monthStart } } },
      {
        $addFields: {
          cashAmount: {
            $cond: [
              { $eq: ['$method', 'mixed'] },
              { $arrayElemAt: [{ $filter: { input: '$breakdown', cond: { $eq: ['$$this.method', 'cash'] } } }, 0] },
              { $cond: [{ $eq: ['$method', 'cash'] }, { amount: '$amount' }, { amount: 0 }]
              }
            ]
          }
        }
      },
      { $group: { _id: null, total: { $sum: '$cashAmount.amount' } } }
    ]),
    // Online collection (including mixed payments)
    Payment.aggregate([
      { $match: { ...matchBranch, createdAt: { $gte: todayStart } } },
      {
        $addFields: {
          onlineAmount: {
            $cond: [
              { $eq: ['$method', 'mixed'] },
              { $arrayElemAt: [{ $filter: { input: '$breakdown', cond: { $eq: ['$$this.method', 'upi'] } } }, 0] },
              { $cond: [{ $eq: ['$method', 'upi'] }, { amount: '$amount' }, { amount: 0 }]
              }
            ]
          }
        }
      },
      { $group: { _id: null, total: { $sum: '$onlineAmount.amount' } } }
    ]),
    Payment.aggregate([
      { $match: { ...matchBranch, createdAt: { $gte: monthStart } } },
      {
        $addFields: {
          onlineAmount: {
            $cond: [
              { $eq: ['$method', 'mixed'] },
              { $arrayElemAt: [{ $filter: { input: '$breakdown', cond: { $eq: ['$$this.method', 'upi'] } } }, 0] },
              { $cond: [{ $eq: ['$method', 'upi'] }, { amount: '$amount' }, { amount: 0 }]
              }
            ]
          }
        }
      },
      { $group: { _id: null, total: { $sum: '$onlineAmount.amount' } } }
    ]),
    Expense.aggregate([{ $match: { ...matchBranch, date: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Expense.aggregate([{ $match: { ...matchBranch, date: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Table.countDocuments({ ...(bf ? { branch: bf } : {}), status: 'running', isActive: true }),
    Table.countDocuments({ ...(bf ? { branch: bf } : {}), status: 'available', isActive: true }),
    Session.countDocuments({ ...(matchBranch), startTime: { $gte: todayStart } }),
    Customer.aggregate([{ $match: { ...matchBranch, isActive: true } }, { $group: { _id: null, total: { $sum: '$walletBalance' } } }]),
    WalletTransaction.aggregate([{ $match: { ...matchBranch, type: 'credit', createdAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    WalletTransaction.aggregate([{ $match: { ...matchBranch, type: 'debit', createdAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    // Payment status breakdown
    Order.aggregate([{ $match: { ...matchBranch, paymentStatus: 'paid', createdAt: { $gte: todayStart } } }, { $count: 'count' }]),
    Order.aggregate([{ $match: { ...matchBranch, paymentStatus: 'partial', createdAt: { $gte: todayStart } } }, { $count: 'count' }]),
    Order.aggregate([{ $match: { ...matchBranch, paymentStatus: 'unpaid', createdAt: { $gte: todayStart } } }, { $count: 'count' }]),
    // Total outstanding balance
    Order.aggregate([{ $match: { ...matchBranch, paymentStatus: { $in: ['partial', 'unpaid'] } } }, { $group: { _id: null, total: { $sum: '$pendingPaymentAmount' } } }]),
  ]);

  const todayRev = todayRevenue[0]?.total || 0;
  const monthRev = monthRevenue[0]?.total || 0;
  const yearRev = yearRevenue[0]?.total || 0;
  const todayExp = todayExpenses[0]?.total || 0;
  const monthExp = monthExpenses[0]?.total || 0;
  const todayCash = todayCashCollection[0]?.total || 0;
  const monthCash = monthCashCollection[0]?.total || 0;
  const todayOnline = todayOnlineCollection[0]?.total || 0;
  const monthOnline = monthOnlineCollection[0]?.total || 0;

  res.status(200).json({
    success: true,
    data: {
      revenue: { today: todayRev, month: monthRev, year: yearRev },
      expenses: { today: todayExp, month: monthExp },
      profit: { today: todayRev - todayExp, month: monthRev - monthExp },
      tables: { running: runningTables, available: availableTables },
      customersToday: todayCustomers,
      collection: {
        cash: { today: todayCash, month: monthCash },
        online: { today: todayOnline, month: monthOnline },
      },
      wallet: {
        totalBalance: totalWalletBalance[0]?.total || 0,
        todayCredits: todayWalletCredits[0]?.total || 0,
        todayDebits: todayWalletDebits[0]?.total || 0,
      },
      paymentStatus: {
        paid: todayPaidOrders[0]?.count || 0,
        partial: todayPartialOrders[0]?.count || 0,
        unpaid: todayUnpaidOrders[0]?.count || 0,
        outstandingBalance: totalOutstandingBalance[0]?.total || 0,
      },
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

  const [revenue, expenses, cashTotal, onlineTotal, customerCount] = await Promise.all([
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
    // Total cash payment
    Payment.aggregate([
      { $match: { ...matchBranch, createdAt: { $gte: from, $lte: to } } },
      {
        $addFields: {
          cashAmount: {
            $cond: [
              { $eq: ['$method', 'mixed'] },
              { $arrayElemAt: [{ $filter: { input: '$breakdown', cond: { $eq: ['$$this.method', 'cash'] } } }, 0] },
              { $cond: [{ $eq: ['$method', 'cash'] }, { amount: '$amount' }, { amount: 0 }]
              }
            ]
          }
        }
      },
      { $group: { _id: null, total: { $sum: '$cashAmount.amount' } } }
    ]),
    // Total online payment
    Payment.aggregate([
      { $match: { ...matchBranch, createdAt: { $gte: from, $lte: to } } },
      {
        $addFields: {
          onlineAmount: {
            $cond: [
              { $eq: ['$method', 'mixed'] },
              { $arrayElemAt: [{ $filter: { input: '$breakdown', cond: { $eq: ['$$this.method', 'upi'] } } }, 0] },
              { $cond: [{ $eq: ['$method', 'upi'] }, { amount: '$amount' }, { amount: 0 }]
              }
            ]
          }
        }
      },
      { $group: { _id: null, total: { $sum: '$onlineAmount.amount' } } }
    ]),
    // Total customers
    Customer.countDocuments({ ...matchBranch, createdAt: { $gte: from, $lte: to } }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      revenue,
      expenses,
      summary: {
        totalCash: cashTotal[0]?.total || 0,
        totalOnline: onlineTotal[0]?.total || 0,
        totalCustomers: customerCount,
      }
    }
  });
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
  console.log('📊 Branch comparison request received');
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  console.log('📊 Month start date:', monthStart);

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

    console.log('📊 Revenue by branch:', revenueByBranch);
    console.log('📊 Expense by branch:', expenseByBranch);

    const expenseMap = Object.fromEntries(expenseByBranch.map((e) => [e._id.toString(), e.expenses]));
    const comparison = revenueByBranch.map((b) => ({
      ...b,
      expenses: expenseMap[b._id.toString()] || 0,
      profit: b.revenue - (expenseMap[b._id.toString()] || 0),
    }));

    console.log('📊 Branch comparison result:', comparison);
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
  } else if (type === 'orders') {
    const bf = branchFilter(req);
    const matchStage = { isActive: { $ne: false } };
    if (bf) {
      matchStage.branch = bf;
    }
    if (req.query.from || req.query.to) {
      matchStage.createdAt = {};
      if (req.query.from) {
        matchStage.createdAt.$gte = new Date(req.query.from);
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

    const orders = await Order.aggregate(pipeline).allowDiskUse(true);

    sheet.columns = [
      { header: 'Order ID', key: 'orderId', width: 20 },
      { header: 'Customer Name', key: 'customerName', width: 20 },
      { header: 'Mobile Number', key: 'mobileNumber', width: 15 },
      { header: 'Branch Name', key: 'branchName', width: 15 },
      { header: 'Menu Category', key: 'menuCategory', width: 15 },
      { header: 'Menu Item', key: 'menuItem', width: 20 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Bill Amount', key: 'billAmount', width: 12 },
      { header: 'Amount Received', key: 'amountReceived', width: 15 },
      { header: 'Wallet Used', key: 'walletUsed', width: 12 },
      { header: 'Wallet Added', key: 'walletAdded', width: 12 },
      { header: 'Payment Method', key: 'paymentMethod', width: 15 },
      { header: 'Payment Status', key: 'paymentStatus', width: 15 },
      { header: 'Created By', key: 'createdBy', width: 15 },
      { header: 'Created At', key: 'createdAt', width: 20 },
    ];

    orders.forEach((o) => {
      sheet.addRow({
        orderId: o.orderId,
        customerName: o.customerName,
        mobileNumber: o.mobileNumber,
        branchName: o.branchName,
        menuCategory: o.menuCategory,
        menuItem: o.menuItem,
        quantity: o.quantity,
        billAmount: o.billAmount,
        amountReceived: o.amountReceived,
        walletUsed: o.walletUsed,
        walletAdded: o.walletAdded,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        createdBy: o.createdBy,
        createdAt: o.createdAt ? new Date(o.createdAt).toLocaleString('en-IN') : '—',
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
      matchStage.createdAt.$gte = new Date(req.query.from);
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
      matchStage.createdAt.$gte = new Date(req.query.from);
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
