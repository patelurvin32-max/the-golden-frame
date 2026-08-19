const asyncHandler = require('../utils/asyncHandler');
const ContactMessage = require('../models/ContactMessage');
const AppError = require('../utils/AppError');
const { ROLES } = require('../config/constants');

exports.getMessages = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const filter = {};

  if (req.user.role !== ROLES.SUPER_ADMIN) {
    filter.branch = { $in: req.user.branches };
  } else if (req.query.branch) {
    filter.branch = req.query.branch;
  }

  if (req.query.status) filter.status = req.query.status;

  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    filter.$or = [
      { name: searchRegex },
      { phone: searchRegex },
      { email: searchRegex },
      { subject: searchRegex },
    ];
  }

  const [messages, total] = await Promise.all([
    ContactMessage.find(filter)
      .populate('branch', 'name code')
      .populate('respondedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ContactMessage.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      messages,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    },
  });
});

exports.updateStatus = asyncHandler(async (req, res, next) => {
  const { status } = req.body;

  if (!['new', 'read', 'resolved'].includes(status)) {
    return next(new AppError('Invalid status value.', 400));
  }

  const message = await ContactMessage.findById(req.params.id);
  if (!message) return next(new AppError('Message not found.', 404));

  if (
    req.user.role !== ROLES.SUPER_ADMIN &&
    message.branch &&
    !req.user.branches.some((b) => b.toString() === message.branch.toString())
  ) {
    return next(new AppError('You do not have access to this message.', 403));
  }

  message.status = status;
  message.respondedBy = req.user._id;
  message.respondedAt = new Date();
  await message.save();

  res.status(200).json({
    success: true,
    message: 'Status updated successfully.',
    data: { message },
  });
});

exports.deleteMessage = asyncHandler(async (req, res, next) => {
  const message = await ContactMessage.findById(req.params.id);
  if (!message) return next(new AppError('Message not found.', 404));

  if (
    req.user.role !== ROLES.SUPER_ADMIN &&
    message.branch &&
    !req.user.branches.some((b) => b.toString() === message.branch.toString())
  ) {
    return next(new AppError('You do not have access to this message.', 403));
  }

  await message.deleteOne();
  res.status(200).json({ success: true, message: 'Message deleted.' });
});

// PUBLIC, unauthenticated
exports.submitMessage = asyncHandler(async (req, res, next) => {
  const { name, phone, email, subject, message, branch } = req.body;

  if (!name || !phone || !subject || !message) {
    return next(new AppError('Name, phone, subject, and message are required.', 400));
  }

  const contactMessage = await ContactMessage.create({
    name,
    phone,
    email: email || undefined,
    subject,
    message,
    branch: branch || undefined,
  });

  res.status(201).json({
    success: true,
    message: 'Thank you - your message has been received.',
    data: { id: contactMessage._id },
  });
});
