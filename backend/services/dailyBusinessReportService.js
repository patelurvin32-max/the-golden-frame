const Branch = require('../models/Branch');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Session = require('../models/Session');
const Table = require('../models/Table');
const WalletTransaction = require('../models/WalletTransaction');
const Reservation = require('../models/Reservation');
const { Expense } = require('../models/Operations');
const { Settings } = require('../models/System');
const DailyReportDelivery = require('../models/DailyReportDelivery');
const { parseEmailList, resolveEmailProvider, sendEmail, buildSenderAddress } = require('./emailService');
const { getDailyBusinessWindow } = require('../utils/reportWindow');

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatInteger = (value) => Number(value || 0).toLocaleString('en-IN');

const formatOrderTime = (date, timeZone) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date));

const determineRecipients = (settings) => {
  const fromSettings = parseEmailList(settings?.dailyReportEmails || settings?.dailyReportRecipientEmails);
  const fromEnv = parseEmailList(process.env.DAILY_REPORT_RECIPIENT_EMAILS || process.env.DAILY_REPORT_RECIPIENT_EMAIL);
  return fromSettings.length ? fromSettings : fromEnv;
};

const determineBranchIds = async (settings) => {
  const configured = Array.isArray(settings?.dailyReportBranchIds) ? settings.dailyReportBranchIds.filter(Boolean) : [];
  if (configured.length) return configured;

  if (process.env.DAILY_REPORT_BRANCH_IDS) {
    return process.env.DAILY_REPORT_BRANCH_IDS.split(/[,;]+/).map((entry) => entry.trim()).filter(Boolean);
  }

  const activeBranches = await Branch.find({ isActive: true }).select('_id').lean();
  return activeBranches.map((branch) => branch._id);
};

const buildSubject = (reportDateLabel) => `The Golden Frame – Daily Business Report (${reportDateLabel})`;

const buildPlainTextReport = (report) => {
  const lines = [];
  lines.push(`The Golden Frame Daily Business Report`);
  lines.push(`Branch: ${report.branchName}`);
  lines.push(`Report Date: ${report.reportDateLabel}`);
  lines.push(`Generated At: ${report.generationTimeLabel}`);
  lines.push('');
  lines.push(`Customers: total ${report.summary.customer.totalCustomers}, new ${report.summary.customer.newCustomersToday}, returning ${report.summary.customer.returningCustomers}`);
  lines.push(`Orders: total ${report.summary.orders.totalOrders}, paid ${report.summary.orders.paidOrders}, partial ${report.summary.orders.partialOrders}, unpaid ${report.summary.orders.unpaidOrders}`);
  lines.push(`Revenue: ${formatCurrency(report.summary.revenue.totalRevenue)} | Cash ${formatCurrency(report.summary.revenue.totalCashCollection)} | UPI ${formatCurrency(report.summary.revenue.totalUPICollection)} | Wallet ${formatCurrency(report.summary.revenue.totalWalletPayments)}`);
  lines.push(`Expenses: ${formatCurrency(report.summary.expense.totalExpensesToday)} | Net ${formatCurrency(report.summary.expense.netRevenue)} | Profit/Loss ${formatCurrency(report.summary.expense.profitLoss)}`);
  lines.push(`Reservations: total ${report.summary.reservation.totalReservations}, confirmed ${report.summary.reservation.confirmedReservations}, cancelled ${report.summary.reservation.cancelledReservations}`);
  lines.push(`Wallet: credits ${formatCurrency(report.summary.wallet.walletCredits)}, debits ${formatCurrency(report.summary.wallet.walletDebits)}, balance ${formatCurrency(report.summary.wallet.currentTotalWalletBalance)}`);
  lines.push('');
  lines.push('Top Selling Items:');
  report.topSellingItems.forEach((item) => {
    lines.push(`- ${item.label}: ${item.quantity}`);
  });
  lines.push('');
  lines.push(`Total orders listed: ${report.orders.length}`);
  lines.push(`Total revenue from table: ${formatCurrency(report.orders.reduce((sum, order) => sum + (order.billAmount || 0), 0))}`);
  return lines.join('\n');
};

