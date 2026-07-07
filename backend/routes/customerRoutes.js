const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const customerController = require('../controllers/customerController');

const router = express.Router();

router.use(protect, requirePermission('customers:manage'));

router
  .route('/')
  .get(customerController.getCustomers)
  .post(
    [
      body('name').notEmpty().withMessage('Full Name is required'),
      body('phone').notEmpty().withMessage('Phone Number is required'),
      // Branch is optional - will be auto-assigned from user for Branch Manager/Staff
      body('branch').optional().isMongoId().withMessage('Invalid Branch ID'),
      body('menuCategoryId').isMongoId().withMessage('Menu Category is required'),
      body('menuItemId').isMongoId().withMessage('Menu Item is required'),
      body('startTime').notEmpty().withMessage('Start Time is required'),
      body('paymentStatus').notEmpty().withMessage('Payment Status is required'),
      body('paymentMethod').notEmpty().withMessage('Payment Method is required')
        .isIn(['cash', 'upi', 'mixed']).withMessage('Invalid payment method'),
    ],
    validate,
    customerController.createCustomer
  );

router.get('/lookup/:phone', protect, customerController.lookupCustomer);

router
  .route('/:id')
  .get(customerController.getCustomer)
  .patch(customerController.updateCustomer)
  .delete(customerController.deleteCustomer);

module.exports = router;
