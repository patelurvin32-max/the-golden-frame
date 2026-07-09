// routes/menuRoutes.js
const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const menuController = require('../controllers/menuController');

const router = express.Router();

// Category Routes - GET uses menu:view, others use menu:manage
router.get('/categories', protect, requirePermission('menu:view'), menuController.getMenuCategories);
router.post('/categories', protect, requirePermission('menu:manage'), [body('name').notEmpty()], validate, menuController.createMenuCategory);
router.patch('/categories/:id', protect, requirePermission('menu:manage'), menuController.updateMenuCategory);
router.delete('/categories/:id', protect, requirePermission('menu:manage'), menuController.deleteMenuCategory);

// Menu Item Routes - GET uses menu:view, others use menu:manage
router.get('/', protect, requirePermission('menu:view'), menuController.getMenuItems);
router.post('/', protect, requirePermission('menu:manage'), [
  body('name').notEmpty(),
  body('branch').optional({ checkFalsy: true }).isMongoId(),
  body('category').isMongoId(),
  body('price').isNumeric()
], validate, menuController.createMenuItem);
router.get('/:id', protect, requirePermission('menu:view'), menuController.getMenuItem);
router.patch('/:id', protect, requirePermission('menu:manage'), menuController.updateMenuItem);
router.delete('/:id', protect, requirePermission('menu:manage'), menuController.deleteMenuItem);

module.exports = router;
