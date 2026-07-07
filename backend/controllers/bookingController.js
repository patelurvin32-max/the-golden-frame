const Booking = require('../models/Booking');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

exports.getBookings = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role !== ROLES.SUPER_ADMIN) filter.branch = { $in: req.user.branches };
  if (req.query.branch) filter.branch = req.query.branch;
  if (req.query.date) {
    const d = new Date(req.query.date);
    filter.date = { $gte: d, $lt: new Date(d.getTime() + 86400000) };
  }
  if (req.query.status) filter.status = req.query.status;

  const bookings = await Booking.find(filter)
    .populate('table', 'name type')
    .populate('customer', 'name phone')
    .populate('branch', 'name')
    .sort('date startTime');

  res.status(200).json({ success: true, results: bookings.length, data: { bookings } });
});

exports.createBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.create({ ...req.body, createdBy: req.user._id });
  const populated = await Booking.findById(booking._id)
    .populate('table', 'name type')
    .populate('customer', 'name phone');
  res.status(201).json({ success: true, data: { booking: populated } });
});

exports.updateBooking = asyncHandler(async (req, res, next) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!booking) return next(new AppError('Booking not found.', 404));
  res.status(200).json({ success: true, data: { booking } });
});

exports.cancelBooking = asyncHandler(async (req, res, next) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
  if (!booking) return next(new AppError('Booking not found.', 404));
  res.status(200).json({ success: true, data: { booking } });
});
