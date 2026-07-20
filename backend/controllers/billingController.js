const { Bill, Payment } = require('../models/Billing');
const Session = require('../models/Session');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { Inventory } = require('../models/Operations');
const { MenuItem } = require('../models/Operations');
const { Settings } = require('../models/System');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateInvoiceNumber } = require('../utils/invoiceNumber');
const { generateInvoicePDF } = require('../services/pdfService');
const { logActivity } = require('../services/activityLogService');

// POST /api/bills  — create a bill from a completed session
exports.createBill = asyncHandler(async (req, res, next) => {
  const {
    sessionId,
    branchId,
    customerId,
    inventoryItems = [],   // [{ inventoryId, quantity }]
    discountType,          // 'flat' | 'percent' | null
    discountValue = 0,
    couponCode,
    branch,
  } = req.body;

  const targetBranch = branchId || branch;

  // Build line items
  const items = [];
  let subtotal = 0;

  // 1. Table time from session
  if (sessionId) {
    const session = await Session.findById(sessionId).populate('table', 'name type');
    if (!session) return next(new AppError('Session not found.', 404));
    if (session.status !== 'completed') return next(new AppError('Session must be stopped before billing.', 400));

    const tableItem = {
      description: `${session.table?.type?.toUpperCase()} - ${session.table?.name} (${session.billableMinutes} min)`,
      quantity: 1,
      unitPrice: session.amount,
      total: session.amount,
      type: 'table_time',
    };
    items.push(tableItem);
    subtotal += session.amount;
  }

  // 2. Inventory / food items sold
  for (const { inventoryId, quantity } of inventoryItems) {
    const item = await Inventory.findById(inventoryId);
    if (!item) continue;
    if (item.stockQuantity < quantity) {
      return next(new AppError(`Insufficient stock for ${item.name}.`, 400));
    }
    const lineTotal = item.sellingPrice * quantity;
    items.push({
      description: item.name,
      quantity,
      unitPrice: item.sellingPrice,
      total: lineTotal,
      type: 'inventory',
      inventoryItem: item._id,
    });
    subtotal += lineTotal;
    // Deduct stock
    item.stockQuantity -= quantity;
    await item.save();
  }

  // 3. Discount calculation
  let discountAmount = 0;
  if (discountType === 'flat') discountAmount = Math.min(discountValue, subtotal);
  if (discountType === 'percent') discountAmount = (subtotal * discountValue) / 100;

  // 4. Membership discount
  let membershipDiscount = 0;
  if (customerId) {
    const customer = await Customer.findById(customerId).select('membership');
    const { MembershipPlan } = require('../models/Operations');
    if (customer?.membership?.tier) {
      const plan = await MembershipPlan.findOne({ tier: customer.membership.tier, isActive: true });
      if (plan) {
        membershipDiscount = (subtotal * plan.discountPercent) / 100;
      }
    }
  }

  // 5. Tax
  const settings = await Settings.findOne();
  const taxPercent = settings?.taxPercent || 0;
  const afterDiscounts = Math.max(0, subtotal - discountAmount - membershipDiscount);
  const tax = (afterDiscounts * taxPercent) / 100;
  const total = afterDiscounts + tax;

  const invoiceNumber = await generateInvoiceNumber();

  const bill = await Bill.create({
    invoiceNumber,
    branch: targetBranch,
    customer: customerId || undefined,
    session: sessionId || undefined,
    items,
    subtotal,
    discountType: discountType || null,
    discountValue,
    discountAmount,
    couponCode,
    membershipDiscount,
    tax,
    total,
    paymentStatus: 'unpaid',
    createdBy: req.user._id,
  });

  // Update session with bill reference
  if (sessionId) {
    await Session.findByIdAndUpdate(sessionId, { bill: bill._id });
  }

  // Update customer spending
  if (customerId) {
    await Customer.findByIdAndUpdate(customerId, { $inc: { totalSpending: total } });
  }

  await logActivity({
    userId: req.user._id,
    branchId: targetBranch,
    action: 'bill.create',
    entity: 'Bill',
    entityId: bill._id,
    description: `${req.user.name} created bill ${invoiceNumber} — ₹${total}`,
    ipAddress: req.ip,
  });

  const populated = await Bill.findById(bill._id).populate('customer', 'name phone').populate('branch', 'name');
  res.status(201).json({ success: true, data: { bill: populated } });
});

// POST /api/bills/:id/payment  — record payment against a bill
exports.receivePayment = asyncHandler(async (req, res, next) => {
  const { method, amount, breakdown = [], transactionRef } = req.body;
  const bill = await Bill.findById(req.params.id);
  if (!bill) return next(new AppError('Bill not found.', 404));
  if (bill.paymentStatus === 'paid') return next(new AppError('Bill is already fully paid.', 400));

  const payment = await Payment.create({
    bill: bill._id,
    branch: bill.branch,
    method,
    breakdown,
    amount,
    receivedBy: req.user._id,
    transactionRef,
  });

  // Check if bill is now fully paid (sum all payments)
  const allPayments = await Payment.find({ bill: bill._id });
  const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
  bill.paymentStatus = totalPaid >= bill.total ? 'paid' : 'partial';
  await bill.save();

  res.status(201).json({ success: true, data: { payment, bill } });
});

