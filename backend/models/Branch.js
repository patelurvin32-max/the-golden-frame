const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    openingTime: { type: String, default: '10:00' }, // HH:mm
    closingTime: { type: String, default: '23:00' },
    latitude: { type: Number },
    longitude: { type: Number },
    attendanceRadius: { type: Number, default: 100 }, // meters
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Branch', branchSchema);
