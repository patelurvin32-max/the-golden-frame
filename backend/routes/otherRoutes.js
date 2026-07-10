// ── Expense Routes ────────────────────────────────────────────────────────────
const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');

// Expenses
const expenseController = require('../controllers/expenseController');
const expenseRouter = express.Router();
expenseRouter.use(protect, requirePermission('expenses:manage'));
expenseRouter.get('/', expenseController.getExpenses);
expenseRouter.post('/', [body('title').notEmpty(), body('amount').isFloat({ min: 0 }), body('branch').optional({ checkFalsy: true }).isMongoId(), body('category').notEmpty()], validate, expenseController.createExpense);
expenseRouter.patch('/:id', expenseController.updateExpense);
expenseRouter.delete('/:id', expenseController.deleteExpense);

// Bookings
const bookingController = require('../controllers/bookingController');
const bookingRouter = express.Router();
bookingRouter.use(protect, requirePermission('bookings:manage'));
bookingRouter.get('/', bookingController.getBookings);
bookingRouter.post('/', [body('branch').isMongoId(), body('table').isMongoId(), body('customer').isMongoId(), body('date').matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/), body('startTime').notEmpty()], validate, bookingController.createBooking);
bookingRouter.patch('/:id', bookingController.updateBooking);
bookingRouter.patch('/:id/cancel', bookingController.cancelBooking);

// Attendance
const attendanceController = require('../controllers/attendanceController');
const attendanceRouter = express.Router();
attendanceRouter.use(protect, requirePermission('attendance:manage'));
attendanceRouter.get('/', attendanceController.getAttendance);
attendanceRouter.post('/', [body('employee').isMongoId(), body('date').matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/), body('branch').optional({ checkFalsy: true }).isMongoId()], validate, attendanceController.markAttendance);
attendanceRouter.post('/bulk', attendanceController.bulkMarkAttendance);
attendanceRouter.get('/history/:employeeId', attendanceController.getAttendanceHistory);
attendanceRouter.get('/export/excel', attendanceController.exportAttendanceExcel);
attendanceRouter.get('/export/pdf', attendanceController.exportAttendancePDF);
attendanceRouter.patch('/:id', attendanceController.updateAttendance);

// Reports
const reportsController = require('../controllers/reportsController');
const reportsRouter = express.Router();
reportsRouter.use(protect, requirePermission('reports:view'));
reportsRouter.get('/dashboard', reportsController.getDashboardStats);
reportsRouter.get('/revenue', reportsController.getRevenueReport);
reportsRouter.get('/table-usage', reportsController.getTableUsageReport);
reportsRouter.get('/branch-comparison', reportsController.getBranchComparison);
reportsRouter.get('/export/excel', reportsController.exportExcel);

// Settings
const { Settings } = require('../models/System');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const settingsRouter = express.Router();
settingsRouter.use(protect);
settingsRouter.get('/', asyncHandler(async (req, res) => {
  const settings = await Settings.findOne() || await Settings.create({});
  res.status(200).json({ success: true, data: { settings } });
}));
settingsRouter.patch('/', asyncHandler(async (req, res) => {
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();
  Object.assign(settings, req.body);
  await settings.save();
  res.status(200).json({ success: true, data: { settings } });
}));

// Activity Logs
const { ActivityLog } = require('../models/System');
const logsRouter = express.Router();
logsRouter.use(protect);
logsRouter.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.branch) filter.branch = req.query.branch;
  const logs = await ActivityLog.find(filter)
    .populate('user', 'name role')
    .sort('-createdAt')
    .limit(200);
  res.status(200).json({ success: true, data: { logs } });
}));

// Notifications
const { Notification } = require('../models/System');
const notifRouter = express.Router();
notifRouter.use(protect);
notifRouter.get('/', asyncHandler(async (req, res) => {
  const filter = { $or: [{ targetUser: req.user._id }, { targetRoles: { $in: [req.user.role] } }] };
  const notifications = await Notification.find(filter).sort('-createdAt').limit(50);
  res.status(200).json({ success: true, data: { notifications } });
}));
notifRouter.patch('/:id/read', asyncHandler(async (req, res) => {
  await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
  res.status(200).json({ success: true });
}));

module.exports = { expenseRouter, bookingRouter, attendanceRouter, reportsRouter, settingsRouter, logsRouter, notifRouter };
