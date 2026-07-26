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

const sessionItemSchema = new mongoose.Schema(
  {
    menuCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuCategory' },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    categoryName: { type: String, required: true },
    itemName: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    unitPrice: { type: Number, required: true, default: 0 },
    totalAmount: { type: Number, required: true, default: 0 },
  },
  { _id: true, timestamps: true }
);

const sessionSchema = new mongoose.Schema(
  {
    table: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String },
    phoneNumber: { type: String },
    extraPlayers: { type: [String], default: [] },
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
    menuCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuCategory' },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    menuCategory: { type: String },
    menuItem: { type: String },
    addedItems: [sessionItemSchema],
  },
  { timestamps: true }
);

sessionSchema.index({ table: 1 });
sessionSchema.index({ customerName: 1 });
sessionSchema.index({ status: 1 });
sessionSchema.index({ branch: 1, status: 1, startTime: -1 });
sessionSchema.index({ branch: 1, startTime: -1 });
sessionSchema.index({ branch: 1, endTime: -1 });
sessionSchema.index({ customer: 1, createdAt: -1 });
sessionSchema.index({ table: 1, status: 1 });

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
