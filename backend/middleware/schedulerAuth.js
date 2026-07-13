const AppError = require('../utils/AppError');

const schedulerAuth = (req, res, next) => {
  const expectedSecret = process.env.DAILY_REPORT_SCHEDULER_SECRET;

  // Debug logs
  console.log('================ Scheduler Auth Debug ================');
  console.log('EXPECTED SECRET:', expectedSecret);
  console.log('HEADER x-daily-report-secret:', req.get('x-daily-report-secret'));
  console.log('HEADER x-scheduler-secret:', req.get('x-scheduler-secret'));
  console.log('QUERY secret:', req.query.secret);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('======================================================');

  // Secret not configured
  if (!expectedSecret) {
    console.log('Scheduler secret is not configured.');

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
    console.log('No scheduler secret provided.');

    return next(
      new AppError('Unauthorized scheduler request.', 401)
    );
  }

  if (providedSecret !== expectedSecret) {
    console.log('Scheduler secret mismatch.');
    console.log('Expected:', expectedSecret);
    console.log('Received:', providedSecret);

    return next(
      new AppError('Unauthorized scheduler request.', 401)
    );
  }

  console.log('Scheduler authentication successful.');

  return next();
};

module.exports = schedulerAuth;