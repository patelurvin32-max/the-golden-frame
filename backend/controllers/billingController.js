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
const { ROLES } = require('../config/constants');
const { generateOrderId, generateCustomerId, parseCurrencyValue } = require('./customerController');
const PaymentHistory = require('../models/PaymentHistory');
const WalletTransaction = require('../models/WalletTransaction');

// GET /api/bills/stats
exports.getBillStats = asyncHandler(async (req, res) => {
  const filter = {};
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
  
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    filter.branch = { $in: userBranchIds };
  } else if (req.query.branch) {
    filter.branch = req.query.branch;
  }

  // Get date ranges
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get counts
  const [todayCount, weekCount, monthCount, totalCount] = await Promise.all([
    Bill.countDocuments({ ...filter, createdAt: { $gte: todayStart } }),
    Bill.countDocuments({ ...filter, createdAt: { $gte: weekStart } }),
    Bill.countDocuments({ ...filter, createdAt: { $gte: monthStart } }),
    Bill.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      today: todayCount,
      week: weekCount,
      month: monthCount,
      total: totalCount,
    },
  });
});

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
    manualAmount,          // Manual bill amount for sessions
    paymentStatus,         // Payment status for sessions
    paymentMethod,         // Payment method for sessions
  } = req.body;

  const targetBranch = branchId || branch;

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!targetBranch || !userBranchIds.includes(targetBranch.toString())) {
      return next(new AppError('You do not have access to this branch.', 403));
    }
  }

  // Build line items
  const items = [];
  let subtotal = 0;

  // 1. Table time from session
  let sessionMenuCategoryId, sessionMenuItemId, sessionMenuCategory, sessionMenuItem;
  if (sessionId) {
    const session = await Session.findById(sessionId).populate('table', 'name type');
    if (!session) return next(new AppError('Session not found.', 404));
    if (session.status !== 'completed') return next(new AppError('Session must be stopped before billing.', 400));

    // Extract menu category/item from session for Live Tables billing
    // If session has explicit menu category/item (from Customer/Menu flow), use those
    // Otherwise, use table type as category and table name as item (for Live Tables flow)
    if (session.menuCategoryId && session.menuItemId) {
      sessionMenuCategoryId = session.menuCategoryId;
      sessionMenuItemId = session.menuItemId;
      sessionMenuCategory = session.menuCategory;
      sessionMenuItem = session.menuItem;
    } else {
      // For Live Tables sessions without explicit menu selection, use table info
      sessionMenuCategory = session.table?.type || '';
      sessionMenuItem = session.table?.name || '';
    }

    const addedItemsTotal = (session.addedItems || []).reduce((sum, item) => sum + (item.totalAmount || 0), 0);
    const calculatedGrandTotal = session.amount + addedItemsTotal;

    // Use manual amount if provided, otherwise use calculated grand total
    const finalBillAmount = manualAmount !== undefined ? Number(manualAmount) : calculatedGrandTotal;
    const sessionTimeAmount = manualAmount !== undefined ? Math.max(0, finalBillAmount - addedItemsTotal) : session.amount;

    const tableItem = {
      description: `${session.table?.type?.toUpperCase()} - ${session.table?.name} (${session.billableMinutes} min)`,
      quantity: 1,
      unitPrice: sessionTimeAmount,
      total: sessionTimeAmount,
      type: 'table_time',
    };
    items.push(tableItem);
    subtotal += sessionTimeAmount;

    // Add session added items (beverages & accessories) to bill line items
    if (session.addedItems && session.addedItems.length > 0) {
      for (const addedItem of session.addedItems) {
        items.push({
          description: `${addedItem.categoryName} - ${addedItem.itemName}`,
          quantity: addedItem.quantity,
          unitPrice: addedItem.unitPrice,
          total: addedItem.totalAmount,
          type: 'inventory',
          menuItem: addedItem.menuItemId,
        });
        subtotal += addedItem.totalAmount;
      }
    }
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

  // Fetch settings and customer membership in parallel
  let _sessionForName = null;
  const [settings, membershipCustomer] = await Promise.all([
    Settings.findOne().lean(),
    customerId ? Customer.findById(customerId).select('name phone membership').lean() : null,
  ]);

  if (sessionId) {
    // For session-based bills, grab name and timestamps from session
    _sessionForName = await Session.findById(sessionId).select('customerName phoneNumber createdAt startTime').lean();
  }

  if (membershipCustomer?.membership?.tier) {
    const { MembershipPlan } = require('../models/Operations');
    const plan = await MembershipPlan.findOne({ tier: membershipCustomer.membership.tier, isActive: true }).lean();
    if (plan) {
      membershipDiscount = (subtotal * plan.discountPercent) / 100;
    }
  }

  // 5. Tax
  const taxPercent = settings?.taxPercent || 0;
  const afterDiscounts = Math.max(0, subtotal - discountAmount - membershipDiscount);
  const tax = (afterDiscounts * taxPercent) / 100;
  const total = afterDiscounts + tax;

  const invoiceNumber = await generateInvoiceNumber(targetBranch);

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
    paymentStatus: paymentStatus || 'unpaid',
    paymentMethod: paymentMethod || null,
    cashAmount: req.body.cashAmount || 0,
    onlineAmount: req.body.onlineAmount || 0,
    walletAmount: req.body.walletAmount || 0,
    amountReceived: req.body.amountReceived || 0,
    pendingPaymentAmount: req.body.pendingPaymentAmount || 0,
    pendingPlayers: req.body.pendingPlayers || [],
    notes: req.body.notes || '',
    createdBy: req.user._id,
    // Denormalized fields for fast search without pre-lookup queries
    customerName:  membershipCustomer?.name || _sessionForName?.customerName || '',
    customerPhone: membershipCustomer?.phone || _sessionForName?.phoneNumber || '',
    // Denormalized menu category/item from session for Live Tables billing
    menuCategoryId: sessionMenuCategoryId,
    menuItemId: sessionMenuItemId,
    menuCategory: sessionMenuCategory || '',
    menuItem: sessionMenuItem || '',
    ...(sessionId && _sessionForName ? { createdAt: _sessionForName.createdAt || _sessionForName.startTime } : {}),
  });

  // Handle pending player payments and create Order records for unpaid/partial bills
  let customerIdToUse = customerId;
  if (!customerIdToUse && (req.body.customerName || req.body.customerPhone || bill.customerName || bill.customerPhone)) {
    const phone = String(req.body.customerPhone || bill.customerPhone || '').replace(/\D/g, '').slice(0, 10);
    const name = req.body.customerName || bill.customerName || `Player (${phone})`;
    if (phone.length === 10) {
      let customerDoc = await Customer.findOne({ phone, isActive: true });
      if (!customerDoc) {
        const custId = await generateCustomerId(targetBranch);
        customerDoc = await Customer.create({
          customerId: custId,
          name,
          phone,
          branch: targetBranch,
        });
      } else {
        let customerUpdated = false;
        if (name && name.trim() !== '' && name.trim() !== customerDoc.name) {
          customerDoc.name = name.trim();
          customerUpdated = true;
        }
        if (customerUpdated) {
          await customerDoc.save();
        }
      }
      customerIdToUse = customerDoc._id;
    }
  }

  if (bill.paymentStatus === 'unpaid' || bill.paymentStatus === 'partial') {
    const cashAmount = req.body.cashAmount || 0;
    const onlineAmount = req.body.onlineAmount || 0;
    const walletAmount = req.body.walletAmount || 0;
    const amountReceived = req.body.amountReceived || 0;
    const pendingPaymentAmount = req.body.pendingPaymentAmount || 0;
    const mainPending = Math.max(0, bill.total - cashAmount - onlineAmount - walletAmount - pendingPaymentAmount);

    let parentOrderId = null;
    let mainOrder = null;

    if (mainPending > 0 || (req.body.pendingPlayers && req.body.pendingPlayers.length > 0)) {
      parentOrderId = await generateOrderId(targetBranch);
      
      mainOrder = await Order.create({
        orderId: parentOrderId,
        customer: customerIdToUse,
        branch: targetBranch,
        session: sessionId || undefined,
        bill: bill._id,
        paymentStatus: bill.paymentStatus,
        paymentMethod: bill.paymentMethod || null,
        cashAmount,
        onlineAmount,
        walletAmount,
        pendingPaymentAmount: mainPending,
        amountReceived,
        totalPaid: cashAmount + onlineAmount + walletAmount,
        billAmount: bill.total,
        notes: bill.notes || `Pending payment for invoice ${bill.invoiceNumber}`,
        createdBy: req.user._id,
      });

      if (mainPending > 0) {
        await PaymentHistory.create({
          order: mainOrder._id,
          orderId: mainOrder.orderId,
          customer: customerIdToUse,
          customerName: bill.customerName || 'Customer',
          customerPhone: bill.customerPhone || '',
          branch: targetBranch,
          paymentMethod: bill.paymentMethod || null,
          cashAmount,
          onlineAmount,
          walletAmount,
          totalPaid: cashAmount + onlineAmount + walletAmount,
          billAmount: bill.total,
          pendingAmount: mainPending,
          paymentStatus: bill.paymentStatus,
          notes: bill.notes || `Pending payment for invoice ${bill.invoiceNumber}`,
          createdBy: req.user._id,
          paymentNumber: 1,
        });

        if (customerIdToUse) {
          await Customer.findByIdAndUpdate(customerIdToUse, { $inc: { outstandingBalance: mainPending } });
        }
      }

      const pendingPlayers = req.body.pendingPlayers || [];
      const savedPendingPlayersList = [];

      for (const player of pendingPlayers) {
        const playerMobile = String(player.mobile || player.phone || '').replace(/\D/g, '').slice(0, 10);
        const playerAmount = parseCurrencyValue(player.amount) || 0;
        const playerName = (player.name && player.name.trim()) ? player.name.trim() : `Player (${playerMobile})`;
        
        if (playerMobile.length === 10 && playerAmount > 0) {
          let playerCustomer = await Customer.findOne({ phone: playerMobile, isActive: true });
          if (!playerCustomer) {
            const playerCustId = await generateCustomerId(targetBranch);
            playerCustomer = await Customer.create({
              customerId: playerCustId,
              name: playerName,
              phone: playerMobile,
              branch: targetBranch,
            });
          } else {
            if (playerName && playerName.trim() !== '' && (playerCustomer.name.startsWith('Player (') || !playerCustomer.name)) {
              playerCustomer.name = playerName.trim();
              await playerCustomer.save();
            }
          }

          const pOrderId = `${mainOrder.orderId}-P${savedPendingPlayersList.length + 1}`;

          const playerOrder = await Order.create({
            orderId: pOrderId,
            customer: playerCustomer._id,
            parentOrder: mainOrder._id,
            parentOrderId: mainOrder.orderId,
            branch: targetBranch,
            session: sessionId || undefined,
            bill: bill._id,
            paymentStatus: 'unpaid',
            paymentMethod: null,
            cashAmount: 0,
            onlineAmount: 0,
            walletAmount: 0,
            pendingPaymentAmount: playerAmount,
            amountReceived: 0,
            totalPaid: 0,
            billAmount: playerAmount,
            additionalPlayers: `Pending player payment for order ${mainOrder.orderId}`,
            createdBy: req.user._id,
          });

          await PaymentHistory.create({
            order: playerOrder._id,
            orderId: playerOrder.orderId,
            customer: playerCustomer._id,
            customerName: playerCustomer.name,
            customerPhone: playerCustomer.phone,
            branch: targetBranch,
            paymentMethod: null,
            cashAmount: 0,
            onlineAmount: 0,
            walletAmount: 0,
            totalPaid: 0,
            billAmount: playerAmount,
            pendingAmount: playerAmount,
            paymentStatus: 'unpaid',
            notes: `Pending player payment for order ${mainOrder.orderId}`,
            createdBy: req.user._id,
            paymentNumber: 1,
          });

          playerCustomer.outstandingBalance = (playerCustomer.outstandingBalance || 0) + playerAmount;
          await playerCustomer.save();

          savedPendingPlayersList.push({
            id: playerOrder._id.toString(),
            playerName,
            name: playerName,
            mobileNumber: playerMobile,
            mobile: playerMobile,
            pendingAmount: playerAmount,
            amount: playerAmount,
            orderId: pOrderId,
            customerId: playerCustomer._id.toString(),
          });
        }
      }

      if (savedPendingPlayersList.length > 0) {
        mainOrder.pendingPlayers = savedPendingPlayersList;
        await mainOrder.save();
      }
    }
  }

  // Update session with bill reference
  if (sessionId) {
    await Session.findByIdAndUpdate(sessionId, { bill: bill._id });
  }

  // Update customer spending
  if (customerIdToUse) {
    await Customer.findByIdAndUpdate(customerIdToUse, { $inc: { totalSpending: total } });
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

  const populated = await Bill.findById(bill._id)
    .populate('customer', 'name phone')
    .populate('branch', 'name')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name');
  res.status(201).json({ success: true, data: { bill: populated } });
});

