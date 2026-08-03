const mongoose = require('mongoose');
const Session = require('../models/Session');
const Table = require('../models/Table');
const Customer = require('../models/Customer');
const { MenuCategory, MenuItem } = require('../models/Operations');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');

const emitTableUpdate = (req, tableDoc, sessionDoc = null) => {
  try {
    const payload = {
      _id: tableDoc._id,
      name: tableDoc.name,
      type: tableDoc.type,
      branch: tableDoc.branch,
      status: tableDoc.status,
      isActive: tableDoc.isActive,
      hourlyRate: tableDoc.hourlyRate,
      currentSession: sessionDoc
        ? {
            _id: sessionDoc._id,
            status: sessionDoc.status,
            startTime: sessionDoc.startTime,
            pauses: sessionDoc.pauses || [],
            extendedMinutes: sessionDoc.extendedMinutes || 0,
            hourlyRate: sessionDoc.hourlyRate,
            extraPlayers: sessionDoc.extraPlayers,
            addedItems: sessionDoc.addedItems || [],
            menuCategoryId: sessionDoc.menuCategoryId,
            menuItemId: sessionDoc.menuItemId,
            menuCategory: sessionDoc.menuCategory,
            menuItem: sessionDoc.menuItem,
            customer: sessionDoc.customer,
            customerName: sessionDoc.customerName,
            phoneNumber: sessionDoc.phoneNumber,
          }
        : null,
    };

    req.app.get('io')?.to(`branch:${tableDoc.branch}`).emit('table:updated', payload);
    console.log('[emitTableUpdate] Emitted table update for branch:', tableDoc.branch, 'table:', tableDoc.name, 'session status:', sessionDoc?.status);
  } catch (err) {
    console.error('[emitTableUpdate] Error:', err.message);
  }
};

// POST /api/sessions/start  { tableId, customerId?, customerName?, phoneNumber?, extraPlayers? }
exports.startSession = asyncHandler(async (req, res, next) => {
  const { tableId, customerId, customerName, phoneNumber, extraPlayers } = req.body;

  const table = await Table.findById(tableId);
  if (!table) return next(new AppError('Table not found.', 404));

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(table.branch?.toString())) {
      return next(new AppError('You do not have access to this branch.', 403));
    }
  }

  if (table.status !== 'available') {
    return next(new AppError(`Table is currently ${table.status} and cannot be started.`, 400));
  }

  const session = await Session.create({
    table: table._id,
    branch: table.branch,
    customer: customerId || undefined,
    customerName,
    phoneNumber,
    extraPlayers: extraPlayers || [],
    startedBy: req.user._id,
    hourlyRate: table.hourlyRate,
    startTime: new Date(),
    status: 'running',
  });

  table.status = 'running';
  table.currentSession = session._id;
  await table.save();

  if (customerId) {
    await Customer.findByIdAndUpdate(customerId, { $inc: { visits: 1 } });
  }

  await logActivity({
    userId: req.user._id,
    branchId: table.branch,
    action: 'session.start',
    entity: 'Session',
    entityId: session._id,
    description: `${req.user.name} started session on table ${table.name}`,
    ipAddress: req.ip,
  });

  emitTableUpdate(req, table, session);
  res.status(201).json({ success: true, data: { session } });
});