// GET /api/bills/:id/pdf  — stream PDF invoice
exports.downloadPDF = asyncHandler(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id)
    .populate('customer', 'name phone walletBalance')
    .populate('order', 'paymentMethod cashAmount onlineAmount walletAmount pendingPaymentAmount amountReceived totalPaid additionalPlayers')
    .populate('branch', 'name address phone')
    .populate('session')
    .populate('createdBy', 'name');
  if (!bill) return next(new AppError('Bill not found.', 404));

  // Populate session table details if session exists
  if (bill.session) {
    await bill.session.populate('table', 'name type');
  }

  const settings = await Settings.findOne();
  const pdfBuffer = await generateInvoicePDF(bill.toObject(), settings?.toObject() || {});

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${bill.invoiceNumber}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });
  res.end(pdfBuffer);
});

// GET /api/bills?branch=&page=&limit=
exports.getBills = asyncHandler(async (req, res) => {
  const { ROLES } = require('../config/constants');
  const filter = {};
  if (req.user.role !== ROLES.SUPER_ADMIN) filter.branch = { $in: req.user.branches };
  if (req.query.branch) filter.branch = req.query.branch;
  if (req.query.status) filter.paymentStatus = req.query.status;

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const [bills, total] = await Promise.all([
    Bill.find(filter)
      .populate('customer', 'name phone')
      .populate('branch', 'name')
      .populate('createdBy', 'name')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit),
    Bill.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    results: bills.length,
    total,
    page,
    pages: Math.ceil(total / limit),
    data: { bills },
  });
});

// GET /api/bills/:id
exports.getBill = asyncHandler(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id)
    .populate('customer', 'name phone')
    .populate('branch', 'name')
    .populate('session')
    .populate('createdBy', 'name');
  if (!bill) return next(new AppError('Bill not found.', 404));
  res.status(200).json({ success: true, data: { bill } });
});

// POST /api/bills/from-customer  — create a bill directly from customer data
exports.createBillFromCustomer = asyncHandler(async (req, res, next) => {
  const { customerId, orderId } = req.body;

  let order;
  if (orderId) {
    order = await Order.findById(orderId)
      .populate('menuCategoryId', 'name')
      .populate('menuItemId', 'name price')
      .populate('customer', 'name phone branch walletBalance')
      .populate('branch', 'name');
  } else if (customerId) {
    // The customer list page currently passes the row _id, which is an order id.
    // Support that first, then fall back to the latest order for a real customer id.
    order = await Order.findById(customerId)
      .populate('menuCategoryId', 'name')
      .populate('menuItemId', 'name price')
      .populate('customer', 'name phone branch walletBalance')
      .populate('branch', 'name');

    if (!order) {
      const customer = await Customer.findById(customerId).select('_id');
      if (customer) {
        order = await Order.findOne({ customer: customer._id })
          .populate('menuCategoryId', 'name')
          .populate('menuItemId', 'name price')
          .populate('customer', 'name phone branch walletBalance')
          .populate('branch', 'name')
          .sort('-createdAt');
      }
    }
  }
  
  if (!order) return next(new AppError('Order not found.', 404));

  const customer = order.customer;

  // Build line items from order's billAmount
  const items = [];
  let subtotal = 0;

  if (order.menuItemId) {
    const menuItem = order.menuItemId;
    const itemTotal = order.billAmount || menuItem.price || 0;
    items.push({
      description: `${order.menuCategoryId?.name || 'Menu'} - ${menuItem.name}`,
      quantity: 1,
      unitPrice: order.billAmount || menuItem.price || 0,
      total: itemTotal,
      type: 'other',
    });
    subtotal += itemTotal;
  }

  // Tax calculation
  const settings = await Settings.findOne();
  const taxPercent = settings?.taxPercent || 0;
  const tax = (subtotal * taxPercent) / 100;
  const total = subtotal + tax;

  const invoiceNumber = await generateInvoiceNumber();

  const bill = await Bill.create({
    invoiceNumber,
    branch: order.branch._id || order.branch,
    customer: customer._id,
    order: order._id,
    items,
    subtotal,
    tax,
    total,
    walletUsed: order.walletAmount || 0,
    walletBalance: customer.walletBalance || 0,
    paymentStatus: order.paymentStatus || 'unpaid',
    createdBy: req.user._id,
  });

  // Update customer spending
  await Customer.findByIdAndUpdate(customer._id, { $inc: { totalSpending: total } });

  await logActivity({
    userId: req.user._id,
    branchId: order.branch._id || order.branch,
    action: 'bill.create',
    entity: 'Bill',
    entityId: bill._id,
    description: `${req.user.name} created bill ${invoiceNumber} from order ${order.orderId} — ₹${total}`,
    ipAddress: req.ip,
  });

  const populated = await Bill.findById(bill._id).populate('customer', 'name phone walletBalance').populate('branch', 'name');
  res.status(201).json({ success: true, data: { bill: populated } });
});
