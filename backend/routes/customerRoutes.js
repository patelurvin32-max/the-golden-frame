const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission, restrictTo } = require('../middleware/auth');
const validate = require('../middleware/validate');
const customerController = require('../controllers/customerController');
const { MenuCategory } = require('../models/Operations');
const { ROLES } = require('../config/constants');

const router = express.Router();

// Super Admin Central Customer Management Routes (Accessible strictly to Super Admin)
router.get('/super-admin', protect, restrictTo(ROLES.SUPER_ADMIN), customerController.getSuperAdminCustomers);
router.patch(
  '/super-admin/:id',
  protect,
  restrictTo(ROLES.SUPER_ADMIN),
  [
    body('name').notEmpty().withMessage('Customer Name is required'),
    body('phone').matches(/^\d{10}$/).withMessage('Mobile number must contain exactly 10 digits'),
  ],
  validate,
  customerController.updateSuperAdminCustomer
);

// Customer Routes - GET uses customers:view, others use customers:manage
router
  .route('/')
  .get(protect, requirePermission('customers:view'), customerController.getCustomers)
  .post(protect, requirePermission('customers:create'), [
      body('name').notEmpty().withMessage('Full Name is required'),
      body('phone').notEmpty().withMessage('Phone Number is required')
        .matches(/^\d{10}$/).withMessage('Mobile number must contain exactly 10 digits'),
      // Branch is optional - will be auto-assigned from user for Branch Manager/Staff
      body('branch').optional().isMongoId().withMessage('Invalid Branch ID'),
      body('menuCategoryId').optional().isMongoId().withMessage('Invalid Menu Category ID'),
      body('menuItemId').optional().isMongoId().withMessage('Invalid Menu Item ID'),
      body('startTime').custom(async (value, { req }) => {
        if (!req.body.menuCategoryId) return true;
        // Check if the selected category is Accessories or Beverage (product purchases)
        const category = await MenuCategory.findById(req.body.menuCategoryId);
        const categoryName = category?.name?.toLowerCase() || '';
        if (categoryName === 'accessories' || categoryName === 'beverage' || categoryName === 'beverages') {
          // startTime is optional for product categories
          return true;
        }
        // startTime is required for session-based categories
        if (!value) {
          throw new Error('Start Time is required');
        }
        return true;
      }),
      body('paymentStatus').notEmpty().withMessage('Payment Status is required'),
      body('paymentMethod').custom((value, { req }) => {
        const status = req.body.paymentStatus;
        if (status === 'paid' || status === 'partial') {
          if (!value) {
            throw new Error('Payment Method is required');
          }
        }
        if (value && !['cash', 'upi', 'mixed', 'wallet', 'n/a', 'N/A', ''].includes(value)) {
          throw new Error('Invalid payment method');
        }
        return true;
      }),
      body('billAmount')
        .notEmpty().withMessage('Total Amount is required')
        .custom((value) => {
          const text = typeof value === 'number' ? String(value) : value;
          return /^\d+(\.\d{1,2})?$/.test(text);
        }).withMessage('Total Amount must be a valid number with up to two decimals'),
      body('cashAmount').optional({ checkFalsy: true }).custom((value) => {
        if (!value) return true;
        const text = typeof value === 'number' ? String(value) : value;
        return /^\d+(\.\d{1,2})?$/.test(text);
      }).withMessage('Cash Amount must be a valid number with up to two decimals'),
      body('onlineAmount').optional({ checkFalsy: true }).custom((value) => {
        if (!value) return true;
        const text = typeof value === 'number' ? String(value) : value;
        return /^\d+(\.\d{1,2})?$/.test(text);
      }).withMessage('Online Amount must be a valid number with up to two decimals'),
    ],
    validate,
    customerController.createCustomer
  );

router.get('/lookup/:phone', protect, customerController.lookupCustomer);
router.get('/stats', protect, requirePermission('customers:view'), customerController.getCustomerStats);

router
  .route('/:id')
  .get(protect, requirePermission('customers:view'), customerController.getCustomer)
  .patch(protect, requirePermission('customers:manage'), [
      body('startTime').optional().custom(async (value, { req }) => {
        // If startTime is being provided, validate it
        if (value !== undefined && value !== '') {
          // Check if the selected category is Accessories or Beverage (product purchases)
          const category = await MenuCategory.findById(req.body.menuCategoryId);
          const categoryName = category?.name?.toLowerCase() || '';
          if (categoryName === 'accessories' || categoryName === 'beverage' || categoryName === 'beverages') {
            // startTime is optional for product categories
            return true;
          }
          return true;
        }
        return true;
      }),
    ],
    validate,
    customerController.updateCustomer
  )
  .delete(protect, requirePermission('customers:manage'), customerController.deleteCustomer);

// Payment-related routes
router.post('/:id/receive-payment', protect, requirePermission('customers:manage'), customerController.receivePayment);
router.get('/:id/payment-history', protect, requirePermission('customers:view'), customerController.getPaymentHistory);

module.exports = router;
