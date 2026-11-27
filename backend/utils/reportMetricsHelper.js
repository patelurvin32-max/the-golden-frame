const { Bill, Payment } = require('../models/Billing');
const { Expense } = require('../models/Operations');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const TournamentParticipant = require('../models/TournamentParticipant');
const PaymentHistory = require('../models/PaymentHistory');
const { ROLES } = require('../config/constants');
const mongoose = require('mongoose');

const TIMEZONE_OFFSET = '+05:30';
const TIMEZONE_NAME = 'Asia/Kolkata';

const istDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE_NAME,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Format a Date into YYYY-MM-DD in Asia/Kolkata (+05:30)
 */
const formatDateKeyIST = (date) => {
  return istDateKeyFormatter.format(new Date(date));
};

/**
 * Format a Date or YYYY-MM-DD key into DD/MM/YYYY in Asia/Kolkata (+05:30)
 */
const formatDisplayDateIST = (dateOrKey) => {
  const key = typeof dateOrKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOrKey)
    ? dateOrKey
    : formatDateKeyIST(dateOrKey);
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

/**
 * Return start and end Date objects for a YYYY-MM-DD date key in IST (+05:30)
 */
const getDayBoundsIST = (dateKey) => ({
  start: new Date(`${dateKey}T00:00:00.000${TIMEZONE_OFFSET}`),
  end: new Date(`${dateKey}T23:59:59.999${TIMEZONE_OFFSET}`),
});

/**
 * Enumerate YYYY-MM-DD keys between from and to inclusive in IST (+05:30)
 */
const enumerateDateKeysIST = (from, to) => {
  const keys = [];
  const startKey = formatDateKeyIST(from);
  const endKey = formatDateKeyIST(to);
  let cursor = new Date(`${startKey}T12:00:00.000Z`);
  const endCursor = new Date(`${endKey}T12:00:00.000Z`);
  while (cursor <= endCursor) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
};

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

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

const formatPaymentMethodDisplay = (method) => {
  if (!method) return '—';
  const m = String(method).toLowerCase();
  if (m === 'cash') return 'Cash';
  if (m === 'upi' || m === 'card' || m === 'online') return 'Online';
  if (m === 'mixed') return 'Mixed';
  if (m === 'wallet') return 'Wallet';
  if (m === 'n/a') return '—';
  return method;
};

const formatPaymentStatusDisplay = (status) => {
  if (!status) return 'Unpaid';
  const s = String(status).toLowerCase();
  if (s === 'paid') return 'Paid';
  if (s === 'partial') return 'Partially Paid';
  if (s === 'unpaid') return 'Unpaid';
  if (s === 'refunded') return 'Refunded';
  return status;
};

/**
 * Resolve normalized payment & pending breakdown for an Order document.
 * Optionally takes subsequent PaymentHistory entries (paymentNumber > 1) and active sub-orders total.
 */
