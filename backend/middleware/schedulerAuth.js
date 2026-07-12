const AppError = require('../utils/AppError');

const schedulerAuth = (req, res, next) => {
  const expectedSecret = process.env.DAILY_REPORT_SCHEDULER_SECRET;
  if (!expectedSecret) {
    if (process.env.NODE_ENV === 'production') {
      return next(new AppError('Scheduler secret is not configured.', 500));
    }
    return next();
  }

  const providedSecret = req.get('x-daily-report-secret') || req.get('x-scheduler-secret') || req.query.secret;
  if (!providedSecret || providedSecret !== expectedSecret) {
    return next(new AppError('Unauthorized scheduler request.', 401));
  }

  return next();
};

module.exports = schedulerAuth;
