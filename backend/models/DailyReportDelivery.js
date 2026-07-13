const mongoose = require('mongoose');

const dailyReportDeliverySchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      enum: ['daily_business_report'],
      default: 'daily_business_report',
      required: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    branchName: { type: String, required: true, trim: true },
    reportDateKey: { type: String, required: true, trim: true },
    reportDate: { type: Date, required: true },
    timeZone: { type: String, default: 'Asia/Kolkata' },
    status: {
      type: String,
      enum: ['processing', 'sent', 'failed', 'skipped'],
      default: 'processing',
    },
    recipientEmails: [{ type: String, trim: true, lowercase: true }],
    provider: { type: String, default: 'brevo' },
    providerMessageId: { type: String, trim: true },
    subject: { type: String, trim: true },
    summary: { type: mongoose.Schema.Types.Mixed },
    attemptCount: { type: Number, default: 0 },
    errorMessage: { type: String, trim: true },
    generatedAt: { type: Date },
    sentAt: { type: Date },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    triggeredBy: { type: String, default: 'scheduler' },
  },
  { timestamps: true }
);

dailyReportDeliverySchema.index({ reportType: 1, branch: 1, reportDateKey: 1 }, { unique: true });
dailyReportDeliverySchema.index({ status: 1, createdAt: -1 });
dailyReportDeliverySchema.index({ branch: 1, reportDate: -1 });

module.exports = mongoose.model('DailyReportDelivery', dailyReportDeliverySchema);
