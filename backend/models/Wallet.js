const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../config/constants');

const walletSchema = new mongoose.Schema(
  {
    walletId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    mobileNumber: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    cashAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, default: 0 },
    pendingAmount: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, 'n/a', 'N/A', null, ''], required: true },
    paymentStatus: { type: String, enum: ['paid', 'partial', 'unpaid', 'refunded'], required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// Indexes for performance
walletSchema.index({ walletId: 1 }, { unique: true });
walletSchema.index({ branch: 1, createdAt: -1 });
walletSchema.index({ mobileNumber: 1 });
walletSchema.index({ paymentStatus: 1 });
walletSchema.index({ paymentMethod: 1 });
walletSchema.index({ createdAt: -1 });
// Compound indexes for common queries
walletSchema.index({ branch: 1, paymentStatus: 1, createdAt: -1 });
walletSchema.index({ branch: 1, mobileNumber: 1 });
walletSchema.index({ name: 1 });

module.exports = mongoose.model('Wallet', walletSchema);