const resolveOrderPaymentBreakdown = (order, options = {}) => {
  const {
    asOfDate = null,
    laterPayments = [],
    subOrdersAllocated = null,
  } = options;

  const billAmount = Number(order.billAmount) || 0;
  const rawStatus = order.paymentStatus ? String(order.paymentStatus).toLowerCase() : 'unpaid';

  // Cancelled, soft-deleted, or refunded orders contribute 0 revenue, 0 collections, and 0 pending balance
  if (order.isActive === false || rawStatus === 'refunded' || rawStatus === 'cancelled') {
    return {
      billAmount: round2(billAmount),
      collectibleBill: 0,
      cashAmount: 0,
      onlineAmount: 0,
      walletAmount: 0,
      totalReceived: 0,
      collectedTowardBill: 0,
      pendingAmount: 0,
      paymentMethod: order.paymentMethod || null,
      paymentMethodDisplay: formatPaymentMethodDisplay(order.paymentMethod),
      paymentStatus: rawStatus,
      paymentStatusDisplay: formatPaymentStatusDisplay(rawStatus),
    };
  }

  let cash = Number(order.cashAmount) || 0;
  let online = Number(order.onlineAmount) || 0;
  let wallet = Number(order.walletAmount) || 0;
  const rawTotalPaid = Number(order.totalPaid) || 0;
  const rawAmountReceived = Number(order.amountReceived) || 0;

  const method = order.paymentMethod ? String(order.paymentMethod).toLowerCase() : null;
  if (method === 'cash' && cash === 0 && (rawTotalPaid > 0 || rawAmountReceived > 0)) {
    cash = Math.max(rawTotalPaid, rawAmountReceived);
  } else if ((method === 'upi' || method === 'card') && online === 0 && (rawTotalPaid > 0 || rawAmountReceived > 0)) {
    online = Math.max(rawTotalPaid, rawAmountReceived);
  } else if (method === 'wallet' && wallet === 0 && (rawTotalPaid > 0 || rawAmountReceived > 0)) {
    wallet = Math.max(rawTotalPaid, rawAmountReceived);
  }

  let effectivePaid = Math.max(cash + online + wallet, rawTotalPaid, rawAmountReceived);

  // Legacy fallback: if marked 'paid' with 0 recorded amounts and no pendingPlayers
  const allocatedPendingPlayers = subOrdersAllocated !== null
    ? subOrdersAllocated
    : (Array.isArray(order.pendingPlayers)
      ? order.pendingPlayers.reduce((sum, p) => sum + (Number(p.amount || p.pendingAmount) || 0), 0)
      : 0);

  if (rawStatus === 'paid' && effectivePaid === 0 && billAmount > 0 && allocatedPendingPlayers === 0) {
    effectivePaid = billAmount;
    if (method === 'upi' || method === 'card') online = billAmount;
    else if (method === 'wallet') wallet = billAmount;
    else cash = billAmount;
  }

  // If computing as of a historical To Date, subtract payments recorded strictly after asOfDate
  if (asOfDate && Array.isArray(laterPayments) && laterPayments.length > 0) {
    let laterTotal = 0;
    let laterCash = 0;
    let laterOnline = 0;
    let laterWallet = 0;
    laterPayments.forEach((ph) => {
      if (ph.paymentNumber > 1 && new Date(ph.createdAt) > asOfDate) {
        laterTotal += Number(ph.totalPaid) || 0;
        laterCash += Number(ph.cashAmount) || 0;
        laterOnline += Number(ph.onlineAmount) || 0;
        laterWallet += Number(ph.walletAmount) || 0;
      }
    });
    effectivePaid = Math.max(0, effectivePaid - laterTotal);
    cash = Math.max(0, cash - laterCash);
    online = Math.max(0, online - laterOnline);
    wallet = Math.max(0, wallet - laterWallet);
  }

  // For direct/parent order, its own collectible amount excludes amounts split onto active sub-orders
  const collectibleBill = Math.max(0, billAmount - allocatedPendingPlayers);
  const collectedTowardBill = Math.min(collectibleBill, effectivePaid);
  const pendingAmount = Math.max(0, round2(collectibleBill - effectivePaid));

  // Mixed payment allocation rule: ensure cash + online + wallet reconciles to collectedTowardBill
  // (caps overpayment extra that went to wallet top-up and allocates any unattributed paid gap)
  const channelSum = cash + online + wallet;
  if (channelSum > collectedTowardBill && channelSum > 0) {
    const scale = collectedTowardBill / channelSum;
    cash = round2(cash * scale);
    online = round2(online * scale);
    wallet = round2(collectedTowardBill - cash - online);
  } else if (collectedTowardBill > channelSum) {
    const unattributed = collectedTowardBill - channelSum;
    if (method === 'upi' || method === 'card') online += unattributed;
    else if (method === 'wallet') wallet += unattributed;
    else cash += unattributed;
  }

  // Derive accurate effective status from actual balances
  let effectiveStatus = rawStatus;
  if (pendingAmount <= 0 && (collectibleBill > 0 || effectivePaid > 0)) effectiveStatus = 'paid';
  else if (effectivePaid > 0) effectiveStatus = 'partial';
  else effectiveStatus = 'unpaid';

  // Derive effective method if multiple payment channels exist
  let effectiveMethod = order.paymentMethod || null;
  const activeChannels = (cash > 0 ? 1 : 0) + (online > 0 ? 1 : 0) + (wallet > 0 ? 1 : 0);
  if (activeChannels > 1) {
    effectiveMethod = 'mixed';
  } else if (!effectiveMethod && effectivePaid > 0) {
    if (cash > 0) effectiveMethod = 'cash';
    else if (online > 0) effectiveMethod = 'upi';
    else if (wallet > 0) effectiveMethod = 'wallet';
  }

  return {
    billAmount: round2(billAmount),
    collectibleBill: round2(collectibleBill),
    cashAmount: round2(cash),
    onlineAmount: round2(online),
    walletAmount: round2(wallet),
    totalReceived: round2(effectivePaid),
    collectedTowardBill: round2(collectedTowardBill),
    pendingAmount,
    paymentMethod: effectiveMethod,
    paymentMethodDisplay: formatPaymentMethodDisplay(effectiveMethod),
    paymentStatus: effectiveStatus,
    paymentStatusDisplay: formatPaymentStatusDisplay(effectiveStatus),
  };
};

