const mongoose = require('mongoose');

const tournamentMatchSchema = new mongoose.Schema(
  {
    tournament: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    round: { type: Number, required: true },
    matchNumber: { type: Number, required: true },
    player1: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentParticipant', default: null },
    player2: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentParticipant', default: null },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentParticipant', default: null },
    loser: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentParticipant', default: null },
    status: {
      type: String,
      enum: ['pending', 'active', 'completed'],
      default: 'pending'
    },
    table: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', default: null },
    nextMatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'TournamentMatch', default: null },
    matchDate: { type: Date },
    startTime: { type: Date },
    endTime: { type: Date },
    duration: { type: String, trim: true },
    notes: { type: String, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('TournamentMatch', tournamentMatchSchema);
