const mongoose = require('mongoose');

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
    reservationId: { type: String, unique: true, index: true },
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
    specialRequests: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    statusHistory: [statusHistorySchema],
  },
  { timestamps: true }
);

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

const { getBusinessDayCompactString, getBusinessDayStart } = require('../utils/businessDay');

reservationSchema.pre('save', async function generateId(next) {
  if (this.reservationId) return next();

  const dateStr = getBusinessDayCompactString(new Date());
  const businessDayStart = getBusinessDayStart(new Date());
  const count = await mongoose.model('Reservation').countDocuments({ createdAt: { $gte: businessDayStart } });
  this.reservationId = `RES-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  next();
});

module.exports = mongoose.model('Reservation', reservationSchema);