/**
 * Resolve normalized payment & pending breakdown for a session Bill (order === null/undefined).
 */
const resolveBillPaymentBreakdown = (bill, options = {}) => {
  const {
    asOfDate = null,
    payments = [],
    linkedOrder = null,
    subOrdersAllocated = 0,
  } = options;

  const billAmount = Number(bill.total) || 0;
  const rawStatus = bill.paymentStatus ? String(bill.paymentStatus).toLowerCase() : 'unpaid';

  if (rawStatus === 'refunded' || rawStatus === 'cancelled') {
    return {
      billAmount: round2(billAmount),
      collectibleBill: 0,
      cashAmount: 0,
      onlineAmount: 0,
      walletAmount: 0,
      totalReceived: 0,
      collectedTowardBill: 0,
      pendingAmount: 0,
      paymentMethod: bill.paymentMethod || null,
      paymentMethodDisplay: formatPaymentMethodDisplay(bill.paymentMethod),
      paymentStatus: rawStatus,
      paymentStatusDisplay: formatPaymentStatusDisplay(rawStatus),
    };
  }

  let cash = 0;
  let online = 0;
  let wallet = Number(bill.walletAmount || bill.walletUsed || 0);
  let paidFromPaymentDocs = 0;

  const validPayments = payments.filter((p) => !asOfDate || new Date(p.createdAt) <= asOfDate);
  if (validPayments.length > 0) {
    validPayments.forEach((p) => {
      paidFromPaymentDocs += Number(p.amount) || 0;
      if (p.method === 'cash') {
        cash += Number(p.amount) || 0;
      } else if (p.method === 'upi' || p.method === 'card') {
        online += Number(p.amount) || 0;
      } else if (p.method === 'wallet') {
        wallet += Number(p.amount) || 0;
      } else if (p.method === 'mixed') {
        if (Array.isArray(p.breakdown) && p.breakdown.length > 0) {
          p.breakdown.forEach((b) => {
            if (b.method === 'cash') cash += Number(b.amount) || 0;
            else if (b.method === 'upi' || b.method === 'card') online += Number(b.amount) || 0;
            else if (b.method === 'wallet') wallet += Number(b.amount) || 0;
          });
        } else {
          cash += Number(p.amount) || 0;
        }
      }
    });
  } else {
    cash = Number(bill.cashAmount) || 0;
    online = Number(bill.onlineAmount) || 0;
    const method = bill.paymentMethod ? String(bill.paymentMethod).toLowerCase() : null;
    const fallbackAmt = bill.paymentStatus === 'paid' ? billAmount : (Number(bill.amountReceived) || 0);
    if (method === 'cash' && cash === 0 && fallbackAmt > 0) cash = fallbackAmt;
    else if ((method === 'upi' || method === 'card') && online === 0 && fallbackAmt > 0) online = fallbackAmt;
    else if (method === 'wallet' && wallet === 0 && fallbackAmt > 0) wallet = fallbackAmt;
  }

  let effectivePaid = Math.max(paidFromPaymentDocs, cash + online + wallet, Number(bill.amountReceived) || 0);

  if (linkedOrder) {
    const orderBreakdown = resolveOrderPaymentBreakdown(linkedOrder, { asOfDate });
    if (orderBreakdown.totalReceived > effectivePaid) {
      effectivePaid = orderBreakdown.totalReceived;
      cash = Math.max(cash, orderBreakdown.cashAmount);
      online = Math.max(online, orderBreakdown.onlineAmount);
      wallet = Math.max(wallet, orderBreakdown.walletAmount);
    }
  }

  const allocatedPendingPlayers = subOrdersAllocated > 0
    ? subOrdersAllocated
    : (Array.isArray(bill.pendingPlayers)
      ? bill.pendingPlayers.reduce((sum, p) => sum + (Number(p.amount || p.pendingAmount) || 0), 0)
      : 0);

  if (bill.paymentStatus === 'paid' && effectivePaid === 0 && billAmount > 0 && allocatedPendingPlayers === 0) {
    effectivePaid = billAmount;
    const method = bill.paymentMethod ? String(bill.paymentMethod).toLowerCase() : 'cash';
    if (method === 'upi' || method === 'card') online = billAmount;
    else if (method === 'wallet') wallet = billAmount;
    else cash = billAmount;
  }

  const collectibleBill = Math.max(0, billAmount - allocatedPendingPlayers);
  const collectedTowardBill = Math.min(collectibleBill, effectivePaid);
  const pendingAmount = Math.max(0, round2(collectibleBill - effectivePaid));

  let effectiveStatus = bill.paymentStatus || 'unpaid';
  if (effectiveStatus !== 'refunded') {
    if (pendingAmount <= 0 && (billAmount > 0 || effectivePaid > 0)) effectiveStatus = 'paid';
    else if (effectivePaid > 0) effectiveStatus = 'partial';
    else effectiveStatus = 'unpaid';
  }

  let effectiveMethod = bill.paymentMethod || null;
  if (cash > 0 && online > 0) effectiveMethod = 'mixed';
  else if (!effectiveMethod && effectivePaid > 0) {
    if (cash > 0) effectiveMethod = 'cash';
    else if (online > 0) effectiveMethod = 'upi';
    else if (wallet > 0) effectiveMethod = 'wallet';
  }

  return {
    billAmount: round2(billAmount),
    collectibleBill: round2(collectibleBill),
    cashAmount: round2(cash),
    onlineAmount: round2(online),
    walletAmount: round2(wallet),
    totalReceived: round2(effectivePaid),
    collectedTowardBill: round2(collectedTowardBill),
    pendingAmount,
    paymentMethod: effectiveMethod,
    paymentMethodDisplay: formatPaymentMethodDisplay(effectiveMethod),
    paymentStatus: effectiveStatus,
    paymentStatusDisplay: formatPaymentStatusDisplay(effectiveStatus),
  };
};

