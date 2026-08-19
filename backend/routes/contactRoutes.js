const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, requirePermission } = require('../middleware/auth');
const cc = require('../controllers/contactController');

const router = express.Router();

const publicSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many submissions. Please try again later.' },
});

router.post('/submit', publicSubmitLimiter, cc.submitMessage);

router.use(protect);

const canView = requirePermission('contact:view');

router.get('/', canView, cc.getMessages);
router.patch('/:id/status', canView, cc.updateStatus);
router.delete('/:id', canView, cc.deleteMessage);

module.exports = router;
