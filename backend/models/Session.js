const mongoose = require('mongoose');
const { SESSION_STATUS } = require('../config/constants');

/**
 * A Session represents one usage period of a table (from start to stop).
 * Pause/resume is tracked via pauses[] so elapsed/billable time excludes paused time.
 */
const pauseSchema = new mongoose.Schema(
  {
    pausedAt: { type: Date, required: true },
    resumedAt: { type: Date },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    table: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    hourlyRate: { type: Number, required: true },
    startTime: { type: Date, required: true, default: Date.now },
    endTime: { type: Date },
    pauses: [pauseSchema],
    status: { type: String, enum: SESSION_STATUS, default: 'running' },
    extendedMinutes: { type: Number, default: 0 },
    billableMinutes: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    bill: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill' },
  },
  { timestamps: true }
);

sessionSchema.index({ branch: 1, status: 1, startTime: -1 });
sessionSchema.index({ branch: 1, startTime: -1 });
sessionSchema.index({ branch: 1, endTime: -1 });

sessionSchema.methods.calculateBillableMinutes = function calculateBillableMinutes() {
  const end = this.endTime || new Date();
  let totalMs = end - this.startTime;

  for (const p of this.pauses) {
    const pauseEnd = p.resumedAt || end;
    totalMs -= pauseEnd - p.pausedAt;
  }

  const minutes = Math.max(0, Math.round(totalMs / 60000));
  return minutes;
};

sessionSchema.methods.calculateAmount = function calculateAmount() {
  const minutes = this.calculateBillableMinutes();
  return (minutes / 60) * this.hourlyRate;
};

module.exports = mongoose.model('Session', sessionSchema);
