const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema(
  {
    messageType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    provider: {
      type: String,
      default: 'brevo',
      trim: true,
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'sent', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },
    fromEmail: { type: String, trim: true },
    fromName: { type: String, trim: true },
    recipients: [{ email: { type: String, trim: true, lowercase: true }, name: { type: String, trim: true } }],
    cc: [{ email: { type: String, trim: true, lowercase: true }, name: { type: String, trim: true } }],
    bcc: [{ email: { type: String, trim: true, lowercase: true }, name: { type: String, trim: true } }],
    replyTo: { type: String, trim: true },
    subject: { type: String, required: true, trim: true },
    textContent: { type: String },
    htmlContent: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
    relatedModel: { type: String, trim: true },
    relatedId: { type: mongoose.Schema.Types.ObjectId },
    attemptCount: { type: Number, default: 0 },
    providerMessageId: { type: String, trim: true },
    lastError: { type: String, trim: true },
    startedAt: { type: Date },
    sentAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

emailLogSchema.index({ createdAt: -1 });
emailLogSchema.index({ messageType: 1, createdAt: -1 });
emailLogSchema.index({ status: 1, createdAt: -1 });
emailLogSchema.index({ relatedModel: 1, relatedId: 1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
