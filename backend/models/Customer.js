const mongoose = require('mongoose');
const { MEMBERSHIP_TIERS, PAYMENT_METHODS } = require('../config/constants');

const customerSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
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
    // Menu Management fields
    menuCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuCategory', required: true },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    paymentStatus: { type: String, enum: ['paid', 'unpaid', 'refunded'], required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    cashAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    billAmount: { type: Number, required: true }, // Manually entered bill/total amount
    additionalPlayers: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes for performance
customerSchema.index({ orderId: 1 }, { unique: true });
customerSchema.index({ phone: 1 }, { unique: true });
customerSchema.index({ name: 'text', phone: 'text', email: 'text' });
customerSchema.index({ name: 1 });
customerSchema.index({ email: 1 });
customerSchema.index({ menuCategoryId: 1 });
customerSchema.index({ menuItemId: 1 });
customerSchema.index({ branch: 1 });
customerSchema.index({ paymentStatus: 1 });
customerSchema.index({ paymentMethod: 1 });
customerSchema.index({ createdAt: -1 });
// Compound indexes for common queries
customerSchema.index({ branch: 1, isActive: 1, createdAt: -1 }); // For customer list queries
customerSchema.index({ menuCategoryId: 1, branch: 1, isActive: 1 }); // For filtering by category and branch
customerSchema.index({ paymentStatus: 1, createdAt: -1 });
customerSchema.index({ paymentStatus: 1, branch: 1, createdAt: -1 });
customerSchema.index({ paymentStatus: 1, billAmount: -1 });
customerSchema.index({ branch: 1, paymentStatus: 1, createdAt: -1 });
customerSchema.index({ billAmount: -1 });
customerSchema.index({ createdAt: -1, paymentStatus: 1 });

module.exports = mongoose.model('Customer', customerSchema);