const buildHtmlTable = (headers, rows) => `
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr>
        ${headers.map((header) => `<th style="text-align:left;padding:8px;border-bottom:1px solid #d1d5db;background:#111827;color:#fff;">${escapeHtml(header)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${rows.map((row) => `<tr>${row.map((cell) => `<td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${cell}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>
`;

const sectionCard = (title, content) => `
  <div style="margin:20px 0;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
    <h2 style="margin:0 0 12px;font-size:18px;line-height:1.3;color:#111827;">${escapeHtml(title)}</h2>
    ${content}
  </div>
`;

const buildDailyReportHtml = (report) => {
  const summaryList = (items) => `<ul style="margin:0;padding-left:18px;line-height:1.7;">${items.map(({ label, value }) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join('')}</ul>`;

  const orderRows = report.orders.map((order) => [
    escapeHtml(order.orderId || '—'),
    escapeHtml(order.customerName || 'Walk-in'),
    escapeHtml(order.mobileNumber || '—'),
    escapeHtml(order.menuCategory || '—'),
    escapeHtml(order.menuItem || '—'),
    escapeHtml(formatCurrency(order.billAmount)),
    escapeHtml(formatCurrency(order.amountReceived)),
    escapeHtml(formatCurrency(order.walletUsed)),
    escapeHtml(formatCurrency(order.walletAdded)),
    escapeHtml(order.paymentMethod || '—'),
    escapeHtml(order.paymentStatus || '—'),
    escapeHtml(order.createdBy || '—'),
    escapeHtml(order.createdAtLabel || '—'),
  ]);

  const pendingRows = report.pendingPayments.map((order) => [
    escapeHtml(order.orderId || '—'),
    escapeHtml(order.customerName || 'Walk-in'),
    escapeHtml(order.mobileNumber || '—'),
    escapeHtml(formatCurrency(order.billAmount)),
    escapeHtml(formatCurrency(order.amountReceived)),
    escapeHtml(formatCurrency(order.pendingAmount)),
    escapeHtml(order.paymentMethod || '—'),
    escapeHtml(order.createdAtLabel || '—'),
  ]);

  const walletRows = report.walletTransactions.map((tx) => [
    escapeHtml(tx.orderId || '—'),
    escapeHtml(tx.customerName || '—'),
    escapeHtml(tx.customerPhone || '—'),
    escapeHtml(formatCurrency(tx.walletCredit)),
    escapeHtml(formatCurrency(tx.walletDebit)),
    escapeHtml(formatCurrency(tx.remainingBalance)),
    escapeHtml(tx.transactionTimeLabel || '—'),
  ]);

  const topItems = report.topSellingItems.length
    ? `<ol style="margin:0;padding-left:20px;line-height:1.7;">${report.topSellingItems.map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(formatInteger(item.quantity))}</li>`).join('')}</ol>`
    : '<p style="margin:0;color:#6b7280;">No item sales recorded for the report window.</p>';

  return `<!doctype html>
  <html>
    <body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:980px;margin:0 auto;padding:24px;">
        <div style="padding:20px 24px;background:#111827;color:#fff;border-radius:16px;">
          <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.8;">The Golden Frame</div>
          <h1 style="margin:8px 0 0;font-size:28px;line-height:1.2;">Daily Business Report</h1>
          <p style="margin:10px 0 0;color:#d1d5db;">Branch: ${escapeHtml(report.branchName)} | Report Date: ${escapeHtml(report.reportDateLabel)} | Generated: ${escapeHtml(report.generationTimeLabel)}</p>
        </div>

        ${sectionCard('Customer Summary', summaryList([
          { label: 'Total Customers', value: formatInteger(report.summary.customer.totalCustomers) },
          { label: 'New Customers Today', value: formatInteger(report.summary.customer.newCustomersToday) },
          { label: 'Returning Customers', value: formatInteger(report.summary.customer.returningCustomers) },
          { label: 'Total Orders', value: formatInteger(report.summary.orders.totalOrders) },
          { label: 'Paid Orders', value: formatInteger(report.summary.orders.paidOrders) },
          { label: 'Partial Orders', value: formatInteger(report.summary.orders.partialOrders) },
          { label: 'Unpaid Orders', value: formatInteger(report.summary.orders.unpaidOrders) },
          { label: 'Completed Orders', value: formatInteger(report.summary.orders.completedOrders) },
          { label: 'Pending Orders', value: formatInteger(report.summary.orders.pendingOrders) },
          { label: 'Cancelled Orders', value: formatInteger(report.summary.orders.cancelledOrders) },
        ]))}

        ${sectionCard('Revenue Summary', summaryList([
          { label: 'Total Cash Collection', value: formatCurrency(report.summary.revenue.totalCashCollection) },
          { label: 'Total UPI Collection', value: formatCurrency(report.summary.revenue.totalUPICollection) },
          { label: 'Total Mixed Payments', value: formatCurrency(report.summary.revenue.totalMixedPayments) },
          { label: 'Total Wallet Payments', value: formatCurrency(report.summary.revenue.totalWalletPayments) },
          { label: 'Total Wallet Credits', value: formatCurrency(report.summary.revenue.totalWalletCredits) },
          { label: 'Total Wallet Debits', value: formatCurrency(report.summary.revenue.totalWalletDebits) },
          { label: 'Total Pending Payments', value: formatCurrency(report.summary.revenue.totalPendingPayments) },
          { label: 'Total Revenue', value: formatCurrency(report.summary.revenue.totalRevenue) },
          { label: 'Average Order Value', value: formatCurrency(report.summary.revenue.averageOrderValue) },
        ]))}

        ${sectionCard('Expense Summary', summaryList([
          { label: 'Total Expenses Today', value: formatCurrency(report.summary.expense.totalExpensesToday) },
          { label: 'Net Revenue', value: formatCurrency(report.summary.expense.netRevenue) },
          { label: 'Profit/Loss', value: formatCurrency(report.summary.expense.profitLoss) },
        ]))}

        ${sectionCard('Session Summary', summaryList([
          { label: 'Running Tables', value: formatInteger(report.summary.session.runningTables) },
          { label: 'Completed Sessions', value: formatInteger(report.summary.session.completedSessions) },
          { label: 'Active Sessions', value: formatInteger(report.summary.session.activeSessions) },
          { label: 'Total Play Time', value: `${formatInteger(report.summary.session.totalPlayTimeMinutes)} min` },
        ]))}

        ${sectionCard('Reservation Summary', summaryList([
          { label: 'Total Reservations', value: formatInteger(report.summary.reservation.totalReservations) },
          { label: 'Confirmed Reservations', value: formatInteger(report.summary.reservation.confirmedReservations) },
          { label: 'Cancelled Reservations', value: formatInteger(report.summary.reservation.cancelledReservations) },
          { label: 'No-Show Reservations', value: formatInteger(report.summary.reservation.noShowReservations) },
        ]))}

        ${sectionCard('Wallet Summary', summaryList([
          { label: 'Wallet Credits', value: formatCurrency(report.summary.wallet.walletCredits) },
          { label: 'Wallet Debits', value: formatCurrency(report.summary.wallet.walletDebits) },
          { label: 'Current Total Wallet Balance', value: formatCurrency(report.summary.wallet.currentTotalWalletBalance) },
          { label: 'Customers with Wallet Balance', value: formatInteger(report.summary.wallet.customersWithWalletBalance) },
        ]))}

        ${sectionCard('Top Selling Items', topItems)}

        ${sectionCard('Complete Order Details', `
          ${report.orders.length ? buildHtmlTable(
            ['Order ID', 'Customer Name', 'Mobile Number', 'Menu Category', 'Menu Item', 'Bill Amount', 'Amount Received', 'Wallet Used', 'Wallet Added', 'Payment Method', 'Payment Status', 'Created By', 'Created At'],
            orderRows,
          ) : '<p style="margin:0;color:#6b7280;">No orders were created during this report window.</p>'}
          <div style="margin-top:12px;display:flex;justify-content:space-between;gap:12px;font-size:13px;color:#374151;">
            <div><strong>Total Orders:</strong> ${formatInteger(report.orders.length)}</div>
            <div><strong>Total Revenue From Table:</strong> ${formatCurrency(report.orderRevenueFromTable)}</div>
          </div>
        `)}

        ${report.pendingPayments.length ? sectionCard('Pending Payment Details', `
          ${buildHtmlTable(
            ['Order ID', 'Customer Name', 'Mobile Number', 'Bill Amount', 'Amount Paid', 'Pending Amount', 'Payment Method', 'Created At'],
            pendingRows,
          )}
          <div style="margin-top:12px;font-size:13px;color:#374151;"><strong>Total Pending Amount:</strong> ${escapeHtml(formatCurrency(report.summary.revenue.totalPendingPayments))}</div>
        `) : ''}

        ${report.walletTransactions.length ? sectionCard('Wallet Transaction Details', buildHtmlTable(
          ['Order ID', 'Customer Name', 'Mobile Number', 'Wallet Credit', 'Wallet Debit', 'Remaining Wallet Balance', 'Transaction Time'],
          walletRows,
        )) : ''}

        <p style="margin:18px 0 0;color:#6b7280;font-size:12px;">This report was generated automatically by The Golden Frame management system.</p>
      </div>
    </body>
  </html>`;
};

const getBranchIdsForReport = async (settings) => {
  const branchIds = await determineBranchIds(settings);
  return branchIds.filter(Boolean);
};

const getReportRecipientsForSettings = (settings) => determineRecipients(settings);

const buildDailyBusinessReportForBranch = async ({ branchId, settings, now = new Date() }) => {
  const timezone = settings?.timezone || process.env.REPORT_TIMEZONE || 'Asia/Kolkata';
  const window = getDailyBusinessWindow(now, timezone);
  const branch = await Branch.findById(branchId).select('name code isActive').lean();
  if (!branch) {
    throw new Error(`Branch not found for id ${branchId}`);
  }

  const branchMatch = { branch: branch._id, createdAt: { $gte: window.windowStart, $lt: window.windowEnd } };
  const activeCustomerMatch = { branch: branch._id, isActive: true };

  const [
    orderAggregation,
    expenseAggregation,
    sessionAggregation,
    reservationAggregation,
    walletAggregation,
    customerSummary,
    currentWalletBalance,
    activeSessionCounts,
    runningTableCount,
    customerIdsInOrders,
  ] = await Promise.all([
    Order.aggregate([
      { $match: { ...branchMatch, isActive: { $ne: false } } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                paidOrders: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] } },
                partialOrders: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'partial'] }, 1, 0] } },
                unpaidOrders: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'unpaid'] }, 1, 0] } },
                completedOrders: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] } },
                pendingOrders: { $sum: { $cond: [{ $in: ['$paymentStatus', ['unpaid', 'partial']] }, 1, 0] } },
                cancelledOrders: { $sum: { $cond: [{ $in: ['$paymentStatus', ['cancelled', 'refunded']] }, 1, 0] } },
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
                totalMixedPayments: {
                  $sum: {
                    $cond: [{ $eq: ['$paymentMethod', 'mixed'] }, { $add: ['$cashAmount', '$onlineAmount'] }, 0],
                  },
                },
                totalWalletPayments: { $sum: '$walletAmount' },
                totalPendingPayments: { $sum: '$pendingPaymentAmount' },
                totalAmountReceived: { $sum: '$amountReceived' },
              },
            },
          ],
          details: [
            {
              $lookup: {
                from: 'customers',
                localField: 'customer',
                foreignField: '_id',
                as: 'customer',
              },
            },
            { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'menucategories',
                localField: 'menuCategoryId',
                foreignField: '_id',
                as: 'menuCategory',
              },
            },
            { $unwind: { path: '$menuCategory', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'menuitems',
                localField: 'menuItemId',
                foreignField: '_id',
                as: 'menuItem',
              },
            },
            { $unwind: { path: '$menuItem', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'users',
                localField: 'createdBy',
                foreignField: '_id',
                as: 'createdByUser',
              },
            },
            { $unwind: { path: '$createdByUser', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                _id: 0,
                orderId: 1,
                customerName: { $ifNull: ['$customer.name', 'Walk-in'] },
                mobileNumber: { $ifNull: ['$customer.phone', ''] },
                menuCategory: { $ifNull: ['$menuCategory.name', ''] },
                menuItem: { $ifNull: ['$menuItem.name', ''] },
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
                pendingPaymentAmount: 1,
                paymentMethod: 1,
                paymentStatus: 1,
                createdAt: 1,
                createdAtLabel: {
                  $dateToString: {
                    date: '$createdAt',
                    timezone,
                    format: '%d %b %Y, %H:%M:%S',
                  },
                },
                createdBy: { $ifNull: ['$createdByUser.name', '—'] },
              },
            },
          ],
          customerIds: [
            { $group: { _id: '$customer' } },
          ],
        },
      },
    ]).allowDiskUse(true),
    Expense.aggregate([
      { $match: { branch: branch._id, date: { $gte: window.windowStart, $lt: window.windowEnd } } },
      { $group: { _id: null, totalExpensesToday: { $sum: '$amount' } } },
    ]),
    Session.aggregate([
      { $match: { branch: branch._id, status: 'completed', startTime: { $gte: window.windowStart, $lt: window.windowEnd } } },
      {
        $group: {
          _id: null,
          completedSessions: { $sum: 1 },
          totalPlayTimeMinutes: { $sum: '$billableMinutes' },
        },
      },
    ]),
    Reservation.aggregate([
      { $match: { branch: branch._id, createdAt: { $gte: window.windowStart, $lt: window.windowEnd } } },
      {
        $group: {
          _id: null,
          totalReservations: { $sum: 1 },
          confirmedReservations: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          cancelledReservations: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          noShowReservations: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
        },
      },
    ]),
    WalletTransaction.aggregate([
      { $match: { branch: branch._id, createdAt: { $gte: window.windowStart, $lt: window.windowEnd } } },
      {
        $group: {
          _id: null,
          walletCredits: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
          walletDebits: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
        },
      },
    ]),
    Customer.countDocuments({ ...activeCustomerMatch, createdAt: { $gte: window.windowStart, $lt: window.windowEnd } }),
    Customer.aggregate([
      { $match: { branch: branch._id, isActive: true } },
      { $group: { _id: null, totalWalletBalance: { $sum: '$walletBalance' }, customersWithWalletBalance: { $sum: { $cond: [{ $gt: ['$walletBalance', 0] }, 1, 0] } } } },
    ]),
    Session.countDocuments({ branch: branch._id, status: { $in: ['running', 'paused'] } }),
    Table.countDocuments({ branch: branch._id, status: 'running', isActive: true }),
    Order.aggregate([
      { $match: { ...branchMatch, isActive: { $ne: false } } },
      { $group: { _id: '$customer' } },
    ]),
  ]);

  const orderFacet = orderAggregation[0] || {};
  const overview = orderFacet.overview?.[0] || {};
  const orders = orderFacet.details || [];
  const orderCustomerIds = (orderFacet.customerIds || []).map((item) => item._id).filter(Boolean);

  const newCustomersToday = customerSummary || 0;
  const returningCustomers = orderCustomerIds.length
    ? await Customer.countDocuments({
      _id: { $in: orderCustomerIds },
      branch: branch._id,
      isActive: true,
      createdAt: { $lt: window.windowStart },
    })
    : 0;

  const expenseToday = expenseAggregation[0]?.totalExpensesToday || 0;
  const sessionSummary = sessionAggregation[0] || {};
  const reservationSummary = reservationAggregation[0] || {};
  const walletSummary = walletAggregation[0] || {};
  const walletBalanceSummary = currentWalletBalance[0] || {};

  const topSellingMap = new Map();
  for (const order of orders) {
    const key = `${order.menuCategory || 'Menu'} :: ${order.menuItem || order.menuCategory || 'Unknown'}`;
    const current = topSellingMap.get(key) || { label: order.menuItem || order.menuCategory || 'Unknown', quantity: 0 };
    current.quantity += 1;
    current.label = order.menuItem ? `${order.menuCategory ? `${order.menuCategory} - ` : ''}${order.menuItem}` : order.menuCategory || 'Unknown';
    topSellingMap.set(key, current);
  }

  const topSellingItems = [...topSellingMap.values()]
    .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label))
    .slice(0, 5);

  const pendingPayments = orders
    .filter((order) => Number(order.pendingPaymentAmount || 0) > 0)
    .map((order) => ({
      ...order,
      pendingAmount: order.pendingPaymentAmount || 0,
    }));

  const walletTransactions = await WalletTransaction.find({
    branch: branch._id,
    createdAt: { $gte: window.windowStart, $lt: window.windowEnd },
  })
    .select('orderId customerName customerPhone type amount balance createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  const walletTransactionRows = walletTransactions.map((tx) => ({
    orderId: tx.orderId || '—',
    customerName: tx.customerName || '—',
    customerPhone: tx.customerPhone || '—',
    walletCredit: tx.type === 'credit' ? tx.amount : 0,
    walletDebit: tx.type === 'debit' ? tx.amount : 0,
    remainingBalance: tx.balance || 0,
    transactionTimeLabel: formatOrderTime(tx.createdAt, timezone),
  }));

  const totalRevenue = Number(overview.totalRevenue || 0);
  const orderRevenueFromTable = orders.reduce((sum, order) => sum + Number(order.billAmount || 0), 0);
  const totalOrders = orders.length;
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const report = {
    branchId: branch._id.toString(),
    branchName: branch.name,
    reportDateKey: window.reportDateKey,
    reportDateLabel: window.reportDateLabel,
    generationTimeLabel: window.generationTimeLabel,
    timeZone: timezone,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    summary: {
      customer: {
        totalCustomers: await Customer.countDocuments(activeCustomerMatch),
        newCustomersToday,
        returningCustomers,
      },
      orders: {
        totalOrders,
        paidOrders: Number(overview.paidOrders || 0),
        partialOrders: Number(overview.partialOrders || 0),
        unpaidOrders: Number(overview.unpaidOrders || 0),
        completedOrders: Number(overview.completedOrders || 0),
        pendingOrders: Number(overview.pendingOrders || 0),
        cancelledOrders: Number(overview.cancelledOrders || 0),
      },
      revenue: {
        totalCashCollection: Number(overview.totalCashCollection || 0),
        totalUPICollection: Number(overview.totalUPICollection || 0),
        totalMixedPayments: Number(overview.totalMixedPayments || 0),
        totalWalletPayments: Number(overview.totalWalletPayments || 0),
        totalWalletCredits: Number(walletSummary.walletCredits || 0),
        totalWalletDebits: Number(walletSummary.walletDebits || 0),
        totalPendingPayments: Number(overview.totalPendingPayments || 0),
        totalRevenue,
        averageOrderValue,
      },
      expense: {
        totalExpensesToday: expenseToday,
        netRevenue: totalRevenue - expenseToday,
        profitLoss: totalRevenue - expenseToday,
      },
      session: {
        runningTables: runningTableCount,
        completedSessions: Number(sessionSummary.completedSessions || 0),
        activeSessions: activeSessionCounts,
        totalPlayTimeMinutes: Number(sessionSummary.totalPlayTimeMinutes || 0),
      },
      reservation: {
        totalReservations: Number(reservationSummary.totalReservations || 0),
        confirmedReservations: Number(reservationSummary.confirmedReservations || 0),
        cancelledReservations: Number(reservationSummary.cancelledReservations || 0),
        noShowReservations: Number(reservationSummary.noShowReservations || 0),
      },
      wallet: {
        walletCredits: Number(walletSummary.walletCredits || 0),
        walletDebits: Number(walletSummary.walletDebits || 0),
        currentTotalWalletBalance: Number(walletBalanceSummary.totalWalletBalance || 0),
        customersWithWalletBalance: Number(walletBalanceSummary.customersWithWalletBalance || 0),
      },
    },
    orders: orders.map((order) => ({
      orderId: order.orderId,
      customerName: order.customerName,
      mobileNumber: order.mobileNumber,
      menuCategory: order.menuCategory || '—',
      menuItem: order.menuItem || '—',
      billAmount: Number(order.billAmount || 0),
      amountReceived: Number(order.amountReceived || 0),
      walletUsed: Number(order.walletUsed || 0),
      walletAdded: Number(order.walletAdded || 0),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      createdBy: order.createdBy,
      createdAtLabel: order.createdAtLabel || formatOrderTime(order.createdAt, timezone),
    })),
    pendingPayments: pendingPayments.map((order) => ({
      orderId: order.orderId,
      customerName: order.customerName,
      mobileNumber: order.mobileNumber,
      billAmount: Number(order.billAmount || 0),
      amountReceived: Number(order.amountReceived || 0),
      pendingAmount: Number(order.pendingAmount || 0),
      paymentMethod: order.paymentMethod,
      createdAtLabel: order.createdAtLabel || formatOrderTime(order.createdAt, timezone),
    })),
    walletTransactions: walletTransactionRows,
    topSellingItems,
    orderRevenueFromTable,
  };

  report.subject = buildSubject(report.reportDateLabel);
  report.html = buildDailyReportHtml(report);
  report.text = buildPlainTextReport(report);

  return report;
};

