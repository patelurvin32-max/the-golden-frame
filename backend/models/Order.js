const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../config/constants');

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    // Menu Management fields
    menuCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuCategory', required: true },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    startTime: { type: Date },
    endTime: { type: Date },
    paymentStatus: { type: String, enum: ['paid', 'partial', 'unpaid', 'refunded'], required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    cashAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, default: 0 },
    walletAmount: { type: Number, default: 0 },
    pendingPaymentAmount: { type: Number, default: 0 },
    amountReceived: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    billAmount: { type: Number, required: true }, // Manually entered bill/total amount
    additionalPlayers: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Indexes for performance
orderSchema.index({ orderId: 1 }, { unique: true });
orderSchema.index({ customer: 1 });
orderSchema.index({ branch: 1 });
orderSchema.index({ menuCategoryId: 1 });
orderSchema.index({ menuItemId: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ paymentMethod: 1 });
orderSchema.index({ createdAt: -1 });
// Compound indexes for common queries
orderSchema.index({ customer: 1, isActive: 1, createdAt: -1 });
orderSchema.index({ branch: 1, isActive: 1, createdAt: -1 });
orderSchema.index({ menuCategoryId: 1, branch: 1, isActive: 1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, branch: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, billAmount: -1 });
orderSchema.index({ branch: 1, paymentStatus: 1, createdAt: -1 });
orderSchema.index({ billAmount: -1 });
orderSchema.index({ createdAt: -1, paymentStatus: 1 });
orderSchema.index({ branch: 1, createdAt: -1, customer: 1 });
orderSchema.index({ branch: 1, createdAt: -1, menuItemId: 1 });

module.exports = mongoose.model('Order', orderSchema);
