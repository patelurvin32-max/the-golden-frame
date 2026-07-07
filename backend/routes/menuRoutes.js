// routes/menuRoutes.js
const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const menuController = require('../controllers/menuController');

const router = express.Router();
router.use(protect, requirePermission('menu:manage'));

// Category Routes
router.get('/categories', menuController.getMenuCategories);
router.post('/categories', [body('name').notEmpty()], validate, menuController.createMenuCategory);
router.patch('/categories/:id', menuController.updateMenuCategory);
router.delete('/categories/:id', menuController.deleteMenuCategory);

// Menu Item Routes
router.get('/', menuController.getMenuItems);
router.post('/', [
  body('name').notEmpty(),
  body('branch').optional({ checkFalsy: true }).isMongoId(),
  body('category').isMongoId(),
  body('price').isNumeric()
], validate, menuController.createMenuItem);
router.get('/:id', menuController.getMenuItem);
router.patch('/:id', menuController.updateMenuItem);
router.delete('/:id', menuController.deleteMenuItem);

module.exports = router;
