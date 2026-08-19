const express = require('express');
const router = express.Router();
const walletManagementController = require('../controllers/walletManagementController');
const { protect, restrictTo } = require('../middleware/auth');

// All wallet management routes require authentication
router.use(protect);

// Role-based access control: Super Admin, Branch Admin, and Branch Manager can access wallet management
router.use(restrictTo('super_admin', 'branch_admin', 'branch_manager'));

// GET /api/wallet-management/stats - Get wallet statistics
router.get('/stats', walletManagementController.getWalletStats);

// GET /api/wallet-management - Get all wallets with pagination and filtering
router.get('/', walletManagementController.getWallets);

// POST /api/wallet-management - Create a new wallet
router.post('/', walletManagementController.createWallet);

// GET /api/wallet-management/:id/pdf - Download/stream PDF invoice for a wallet
router.get('/:id/pdf', walletManagementController.downloadWalletPDF);

// PATCH /api/wallet-management/:id - Update a wallet
router.patch('/:id', walletManagementController.updateWallet);

// DELETE /api/wallet-management/:id - Delete a wallet
router.delete('/:id', walletManagementController.deleteWallet);

module.exports = router;
