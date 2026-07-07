const express = require('express');
const { body } = require('express-validator');
const { protect, restrictTo } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const validate = require('../middleware/validate');
const userController = require('../controllers/userController');

const router = express.Router();

router.use(protect);

// GET /api/users - Allow Branch Managers to view users from their branch
router.get('/', userController.getUsers);

// POST /api/users - Restricted to Super Admin only
router.post(
  '/',
  restrictTo(ROLES.SUPER_ADMIN),
  [
    body('name').notEmpty(),
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    body('role').isIn([ROLES.BRANCH_MANAGER, ROLES.STAFF, ROLES.CASHIER]),
  ],
  validate,
  userController.createUser
);

// GET /api/users/:id - Allow Branch Managers to view user details
router.get('/:id', userController.getUser);

// PATCH /api/users/:id - Restricted to Super Admin only
router.patch('/:id', restrictTo(ROLES.SUPER_ADMIN), userController.updateUser);

// DELETE /api/users/:id - Restricted to Super Admin only
router.delete('/:id', restrictTo(ROLES.SUPER_ADMIN), userController.deactivateUser);

module.exports = router;
