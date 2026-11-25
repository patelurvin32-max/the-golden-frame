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
    seed: { type: Number },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'partial'],
      default: 'unpaid'
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'mixed', 'wallet'],
      default: null
    },
    paidAmount: { type: Number, default: 0 },
    cashAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, default: 0 },
    walletAmount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// Prevent duplicate registrations in the same tournament
tournamentParticipantSchema.index({ tournament: 1, customer: 1 }, { unique: true });

module.exports = mongoose.model('TournamentParticipant', tournamentParticipantSchema);