// POST /api/bills/:id/payment  — record payment against a bill
exports.receivePayment = asyncHandler(async (req, res, next) => {
  let { method, amount, breakdown = [], transactionRef } = req.body;
  
  if (!method || method === '') {
    if (breakdown.length > 0 && breakdown[0].method) {
      method = breakdown[0].method;
    } else {
      method = 'cash';
    }
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill) return next(new AppError('Bill not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(bill.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  // Check if bill is already fully paid based on recorded payments
  const existingPayments = await Payment.find({ bill: bill._id }).lean();
  const existingPaid = existingPayments.reduce((sum, p) => sum + p.amount, 0);
  if (bill.paymentStatus === 'paid' && existingPayments.length > 0 && existingPaid >= bill.total) {
    return next(new AppError('Bill is already fully paid.', 400));
  }

  const payment = await Payment.create({
    bill: bill._id,
    branch: bill.branch,
    method,
    breakdown,
    amount,
    receivedBy: req.user._id,
    transactionRef,
  });

  // Compute new total paid from existing payments + new payment (avoid second query)
  const totalPaid = existingPaid + amount;
  bill.paymentStatus = totalPaid >= bill.total ? 'paid' : 'partial';
  await bill.save();

  res.status(201).json({ success: true, data: { payment, bill } });
});

// GET /api/bills/:id/pdf  — stream PDF invoice
exports.downloadPDF = asyncHandler(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id)
    .populate('customer', 'name phone walletBalance createdAt')
    .populate('order', 'orderId createdAt paymentMethod cashAmount onlineAmount walletAmount pendingPaymentAmount amountReceived totalPaid additionalPlayers')
    .populate('branch', 'name address phone')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name')
    .populate({
      path: 'session',
      populate: { path: 'table', select: 'name type' },  // nested populate, no second round-trip
    })
    .populate('createdBy', 'name')
    .lean();
  if (!bill) return next(new AppError('Bill not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(bill.branch?._id?.toString() || bill.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  const branchId = bill.branch?._id || bill.branch;
  let settings = null;
  if (branchId) {
    settings = await Settings.findOne({ branch: branchId }).lean();
  }
  if (!settings) {
    settings = await Settings.findOne({ branch: { $exists: false } }).lean();
  }
  if (!settings) {
    settings = await Settings.findOne().lean();
  }

  const pdfBuffer = await generateInvoicePDF(bill, settings || {});
  const rawInvoiceNum = bill.order?.orderId || bill.invoiceNumber || 'invoice';
  const safeFilename = rawInvoiceNum.replace(/[/\\?%*:|"<>]/g, '_');

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });
  res.end(pdfBuffer);
});

// GET /api/bills?branch=&page=&limit=&search=&sort=
exports.getBills = asyncHandler(async (req, res) => {
  const filter = {};
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
  
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    if (req.query.branch && userBranchIds.includes(req.query.branch.toString())) {
      filter.branch = req.query.branch;
    } else {
      filter.branch = { $in: userBranchIds };
    }
  } else if (req.query.branch) {
    filter.branch = req.query.branch;
  }
  if (req.query.status) filter.paymentStatus = req.query.status;

  // Search functionality — search on denormalized fields (no pre-lookup queries needed)
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    filter.$or = [
      { invoiceNumber:  searchRegex },
      { customerName:   searchRegex },
      { customerPhone:  searchRegex },
    ];
  }

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  // Sorting
  let sortOption = { createdAt: -1 }; // Default sort by createdAt descending
  if (req.query.sort) {
    const sortField = req.query.sort.startsWith('-') ? req.query.sort.substring(1) : req.query.sort;
    const sortOrder = req.query.sort.startsWith('-') ? -1 : 1;
    sortOption = { [sortField]: sortOrder };
  }

  const [bills, total] = await Promise.all([
    Bill.find(filter)
      .populate('customer', 'name phone walletBalance')
      .populate('branch', 'name')
      .populate('createdBy', 'name')
      .populate('order', 'orderId paymentMethod cashAmount onlineAmount walletAmount pendingPaymentAmount amountReceived totalPaid pendingPlayers notes')
      .populate('menuCategoryId', 'name')
      .populate('menuItemId', 'name')
      .populate({
        path: 'session',
        populate: [
          { path: 'table', select: 'name type' },
          { path: 'menuCategoryId', select: 'name' },
          { path: 'menuItemId', select: 'name' }
        ]
      })
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Bill.countDocuments(filter),
  ]);

  const calculatedTotalPages = Math.ceil(total / limit);

  const formattedBills = bills.map((b) => ({
    ...b,
    invoiceNumber: b.order?.orderId || b.invoiceNumber,
  }));

  res.status(200).json({
    success: true,
    results: formattedBills.length,
    total,
    page,
    limit,
    totalPages: calculatedTotalPages,
    hasNextPage: page < calculatedTotalPages,
    hasPreviousPage: page > 1,
    data: { bills: formattedBills },
  });
});