/**
 * Single source of truth calculation for outstanding pending balances as of `to` (with optional split before `from`).
 */
const calculateOutstandingPendingSummary = async (matchBranch, from, to) => {
  const [allOrdersUpToTo, allBillsUpToTo, allPaymentsUpToTo, laterPaymentHistories] = await Promise.all([
    Order.find({
      ...matchBranch,
      isActive: { $ne: false },
      paymentStatus: { $nin: ['refunded', 'cancelled'] },
      createdAt: { $lte: to },
    })
      .select('_id orderId customer branch session parentOrder billAmount totalPaid amountReceived cashAmount onlineAmount walletAmount pendingPaymentAmount paymentMethod paymentStatus pendingPlayers createdAt')
      .lean(),
    Bill.find({
      ...matchBranch,
      order: { $in: [null, undefined] },
      paymentStatus: { $nin: ['refunded', 'cancelled'] },
      createdAt: { $lte: to },
    })
      .select('_id invoiceNumber customer branch session order total paymentStatus paymentMethod cashAmount onlineAmount walletAmount walletUsed amountReceived pendingPaymentAmount pendingPlayers createdAt')
      .lean(),
    Payment.find({
      ...matchBranch,
      createdAt: { $lte: to },
    }).lean(),
    PaymentHistory.find({
      ...matchBranch,
      paymentNumber: { $gt: 1 },
      createdAt: { $gt: to },
    })
      .select('order paymentNumber totalPaid cashAmount onlineAmount walletAmount createdAt')
      .lean(),
  ]);

  const laterPHByOrder = new Map();
  laterPaymentHistories.forEach((ph) => {
    if (!ph.order) return;
    const key = String(ph.order);
    if (!laterPHByOrder.has(key)) laterPHByOrder.set(key, []);
    laterPHByOrder.get(key).push(ph);
  });

  // Group sub-orders by parentOrder so parent orders never double-count pending player splits
  const subOrdersAllocatedByParent = new Map();
  allOrdersUpToTo.forEach((o) => {
    if (o.parentOrder) {
      const pKey = String(o.parentOrder);
      subOrdersAllocatedByParent.set(pKey, (subOrdersAllocatedByParent.get(pKey) || 0) + (Number(o.billAmount) || 0));
    }
  });

  // Track sessions that have Bills so session-linked main Orders are reconciled without double counting
  const sessionBillBySessionId = new Map();
  allBillsUpToTo.forEach((b) => {
    if (b.session) sessionBillBySessionId.set(String(b.session), b);
  });

  const sessionMainOrderBySessionId = new Map();
  allOrdersUpToTo.forEach((o) => {
    if (o.session && !o.parentOrder) {
      sessionMainOrderBySessionId.set(String(o.session), o);
    }
  });

  const paymentsByBill = new Map();
  allPaymentsUpToTo.forEach((p) => {
    const key = String(p.bill);
    if (!paymentsByBill.has(key)) paymentsByBill.set(key, []);
    paymentsByBill.get(key).push(p);
  });

  const pendingByDateKey = {};
  let priorPendingAmount = 0;
  let periodPendingAmount = 0;
  let totalPendingAmount = 0;

  // 1. Process Orders (direct orders + pending-player sub-orders + session orders that have NO Bill)
  allOrdersUpToTo.forEach((o) => {
    // If this is a session main order that already has a Bill, let the Bill branch handle it to avoid double counting
    if (o.session && !o.parentOrder && sessionBillBySessionId.has(String(o.session))) {
      return;
    }

    const breakdown = resolveOrderPaymentBreakdown(o, {
      asOfDate: to,
      laterPayments: laterPHByOrder.get(String(o._id)) || [],
      subOrdersAllocated: o.parentOrder ? 0 : (subOrdersAllocatedByParent.get(String(o._id)) ?? null),
    });

    if (breakdown.pendingAmount > 0) {
      totalPendingAmount += breakdown.pendingAmount;
      if (from && new Date(o.createdAt) < from) {
        priorPendingAmount += breakdown.pendingAmount;
      } else {
        periodPendingAmount += breakdown.pendingAmount;
        const dateKey = formatDateKeyIST(o.createdAt);
        pendingByDateKey[dateKey] = round2((pendingByDateKey[dateKey] || 0) + breakdown.pendingAmount);
      }
    }
  });

  // 2. Process Session Bills (order === null)
  allBillsUpToTo.forEach((b) => {
    const linkedOrder = b.session ? sessionMainOrderBySessionId.get(String(b.session)) : null;
    const subAlloc = linkedOrder ? (subOrdersAllocatedByParent.get(String(linkedOrder._id)) || 0) : 0;
    const breakdown = resolveBillPaymentBreakdown(b, {
      asOfDate: to,
      payments: paymentsByBill.get(String(b._id)) || [],
      linkedOrder,
      subOrdersAllocated: subAlloc,
    });

    if (breakdown.pendingAmount > 0) {
      totalPendingAmount += breakdown.pendingAmount;
      if (from && new Date(b.createdAt) < from) {
        priorPendingAmount += breakdown.pendingAmount;
      } else {
        periodPendingAmount += breakdown.pendingAmount;
        const dateKey = formatDateKeyIST(b.createdAt);
        pendingByDateKey[dateKey] = round2((pendingByDateKey[dateKey] || 0) + breakdown.pendingAmount);
      }
    }
  });

  return {
    priorPendingAmount: round2(priorPendingAmount),
    periodPendingAmount: round2(periodPendingAmount),
    totalPendingAmount: round2(totalPendingAmount),
    pendingByDateKey,
  };
};

