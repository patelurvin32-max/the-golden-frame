const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

/**
 * Run after express-validator chains in a route definition. Collects all
 * validation errors and forwards a single readable AppError.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const message = errors
    .array()
    .map((e) => `${e.path}: ${e.msg}`)
    .join('; ');

  return next(new AppError(message, 400));
};

module.exports = validate;
