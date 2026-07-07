const mongoose = require('mongoose');
const { TABLE_TYPES, TABLE_STATUS } = require('../config/constants');

const tableSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    type: { type: String, enum: TABLE_TYPES, required: true },
    hourlyRate: { type: Number, required: true, min: 0 },
    status: { type: String, enum: TABLE_STATUS, default: 'available' },
    qrCode: { type: String }, // data URL / cloudinary URL of generated QR
    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    currentSession: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
  },
  { timestamps: true }
);

tableSchema.index({ branch: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Table', tableSchema);
