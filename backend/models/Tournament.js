const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    status: {
      type: String,
      enum: ['pending', 'ongoing', 'completed', 'cancelled'],
      default: 'pending'
    },
    startDate: { type: Date },
    endDate: { type: Date },
    tournamentDate: { type: Date },
    startTime: { type: String, trim: true },
    gameCategory: { type: String, trim: true },
    format: { type: String, default: 'Single Elimination' },
    maxParticipants: { type: Number, default: 200, max: 200 },
    currentRound: { type: Number, default: 0 },
    description: { type: String, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tournament', tournamentSchema);
