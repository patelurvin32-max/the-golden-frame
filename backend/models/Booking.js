const mongoose = require('mongoose');
const { BOOKING_STATUS } = require('../config/constants');

const bookingSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    table: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true }, // HH:mm
    durationMinutes: { type: Number, required: true, default: 60 },
    status: { type: String, enum: BOOKING_STATUS, default: 'pending' },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

bookingSchema.index({ branch: 1, date: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
