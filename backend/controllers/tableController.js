const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateTableQRCode } = require('../services/qrCodeService');
const { logActivity } = require('../services/activityLogService');
const { ROLES } = require('../config/constants');
const { syncTablesWithMenuItems } = require('../utils/tableSync');

// GET /api/tables?branch=...&type=...&status=...
exports.getTables = asyncHandler(async (req, res) => {
  await syncTablesWithMenuItems();

  const filter = { isActive: true };
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
  if (req.query.type) filter.type = { $regex: new RegExp(`^${req.query.type}$`, 'i') };
  if (req.query.status) filter.status = req.query.status;

  const tables = await Table.find(filter)
    .populate('branch', 'name code')
    .populate({
      path: 'currentSession',
      populate: [
        { path: 'menuCategoryId', select: 'name' },
        { path: 'menuItemId', select: 'name price' },
        { path: 'customer', select: 'name phone customerId' }
      ]
    })
    .sort('name')
    .lean();

  res.status(200).json({ success: true, results: tables.length, data: { tables } });
});

// GET /api/tables/:id
exports.getTable = asyncHandler(async (req, res, next) => {

  const table = await Table.findById(req.params.id)
    .populate('branch')
    .populate({
      path: 'currentSession',
      populate: [
        { path: 'menuCategoryId', select: 'name' },
        { path: 'menuItemId', select: 'name price' },
        { path: 'customer', select: 'name phone customerId' }
      ]
    });
  if (!table) return next(new AppError('Table not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(table.branch?._id?.toString() || table.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }
  
  res.status(200).json({ success: true, data: { table } });
});

// POST /api/tables (super admin only)
exports.createTable = asyncHandler(async (req, res) => {
  const table = await Table.create(req.body);
  table.qrCode = await generateTableQRCode(table._id);
  await table.save();

  await logActivity({
    userId: req.user._id,
    branchId: table.branch,
    action: 'table.create',
    entity: 'Table',
    entityId: table._id,
    description: `${req.user.name} created table ${table.name}`,
    ipAddress: req.ip,
  });

  res.status(201).json({ success: true, data: { table } });
});

// PATCH /api/tables/:id
exports.updateTable = asyncHandler(async (req, res, next) => {
  // Pricing changes restricted to super admin (enforced again here as defense-in-depth)
  if (req.body.hourlyRate !== undefined && req.user.role !== ROLES.SUPER_ADMIN) {
    delete req.body.hourlyRate;
  }

  const table = await Table.findById(req.params.id);
  if (!table) return next(new AppError('Table not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(table.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  const updatedTable = await Table.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!updatedTable) return next(new AppError('Table not found.', 404));

  req.app.get('io')?.to(`branch:${updatedTable.branch}`).emit('table:updated', updatedTable);

  res.status(200).json({ success: true, data: { table: updatedTable } });
});

// DELETE /api/tables/:id (super admin only - soft delete)
exports.deleteTable = asyncHandler(async (req, res, next) => {
  const table = await Table.findById(req.params.id);
  if (!table) return next(new AppError('Table not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(table.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  await Table.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  res.status(200).json({ success: true, message: 'Table removed.' });
});
