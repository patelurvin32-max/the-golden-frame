const mongoose = require('mongoose');
const { ATTENDANCE_STATUS } = require('../config/constants');

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUS, default: 'present' },
    checkIn: { type: String }, // HH:mm
    checkOut: { type: String },
    workingHours: { type: Number }, // minutes
    overtimeHours: { type: Number }, // minutes
    lateMinutes: { type: Number, default: 0 },
    earlyExitMinutes: { type: Number, default: 0 },
    notes: { type: String, trim: true },
    shift: { type: String, enum: ['morning', 'evening', 'night', 'full_day'], default: 'full_day' },
    markedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    markedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

const notificationSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    type: {
      type: String,
      enum: ['low_inventory', 'booking_reminder', 'membership_expiry', 'table_time_ending', 'staff_attendance', 'general'],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    targetRoles: [{ type: String }],
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isRead: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    action: { type: String, required: true }, // e.g. 'table.start', 'bill.create'
    entity: { type: String }, // e.g. 'Table'
    entityId: { type: mongoose.Schema.Types.ObjectId },
    description: { type: String },
    ipAddress: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
activityLogSchema.index({ branch: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, description: 1 });
activityLogSchema.index({ createdAt: -1 });

const settingsSchema = new mongoose.Schema(
  {
    businessName: { type: String, default: 'The Golden Frame' },
    logoUrl: { type: String },
    currency: { type: String, default: 'INR' },
    currencySymbol: { type: String, default: '₹' },
    taxPercent: { type: Number, default: 0 },
    gstNumber: { type: String, trim: true },
    receiptFooterNote: { type: String, default: 'Thank you for visiting!' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    backupEnabled: { type: Boolean, default: true },
    dailyReportEnabled: { type: Boolean, default: true },
    dailyReportFromEmail: { type: String, trim: true },
    dailyReportEmails: [{ type: String, trim: true, lowercase: true }],
    dailyReportRecipientEmails: [{ type: String, trim: true, lowercase: true }],
    dailyReportBranchIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
    receipt: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = {
  Attendance: mongoose.model('Attendance', attendanceSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  ActivityLog: mongoose.model('ActivityLog', activityLogSchema),
  Settings: mongoose.model('Settings', settingsSchema),
};
