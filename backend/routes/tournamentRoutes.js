const express = require('express');
const {
  createTournament,
  getTournaments,
  getTournamentById,
  updateTournament,
  deleteTournament,
  registerParticipant,
  getParticipants,
  removeParticipant,
  updateParticipantPayment,
  generateBracket,
  getBracket,
  updateMatchResult
} = require('../controllers/tournamentController');
const { protect, requirePermission, scopeToBranch } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/constants');

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

// Basic CRUD
router.route('/')
  .get(getTournaments)
  .post(createTournament);

router.route('/:id')
  .get(getTournamentById)
  .put(updateTournament)
  .delete(deleteTournament);

// Participants
router.route('/:id/participants')
  .get(getParticipants)
  .post(registerParticipant);

router.delete('/:id/participants/:participantId', removeParticipant);
router.patch('/:id/participants/:participantId/payment', updateParticipantPayment);

// Bracket & Matches
router.post('/:id/generate-bracket', generateBracket);
router.get('/:id/bracket', getBracket);
router.put('/match/:matchId', updateMatchResult);

module.exports = router;
