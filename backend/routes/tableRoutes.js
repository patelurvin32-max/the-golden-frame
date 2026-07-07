const express = require('express');
const { body } = require('express-validator');
const { protect, restrictTo, requirePermission } = require('../middleware/auth');
const { ROLES, TABLE_TYPES } = require('../config/constants');
const validate = require('../middleware/validate');
const tableController = require('../controllers/tableController');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(requirePermission('tables:view'), tableController.getTables)
  .post(
    restrictTo(ROLES.SUPER_ADMIN),
    [
      body('name').notEmpty(),
      body('branch').isMongoId(),
      body('type').isIn(TABLE_TYPES),
      body('hourlyRate').isFloat({ min: 0 }),
    ],
    validate,
    tableController.createTable
  );

router
  .route('/:id')
  .get(requirePermission('tables:view'), tableController.getTable)
  .patch(requirePermission('tables:operate'), tableController.updateTable)
  .delete(restrictTo(ROLES.SUPER_ADMIN), tableController.deleteTable);

module.exports = router;
