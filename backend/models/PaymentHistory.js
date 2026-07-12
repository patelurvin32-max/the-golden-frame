const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../config/constants');

const paymentHistorySchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    orderId: { type: String, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    cashAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, default: 0 },
    walletAmount: { type: Number, default: 0 },
    totalPaid: { type: Number, required: true },
    billAmount: { type: Number, required: true },
    pendingAmount: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['paid', 'partial', 'unpaid'], required: true },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paymentNumber: { type: Number, required: true }, // Sequence number for payments on the same order
  },
  { timestamps: true }
);

// Indexes for performance
paymentHistorySchema.index({ order: 1, createdAt: -1 });
paymentHistorySchema.index({ orderId: 1, createdAt: -1 });
paymentHistorySchema.index({ customer: 1, createdAt: -1 });
paymentHistorySchema.index({ branch: 1, createdAt: -1 });
paymentHistorySchema.index({ paymentStatus: 1, createdAt: -1 });
paymentHistorySchema.index({ order: 1, paymentNumber: 1 }, { unique: true }); // Ensure unique payment numbers per order

module.exports = mongoose.model('PaymentHistory', paymentHistorySchema);
