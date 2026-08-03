const express = require('express');
const { body } = require('express-validator');
const { protect, restrictTo, requirePermission } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const validate = require('../middleware/validate');
const userController = require('../controllers/userController');

const router = express.Router();

router.use(protect);

// GET /api/users - Allow Branch Managers and Branch Admins to view users from their branch
router.get('/', requirePermission('staff:view'), userController.getUsers);

// POST /api/users - Super Admin, Admin, Branch Manager, and Branch Admin
router.post(
  '/',
  restrictTo(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.BRANCH_MANAGER, ROLES.BRANCH_ADMIN),
  requirePermission('staff:manage'),
  [
    body('name').notEmpty(),
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    body('role').isIn([ROLES.BRANCH_ADMIN, ROLES.BRANCH_MANAGER, ROLES.STAFF, ROLES.CASHIER]),
  ],
  validate,
  userController.createUser
);

// GET /api/users/:id - Allow Branch Managers and Branch Admins to view user details
router.get('/:id', requirePermission('staff:view'), userController.getUser);

// PATCH /api/users/:id - Super Admin, Admin, Branch Manager, and Branch Admin
router.patch('/:id', restrictTo(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.BRANCH_MANAGER, ROLES.BRANCH_ADMIN), requirePermission('staff:manage'), userController.updateUser);

// DELETE /api/users/:id - Super Admin, Admin, Branch Manager, and Branch Admin
router.delete('/:id', restrictTo(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.BRANCH_MANAGER, ROLES.BRANCH_ADMIN), requirePermission('staff:manage'), userController.deactivateUser);

module.exports = router;
