const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect, restrictTo } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const Branch = require('../models/Branch');
const { Settings } = require('../models/System');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const router = express.Router();

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

// Logo files must stay publicly readable so login and other unauthenticated pages can render them.
router.use('/logo-file', express.static(uploadDir, {
  setHeaders: (res) => {
    // Allow frontend apps on a different origin to render branch logos.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

router.use(protect);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { branch } = req.query;
    
    // If branch is specified, get branch-specific settings
    if (branch) {
      let settings = await Settings.findOne({ branch });
      if (!settings) {
        // Return default settings if no branch-specific settings exist
        settings = new Settings({ branch });
      }
      res.status(200).json({ success: true, data: { settings } });
    } else {
      // Super Admin gets global settings (no branch)
      let settings = await Settings.findOne({ branch: { $exists: false } });
      if (!settings) {
        settings = await Settings.create({});
      }

      const activeBranches = await Branch.find({ isActive: true }).sort({ name: 1 }).lean();
      const existingConfigs = settings.branchReportConfigs || [];
      const configMap = new Map();
      existingConfigs.forEach((c) => {
        if (c.branch) configMap.set(c.branch.toString(), c);
      });

      const mergedConfigs = activeBranches.map((b) => {
        const bIdStr = b._id.toString();
        const existing = configMap.get(bIdStr);
        return {
          branch: b._id,
          branchName: b.name,
          dailyReportEnabled: existing ? existing.dailyReportEnabled !== false : true,
          dailyReportEmails: existing ? existing.dailyReportEmails || [] : [],
        };
      });

      const settingsObj = settings.toObject ? settings.toObject() : settings;
      settingsObj.branchReportConfigs = mergedConfigs;

      res.status(200).json({ success: true, data: { settings: settingsObj } });
    }
  })
);

router.patch(
  '/',
  asyncHandler(async (req, res, next) => {
    const body = req.body || {};
    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isAdmin = req.user.role === ROLES.ADMIN;
    const branchId = body.branch || (req.user.branches?.[0]?._id || req.user.branches?.[0]);

    // Determine which settings document to update
    let settings;
    if (isSuperAdmin && !branchId) {
      // Super Admin without branch context - update global settings
      settings = await Settings.findOne({ branch: { $exists: false } });
      if (!settings) {
        settings = new Settings();
      }
    } else {
      // Branch Admin or Super Admin with branch context - update branch-specific settings
      const targetBranch = branchId || req.user.branches?.[0]?._id || req.user.branches?.[0];
      if (!targetBranch) {
        return next(new AppError('Branch context required', 400));
      }
      settings = await Settings.findOne({ branch: targetBranch });
      if (!settings) {
        settings = new Settings({ branch: targetBranch });
      }
    }

    // Branch Admin can only modify brand and receipt settings
    if (!isSuperAdmin && !isAdmin) {
      // Allow only brand and receipt settings for Branch Admin
      const branchAdminAllowed = [
        'businessName',
        'shortBusinessName',
        'logoUrl',
        'currency',
        'currencySymbol',
        'taxPercent',
        'gstNumber',
        'timezone',
      ];
      
      branchAdminAllowed.forEach((key) => {
        if (body[key] !== undefined) {
          settings[key] = body[key];
        }
      });

      if (body.receipt !== undefined) {
        settings.receipt = body.receipt;
      }

      settings.markModified('receipt');
      await settings.save();

      res.status(200).json({ success: true, data: { settings } });
      return;
    }

    // Super Admin and Admin can modify all settings
    if (body.receipt !== undefined) {
      settings.receipt = body.receipt;
    }

    const allowed = [
      'businessName',
      'shortBusinessName',
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
        : String(body.dailyReportBranchIds).split(/[,;]+/).map((bId) => bId.trim()).filter(Boolean);
    }

    if (body.branchReportConfigs !== undefined && Array.isArray(body.branchReportConfigs)) {
      const sanitizedConfigs = body.branchReportConfigs.map((cfg) => {
        const emails = Array.isArray(cfg.dailyReportEmails)
          ? cfg.dailyReportEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
          : String(cfg.dailyReportEmails || '').split(/[,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
        return {
          branch: cfg.branch,
          dailyReportEnabled: cfg.dailyReportEnabled !== false,
          dailyReportEmails: emails,
        };
      });

      settings.branchReportConfigs = sanitizedConfigs;
      settings.markModified('branchReportConfigs');

      // Also update each individual branch's Settings document
      for (const cfg of sanitizedConfigs) {
        if (cfg.branch) {
          await Settings.findOneAndUpdate(
            { branch: cfg.branch },
            {
              $set: {
                dailyReportEnabled: cfg.dailyReportEnabled,
                dailyReportEmails: cfg.dailyReportEmails,
                dailyReportRecipientEmails: cfg.dailyReportEmails,
              },
            },
            { upsert: true }
          );
        }
      }
    }

    settings.markModified('receipt');
    await settings.save();

    res.status(200).json({ success: true, data: { settings } });
  })
);

router.post(
  '/upload-logo',
  upload.single('logo'),
  asyncHandler(async (req, res, next) => {
    // Branch Admin can also upload logos
    if (!req.file) {
      return next(new AppError('No file uploaded.', 400));
    }

    const isSuperAdmin = req.user.role === ROLES.SUPER_ADMIN;
    const isAdmin = req.user.role === ROLES.ADMIN;
    const branchId = req.body.branch || (req.user.branches?.[0]?._id || req.user.branches?.[0]);

    // Determine which settings document to update
    let settings;
    if (isSuperAdmin && !branchId) {
      // Super Admin without branch context - update global settings
      settings = await Settings.findOne({ branch: { $exists: false } });
      if (!settings) {
        settings = new Settings();
      }
    } else {
      // Branch Admin or Super Admin with branch context - update branch-specific settings
      const targetBranch = branchId || req.user.branches?.[0]?._id || req.user.branches?.[0];
      if (!targetBranch) {
        return next(new AppError('Branch context required', 400));
      }
      settings = await Settings.findOne({ branch: targetBranch });
      if (!settings) {
        settings = new Settings({ branch: targetBranch });
      }
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
  asyncHandler(async (req, res) => {
    // Branch Admin can also remove logos
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
