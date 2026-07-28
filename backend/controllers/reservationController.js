const Reservation = require('../models/Reservation');
const Table = require('../models/Table');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');
const { ROLES } = require('../config/constants');
const { createBranchNotification } = require('../services/notificationService');

// Helper: convert minutes-since-midnight to 12-hour AM/PM string
function formatMinutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

// Helper: emit reservation:changed socket event to branch room
function emitReservationChanged(req, branchId, action, reservation) {
  try {
    req.app.get('io')?.to(`branch:${branchId}`).emit('reservation:changed', {
      action,
      reservation: {
        _id: reservation._id,
        branch: branchId,
        menuItemId: reservation.menuItemId,
        menuCategoryId: reservation.menuCategoryId,
        reservationDate: reservation.reservationDate,
        reservationTime: reservation.reservationTime,
        durationMinutes: reservation.durationMinutes,
        status: reservation.status,
      },
    });
  } catch (err) {
    console.error('[ReservationController] Socket emission error:', err.message);
  }
}

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
    if (query.dateFrom && query.dateTo) {
      // Range filter: both dateFrom and dateTo provided
      filter.reservationDate.$gte = new Date(query.dateFrom);
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      filter.reservationDate.$lte = end;
    } else if (query.dateFrom) {
      // Single date filter: only dateFrom provided, filter for that specific date
      const d = new Date(query.dateFrom);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      filter.reservationDate = { $gte: d, $lt: next };
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
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder || 'desc';

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
  resDate.setHours(0, 0, 0, 0);
  const duration = parseInt(durationMinutes, 10);

  const [reqH, reqM] = time.split(':').map(Number);
  const reqStart = reqH * 60 + reqM;
  const reqEnd = reqStart + duration;

  const nextDay = new Date(resDate);
  nextDay.setDate(resDate.getDate() + 1);

  const [overlapping, allTables] = await Promise.all([
    Reservation.find({
      branch,
      reservationDate: { $gte: resDate, $lt: nextDay },
      status: { $nin: ['cancelled', 'no_show', 'completed'] },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).select('table reservationTime durationMinutes').lean(),
    Table.find({ branch, isActive: true }).select('name type hourlyRate status').lean(),
  ]);

  const blockedTableIds = new Set();
  for (const r of overlapping) {
    const [h, m] = r.reservationTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (r.durationMinutes || 60);
    if (reqStart < end && start < reqEnd) {
      blockedTableIds.add(r.table.toString());
    }
  }

  const available = allTables.filter((t) => !blockedTableIds.has(t._id.toString()));

  res.status(200).json({ success: true, data: { available, blocked: allTables.length - available.length } });
});

