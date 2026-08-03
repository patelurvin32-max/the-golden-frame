const Reservation = require('../models/Reservation');
const Table = require('../models/Table');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const PaymentHistory = require('../models/PaymentHistory');
const WalletTransaction = require('../models/WalletTransaction');
const OrderCounter = require('../models/OrderCounter');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');
const { ROLES } = require('../config/constants');
const { createBranchNotification } = require('../services/notificationService');
const { generateOrderId, generateCustomerId } = require('./customerController');
const {
  getBusinessDayDate,
  getBusinessDayRange,
  getBusinessDayStart,
  getBusinessDayNextStart,
  getBusinessDayDateString,
} = require('../utils/businessDay');

const parseCurrencyValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num;
};



// Helper: convert minutes-since-midnight to 12-hour AM/PM string
function formatMinutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

// Helper: convert HH:MM time string to business day minutes relative to 05:00 AM start
function timeToBusinessMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  const minutesFromMidnight = h * 60 + m;
  if (minutesFromMidnight < 300) {
    return minutesFromMidnight + 1440 - 300;
  }
  return minutesFromMidnight - 300;
}

// Helper: convert business day minutes back to 12-hour AM/PM string
function formatBusinessMinutesToTime(businessMinutes) {
  const minutesFromMidnight = (businessMinutes + 300) % 1440;
  return formatMinutesToTime(minutesFromMidnight);
}


// Helper: emit reservation:changed socket event to branch room
function emitReservationChanged(req, branchId, action, reservation) {
  try {
    const io = req.app.get('io');
    if (io) {
      const payload = {
        action,
        reservation: {
          _id: reservation._id,
          branch: branchId,
          table: reservation.table,
          reservationDate: reservation.reservationDate,
          reservationTime: reservation.reservationTime,
          status: reservation.status,
        },
      };
      io.to(`branch:${branchId}`).emit('reservation:changed', payload);
      io.to(`role:${ROLES.SUPER_ADMIN}`).emit('reservation:changed', payload);
    }
  } catch (err) {
    console.error('Socket broadcast failed:', err.message);
  }
}

// Helper: emit availability:changed socket event to branch room
function emitAvailabilityChanged(req, branchId) {
  try {
    const io = req.app.get('io');
    if (io) {
      const payload = {
        branch: branchId,
        timestamp: new Date().toISOString(),
      };
      io.to(`branch:${branchId}`).emit('availability:changed', payload);
      io.to(`role:${ROLES.SUPER_ADMIN}`).emit('availability:changed', payload);
    }
  } catch (err) {
    console.error('[emitAvailabilityChanged] Error:', err.message);
  }
}

// ── Private Filter Builder ───────────────────────────────────────────────────
const buildFilter = (query, user) => {
  const filter = {};

  if (user.role !== ROLES.SUPER_ADMIN && user.role !== ROLES.ADMIN) {
    const userBranchIds = (user.branches || []).map(b => (b._id || b).toString());
    if (query.branch && userBranchIds.includes(query.branch.toString())) {
      filter.branch = query.branch;
    } else {
      filter.branch = { $in: user.branches };
    }
  } else if (query.branch) {
    filter.branch = query.branch;
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.table) {
    filter.table = query.table;
  }

  if (query.dateFrom || query.dateTo) {
    filter.reservationDate = {};
    if (query.dateFrom && query.dateTo) {
      filter.reservationDate.$gte = new Date(query.dateFrom);
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      filter.reservationDate.$lte = end;
    } else if (query.dateFrom) {
      const d = getBusinessDayDate(new Date(query.dateFrom));
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      filter.reservationDate = { $gte: d, $lt: next };
    }
  } else if (query.date) {
    const d = getBusinessDayDate(new Date(query.date));
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

exports.getStats = asyncHandler(async (req, res, next) => {
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    return next(new AppError('Forbidden. Only Super Admin can access these statistics.', 403));
  }

  const mongoose = require('mongoose');
  let branchFilter = {};
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => new mongoose.Types.ObjectId(b._id || b));
    if (req.query.branch && userBranchIds.some(id => id.toString() === req.query.branch.toString())) {
      branchFilter = { branch: new mongoose.Types.ObjectId(req.query.branch) };
    } else {
      branchFilter = { branch: { $in: userBranchIds } };
    }
  } else if (req.query.branch) {
    branchFilter = { branch: new mongoose.Types.ObjectId(req.query.branch) };
  }

  const { start: todayStart, end: todayEnd } = getBusinessDayRange(new Date());

  const [result] = await Reservation.aggregate([
    { $match: branchFilter },
    {
      $facet: {
        total:    [{ $count: 'n' }],
        today:    [{ $match: { reservationDate: { $gte: todayStart, $lte: todayEnd } } }, { $count: 'n' }],
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
      },
    },
  ]);

  const byStatus = (result?.byStatus || []).reduce((acc, g) => {
    acc[g._id] = g.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      total:     result?.total[0]?.n || 0,
      today:     result?.today[0]?.n || 0,
      confirmed: byStatus.confirmed || 0,
      pending:   byStatus.pending   || 0,
      seated:    byStatus.seated    || 0,
      completed: byStatus.completed || 0,
      cancelled: byStatus.cancelled || 0,
      no_show:   byStatus.no_show   || 0,
    },
  });
});

