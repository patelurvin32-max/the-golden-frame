const AppError = require('../utils/AppError');

const schedulerAuth = (req, res, next) => {
  const expectedSecret = process.env.DAILY_REPORT_SCHEDULER_SECRET;

  // Secret not configured
  if (!expectedSecret) {
    if (process.env.NODE_ENV === 'production') {
      return next(
        new AppError('Scheduler secret is not configured.', 500)
      );
    }

    return next();
  }

  // Get provided secret
  const providedSecret =
    req.get('x-daily-report-secret') ||
    req.get('x-scheduler-secret') ||
    req.query.secret;

  // Validation
  if (!providedSecret) {
    return next(
      new AppError('Unauthorized scheduler request.', 401)
    );
  }

  if (providedSecret !== expectedSecret) {
    return next(
      new AppError('Unauthorized scheduler request.', 401)
    );
  }

  return next();
};

module.exports = schedulerAuth;