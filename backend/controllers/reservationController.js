const Reservation = require('../models/Reservation');
const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');
const { ROLES } = require('../config/constants');

const buildFilter = (query, user) => {
  const filter = {};

  if (user.role !== ROLES.SUPER_ADMIN) {
    filter.branch = { $in: user.branches };
  }
  if (query.branch) filter.branch = query.branch;
  if (query.status) filter.status = query.status;
  if (query.table) filter.table = query.table;
  if (query.menuCategoryId) filter.menuCategoryId = query.menuCategoryId;

  if (query.dateFrom || query.dateTo) {
    filter.reservationDate = {};
    if (query.dateFrom) filter.reservationDate.$gte = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      filter.reservationDate.$lte = end;
    }
  } else if (query.date) {
    const d = new Date(query.date);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    filter.reservationDate = { $gte: d, $lt: next };
  }

  if (query.search) {
    const re = new RegExp(query.search.trim(), 'i');
    filter.$or = [
      { customerName: re },
      { phoneNumber: re },
      { reservationId: re },
    ];
  }

  return filter;
};

const buildSort = (sortBy, sortOrder) => {
  const order = sortOrder === 'asc' ? 1 : -1;
  const map = {
    reservationDate: { reservationDate: order, reservationTime: order },
    customerName: { customerName: order },
    createdAt: { createdAt: order },
    status: { status: order },
  };
  return map[sortBy] || { createdAt: -1 };
};

exports.getReservations = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(req.query.pageSize, 10) || 10));
  const sortBy = req.query.sortBy || 'reservationDate';
  const sortOrder = req.query.sortOrder || 'asc';

  const filter = buildFilter(req.query, req.user);
  const sort = buildSort(sortBy, sortOrder);
  const skip = (page - 1) * pageSize;

  const [reservations, totalRecords] = await Promise.all([
    Reservation.find(filter)
      .populate('branch', 'name code')
      .populate('table', 'name type hourlyRate')
      .populate('menuCategoryId', 'name')
      .populate('menuItemId', 'name price')
      .populate('createdBy', 'name')
      .sort(sort)
      .skip(skip)
      .limit(pageSize)
      .lean(),
    Reservation.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: reservations,
    totalRecords,
    currentPage: page,
    totalPages: Math.ceil(totalRecords / pageSize),
    pageSize,
  });
});