const runDailyBusinessReportForBranch = async ({ branchId, settings, now = new Date(), triggeredBy = 'scheduler' }) => {
  const report = await buildDailyBusinessReportForBranch({ branchId, settings, now });
  const recipients = getReportRecipientsForSettings(settings);
  if (!recipients.length) {
    const delivery = await DailyReportDelivery.findOneAndUpdate(
      { reportType: 'daily_business_report', branch: report.branchId, reportDateKey: report.reportDateKey },
      {
        $set: {
          branch: report.branchId,
          branchName: report.branchName,
          reportDateKey: report.reportDateKey,
          reportDate: report.windowEnd,
          timeZone: report.timeZone,
          status: 'skipped',
          recipientEmails: [],
          provider: resolveEmailProvider(),
          subject: report.subject,
          summary: report.summary,
          attemptCount: 0,
          errorMessage: 'No report recipient email configured.',
          generatedAt: now,
          finishedAt: new Date(),
          triggeredBy,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      status: 'skipped',
      branchId: report.branchId,
      branchName: report.branchName,
      reportDateKey: report.reportDateKey,
      recipients: [],
      delivery,
      report,
      message: 'No report recipients configured.',
    };
  }

  const existing = await DailyReportDelivery.findOne({
    reportType: 'daily_business_report',
    branch: report.branchId,
    reportDateKey: report.reportDateKey,
  });

  if (existing?.status === 'sent') {
    return {
      status: 'duplicate',
      branchId: report.branchId,
      branchName: report.branchName,
      reportDateKey: report.reportDateKey,
      recipients,
      delivery: existing,
      report,
      message: 'Daily report has already been sent for this branch and date.',
    };
  }

  const delivery = existing || new DailyReportDelivery({
    reportType: 'daily_business_report',
    branch: report.branchId,
    branchName: report.branchName,
    reportDateKey: report.reportDateKey,
    reportDate: report.windowEnd,
    timeZone: report.timeZone,
    status: 'processing',
    recipientEmails: recipients,
    provider: resolveEmailProvider(),
    subject: report.subject,
    summary: report.summary,
    attemptCount: 0,
    generatedAt: now,
    startedAt: now,
    triggeredBy,
  });

  delivery.branchName = report.branchName;
  delivery.reportDate = report.windowEnd;
  delivery.timeZone = report.timeZone;
  delivery.status = 'processing';
  delivery.recipientEmails = recipients;
  delivery.provider = resolveEmailProvider();
  delivery.subject = report.subject;
  delivery.summary = report.summary;
  delivery.generatedAt = now;
  delivery.startedAt = now;
  delivery.triggeredBy = triggeredBy;
  await delivery.save();

  let sendResult = null;
  let lastError = null;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      delivery.attemptCount = attempt;
      await delivery.save();
      sendResult = await sendEmail({
        to: recipients,
        subject: report.subject,
        html: report.html,
        text: report.text,
        from: activeSettings.dailyReportFromEmail || buildSenderAddress(),
        messageType: 'daily_business_report',
        metadata: {
          branchId: report.branchId,
          branchName: report.branchName,
          reportDateKey: report.reportDateKey,
        },
        relatedModel: 'DailyReportDelivery',
        relatedId: delivery._id,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
    }
  }

  if (!sendResult) {
    delivery.status = 'failed';
    delivery.errorMessage = lastError?.message || 'Unknown email delivery failure.';
    delivery.finishedAt = new Date();
    await delivery.save();
    return {
      status: 'failed',
      branchId: report.branchId,
      branchName: report.branchName,
      reportDateKey: report.reportDateKey,
      recipients,
      delivery,
      report,
      error: lastError,
      message: lastError?.message || 'Email delivery failed.',
    };
  }

  delivery.status = 'sent';
  delivery.provider = sendResult.provider || delivery.provider;
  delivery.providerMessageId = sendResult.messageId || delivery.providerMessageId;
  delivery.errorMessage = '';
  delivery.sentAt = new Date();
  delivery.finishedAt = new Date();
  await delivery.save();

  return {
    status: 'sent',
    branchId: report.branchId,
    branchName: report.branchName,
    reportDateKey: report.reportDateKey,
    recipients,
    delivery,
    report,
    sendResult,
    message: 'Daily report sent successfully.',
  };
};

const runDailyBusinessReport = async ({ settings, now = new Date(), triggeredBy = 'scheduler' }) => {
  const activeSettings = settings || (await Settings.findOne().lean()) || {};
  if (activeSettings.dailyReportEnabled === false) {
    return {
      timeZone: activeSettings.timezone || process.env.REPORT_TIMEZONE || 'Asia/Kolkata',
      recipients: getReportRecipientsForSettings(activeSettings),
      results: [],
      skipped: true,
      message: 'Daily report automation is disabled in settings.',
    };
  }

  const reportBranchIds = await getBranchIdsForReport(activeSettings);
  const results = [];

  for (const branchId of reportBranchIds) {
    try {
      results.push(await runDailyBusinessReportForBranch({ branchId, settings: activeSettings, now, triggeredBy }));
    } catch (error) {
      results.push({
        status: 'failed',
        branchId: branchId?.toString?.() || String(branchId),
        error: error?.message || 'Unknown branch processing failure.',
        message: error?.message || 'Unknown branch processing failure.',
      });
    }
  }

  return {
    timeZone: activeSettings.timezone || process.env.REPORT_TIMEZONE || 'Asia/Kolkata',
    recipients: getReportRecipientsForSettings(activeSettings),
    results,
  };
};

module.exports = {
  escapeHtml,
  formatCurrency,
  buildSubject,
  buildDailyReportHtml,
  buildPlainTextReport,
  buildDailyBusinessReportForBranch,
  runDailyBusinessReportForBranch,
  runDailyBusinessReport,
  determineRecipients,
  determineBranchIds,
  getBranchIdsForReport,
  getReportRecipientsForSettings,
};