// ── Check menu item availability for a specific slot ─────────────────────────
exports.checkMenuItemAvailability = asyncHandler(async (req, res, next) => {
  const { branch, date, time, durationMinutes = 60, menuCategoryId, excludeId } = req.query;
  if (!branch || !date || !time || !menuCategoryId) {
    return next(new AppError('branch, date, time, and menuCategoryId are required.', 400));
  }

  const resDate = new Date(date);
  resDate.setHours(0, 0, 0, 0);
  const duration = parseInt(durationMinutes, 10);

  const [reqH, reqM] = time.split(':').map(Number);
  const reqStart = reqH * 60 + reqM;
  const reqEnd = reqStart + duration;

  const nextDay = new Date(resDate);
  nextDay.setDate(resDate.getDate() + 1);

  // Fetch bookings and menu items in parallel
  const MenuItem = require('mongoose').model('MenuItem');
  const [bookings, menuItems] = await Promise.all([
    Reservation.find({
      branch,
      menuCategoryId,
      reservationDate: { $gte: resDate, $lt: nextDay },
      status: { $nin: ['cancelled', 'no_show', 'completed'] },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).select('menuItemId reservationTime durationMinutes').lean(),
    MenuItem.find({ category: menuCategoryId, isActive: true }).select('name price').lean(),
  ]);

  // Build conflict map: menuItemId -> { conflictStart, conflictEnd } (first conflict)
  const conflictMap = new Map();
  for (const r of bookings) {
    if (!r.menuItemId) continue;
    const [h, m] = r.reservationTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (r.durationMinutes || 60);
    if (reqStart < end && start < reqEnd) {
      const key = r.menuItemId.toString();
      if (!conflictMap.has(key)) {
        conflictMap.set(key, { conflictTime: formatMinutesToTime(start), conflictEnd: formatMinutesToTime(end) });
      }
    }
  }

  // Build response items
  const items = menuItems.map((item) => {
    const conflict = conflictMap.get(item._id.toString());
    return {
      menuItemId: item._id,
      name: item.name,
      price: item.price,
      available: !conflict,
      ...(conflict || {}),
    };
  });

  res.status(200).json({ success: true, data: { items } });
});

// ── Today's live table availability (grouped by category) ────────────────
exports.getTodayAvailability = asyncHandler(async (req, res, next) => {
  let { branch } = req.query;

  if (!branch && req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    const userBranch = req.user.branches[0];
    branch = typeof userBranch === 'string' ? userBranch : (userBranch._id || userBranch).toString();
  }

  if (!branch) return next(new AppError('branch is required.', 400));

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const { MenuCategory, MenuItem } = require('../models/Operations');

  // Fetch categories, menu items, and today's active bookings in parallel
  const [categories, menuItems, bookings] = await Promise.all([
    MenuCategory.find({ status: 'Active' }).select('name').lean(),
    MenuItem.find({ branch, status: 'Active' }).select('name category price').lean(),
    Reservation.find({
      branch,
      reservationDate: { $gte: todayStart, $lt: todayEnd },
      status: { $nin: ['cancelled', 'no_show', 'completed'] },
    }).select('menuItemId menuCategoryId reservationTime durationMinutes customerName phoneNumber status').lean(),
  ]);

  // Build booking lookup: menuItemId -> array of bookings
  const bookingsByItem = new Map();
  for (const b of bookings) {
    if (!b.menuItemId) continue;
    const key = b.menuItemId.toString();
    if (!bookingsByItem.has(key)) bookingsByItem.set(key, []);
    bookingsByItem.get(key).push(b);
  }

  // Filter out "beverage" and "accessories" categories from bookings timeline
  const filteredCategories = categories.filter((c) => {
    const n = c.name?.trim().toLowerCase();
    return n !== 'beverage' && n !== 'beverages' && n !== 'accessory' && n !== 'accessories';
  });

  // Group items by category
  const result = filteredCategories.map((cat) => {
    const catItems = menuItems.filter(
      (item) => item.category?.toString() === cat._id.toString()
    );

    const items = catItems.map((item) => {
      const itemBookings = bookingsByItem.get(item._id.toString()) || [];

      // Find the current/next overlapping booking at this moment
      let currentBooking = null;
      let upcomingBooking = null;

      for (const bk of itemBookings) {
        const [h, m] = bk.reservationTime.split(':').map(Number);
        const start = h * 60 + m;
        const end = start + (bk.durationMinutes || 60);

        if (nowMinutes >= start && nowMinutes < end) {
          // Currently active booking
          currentBooking = {
            customerName: bk.customerName,
            phoneNumber: bk.phoneNumber,
            startTime: formatMinutesToTime(start),
            endTime: formatMinutesToTime(end),
            remainingMinutes: Math.max(0, end - nowMinutes),
            status: bk.status,
          };
        } else if (start > nowMinutes && start - nowMinutes <= 15) {
          // Booking starts within next 15 minutes
          if (!upcomingBooking || start < upcomingBooking._start) {
            upcomingBooking = {
              customerName: bk.customerName,
              phoneNumber: bk.phoneNumber,
              startTime: formatMinutesToTime(start),
              endTime: formatMinutesToTime(end),
              startsInMinutes: start - nowMinutes,
              status: bk.status,
              _start: start,
            };
          }
        }
      }

      // Determine color status
      let colorStatus = 'available'; // green
      if (currentBooking) {
        colorStatus = 'booked'; // red
      } else if (upcomingBooking) {
        colorStatus = 'upcoming'; // yellow
      }

      const booking = currentBooking || (upcomingBooking ? { ...upcomingBooking, _start: undefined } : null);
      if (booking) delete booking._start;

      return {
        menuItemId: item._id,
        name: item.name,
        price: item.price,
        colorStatus,
        booking,
      };
    });

    return {
      categoryId: cat._id,
      categoryName: cat.name,
      items,
    };
  }).filter((cat) => cat.items.length > 0);

  res.status(200).json({ success: true, data: { categories: result, serverTime: now.toISOString() } });
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

  let finalTable = table;
  if (!finalTable && menuItemId) {
    const matchedTable = await Table.findOne({ menuItemId, branch: finalBranch, isActive: true });
    if (matchedTable) {
      finalTable = matchedTable._id;
    }
  }
  if (!finalTable) {
    finalTable = await getFirstAvailableTable({ branch: finalBranch, reservationDate, reservationTime, durationMinutes });
    if (!finalTable) return next(new AppError('No available table for this reservation slot.', 409));
  }

  const clash = await checkDoubleBooking({ branch: finalBranch, table: finalTable, reservationDate, reservationTime, durationMinutes, menuItemId });
  if (clash) {
    const itemName = clash.menuItemName || 'This table';
    const [cH, cM] = clash.reservationTime.split(':').map(Number);
    const cStart = cH * 60 + cM;
    const cEnd = cStart + (clash.durationMinutes || 60);
    return next(new AppError(
      `${itemName} is already booked from ${formatMinutesToTime(cStart)} to ${formatMinutesToTime(cEnd)}. Please select another table or choose a different time.`,
      409
    ));
  }

  const reservation = await Reservation.create({
    customerName,
    phoneNumber,
    email,
    branch: finalBranch,
    table: finalTable,
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

  res.status(201).json({ success: true, data: { reservation: populated } });

  emitReservationChanged(req, finalBranch, 'create', reservation);

  void createBranchNotification({
    branchId: finalBranch,
    actor: req.user,
    title: 'New Reservation Created',
    message: `${req.user.name} created a new reservation (${reservation.reservationId}) for ${customerName}.`,
    req,
  }).catch((err) => console.error('Failed to create reservation notification:', err.message));

  void logActivity({
    userId: req.user._id,
    branchId: finalBranch,
    action: 'reservation.create',
    entity: 'Reservation',
    entityId: reservation._id,
    description: `${req.user.name} created reservation ${reservation.reservationId} for ${customerName}`,
    ipAddress: req.ip,
  });
});

exports.updateReservation = asyncHandler(async (req, res, next) => {
  const reservation = await Reservation.findById(req.params.id);
  if (!reservation) return next(new AppError('Reservation not found.', 404));

  const { table, reservationDate, reservationTime, durationMinutes, menuItemId } = req.body;

  let targetTable = table;
  if (!targetTable && menuItemId) {
    const matchedTable = await Table.findOne({ menuItemId, branch: reservation.branch, isActive: true });
    if (matchedTable) {
      targetTable = matchedTable._id;
    }
  }
  if (targetTable) {
    req.body.table = targetTable;
  }

  const slotChanging = (req.body.table && req.body.table.toString() !== reservation.table.toString())
    || (reservationDate && new Date(reservationDate).toDateString() !== reservation.reservationDate.toDateString())
    || (reservationTime && reservationTime !== reservation.reservationTime);

  if (slotChanging) {
    const clash = await checkDoubleBooking({
      branch: reservation.branch,
      table: req.body.table || reservation.table,
      reservationDate: reservationDate || reservation.reservationDate,
      reservationTime: reservationTime || reservation.reservationTime,
      durationMinutes: durationMinutes || reservation.durationMinutes,
      menuItemId: menuItemId || reservation.menuItemId,
      excludeId: reservation._id,
    });
    if (clash) {
      const itemName = clash.menuItemName || 'This table';
      const [cH, cM] = clash.reservationTime.split(':').map(Number);
      const cStart = cH * 60 + cM;
      const cEnd = cStart + (clash.durationMinutes || 60);
      return next(new AppError(
        `${itemName} is already booked from ${formatMinutesToTime(cStart)} to ${formatMinutesToTime(cEnd)}. Please select another table or choose a different time.`,
        409
      ));
    }
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

  res.status(200).json({ success: true, data: { reservation: populated } });

  emitReservationChanged(req, reservation.branch, 'update', reservation);

  void logActivity({
    userId: req.user._id,
    branchId: reservation.branch,
    action: 'reservation.update',
    entity: 'Reservation',
    entityId: reservation._id,
    description: `${req.user.name} updated reservation ${reservation.reservationId}`,
    ipAddress: req.ip,
  });
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

  res.status(200).json({ success: true, data: { reservation } });

  emitReservationChanged(req, reservation.branch, 'status', reservation);

  void logActivity({
    userId: req.user._id,
    branchId: reservation.branch,
    action: `reservation.${status}`,
    entity: 'Reservation',
    entityId: reservation._id,
    description: `${req.user.name} marked reservation ${reservation.reservationId} as ${status}`,
    ipAddress: req.ip,
  });
});

exports.deleteReservation = asyncHandler(async (req, res, next) => {
  const reservation = await Reservation.findById(req.params.id);
  if (!reservation) return next(new AppError('Reservation not found.', 404));
  if (['seated', 'completed'].includes(reservation.status)) {
    return next(new AppError('Cannot delete a seated or completed reservation.', 400));
  }

  await reservation.deleteOne();

  res.status(200).json({ success: true, message: 'Reservation deleted.' });

  emitReservationChanged(req, reservation.branch, 'delete', reservation);

  void logActivity({
    userId: req.user._id,
    branchId: reservation.branch,
    action: 'reservation.delete',
    entity: 'Reservation',
    entityId: reservation._id,
    description: `${req.user.name} deleted reservation ${reservation.reservationId}`,
    ipAddress: req.ip,
  });
});

async function checkDoubleBooking({ branch, table, reservationDate, reservationTime, durationMinutes = 60, menuItemId, excludeId }) {
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
  }).select('reservationTime durationMinutes reservationId menuItemId').populate('menuItemId', 'name').lean();

  for (const r of same) {
    const [h, m] = r.reservationTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (r.durationMinutes || 60);
    if (reqStart < end && start < reqEnd) {
      return {
        ...r,
        menuItemName: (typeof r.menuItemId === 'object' && r.menuItemId?.name) ? r.menuItemId.name : null,
      };
    }
  }
  return null;
}

async function getFirstAvailableTable({ branch, reservationDate, reservationTime, durationMinutes = 60, excludeId }) {
  const d = new Date(reservationDate);
  const nextDay = new Date(d);
  nextDay.setDate(d.getDate() + 1);

  const [reqH, reqM] = reservationTime.split(':').map(Number);
  const reqStart = reqH * 60 + reqM;
  const reqEnd = reqStart + parseInt(durationMinutes, 10);

  const overlapping = await Reservation.find({
    branch,
    reservationDate: { $gte: d, $lt: nextDay },
    status: { $nin: ['cancelled', 'no_show', 'completed'] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select('table reservationTime durationMinutes');

  const blockedTableIds = new Set();
  for (const r of overlapping) {
    const [h, m] = r.reservationTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (r.durationMinutes || 60);
    if (reqStart < end && start < reqEnd) blockedTableIds.add(r.table.toString());
  }

  const allTables = await Table.find({ branch, isActive: true }).select('_id');
  const availableTable = allTables.find((t) => !blockedTableIds.has(t._id.toString()));
  return availableTable?._id || null;
}
