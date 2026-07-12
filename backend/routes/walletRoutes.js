const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { protect, requirePermission } = require('../middleware/auth');

// All wallet routes require authentication
router.use(protect);

// GET /api/wallet/transactions - Get wallet transactions with pagination
router.get('/transactions', requirePermission('customers:view'), walletController.getWalletTransactions);

// GET /api/wallet/customer/:customerId - Get customer wallet history
router.get('/customer/:customerId', requirePermission('customers:view'), walletController.getCustomerWalletHistory);

// POST /api/wallet/add-balance - Add balance to customer wallet
router.post('/add-balance', requirePermission('customers:manage'), walletController.addWalletBalance);

// GET /api/wallet/summary - Get wallet summary
router.get('/summary', requirePermission('reports:view'), walletController.getWalletSummary);

module.exports = router;