// PATCH /api/sessions/:id/pause
exports.pauseSession = asyncHandler(async (req, res, next) => {
  const session = await Session.findById(req.params.id);
  if (!session) return next(new AppError('Session not found.', 404));

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(session.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  if (session.status !== 'running') return next(new AppError('Only running sessions can be paused.', 400));

  session.pauses.push({ pausedAt: new Date() });
  session.status = 'paused';
  await session.save();

  // Keep table status as 'running' — the frontend uses session.status='paused'
  // to display the correct paused UI state.
  const table = await Table.findById(session.table);

  emitTableUpdate(req, table, session);
  res.status(200).json({ success: true, data: { session } });
});

// PATCH /api/sessions/:id/resume
exports.resumeSession = asyncHandler(async (req, res, next) => {
  const session = await Session.findById(req.params.id);
  if (!session) return next(new AppError('Session not found.', 404));

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(session.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  if (session.status !== 'paused') return next(new AppError('Only paused sessions can be resumed.', 400));

  const lastPause = session.pauses[session.pauses.length - 1];
  if (lastPause && !lastPause.resumedAt) lastPause.resumedAt = new Date();
  session.status = 'running';
  await session.save();

  const table = await Table.findById(session.table);
  emitTableUpdate(req, table, session);

  res.status(200).json({ success: true, data: { session } });
});

// PATCH /api/sessions/:id/extend  { minutes }
exports.extendSession = asyncHandler(async (req, res, next) => {
  const { minutes } = req.body;
  if (!minutes || minutes <= 0) return next(new AppError('Provide a positive number of minutes.', 400));

  const session = await Session.findById(req.params.id);
  if (!session) return next(new AppError('Session not found.', 404));

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(session.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  session.extendedMinutes += minutes;
  await session.save();

  const table = await Table.findById(session.table);
  emitTableUpdate(req, table, session);

  res.status(200).json({ success: true, data: { session } });
});

// PATCH /api/sessions/:id/transfer  { customerId }
exports.transferCustomer = asyncHandler(async (req, res, next) => {
  const { customerId } = req.body;
  const session = await Session.findById(req.params.id);
  if (!session) return next(new AppError('Session not found.', 404));

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(session.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  const updatedSession = await Session.findByIdAndUpdate(
    req.params.id,
    { customer: customerId },
    { new: true }
  );
  if (!updatedSession) return next(new AppError('Session not found.', 404));
  res.status(200).json({ success: true, data: { session: updatedSession } });
});

// PATCH /api/sessions/:id/stop
// Stops the timer, calculates final billable time & amount, frees the table.
// Does NOT create the Bill itself — that's a deliberate separate step (POST /api/bills)
// so staff can add inventory items / discounts before finalizing the invoice.
exports.stopSession = asyncHandler(async (req, res, next) => {
  const session = await Session.findById(req.params.id);
  if (!session) return next(new AppError('Session not found.', 404));

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(session.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  if (session.status === 'completed') {
    return res.status(200).json({ success: true, message: 'Session already completed.', data: { session } });
  }

  // Close any open pause
  const lastPause = session.pauses[session.pauses.length - 1];
  if (lastPause && !lastPause.resumedAt) lastPause.resumedAt = new Date();

  session.endTime = new Date();
  session.billableMinutes = session.calculateBillableMinutes() + session.extendedMinutes;
  session.amount = (session.billableMinutes / 60) * session.hourlyRate;
  session.status = 'completed';
  await session.save();

  const table = await Table.findByIdAndUpdate(
    session.table,
    { status: 'available', currentSession: null },
    { new: true }
  );

  const addedItemsTotal = (session.addedItems || []).reduce((sum, item) => sum + (item.totalAmount || 0), 0);
  const grandTotal = Math.round((session.amount + addedItemsTotal) * 100) / 100;

  await logActivity({
    userId: req.user._id,
    branchId: session.branch,
    action: 'session.stop',
    entity: 'Session',
    entityId: session._id,
    description: `${req.user.name} stopped session on table ${table.name} — ₹${grandTotal}`,
    ipAddress: req.ip,
  });

  emitTableUpdate(req, table, null);
  res.status(200).json({
    success: true,
    data: {
      session,
      addedItems: session.addedItems || [],
      addedItemsTotal,
      grandTotal,
    }
  });
});

// GET /api/sessions/:id
exports.getSession = asyncHandler(async (req, res, next) => {
  const session = await Session.findById(req.params.id)
    .populate('table', 'name type hourlyRate')
    .populate('customer', 'name phone')
    .populate('startedBy', 'name')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name price')
    .lean();
  if (!session) return next(new AppError('Session not found.', 404));

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(session.branch?._id?.toString() || session.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }
  res.status(200).json({ success: true, data: { session } });
});

// GET /api/sessions/live?branch=...
exports.getLiveSessions = asyncHandler(async (req, res) => {
  const filter = { status: { $in: ['running', 'paused'] } };
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    if (req.query.branch && userBranchIds.includes(req.query.branch.toString())) {
      filter.branch = req.query.branch;
    } else {
      filter.branch = { $in: userBranchIds };
    }
  } else if (req.query.branch) {
    filter.branch = req.query.branch;
  }

  const sessions = await Session.find(filter)
    .populate('table', 'name type hourlyRate')
    .populate('customer', 'name phone')
    .populate('startedBy', 'name')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name price')
    .lean();

  res.status(200).json({ success: true, results: sessions.length, data: { sessions } });
});

// PATCH /api/sessions/:id/update-menu  { menuCategoryId, menuItemId, quantity }
exports.updateSessionMenu = asyncHandler(async (req, res, next) => {
  const { menuCategoryId, menuItemId, quantity = 1 } = req.body;
  if (!menuCategoryId || !menuItemId) {
    return next(new AppError('Menu Category and Menu Item are required.', 400));
  }

  const session = await Session.findById(req.params.id);
  if (!session) return next(new AppError('Session not found.', 404));

  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(session.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  const [menuCategoryDoc, menuItemDoc] = await Promise.all([
    MenuCategory.findById(menuCategoryId),
    MenuItem.findById(menuItemId)
  ]);

  if (!menuItemDoc) {
    return next(new AppError('Selected Menu Item not found.', 404));
  }

  const categoryName = menuCategoryDoc?.name || 'Item';
  const itemName = menuItemDoc.name;
  const unitPrice = menuItemDoc.price || 0;
  const qty = Number(quantity) || 1;

  if (!session.addedItems) session.addedItems = [];

  const existingIndex = session.addedItems.findIndex(
    (item) => item.menuItemId?.toString() === menuItemId.toString()
  );

  if (existingIndex > -1) {
    session.addedItems[existingIndex].quantity += qty;
    session.addedItems[existingIndex].unitPrice = unitPrice;
    session.addedItems[existingIndex].totalAmount = session.addedItems[existingIndex].quantity * unitPrice;
  } else {
    session.addedItems.push({
      menuCategoryId,
      menuItemId,
      categoryName,
      itemName,
      quantity: qty,
      unitPrice,
      totalAmount: qty * unitPrice,
    });
  }

  session.menuCategoryId = menuCategoryId;
  session.menuItemId = menuItemId;
  session.menuCategory = categoryName;
  session.menuItem = itemName;

  await session.save();

  const table = await Table.findById(session.table);
  emitTableUpdate(req, table, session);

  res.status(200).json({ success: true, data: { session } });
});
