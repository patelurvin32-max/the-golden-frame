const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect, restrictTo } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const { Settings } = require('../models/System');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const router = express.Router();
router.use(protect);

const uploadDir = path.join(__dirname, '../uploads/logos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new AppError('Only JPG, PNG, WEBP, SVG allowed.', 400));
    }
    cb(null, true);
  },
});

router.use('/logo-file', express.static(uploadDir));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }

    res.status(200).json({ success: true, data: { settings } });
  })
);

router.patch(
  '/',
  restrictTo(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    const body = req.body || {};

    if (body.receipt !== undefined) {
      settings.receipt = body.receipt;
    }

    const allowed = [
      'businessName',
      'logoUrl',
      'currency',
      'currencySymbol',
      'taxPercent',
      'gstNumber',
      'timezone',
      'backupEnabled',
      'dailyReportEnabled',
      'dailyReportFromEmail',
    ];
    allowed.forEach((key) => {
      if (body[key] !== undefined) {
        settings[key] = body[key];
      }
    });

    if (body.dailyReportEmails !== undefined) {
      settings.dailyReportEmails = Array.isArray(body.dailyReportEmails)
        ? body.dailyReportEmails
        : String(body.dailyReportEmails).split(/[,;]+/).map((email) => email.trim()).filter(Boolean);
    }

    if (body.dailyReportRecipientEmails !== undefined) {
      settings.dailyReportRecipientEmails = Array.isArray(body.dailyReportRecipientEmails)
        ? body.dailyReportRecipientEmails
        : String(body.dailyReportRecipientEmails).split(/[,;]+/).map((email) => email.trim()).filter(Boolean);
    }

    if (body.dailyReportBranchIds !== undefined) {
      settings.dailyReportBranchIds = Array.isArray(body.dailyReportBranchIds)
        ? body.dailyReportBranchIds
        : String(body.dailyReportBranchIds).split(/[,;]+/).map((branchId) => branchId.trim()).filter(Boolean);
    }

    settings.markModified('receipt');
    await settings.save();

    res.status(200).json({ success: true, data: { settings } });
  })
);

router.post(
  '/upload-logo',
  restrictTo(ROLES.SUPER_ADMIN),
  upload.single('logo'),
  asyncHandler(async (req, res, next) => {
    if (!req.file) {
      return next(new AppError('No file uploaded.', 400));
    }

    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    if (settings.logoUrl && settings.logoUrl.startsWith('/api/settings/logo-file/')) {
      const oldFile = path.join(uploadDir, path.basename(settings.logoUrl));
      if (fs.existsSync(oldFile)) {
        fs.unlinkSync(oldFile);
      }
    }

    settings.logoUrl = `/api/settings/logo-file/${req.file.filename}`;
    await settings.save();

    res.status(200).json({
      success: true,
      data: { logoUrl: settings.logoUrl },
      message: 'Logo uploaded successfully',
    });
  })
);

router.delete(
  '/logo',
  restrictTo(ROLES.SUPER_ADMIN),
  asyncHandler(async (req, res) => {
    const settings = await Settings.findOne();
    if (settings?.logoUrl && settings.logoUrl.startsWith('/api/settings/logo-file/')) {
      const file = path.join(uploadDir, path.basename(settings.logoUrl));
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }

    if (settings) {
      settings.logoUrl = '';
      await settings.save();
    }

    res.status(200).json({ success: true, message: 'Logo removed.' });
  })
);

module.exports = router;
