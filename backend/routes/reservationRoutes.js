const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const rc = require('../controllers/reservationController');

const router = express.Router();
router.use(protect);

const canView = requirePermission('tables:view');
const canManage = requirePermission('bookings:manage');

router.get('/stats', canView, rc.getStats);
router.get('/available-tables', canView, rc.getAvailableTables);
router.get('/', canView, rc.getReservations);
router.get('/:id', canView, rc.getReservation);

router.post(
  '/',
  canManage,
  [
    body('customerName').notEmpty().withMessage('Customer name is required'),
    body('phoneNumber').notEmpty().withMessage('Phone number is required'),
    body('branch').optional({ checkFalsy: true }).isMongoId().withMessage('Valid branch is required'),
    body('table').isMongoId().withMessage('Valid table is required'),
    body('reservationDate').matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/).withMessage('Valid date is required'),
    body('reservationTime').matches(/^\d{2}:\d{2}$/).withMessage('Time must be HH:mm'),
    body('numberOfGuests').isInt({ min: 1 }).withMessage('At least 1 guest required'),
  ],
  validate,
  rc.createReservation
);

router.patch(
  '/:id',
  canManage,
  [
    body('reservationDate').optional().matches(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/),
    body('reservationTime').optional().matches(/^\d{2}:\d{2}/),
    body('numberOfGuests').optional().isInt({ min: 1 }),
  ],
  validate,
  rc.updateReservation
);

router.patch(
  '/:id/status',
  canManage,
  [body('status').notEmpty().withMessage('Status is required')],
  validate,
  rc.changeStatus
);

router.delete('/:id', canManage, rc.deleteReservation);

module.exports = router;
