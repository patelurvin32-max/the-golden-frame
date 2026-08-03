const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const billingController = require('../controllers/billingController');

const router = express.Router();
router.use(protect, requirePermission('billing:manage'));

router.get('/stats', billingController.getBillStats);
router.get('/', billingController.getBills);
router.post(
  '/',
  [body('branch').isMongoId().withMessage('Branch required')],
  validate,
  billingController.createBill
);
router.post(
  '/from-customer',
  [body('customerId').isMongoId().withMessage('Customer ID required')],
  validate,
  billingController.createBillFromCustomer
);
router.get('/:id', billingController.getBill);
router.put('/:id', billingController.updateBill);
router.post('/:id/payment', [body('amount').isFloat({ min: 0 })], validate, billingController.receivePayment);
router.get('/:id/pdf', billingController.downloadPDF);

module.exports = router;
