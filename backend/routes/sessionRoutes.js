const express = require('express');
const { body } = require('express-validator');
const { protect, requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const sessionController = require('../controllers/sessionController');

const router = express.Router();

router.use(protect, requirePermission('tables:operate'));

router.get('/live', sessionController.getLiveSessions);
router.post('/start', [body('tableId').isMongoId()], validate, sessionController.startSession);
router.patch('/:id/pause', sessionController.pauseSession);
router.patch('/:id/resume', sessionController.resumeSession);
router.patch('/:id/extend', [body('minutes').isInt({ min: 1 })], validate, sessionController.extendSession);
router.patch('/:id/transfer', [body('customerId').isMongoId()], validate, sessionController.transferCustomer);
router.patch('/:id/stop', sessionController.stopSession);

module.exports = router;
