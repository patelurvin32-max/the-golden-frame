const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../config/constants');

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reservationSchema = new mongoose.Schema(
  {
    reservationId: { type: String },
    customerName: { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    table: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
    menuCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuCategory' },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
    reservationDate: { type: Date, required: true },
    reservationTime: { type: String, required: true },
    durationMinutes: { type: Number, default: 60, min: 15 },
    numberOfGuests: { type: Number, required: true, min: 1, default: 1 },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'],
      default: 'pending',
    },
    startTime: { type: Date },
    endTime: { type: Date },
    seatedAt: { type: Date },
    completedAt: { type: Date },
    specialRequests: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paymentStatus: { type: String, enum: ['paid', 'partial', 'unpaid', 'refunded'], default: 'unpaid' },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, 'n/a', 'N/A', null, ''], default: null },
    cashAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, default: 0 },
    walletAmount: { type: Number, default: 0 },
    amountReceived: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    billAmount: { type: Number, default: 0 },
    pendingPaymentAmount: { type: Number, default: 0 },
    pendingPlayers: [
      {
        name: { type: String, trim: true },
        mobile: { type: String, trim: true },
        amount: { type: Number, min: 0 },
        playerName: { type: String, trim: true },
        mobileNumber: { type: String, trim: true },
        pendingAmount: { type: Number, min: 0 },
      }
    ],
    statusHistory: [statusHistorySchema],
  },
  { timestamps: true }
);

reservationSchema.index({ branch: 1, reservationId: 1 }, { unique: true });
reservationSchema.index({ branch: 1, reservationDate: 1 });
reservationSchema.index({ branch: 1, status: 1 });
reservationSchema.index({ table: 1, reservationDate: 1, status: 1 });
reservationSchema.index({ branch: 1, reservationDate: 1, reservationTime: 1 });
reservationSchema.index({ branch: 1, table: 1, reservationDate: 1, reservationTime: 1 });
reservationSchema.index({ branch: 1, status: 1, reservationDate: 1, reservationTime: 1 });
reservationSchema.index({ reservationDate: 1, reservationTime: 1 });
reservationSchema.index({ customerName: 'text', phoneNumber: 'text', reservationId: 'text' });
reservationSchema.index({ status: 1 });
reservationSchema.index({ createdAt: -1 });
reservationSchema.index({ branch: 1, menuCategoryId: 1, reservationDate: 1, status: 1 });
reservationSchema.index({ branch: 1, menuItemId: 1, reservationDate: 1, status: 1 });

const { getBusinessDayCompactString, getBusinessDayStart, getBusinessDayNextStart } = require('../utils/businessDay');

reservationSchema.pre('save', async function generateId(next) {
  if (this.reservationId) return next();

  const now = new Date();
  const dateStr = getBusinessDayCompactString(now);
  const start = getBusinessDayStart(now);
  const nextStart = getBusinessDayNextStart(now);
  
  let count = await mongoose.model('Reservation').countDocuments({
    branch: this.branch,
    createdAt: { $gte: start, $lt: nextStart }
  });
  
  let attempts = 0;
  while (attempts < 50) {
    const seq = String(count + 1).padStart(4, '0');
    const reservationId = `RES-${dateStr}-${seq}`;
    
    const exists = await mongoose.model('Reservation').findOne({
      branch: this.branch,
      reservationId
    });
    
    if (!exists) {
      this.reservationId = reservationId;
      return next();
    }
    count++;
    attempts++;
  }
  
  this.reservationId = `RES-${dateStr}-${Date.now()}`;
  next();
});


module.exports = mongoose.model('Reservation', reservationSchema);