exports.getStats = asyncHandler(async (req, res) => {
  const branchFilter = req.user.role !== ROLES.SUPER_ADMIN
    ? { branch: { $in: req.user.branches } }
    : req.query.branch ? { branch: req.query.branch } : {};

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const [total, todayCount, statusGroups] = await Promise.all([
    Reservation.countDocuments(branchFilter),
    Reservation.countDocuments({ ...branchFilter, reservationDate: { $gte: todayStart, $lte: todayEnd } }),
    Reservation.aggregate([
      { $match: branchFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const byStatus = statusGroups.reduce((acc, g) => {
    acc[g._id] = g.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      total,
      today: todayCount,
      confirmed: byStatus.confirmed || 0,
      pending: byStatus.pending || 0,
      seated: byStatus.seated || 0,
      completed: byStatus.completed || 0,
      cancelled: byStatus.cancelled || 0,
      no_show: byStatus.no_show || 0,
    },
  });
});

exports.getReservation = asyncHandler(async (req, res, next) => {
  const reservation = await Reservation.findById(req.params.id)
    .populate('branch', 'name code')
    .populate('table', 'name type hourlyRate')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name price')
    .populate('createdBy', 'name email');

  if (!reservation) return next(new AppError('Reservation not found.', 404));
  res.status(200).json({ success: true, data: { reservation } });
});

exports.getAvailableTables = asyncHandler(async (req, res, next) => {
  const { branch, date, time, durationMinutes = 60, excludeId } = req.query;
  if (!branch || !date || !time) return next(new AppError('branch, date and time are required.', 400));

  const resDate = new Date(date);
  const duration = parseInt(durationMinutes, 10);

  const [reqH, reqM] = time.split(':').map(Number);
  const reqStart = reqH * 60 + reqM;
  const reqEnd = reqStart + duration;

  const nextDay = new Date(resDate);
  nextDay.setDate(resDate.getDate() + 1);

  const overlapping = await Reservation.find({
    branch,
    reservationDate: { $gte: resDate, $lt: nextDay },
    status: { $nin: ['cancelled', 'no_show', 'completed'] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select('table reservationTime durationMinutes');

  const blockedTableIds = new Set();
  overlapping.forEach((r) => {
    const [h, m] = r.reservationTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (r.durationMinutes || 60);
    if (reqStart < end && start < reqEnd) {
      blockedTableIds.add(r.table.toString());
    }
  });

  const allTables = await Table.find({ branch, isActive: true }).select('name type hourlyRate status');
  const available = allTables.filter((t) => !blockedTableIds.has(t._id.toString()));

  res.status(200).json({ success: true, data: { available, blocked: allTables.length - available.length } });
});

exports.createReservation = asyncHandler(async (req, res, next) => {
  const {
    customerName, phoneNumber, email, branch, table,
    reservationDate, reservationTime, durationMinutes = 60,
    numberOfGuests, specialRequests, notes, status = 'pending',
    menuCategoryId, menuItemId,
  } = req.body;

  // For Branch Manager and Staff, auto-assign branch from their assigned branches
  let finalBranch = branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    finalBranch = req.user.branches[0];
  }

  const clash = await checkDoubleBooking({ branch: finalBranch, table, reservationDate, reservationTime, durationMinutes });
  if (clash) return next(new AppError(`Table is already reserved at this time (conflict with ${clash.reservationId}).`, 409));

  const reservation = await Reservation.create({
    customerName,
    phoneNumber,
    email,
    branch: finalBranch,
    table,
    menuCategoryId,
    menuItemId,
    reservationDate: new Date(reservationDate),
    reservationTime,
    durationMinutes,
    numberOfGuests,
    specialRequests,
    notes,
    status,
    createdBy: req.user._id,
    statusHistory: [{ status, changedBy: req.user._id, note: 'Reservation created' }],
  });

  const populated = await Reservation.findById(reservation._id)
    .populate('branch', 'name')
    .populate('table', 'name type')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name price');

  await logActivity({
    userId: req.user._id,
    branchId: finalBranch,
    action: 'reservation.create',
    entity: 'Reservation',
    entityId: reservation._id,
    description: `${req.user.name} created reservation ${reservation.reservationId} for ${customerName}`,
    ipAddress: req.ip,
  });

  res.status(201).json({ success: true, data: { reservation: populated } });
});

exports.updateReservation = asyncHandler(async (req, res, next) => {
  const reservation = await Reservation.findById(req.params.id);
  if (!reservation) return next(new AppError('Reservation not found.', 404));

  const { table, reservationDate, reservationTime, durationMinutes } = req.body;
  const slotChanging = (table && table !== reservation.table.toString())
    || (reservationDate && new Date(reservationDate).toDateString() !== reservation.reservationDate.toDateString())
    || (reservationTime && reservationTime !== reservation.reservationTime);

  if (slotChanging) {
    const clash = await checkDoubleBooking({
      branch: reservation.branch,
      table: table || reservation.table,
      reservationDate: reservationDate || reservation.reservationDate,
      reservationTime: reservationTime || reservation.reservationTime,
      durationMinutes: durationMinutes || reservation.durationMinutes,
      excludeId: reservation._id,
    });
    if (clash) return next(new AppError(`Table conflict with ${clash.reservationId}.`, 409));
  }

  if (req.body.status && req.body.status !== reservation.status) {
    reservation.statusHistory.push({
      status: req.body.status,
      changedBy: req.user._id,
      changedAt: new Date(),
      note: req.body.statusNote || '',
    });
  }

  const allowed = [
    'customerName', 'phoneNumber', 'email', 'table', 'reservationDate', 'reservationTime',
    'durationMinutes', 'numberOfGuests', 'specialRequests', 'notes', 'status',
    'menuCategoryId', 'menuItemId',
  ];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) reservation[key] = req.body[key];
  });
  await reservation.save();

  const populated = await Reservation.findById(reservation._id)
    .populate('branch', 'name')
    .populate('table', 'name type')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name price');

  await logActivity({
    userId: req.user._id,
    branchId: reservation.branch,
    action: 'reservation.update',
    entity: 'Reservation',
    entityId: reservation._id,
    description: `${req.user.name} updated reservation ${reservation.reservationId}`,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: { reservation: populated } });
});

exports.changeStatus = asyncHandler(async (req, res, next) => {
  const { status, note = '' } = req.body;
  const VALID = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
  if (!VALID.includes(status)) return next(new AppError('Invalid status.', 400));

  const reservation = await Reservation.findById(req.params.id);
  if (!reservation) return next(new AppError('Reservation not found.', 404));

  reservation.statusHistory.push({ status, changedBy: req.user._id, changedAt: new Date(), note });
  reservation.status = status;
  await reservation.save();

  await logActivity({
    userId: req.user._id,
    branchId: reservation.branch,
    action: `reservation.${status}`,
    entity: 'Reservation',
    entityId: reservation._id,
    description: `${req.user.name} marked reservation ${reservation.reservationId} as ${status}`,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: { reservation } });
});

exports.deleteReservation = asyncHandler(async (req, res, next) => {
  const reservation = await Reservation.findById(req.params.id);
  if (!reservation) return next(new AppError('Reservation not found.', 404));
  if (['seated', 'completed'].includes(reservation.status)) {
    return next(new AppError('Cannot delete a seated or completed reservation.', 400));
  }

  await reservation.deleteOne();

  await logActivity({
    userId: req.user._id,
    branchId: reservation.branch,
    action: 'reservation.delete',
    entity: 'Reservation',
    entityId: reservation._id,
    description: `${req.user.name} deleted reservation ${reservation.reservationId}`,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, message: 'Reservation deleted.' });
});

async function checkDoubleBooking({ branch, table, reservationDate, reservationTime, durationMinutes = 60, excludeId }) {
  const d = new Date(reservationDate);
  const nextDay = new Date(d);
  nextDay.setDate(d.getDate() + 1);

  const [reqH, reqM] = reservationTime.split(':').map(Number);
  const reqStart = reqH * 60 + reqM;
  const reqEnd = reqStart + parseInt(durationMinutes, 10);

  const same = await Reservation.find({
    branch,
    table,
    reservationDate: { $gte: d, $lt: nextDay },
    status: { $nin: ['cancelled', 'no_show', 'completed'] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select('reservationTime durationMinutes reservationId');

  for (const r of same) {
    const [h, m] = r.reservationTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (r.durationMinutes || 60);
    if (reqStart < end && start < reqEnd) return r;
  }
  return null;
}
