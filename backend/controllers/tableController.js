const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { generateTableQRCode } = require('../services/qrCodeService');
const { logActivity } = require('../services/activityLogService');
const { ROLES } = require('../config/constants');

// GET /api/tables?branch=...&type=...&status=...
exports.getTables = asyncHandler(async (req, res) => {
  const filter = { isActive: true };

  if (req.user.role !== ROLES.SUPER_ADMIN) {
    filter.branch = { $in: req.user.branches };
  }
  if (req.query.branch) filter.branch = req.query.branch;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;

  const tables = await Table.find(filter)
    .populate('branch', 'name code')
    .populate('currentSession')
    .sort('name');

  res.status(200).json({ success: true, results: tables.length, data: { tables } });
});

// GET /api/tables/:id
exports.getTable = asyncHandler(async (req, res, next) => {
  const table = await Table.findById(req.params.id).populate('branch').populate('currentSession');
  if (!table) return next(new AppError('Table not found.', 404));
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

  const table = await Table.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!table) return next(new AppError('Table not found.', 404));

  req.app.get('io')?.to(`branch:${table.branch}`).emit('table:updated', table);

  res.status(200).json({ success: true, data: { table } });
});

// DELETE /api/tables/:id (super admin only - soft delete)
exports.deleteTable = asyncHandler(async (req, res, next) => {
  const table = await Table.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!table) return next(new AppError('Table not found.', 404));
  res.status(200).json({ success: true, message: 'Table removed.' });
});