exports.getReservation = asyncHandler(async (req, res, next) => {
  const reservation = await Reservation.findById(req.params.id)
    .populate('branch', 'name code')
    .populate('table', 'name type hourlyRate')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name price')
    .populate('createdBy', 'name email')
    .lean();

  if (!reservation) return next(new AppError('Reservation not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(reservation.branch?._id?.toString() || reservation.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }
  res.status(200).json({ success: true, data: { reservation } });
});

exports.getAvailableTables = asyncHandler(async (req, res, next) => {
  const { branch, reservationDate, reservationTime, durationMinutes } = req.query;

  if (!branch || !reservationDate || !reservationTime) {
    return next(new AppError('branch, reservationDate, and reservationTime are required.', 400));
  }

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(branch.toString())) {
      return next(new AppError('You do not have access to this branch.', 403));
    }
  }

  const duration = parseInt(durationMinutes, 10) || 60;
  const targetDate = new Date(reservationDate);
  const targetNext = new Date(targetDate);
  targetNext.setDate(targetDate.getDate() + 1);

  const [tables, existingReservations] = await Promise.all([
    Table.find({ branch, isActive: true }).select('name type hourlyRate minCapacity maxCapacity').lean(),
    Reservation.find({
      branch,
      reservationDate: { $gte: targetDate, $lt: targetNext },
      status: { $nin: ['cancelled', 'no_show'] },
    }).select('table reservationTime durationMinutes').lean(),
  ]);

  const timeToMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const reqStart = timeToMinutes(reservationTime);
  const reqEnd = reqStart + duration;

  const availableTables = tables.filter((tbl) => {
    const tblReservations = existingReservations.filter(
      (r) => r.table && r.table.toString() === tbl._id.toString()
    );

    for (const r of tblReservations) {
      const rStart = timeToMinutes(r.reservationTime);
      const rEnd = rStart + (r.durationMinutes || 60);
      if (reqStart < rEnd && reqEnd > rStart) {
        return false; // Overlap detected
      }
    }
    return true;
  });

  res.status(200).json({ success: true, data: { availableTables } });
});