/**
 * Single source of truth calculation for report metrics without double counting
 */
const calculateReportMetrics = async (matchBranch, from, to) => {
  // 1. Fetch Bills in range (exclude bills created from orders and refunded/cancelled bills)
  const bills = await Bill.find({
    ...matchBranch,
    createdAt: { $gte: from, $lte: to },
    order: { $in: [null, undefined] },
    paymentStatus: { $nin: ['refunded', 'cancelled'] },
  }).lean();

  // 2. Fetch Direct Orders in range (exclude session duplicates and refunded/cancelled orders)
  const directOrders = await Order.find({
    ...matchBranch,
    isActive: { $ne: false },
    createdAt: { $gte: from, $lte: to },
    session: { $in: [null, undefined] },
    paymentStatus: { $nin: ['refunded', 'cancelled'] },
  }).populate('menuItemId', 'name').lean();

  // 3. Fetch subsequent partial/final payments strictly AFTER `to` (if querying a historical To Date)
  //    and active split sub-orders so parent orders never double-count pending-player splits.
  const orderIdsArr = directOrders.map((o) => o._id);

  const [tournamentParticipants, expenses, billPayments, laterPaymentsForInRangeOrders, subOrders, pendingSummary] = await Promise.all([
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
      bill: { $in: bills.map((b) => b._id) },
      createdAt: { $gte: from, $lte: to },
    }).lean(),
    orderIdsArr.length
      ? PaymentHistory.find({
        order: { $in: orderIdsArr },
        paymentNumber: { $gt: 1 },
        createdAt: { $gt: to },
      }).lean()
      : [],
    orderIdsArr.length
      ? Order.find({
        parentOrder: { $in: orderIdsArr },
        isActive: { $ne: false },
      }).select('parentOrder billAmount').lean()
      : [],
    calculateOutstandingPendingSummary(matchBranch, from, to),
  ]);

  const billPaymentsByBill = new Map();
  billPayments.forEach((p) => {
    const key = String(p.bill);
    if (!billPaymentsByBill.has(key)) billPaymentsByBill.set(key, []);
    billPaymentsByBill.get(key).push(p);
  });

  const laterPHByInRangeOrder = new Map();
  laterPaymentsForInRangeOrders.forEach((ph) => {
    const key = String(ph.order);
    if (!laterPHByInRangeOrder.has(key)) laterPHByInRangeOrder.set(key, []);
    laterPHByInRangeOrder.get(key).push(ph);
  });

  const subAllocByParent = new Map();
  subOrders.forEach((so) => {
    const key = String(so.parentOrder);
    subAllocByParent.set(key, (subAllocByParent.get(key) || 0) + (Number(so.billAmount) || 0));
  });

  let totalCash = 0;
  let totalOnline = 0;
  let billRevenue = 0;
  let totalBillAmount = 0;

  bills.forEach((b) => {
    const bd = resolveBillPaymentBreakdown(b, {
      asOfDate: to,
      payments: billPaymentsByBill.get(String(b._id)) || [],
    });
    totalBillAmount += bd.collectibleBill;
    billRevenue += bd.collectedTowardBill;
    totalCash += bd.cashAmount;
    totalOnline += bd.onlineAmount;
  });

  let orderRevenue = 0;
  directOrders.forEach((o) => {
    const subAlloc = o.parentOrder ? 0 : (subAllocByParent.get(String(o._id)) ?? null);
    const bd = resolveOrderPaymentBreakdown(o, {
      asOfDate: to,
      laterPayments: laterPHByInRangeOrder.get(String(o._id)) || [],
      subOrdersAllocated: subAlloc,
    });
    totalBillAmount += bd.collectibleBill;
    orderRevenue += bd.collectedTowardBill;
    totalCash += bd.cashAmount;
    totalOnline += bd.onlineAmount;
  });

  const tournamentRevenue = tournamentParticipants.reduce((sum, t) => sum + (t.paidAmount || 0), 0);
  totalBillAmount = round2(totalBillAmount + tournamentRevenue);
  tournamentParticipants.forEach((t) => {
    totalCash += (t.cashAmount || 0);
    totalOnline += (t.onlineAmount || 0);
  });

  const totalRevenue = round2(billRevenue + orderRevenue + tournamentRevenue);
  const totalExpenses = round2(expenses.reduce((sum, e) => sum + (e.amount || 0), 0));
  const netProfit = round2(totalRevenue - totalExpenses);
  totalCash = round2(totalCash);
  totalOnline = round2(totalOnline);

  // Total Customers in range
  const customerIdSet = new Set();
  bills.forEach((b) => { if (b.customer) customerIdSet.add(String(b.customer)); });
  directOrders.forEach((o) => { if (o.customer) customerIdSet.add(String(o.customer)); });
  const registeredCustomers = await Customer.find({
    ...matchBranch,
    createdAt: { $gte: from, $lte: to },
  }).select('_id').lean();
  registeredCustomers.forEach((c) => customerIdSet.add(String(c._id)));

  // Total Items Sold and Highest-Selling Item
  const itemCounts = {};

  directOrders.forEach((o) => {
    if (o.parentOrder) return; // avoid duplicating items from parent order on sub-orders
    if (o.menuItemId) {
      const name = o.menuItemId?.name || o.menuItem || 'Menu Item';
      itemCounts[name] = (itemCounts[name] || 0) + 1;
    }
    if (Array.isArray(o.addedItems) && o.addedItems.length > 0) {
      o.addedItems.forEach((ai) => {
        const name = ai.itemName || 'Item';
        itemCounts[name] = (itemCounts[name] || 0) + (Number(ai.quantity) || 1);
      });
    }
  });

  bills.forEach((b) => {
    if (Array.isArray(b.items) && b.items.length > 0) {
      b.items.forEach((it) => {
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
    totalBillAmount,
    totalRevenue,
    totalExpenses,
    netProfit,
    totalCash,
    totalOnline,
    totalCustomers: customerIdSet.size,
    totalPendingAmount: pendingSummary.periodPendingAmount,
    periodPendingAmount: pendingSummary.periodPendingAmount,
    priorPendingAmount: pendingSummary.priorPendingAmount,
    totalItemsSold,
    highestSellingItem,
    itemCounts,
  };
};

module.exports = {
  TIMEZONE_OFFSET,
  TIMEZONE_NAME,
  formatDateKeyIST,
  formatDisplayDateIST,
  getDayBoundsIST,
  enumerateDateKeysIST,
  parseDateRange,
  branchFilter,
  round2,
  formatPaymentMethodDisplay,
  formatPaymentStatusDisplay,
  resolveOrderPaymentBreakdown,
  resolveBillPaymentBreakdown,
  calculateOutstandingPendingSummary,
  calculateReportMetrics,
};
