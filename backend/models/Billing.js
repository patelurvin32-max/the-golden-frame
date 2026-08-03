const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../config/constants');

const billItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true },
    total: { type: Number, required: true },
    type: { type: String, enum: ['table_time', 'inventory', 'other'], default: 'other' },
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory' },
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    items: [billItemSchema],
    subtotal: { type: Number, required: true, default: 0 },
    discountType: { type: String, enum: ['flat', 'percent', null], default: null },
    discountValue: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    couponCode: { type: String, trim: true },
    membershipDiscount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true, default: 0 },
    walletUsed: { type: Number, default: 0 },
    walletBalance: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['unpaid', 'paid', 'partial'], default: 'unpaid' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pdfUrl: { type: String },
    // Payment details stored directly on Bill for session-based bills without Order
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, 'n/a', 'N/A', null, ''], default: null },
    cashAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, default: 0 },
    walletAmount: { type: Number, default: 0 },
    amountReceived: { type: Number, default: 0 },
    pendingPaymentAmount: { type: Number, default: 0 },
    pendingPlayers: [
      {
        id: { type: String },
        playerName: { type: String, trim: true },
        mobileNumber: { type: String, trim: true },
        pendingAmount: { type: Number },
        name: { type: String, trim: true },
        mobile: { type: String, trim: true },
        amount: { type: Number },
        orderId: { type: String, trim: true },
        customerId: { type: String, trim: true }
      }
    ],
    notes: { type: String, trim: true },
    // Denormalized for faster search (avoids Customer/Session pre-lookup on every getBills search)
    customerName:  { type: String, trim: true, default: '' },
    customerPhone: { type: String, trim: true, default: '' },
    // Denormalized menu category/item from session for Live Tables billing
    menuCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuCategory' },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    menuCategory: { type: String, trim: true, default: '' },
    menuItem: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

const paymentSchema = new mongoose.Schema(
  {
    bill: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    // For mixed payments, breakdown by sub-method
    breakdown: [
      {
        method: { type: String, enum: ['cash', 'upi', 'wallet', 'card', 'mixed'] },
        amount: { type: Number },
      },
    ],
    amount: { type: Number, required: true },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    transactionRef: { type: String, trim: true },
  },
  { timestamps: true }
);

billSchema.index({ branch: 1, invoiceNumber: 1 }, { unique: true });
billSchema.index({ session: 1 });
billSchema.index({ customer: 1 });
billSchema.index({ customerName: 1 });
billSchema.index({ branch: 1, createdAt: -1, paymentStatus: 1 });
billSchema.index({ branch: 1, createdAt: -1, customer: 1 });
paymentSchema.index({ branch: 1, createdAt: -1, method: 1 });
paymentSchema.index({ branch: 1, method: 1, createdAt: -1 });
paymentSchema.index({ bill: 1, createdAt: -1 });

module.exports = {
  Bill: mongoose.model('Bill', billSchema),
  Payment: mongoose.model('Payment', paymentSchema),
};
