const mongoose = require('mongoose');
const { MEMBERSHIP_TIERS } = require('../config/constants');

const customerSchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    visits: { type: Number, default: 0 },
    totalSpending: { type: Number, default: 0 },
    favoriteGame: { type: String, enum: ['pool', 'snooker', 'ps5', null], default: null },
    membership: {
      tier: { type: String, enum: [...MEMBERSHIP_TIERS, null], default: null },
      startDate: { type: Date },
      expiryDate: { type: Date },
      rewardPoints: { type: Number, default: 0 },
    },
    notes: { type: String, trim: true },
    // Wallet fields
    walletBalance: { type: Number, default: 0, min: 0 },
    outstandingBalance: { type: Number, default: 0, min: 0 },
    walletTransactions: [{
      type: { type: String, enum: ['credit', 'debit'], required: true },
      amount: { type: Number, required: true },
      balance: { type: Number, required: true }, // Balance after transaction
      orderId: { type: String },
      billAmount: { type: Number },
      paymentMethod: { type: String },
      description: { type: String, trim: true },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      createdAt: { type: Date, default: Date.now },
    }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes for performance
customerSchema.index({ customerId: 1 }, { unique: true });
customerSchema.index({ phone: 1 }, { unique: true });
customerSchema.index({ name: 'text', phone: 'text', email: 'text' });
customerSchema.index({ name: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ branch: 1 });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ walletBalance: 1 });
// Compound indexes for common queries
customerSchema.index({ branch: 1, isActive: 1, createdAt: -1 });
customerSchema.index({ walletBalance: 1, branch: 1 });

module.exports = mongoose.model('Customer', customerSchema);
