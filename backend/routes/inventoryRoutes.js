// routes/inventoryRoutes.js
const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const inventoryController = require('../controllers/inventoryController');

const router = express.Router();
router.use(protect, requirePermission('inventory:manage'));

// Category Routes
router.get('/categories', inventoryController.getCategories);
router.post('/categories', [body('name').notEmpty()], validate, inventoryController.createCategory);
router.patch('/categories/:id', inventoryController.updateCategory);
router.delete('/categories/:id', inventoryController.deleteCategory);

// Inventory Item Routes
router.get('/', inventoryController.getInventory);
router.post('/', [
  body('name').notEmpty(),
  body('branch').optional({ checkFalsy: true }).isMongoId(),
  body('category').isMongoId()
], validate, inventoryController.createInventoryItem);
router.get('/:id', inventoryController.getInventoryItem);
router.patch('/:id', inventoryController.updateInventoryItem);
router.post('/:id/restock', [body('quantity').isInt({ min: 1 })], validate, inventoryController.restockItem);
router.delete('/:id', inventoryController.deleteInventoryItem);

module.exports = router;
