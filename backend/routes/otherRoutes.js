// ── Expense Routes ────────────────────────────────────────────────────────────
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const schedulerAuth = require('../middleware/schedulerAuth');
const { runDailyBusinessReport } = require('../services/dailyBusinessReportService');

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
reportsRouter.get('/orders', reportsController.getOrderDetailsReport);
reportsRouter.get('/orders-summary', reportsController.getOrderSummaryReport);
reportsRouter.get('/export/excel', reportsController.exportExcel);

// Settings
const { Settings } = require('../models/System');
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
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const skip = (page - 1) * limit;
  const sortBy = ['createdAt', 'action', 'description'].includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const filter = {};

  if (req.query.branch) filter.branch = req.query.branch;
  if (req.query.search) {
    const search = req.query.search.toString().trim();
    if (search.length > 0) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { action: regex },
        { description: regex },
        { entity: regex },
      ];
    }
  }

  const [total, logs] = await Promise.all([
    ActivityLog.countDocuments(filter),
    ActivityLog.find(filter)
      .populate('user', 'name role')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit),
  ]);

  const pages = Math.max(1, Math.ceil(total / limit));

  res.status(200).json({
    success: true,
    data: {
      logs,
      pagination: {
        total,
        page,
        limit,
        pages,
      },
    },
  });
}));

// Notifications
const { Notification } = require('../models/System');
const notifRouter = express.Router();
notifRouter.use(protect);
notifRouter.get('/', asyncHandler(async (req, res) => {
  const filter = { $or: [{ targetUser: req.user._id }, { targetRoles: { $in: [req.user.role] } }] };
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    const branches = Array.isArray(req.user.branches) ? req.user.branches : [];
    filter.branch = { $in: branches };
  }
  const notifications = await Notification.find(filter).sort('-createdAt').limit(50);
  res.status(200).json({ success: true, data: { notifications } });
}));
notifRouter.patch('/:id/read', asyncHandler(async (req, res) => {
  await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
  res.status(200).json({ success: true });
}));

// Internal scheduler trigger for automated report dispatch
const schedulerRouter = express.Router();
schedulerRouter.post('/daily-business-report', schedulerAuth, asyncHandler(async (req, res) => {
  const result = await runDailyBusinessReport({
    settings: req.body?.settings,
    now: req.body?.now ? new Date(req.body.now) : new Date(),
    triggeredBy: req.body?.triggeredBy || 'scheduler',
  });

  const hasFailures = Array.isArray(result.results) && result.results.some((entry) => entry.status === 'failed');

  res.status(hasFailures ? 207 : 200).json({
    success: !hasFailures,
    message: 'Daily business report processing completed.',
    partialFailure: hasFailures,
    data: result,
  });
}));

module.exports = { expenseRouter, bookingRouter, attendanceRouter, reportsRouter, settingsRouter, logsRouter, notifRouter, schedulerRouter };
