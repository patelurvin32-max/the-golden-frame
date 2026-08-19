const mongoose = require('mongoose');

const tournamentParticipantSchema = new mongoose.Schema(
  {
    tournament: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    status: {
      type: String,
      enum: ['active', 'eliminated', 'winner'],
      default: 'active'
    },
    seed: { type: Number }
  },
  { timestamps: true }
);

// Prevent duplicate registrations in the same tournament
tournamentParticipantSchema.index({ tournament: 1, customer: 1 }, { unique: true });

module.exports = mongoose.model('TournamentParticipant', tournamentParticipantSchema);