// ── Check menu item availability for a specific slot ─────────────────────────
exports.checkMenuItemAvailability = asyncHandler(async (req, res, next) => {
  let { branch, menuItemId, menuCategoryId, date, reservationDate, time, reservationTime, durationMinutes = 60, excludeId } = req.query;

  if (!branch && req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    const userBranch = req.user.branches[0];
    branch = typeof userBranch === 'string' ? userBranch : (userBranch._id || userBranch).toString();
  }

  const targetDate = reservationDate || date;
  const targetTime = reservationTime || time;

  if (!branch || !targetDate || !targetTime) {
    return next(new AppError('branch, date (or reservationDate), and time (or reservationTime) are required.', 400));
  }

  const MenuItem = require('../models/Operations').MenuItem;

  // Single menuItemId check
  if (menuItemId) {
    const clash = await checkDoubleBooking({
      branch,
      menuItemId,
      reservationDate: targetDate,
      reservationTime: targetTime,
      durationMinutes: Number(durationMinutes),
      excludeId,
    });

    const isAvailable = !clash;
    const conflictTime = clash?.reservationTime || clash?.conflictTime;
    const conflictEnd = clash?.conflictEnd;

    return res.status(200).json({
      success: true,
      available: isAvailable,
      clashReservation: clash || null,
      data: {
        items: [
          {
            menuItemId,
            available: isAvailable,
            ...(conflictTime ? { conflictTime, conflictEnd } : {}),
          },
        ],
      },
    });
  }

  // Batch menuCategoryId check
  if (menuCategoryId) {
    const menuItems = await MenuItem.find({ category: menuCategoryId, isActive: true }).select('_id').lean();
    const items = await Promise.all(
      menuItems.map(async (item) => {
        const itemId = item._id.toString();
        const clash = await checkDoubleBooking({
          branch,
          menuItemId: itemId,
          reservationDate: targetDate,
          reservationTime: targetTime,
          durationMinutes: Number(durationMinutes),
          excludeId,
        });

        const isAvailable = !clash;
        const conflictTime = clash?.reservationTime || clash?.conflictTime;
        const conflictEnd = clash?.conflictEnd;

        return {
          menuItemId: itemId,
          available: isAvailable,
          ...(conflictTime ? { conflictTime, conflictEnd } : {}),
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: { items },
    });
  }

  return res.status(200).json({
    success: true,
    data: { items: [] },
  });
});

// ── Today's live table availability (grouped by category) ────────────────
exports.getTodayAvailability = asyncHandler(async (req, res, next) => {
  let { branch, date } = req.query;

  if (!branch && req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN && req.user.branches && req.user.branches.length > 0) {
    const userBranch = req.user.branches[0];
    branch = typeof userBranch === 'string' ? userBranch : (userBranch._id || userBranch).toString();
  }

  if (!branch) return next(new AppError('branch is required.', 400));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(branch.toString())) {
      return next(new AppError('You do not have access to this branch.', 403));
    }
  }

  const now = new Date();

  // Target date range calculation using Business Day logic
  let targetDate = now;
  if (date) {
    const parsed = new Date(date);
    if (!isNaN(parsed.getTime())) {
      targetDate = parsed;
    }
  }

  const { start: targetStart, end: targetEnd } = getBusinessDayRange(targetDate);
  const targetBusinessDate = getBusinessDayDate(targetDate);
  const targetNextDate = new Date(targetBusinessDate);
  targetNextDate.setDate(targetNextDate.getDate() + 1);

  // Minutes since 05:00 AM business day start for current time
  const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const nowBusinessMinutes = timeToBusinessMinutes(nowTimeStr);

  const { MenuCategory, MenuItem } = require('../models/Operations');

  // Fetch categories, menu items, and active bookings for the selected date
  // ONLY include active statuses: pending, confirmed, seated. EXCLUDE: cancelled, completed, no_show
  const [categories, menuItems, bookings] = await Promise.all([
    MenuCategory.find({ status: 'Active' }).select('name').lean(),
    MenuItem.find({ branch, status: 'Active' }).select('name category price').lean(),
    Reservation.find({
      branch,
      $or: [
        { reservationDate: { $gte: targetBusinessDate, $lt: targetNextDate } },
        { createdAt: { $gte: targetStart, $lt: targetEnd } }
      ],
      status: { $in: ['pending', 'confirmed', 'seated'] },
    })
      .select('menuItemId menuCategoryId reservationTime durationMinutes customerName phoneNumber status reservationDate reservationId')
      .lean(),
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
      // Map every booking's reservationTime into Business Day Minutes (relative to 05:00 AM)
      // and sort chronologically by start business minutes
      const itemBookings = (bookingsByItem.get(item._id.toString()) || []).map((bk) => {
        const start = timeToBusinessMinutes(bk.reservationTime);
        const end = start + (bk.durationMinutes || 60);
        return { ...bk, start, end };
      }).sort((a, b) => a.start - b.start);

      let currentBooking = null;

      // Find currently active booking
      for (const bk of itemBookings) {
        if (nowBusinessMinutes >= bk.start && nowBusinessMinutes < bk.end) {
          currentBooking = {
            _id: bk._id,
            reservationId: bk.reservationId,
            customerName: bk.customerName,
            phoneNumber: bk.phoneNumber,
            startTime: formatBusinessMinutesToTime(bk.start),
            endTime: formatBusinessMinutesToTime(bk.end),
            remainingMinutes: Math.max(0, bk.end - nowBusinessMinutes),
            status: bk.status,
            _start: bk.start,
            _end: bk.end,
          };
          break;
        }
      }

      // Filter all upcoming bookings after current moment / current booking
      const upcomingList = itemBookings.filter((bk) => {
        if (currentBooking) {
          return bk.start >= currentBooking._end;
        }
        return bk.start > nowBusinessMinutes;
      });

      let nextBooking = null;
      if (upcomingList.length > 0) {
        const nbk = upcomingList[0];
        nextBooking = {
          _id: nbk._id,
          reservationId: nbk.reservationId,
          customerName: nbk.customerName,
          phoneNumber: nbk.phoneNumber,
          startTime: formatBusinessMinutesToTime(nbk.start),
          endTime: formatBusinessMinutesToTime(nbk.end),
          startsInMinutes: nbk.start - nowBusinessMinutes,
          status: nbk.status,
          _start: nbk.start,
          _end: nbk.end,
        };
      }

      // Queue of all upcoming bookings
      const upcomingBookings = upcomingList.map((bk) => ({
        _id: bk._id,
        reservationId: bk.reservationId,
        customerName: bk.customerName,
        phoneNumber: bk.phoneNumber,
        startTime: formatBusinessMinutesToTime(bk.start),
        endTime: formatBusinessMinutesToTime(bk.end),
        startsInMinutes: bk.start - nowBusinessMinutes,
        status: bk.status,
      }));

      // Queue of ALL valid bookings for this item today
      const allBookings = itemBookings.map((bk) => ({
        _id: bk._id,
        reservationId: bk.reservationId,
        customerName: bk.customerName,
        phoneNumber: bk.phoneNumber,
        startTime: formatBusinessMinutesToTime(bk.start),
        endTime: formatBusinessMinutesToTime(bk.end),
        durationMinutes: bk.durationMinutes,
        startsInMinutes: bk.start - nowBusinessMinutes,
        remainingMinutes: (nowBusinessMinutes >= bk.start && nowBusinessMinutes < bk.end) ? Math.max(0, bk.end - nowBusinessMinutes) : null,
        isCurrent: (nowBusinessMinutes >= bk.start && nowBusinessMinutes < bk.end),
        status: bk.status,
      }));


      // Determine color status
      let colorStatus = 'available'; // green
      if (currentBooking) {
        colorStatus = 'booked'; // red
      } else if (nextBooking && nextBooking.startsInMinutes <= 15) {
        colorStatus = 'upcoming'; // yellow
      }

      const booking = currentBooking
        ? {
            customerName: currentBooking.customerName,
            phoneNumber: currentBooking.phoneNumber,
            startTime: currentBooking.startTime,
            endTime: currentBooking.endTime,
            remainingMinutes: currentBooking.remainingMinutes,
            status: currentBooking.status,
          }
        : null;

      return {
        menuItemId: item._id,
        name: item.name,
        price: item.price,
        colorStatus,
        booking,
        nextBooking,
        upcomingBookings,
        allBookings,
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
    paymentStatus = 'unpaid', paymentMethod, cashAmount, onlineAmount,
    walletAmount, amountReceived, pendingPlayers, billAmount
  } = req.body;

  // For Branch Manager and Staff, validate they have access to the requested branch
  let finalBranch = branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    
    // If no branch provided, use first assigned branch
    if (!finalBranch && req.user.branches && req.user.branches.length > 0) {
      finalBranch = req.user.branches[0];
    }
    
    // Validate access to the branch
    if (!finalBranch || !userBranchIds.includes(finalBranch.toString())) {
      return next(new AppError('You do not have access to this branch.', 403));
    }
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

  let customer = await Customer.findOne({ phone: phoneNumber, isActive: true });
  if (!customer) {
    const customerId = await generateCustomerId(finalBranch);
    customer = await Customer.create({
      customerId, name: customerName, phone: phoneNumber, email, branch: finalBranch,
    });
  }

  const pCash = parseCurrencyValue(cashAmount);
  const pOnline = parseCurrencyValue(onlineAmount);
  const pWallet = parseCurrencyValue(walletAmount);
  const pReceived = parseCurrencyValue(amountReceived);
  const pBill = parseCurrencyValue(billAmount);

  if (pWallet > 0 && customer.walletBalance < pWallet) {
    return next(new AppError(`Insufficient wallet balance. Available: ₹${customer.walletBalance}, Required: ₹${pWallet}`, 400));
  }

  let totalPaid = pCash + pOnline + pWallet;
  
  if (paymentMethod === 'cash' && pCash === 0 && pReceived > 0) {
    totalPaid = pReceived + pWallet;
  } else if (paymentMethod === 'upi' && pOnline === 0 && pReceived > 0) {
    totalPaid = pReceived + pWallet;
  }

  let pendingPaymentAmount = 0;
  if (Array.isArray(pendingPlayers)) {
    pendingPaymentAmount = pendingPlayers.reduce((sum, p) => sum + parseCurrencyValue(p.amount), 0);
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
    paymentStatus,
    paymentMethod,
    cashAmount: pCash,
    onlineAmount: pOnline,
    walletAmount: pWallet,
    totalPaid,
    billAmount: pBill,
    amountReceived: pReceived,
    pendingPaymentAmount,
    pendingPlayers: Array.isArray(pendingPlayers) ? pendingPlayers : [],
    statusHistory: [{ status, changedBy: req.user._id, note: 'Reservation created' }],
  });

  const populated = await Reservation.findById(reservation._id)
    .populate('branch', 'name')
    .populate('table', 'name type')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name price');

  res.status(201).json({ success: true, data: { reservation: populated } });

  const writePromises = [];
  if (pWallet > 0) {
    customer.walletBalance -= pWallet;
    customer.walletTransactions.push({
      type: 'debit', amount: pWallet, balance: customer.walletBalance,
      billAmount: pBill, paymentMethod, description: `Payment for reservation ${reservation.reservationId}`,
      createdBy: req.user._id,
    });
    writePromises.push(WalletTransaction.create({
      customer: customer._id, customerName: customer.name, customerPhone: customer.phone,
      reservation: reservation._id, branch: finalBranch, type: 'debit',
      amount: pWallet, balance: customer.walletBalance, billAmount: pBill, walletAmountUsed: pWallet,
      paymentMethod, description: `Payment for reservation ${reservation.reservationId}`, createdBy: req.user._id,
    }));
    writePromises.push(customer.save());
  }

  if (totalPaid > 0 || paymentStatus === 'paid' || paymentStatus === 'partial') {
    writePromises.push(PaymentHistory.create({
      reservation: reservation._id,
      customer: customer._id, customerName: customer.name, customerPhone: customer.phone,
      branch: finalBranch, paymentMethod, cashAmount: pCash, onlineAmount: pOnline, walletAmount: pWallet,
      totalPaid, billAmount: pBill, pendingAmount: pendingPaymentAmount, paymentStatus,
      notes, createdBy: req.user._id, paymentNumber: 1
    }));
  }

  if (paymentStatus === 'unpaid' || paymentStatus === 'partial') {
    const sumPending = Array.isArray(pendingPlayers) ? pendingPlayers.reduce((s, p) => s + (parseCurrencyValue(p.amount) || 0), 0) : 0;
    const mainPending = Math.max(0, pBill - totalPaid - sumPending);

    if (mainPending > 0 || (Array.isArray(pendingPlayers) && pendingPlayers.length > 0)) {
      const parentOrderId = await generateOrderId(finalBranch);
      const parentOrder = await Order.create({
        orderId: parentOrderId,
        customer: customer._id,
        branch: finalBranch,
        menuCategoryId,
        menuItemId,
        table: finalTable || undefined,
        paymentStatus,
        paymentMethod: paymentMethod || null,
        cashAmount: pCash,
        onlineAmount: pOnline,
        walletAmount: pWallet,
        pendingPaymentAmount: mainPending,
        amountReceived: pReceived,
        totalPaid,
        billAmount: pBill,
        notes: notes || `Pending payment for reservation ${reservation.reservationId}`,
        createdBy: req.user._id,
      });

      if (mainPending > 0) {
        customer.outstandingBalance = (customer.outstandingBalance || 0) + mainPending;
        writePromises.push(customer.save());

        writePromises.push(PaymentHistory.create({
          order: parentOrder._id,
          orderId: parentOrder.orderId,
          customer: customer._id,
          customerName: customer.name,
          customerPhone: customer.phone,
          branch: finalBranch,
          paymentMethod: paymentMethod || null,
          cashAmount: pCash,
          onlineAmount: pOnline,
          walletAmount: pWallet,
          totalPaid,
          billAmount: pBill,
          pendingAmount: mainPending,
          paymentStatus,
          notes: notes || `Pending payment for reservation ${reservation.reservationId}`,
          createdBy: req.user._id,
          paymentNumber: 1,
        }));
      }

      if (Array.isArray(pendingPlayers) && pendingPlayers.length > 0) {
        const savedPendingPlayersList = [];
        for (const player of pendingPlayers) {
          const pAmt = parseCurrencyValue(player.amount);
          if (pAmt > 0 && player.mobile) {
            let pCustomer = await Customer.findOne({ phone: player.mobile, isActive: true });
            if (!pCustomer) {
              const pCustId = await generateCustomerId(finalBranch);
              pCustomer = await Customer.create({
                customerId: pCustId,
                name: player.name || `Player (${player.mobile})`,
                phone: player.mobile,
                branch: finalBranch
              });
            } else {
              if (player.name && player.name.trim() !== '' && (pCustomer.name.startsWith('Player (') || !pCustomer.name)) {
                pCustomer.name = player.name.trim();
                await pCustomer.save();
              }
            }

            const pOrderId = `${parentOrder.orderId}-P${savedPendingPlayersList.length + 1}`;
            const pOrder = await Order.create({
              orderId: pOrderId,
              customer: pCustomer._id,
              parentOrder: parentOrder._id,
              parentOrderId: parentOrder.orderId,
              branch: finalBranch,
              menuCategoryId,
              menuItemId,
              table: finalTable || undefined,
              paymentStatus: 'unpaid',
              pendingPaymentAmount: pAmt,
              billAmount: pAmt,
              notes: `Pending player payment for reservation ${reservation.reservationId}`,
              createdBy: req.user._id
            });

            pCustomer.outstandingBalance = (pCustomer.outstandingBalance || 0) + pAmt;
            writePromises.push(pCustomer.save());

            writePromises.push(PaymentHistory.create({
              order: pOrder._id,
              orderId: pOrder.orderId,
              customer: pCustomer._id,
              customerName: pCustomer.name,
              customerPhone: pCustomer.phone,
              branch: finalBranch,
              totalPaid: 0,
              billAmount: pAmt,
              pendingAmount: pAmt,
              paymentStatus: 'unpaid',
              notes: `Pending player payment for reservation ${reservation.reservationId}`,
              createdBy: req.user._id,
              paymentNumber: 1
            }));

            savedPendingPlayersList.push({
              id: pOrder._id.toString(),
              playerName: pCustomer.name,
              name: pCustomer.name,
              mobileNumber: pCustomer.phone,
              mobile: pCustomer.phone,
              pendingAmount: pAmt,
              amount: pAmt,
              orderId: pOrderId,
              customerId: pCustomer._id.toString(),
            });
          }
        }

        if (savedPendingPlayersList.length > 0) {
          parentOrder.pendingPlayers = savedPendingPlayersList;
          await parentOrder.save();
        }
      }
    }
  }

  if (writePromises.length > 0) {
    Promise.all(writePromises).catch(err => console.error('Error saving reservation payment records:', err));
  }

  emitReservationChanged(req, finalBranch, 'create', reservation);
  emitAvailabilityChanged(req, finalBranch);

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

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(reservation.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
    if (req.body.branch && !userBranchIds.includes(req.body.branch.toString())) {
      return next(new AppError('You cannot assign to this branch.', 403));
    }
  }

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
    'paymentStatus', 'paymentMethod', 'cashAmount', 'onlineAmount', 'walletAmount',
    'billAmount', 'amountReceived', 'totalPaid', 'pendingPaymentAmount', 'pendingPlayers'
  ];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) reservation[key] = req.body[key];
  });

  // Synchronise Orders and Pending Payments for reservation on update
  if (req.body.paymentStatus === 'unpaid' || req.body.paymentStatus === 'partial' || reservation.paymentStatus === 'unpaid' || reservation.paymentStatus === 'partial') {
    const finalBranch = reservation.branch;
    const pBill = req.body.billAmount !== undefined ? parseCurrencyValue(req.body.billAmount) : reservation.billAmount;
    const pCash = req.body.cashAmount !== undefined ? parseCurrencyValue(req.body.cashAmount) : reservation.cashAmount;
    const pOnline = req.body.onlineAmount !== undefined ? parseCurrencyValue(req.body.onlineAmount) : reservation.onlineAmount;
    const pWallet = req.body.walletAmount !== undefined ? parseCurrencyValue(req.body.walletAmount) : reservation.walletAmount;
    const pReceived = req.body.amountReceived !== undefined ? parseCurrencyValue(req.body.amountReceived) : reservation.amountReceived;
    const totalPaid = pCash + pOnline + pWallet;
    
    const incomingPlayers = req.body.pendingPlayers !== undefined ? req.body.pendingPlayers : (reservation.pendingPlayers || []);
    const sumPending = Array.isArray(incomingPlayers) ? incomingPlayers.reduce((s, p) => s + (parseCurrencyValue(p.amount || p.pendingAmount) || 0), 0) : 0;
    const mainPending = Math.max(0, pBill - totalPaid - sumPending);

    const menuCategoryId = req.body.menuCategoryId || reservation.menuCategoryId;
    const menuItemId = req.body.menuItemId || reservation.menuItemId;
    const finalTable = req.body.table || reservation.table;

    // Find the main customer
    const customer = await Customer.findOne({ phone: req.body.phoneNumber || reservation.phoneNumber, isActive: true });

    if (customer && (mainPending > 0 || (Array.isArray(incomingPlayers) && incomingPlayers.length > 0))) {
      let parentOrder = await Order.findOne({
        customer: customer._id,
        branch: finalBranch,
        $or: [
          { orderId: reservation.reservationId },
          { notes: new RegExp(reservation.reservationId) }
        ],
        parentOrder: null,
        isActive: true
      });

      if (!parentOrder) {
        // Create parent order if it didn't exist before
        const parentOrderId = await generateOrderId(finalBranch);
        parentOrder = await Order.create({
          orderId: parentOrderId,
          customer: customer._id,
          branch: finalBranch,
          menuCategoryId,
          menuItemId,
          table: finalTable || undefined,
          paymentStatus: req.body.paymentStatus || reservation.paymentStatus,
          paymentMethod: req.body.paymentMethod || reservation.paymentMethod || null,
          cashAmount: pCash,
          onlineAmount: pOnline,
          walletAmount: pWallet,
          pendingPaymentAmount: mainPending,
          amountReceived: pReceived,
          totalPaid,
          billAmount: pBill,
          notes: req.body.notes || reservation.notes || `Pending payment for reservation ${reservation.reservationId}`,
          createdBy: req.user._id,
        });

        if (mainPending > 0) {
          customer.outstandingBalance = (customer.outstandingBalance || 0) + mainPending;
          await customer.save();

          await PaymentHistory.create({
            order: parentOrder._id,
            orderId: parentOrder.orderId,
            customer: customer._id,
            customerName: customer.name,
            customerPhone: customer.phone,
            branch: finalBranch,
            paymentMethod: req.body.paymentMethod || reservation.paymentMethod || null,
            cashAmount: pCash,
            onlineAmount: pOnline,
            walletAmount: pWallet,
            totalPaid,
            billAmount: pBill,
            pendingAmount: mainPending,
            paymentStatus: req.body.paymentStatus || reservation.paymentStatus,
            notes: req.body.notes || reservation.notes || `Pending payment for reservation ${reservation.reservationId}`,
            createdBy: req.user._id,
            paymentNumber: 1,
          });
        }
      } else {
        // Update existing parent order
        const oldPending = parentOrder.pendingPaymentAmount || 0;
        const diff = mainPending - oldPending;
        
        parentOrder.menuCategoryId = menuCategoryId;
        parentOrder.menuItemId = menuItemId;
        parentOrder.table = finalTable || undefined;
        parentOrder.paymentStatus = req.body.paymentStatus || reservation.paymentStatus;
        parentOrder.paymentMethod = req.body.paymentMethod || reservation.paymentMethod || null;
        parentOrder.cashAmount = pCash;
        parentOrder.onlineAmount = pOnline;
        parentOrder.walletAmount = pWallet;
        parentOrder.pendingPaymentAmount = mainPending;
        parentOrder.amountReceived = pReceived;
        parentOrder.totalPaid = totalPaid;
        parentOrder.billAmount = pBill;
        parentOrder.notes = req.body.notes || reservation.notes || parentOrder.notes;
        await parentOrder.save();

        if (diff !== 0) {
          customer.outstandingBalance = (customer.outstandingBalance || 0) + diff;
          await customer.save();
        }
      }

      // Synchronise split pending players
      const existingSubOrders = await Order.find({
        parentOrder: parentOrder._id,
        isActive: true
      }).populate('customer');

      const updatedPendingPlayersList = [];
      const processedSubOrderIds = new Set();

      if (Array.isArray(incomingPlayers)) {
        for (const p of incomingPlayers) {
          const playerMobile = String(p.mobile || p.mobileNumber || p.phone || '').replace(/\D/g, '').slice(0, 10);
          const playerAmount = parseCurrencyValue(p.amount || p.pendingAmount) || 0;
          const playerName = (p.name || p.playerName || '').trim() || `Player (${playerMobile})`;
          const targetId = p.id || p._id;

          if (playerMobile.length === 10 && playerAmount > 0) {
            let matchedSub = targetId ? existingSubOrders.find(so => so._id.toString() === targetId.toString()) : null;

            if (matchedSub) {
              processedSubOrderIds.add(matchedSub._id.toString());
              
              const oldSubPending = matchedSub.pendingPaymentAmount || 0;
              const subDiff = playerAmount - oldSubPending;

              matchedSub.billAmount = playerAmount;
              matchedSub.pendingPaymentAmount = playerAmount;
              matchedSub.menuCategoryId = menuCategoryId;
              matchedSub.menuItemId = menuItemId;
              matchedSub.branch = finalBranch;
              matchedSub.table = finalTable || undefined;
              await matchedSub.save();

              if (matchedSub.customer) {
                const pc = await Customer.findById(matchedSub.customer);
                if (pc) {
                  if (playerName && playerName !== pc.name) {
                    pc.name = playerName;
                  }
                  if (subDiff !== 0) {
                    pc.outstandingBalance = (pc.outstandingBalance || 0) + subDiff;
                  }
                  await pc.save();
                }
              }

              updatedPendingPlayersList.push({
                id: matchedSub._id.toString(),
                playerName,
                name: playerName,
                mobileNumber: playerMobile,
                mobile: playerMobile,
                pendingAmount: playerAmount,
                amount: playerAmount,
                orderId: matchedSub.orderId,
                customerId: matchedSub.customer ? (matchedSub.customer._id || matchedSub.customer).toString() : '',
              });
            } else {
              // Create new sub-order
              let pCustomer = await Customer.findOne({ phone: playerMobile, isActive: true });
              if (!pCustomer) {
                const pCustId = await generateCustomerId(finalBranch);
                pCustomer = await Customer.create({
                  customerId: pCustId,
                  name: playerName,
                  phone: playerMobile,
                  branch: finalBranch
                });
              } else {
                if (playerName && (pCustomer.name.startsWith('Player (') || !pCustomer.name)) {
                  pCustomer.name = playerName;
                  await pCustomer.save();
                }
              }

              const pOrderId = `${parentOrder.orderId}-P${updatedPendingPlayersList.length + 1}`;
              const pOrder = await Order.create({
                orderId: pOrderId,
                customer: pCustomer._id,
                parentOrder: parentOrder._id,
                parentOrderId: parentOrder.orderId,
                branch: finalBranch,
                menuCategoryId,
                menuItemId,
                table: finalTable || undefined,
                paymentStatus: 'unpaid',
                pendingPaymentAmount: playerAmount,
                billAmount: playerAmount,
                notes: `Pending player payment for reservation ${reservation.reservationId}`,
                createdBy: req.user._id
              });

              pCustomer.outstandingBalance = (pCustomer.outstandingBalance || 0) + playerAmount;
              await pCustomer.save();

              await PaymentHistory.create({
                order: pOrder._id,
                orderId: pOrder.orderId,
                customer: pCustomer._id,
                customerName: pCustomer.name,
                customerPhone: pCustomer.phone,
                branch: finalBranch,
                totalPaid: 0,
                billAmount: playerAmount,
                pendingAmount: playerAmount,
                paymentStatus: 'unpaid',
                notes: `Pending player payment for reservation ${reservation.reservationId}`,
                createdBy: req.user._id,
                paymentNumber: 1
              });

              updatedPendingPlayersList.push({
                id: pOrder._id.toString(),
                playerName,
                name: playerName,
                mobileNumber: playerMobile,
                mobile: playerMobile,
                pendingAmount: playerAmount,
                amount: playerAmount,
                orderId: pOrderId,
                customerId: pCustomer._id.toString(),
              });
            }
          }
        }
      }

      // Soft delete removed player sub-orders
      for (const existingSub of existingSubOrders) {
        if (!processedSubOrderIds.has(existingSub._id.toString())) {
          existingSub.isActive = false;
          await existingSub.save();
          
          if (existingSub.customer) {
            const pc = await Customer.findById(existingSub.customer);
            if (pc) {
              pc.outstandingBalance = Math.max(0, (pc.outstandingBalance || 0) - (existingSub.pendingPaymentAmount || 0));
              await pc.save();
            }
          }
        }
      }

      parentOrder.pendingPlayers = updatedPendingPlayersList;
      await parentOrder.save();

      // Synchronize back to reservation document
      reservation.pendingPlayers = updatedPendingPlayersList.map(p => ({
        name: p.name,
        mobile: p.mobile,
        amount: p.amount,
        playerName: p.playerName,
        mobileNumber: p.mobileNumber,
        pendingAmount: p.pendingAmount
      }));
    }
  }

  await reservation.save();

  const populated = await Reservation.findById(reservation._id)
    .populate('branch', 'name')
    .populate('table', 'name type')
    .populate('menuCategoryId', 'name')
    .populate('menuItemId', 'name price');

  res.status(200).json({ success: true, data: { reservation: populated } });

  emitReservationChanged(req, reservation.branch, 'update', reservation);
  emitAvailabilityChanged(req, reservation.branch);

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

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(reservation.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  reservation.statusHistory.push({ status, changedBy: req.user._id, changedAt: new Date(), note });
  reservation.status = status;
  await reservation.save();

  res.status(200).json({ success: true, data: { reservation } });

  emitReservationChanged(req, reservation.branch, 'status', reservation);
  emitAvailabilityChanged(req, reservation.branch);

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

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(reservation.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }
  if (['seated', 'completed'].includes(reservation.status)) {
    return next(new AppError('Cannot delete a seated or completed reservation.', 400));
  }

  await reservation.deleteOne();

  res.status(200).json({ success: true, message: 'Reservation deleted.' });

  emitReservationChanged(req, reservation.branch, 'delete', reservation);
  emitAvailabilityChanged(req, reservation.branch);

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

  const queryFilter = {
    branch,
    reservationDate: { $gte: d, $lt: nextDay },
    status: { $nin: ['cancelled', 'no_show', 'completed'] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  };
  if (table) queryFilter.table = table;
  if (menuItemId) queryFilter.menuItemId = menuItemId;

  const same = await Reservation.find(queryFilter)
    .select('reservationTime durationMinutes reservationId menuItemId')
    .populate('menuItemId', 'name')
    .lean();

  for (const r of same) {
    const [h, m] = r.reservationTime.split(':').map(Number);
    const start = h * 60 + m;
    const end = start + (r.durationMinutes || 60);
    if (reqStart < end && start < reqEnd) {
      const endH = Math.floor(end / 60) % 24;
      const endM = end % 60;
      const conflictEnd = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
      return {
        ...r,
        conflictTime: r.reservationTime,
        conflictEnd,
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