// GET /api/bills/:id
exports.getBill = asyncHandler(async (req, res, next) => {
  const bill = await Bill.findById(req.params.id)
    .select('+paymentMethod +cashAmount +onlineAmount +walletAmount +amountReceived +pendingPaymentAmount +pendingPlayers +notes')
    .populate('customer', 'name phone walletBalance')
    .populate('branch', 'name')
    .populate('order', 'orderId paymentMethod cashAmount onlineAmount walletAmount pendingPaymentAmount amountReceived totalPaid pendingPlayers notes')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name')
    .populate({ path: 'session', populate: { path: 'table', select: 'name type' } })
    .populate('createdBy', 'name');
  if (!bill) return next(new AppError('Bill not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(bill.branch?._id?.toString() || bill.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }
  
  const billObj = bill.toObject();
  if (billObj.order?.orderId) {
    billObj.invoiceNumber = billObj.order.orderId;
  }

  res.status(200).json({ success: true, data: { bill: billObj } });
});

// PUT /api/bills/:id
exports.updateBill = asyncHandler(async (req, res, next) => {
  const { items, paymentStatus, total, subtotal, addedItems, paymentMethod, cashAmount, onlineAmount, walletAmount, amountReceived, pendingPaymentAmount, pendingPlayers, notes } = req.body;
  const bill = await Bill.findById(req.params.id);
  if (!bill) return next(new AppError('Bill not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(bill.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  if (items && Array.isArray(items)) {
    bill.items = items;
  }
  if (subtotal !== undefined) {
    bill.subtotal = Number(subtotal);
  }
  if (total !== undefined) {
    bill.total = Number(total);
  }
  if (paymentStatus) {
    bill.paymentStatus = paymentStatus;
  }

  // Store payment details directly on Bill for session-based bills
  if (paymentMethod !== undefined) bill.paymentMethod = paymentMethod;
  if (cashAmount !== undefined) bill.cashAmount = Number(cashAmount) || 0;
  if (onlineAmount !== undefined) bill.onlineAmount = Number(onlineAmount) || 0;
  if (walletAmount !== undefined) bill.walletAmount = Number(walletAmount) || 0;
  if (amountReceived !== undefined) bill.amountReceived = Number(amountReceived) || 0;
  if (pendingPaymentAmount !== undefined) bill.pendingPaymentAmount = Number(pendingPaymentAmount) || 0;
  if (Array.isArray(pendingPlayers)) bill.pendingPlayers = pendingPlayers;
  if (notes !== undefined) bill.notes = notes;

  await bill.save();

  // If associated order exists, update order payment details & pending players
  let targetOrderId = bill.order;
  if (!targetOrderId && bill.session) {
    const sessionOrder = await Order.findOne({ session: bill.session });
    if (sessionOrder) targetOrderId = sessionOrder._id;
  }

  if (targetOrderId) {
    const orderObj = await Order.findById(targetOrderId);
    if (orderObj) {
      if (paymentMethod !== undefined) orderObj.paymentMethod = paymentMethod;
      if (cashAmount !== undefined) orderObj.cashAmount = Number(cashAmount) || 0;
      if (onlineAmount !== undefined) orderObj.onlineAmount = Number(onlineAmount) || 0;
      if (walletAmount !== undefined) orderObj.walletAmount = Number(walletAmount) || 0;
      if (amountReceived !== undefined) orderObj.amountReceived = Number(amountReceived) || 0;
      if (pendingPaymentAmount !== undefined) orderObj.pendingPaymentAmount = Number(pendingPaymentAmount) || 0;
      if (paymentStatus) orderObj.paymentStatus = paymentStatus;
      if (notes !== undefined) orderObj.notes = notes;
      if (Array.isArray(pendingPlayers)) orderObj.pendingPlayers = pendingPlayers;
      orderObj.billAmount = bill.total;

      await orderObj.save();
    }
  }

  // If associated session exists, sync session.addedItems with the updated beverages & accessories
  if (bill.session && Array.isArray(addedItems)) {
    await Session.findByIdAndUpdate(bill.session, { addedItems });
  }

  await logActivity({
    userId: req.user._id,
    branchId: bill.branch,
    action: 'bill.update',
    entity: 'Bill',
    entityId: bill._id,
    description: `${req.user.name} updated bill ${bill.invoiceNumber} — ₹${bill.total}`,
    ipAddress: req.ip,
  });

  const populated = await Bill.findById(bill._id)
    .populate('customer', 'name phone walletBalance')
    .populate('branch', 'name')
    .populate('order', 'paymentMethod cashAmount onlineAmount walletAmount pendingPaymentAmount amountReceived totalPaid pendingPlayers notes')
    .populate({ path: 'session', populate: { path: 'table', select: 'name type' } })
    .populate('createdBy', 'name');

  res.status(200).json({ success: true, data: { bill: populated } });
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

  const targetBranch = order.branch?._id || order.branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(targetBranch.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

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

  let bill = await Bill.findOne({ order: order._id });
  if (bill) {
    if (order.orderId && bill.invoiceNumber !== order.orderId) {
      bill.invoiceNumber = order.orderId;
      await bill.save();
    }
  } else {
    const invoiceNumber = order.orderId || (await generateInvoiceNumber(targetBranch));
    bill = await Bill.create({
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
      createdAt: order.createdAt || undefined,
    });

    // Update customer spending
    await Customer.findByIdAndUpdate(customer._id, { $inc: { totalSpending: total } });
  }

  await logActivity({
    userId: req.user._id,
    branchId: order.branch._id || order.branch,
    action: 'bill.create',
    entity: 'Bill',
    entityId: bill._id,
    description: `${req.user.name} created bill ${bill.invoiceNumber} from order ${order.orderId} — ₹${total}`,
    ipAddress: req.ip,
  });

  const populated = await Bill.findById(bill._id).populate('customer', 'name phone walletBalance').populate('branch', 'name');
  res.status(201).json({ success: true, data: { bill: populated } });
});

