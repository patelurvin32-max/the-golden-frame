const Tournament = require('../models/Tournament');
const TournamentParticipant = require('../models/TournamentParticipant');
const TournamentMatch = require('../models/TournamentMatch');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const mongoose = require('mongoose');

// Helper to filter by allowed branches
const getBranchFilter = (req) => {
  if (req.user.role === ROLES.SUPER_ADMIN) {
    return req.query && req.query.branch ? { branch: req.query.branch } : {};
  }
  const allowedBranchIds = req.user.branches.map((b) => (b._id ? b._id.toString() : b.toString()));
  return { branch: { $in: allowedBranchIds } };
};

exports.createTournament = asyncHandler(async (req, res, next) => {
  const { name, branch, startDate, endDate, tournamentDate, startTime, gameCategory, format, maxParticipants, description } = req.body;
  const tournament = await Tournament.create({
    name,
    branch,
    startDate,
    endDate,
    tournamentDate,
    startTime,
    gameCategory,
    format,
    maxParticipants,
    description
  });
  res.status(201).json({ success: true, data: tournament });
});

exports.updateTournament = asyncHandler(async (req, res, next) => {
  const { name, maxParticipants, gameCategory, tournamentDate, startTime, format, description } = req.body;
  let tournament = await Tournament.findById(req.params.id);
  if (!tournament) return next(new AppError('Tournament not found', 404));

  const filter = getBranchFilter(req);
  if (filter.branch && !filter.branch.$in.includes(tournament.branch.toString())) {
    return next(new AppError('You do not have access to this tournament', 403));
  }

  tournament = await Tournament.findByIdAndUpdate(
    req.params.id,
    { name, maxParticipants, gameCategory, tournamentDate, startTime, format, description },
    { new: true, runValidators: true }
  );

  res.status(200).json({ success: true, data: tournament });
});

exports.getTournaments = asyncHandler(async (req, res, next) => {
  const filter = getBranchFilter(req);
  const tournaments = await Tournament.find(filter).populate('branch', 'name').sort('-createdAt');
  res.status(200).json({ success: true, count: tournaments.length, data: tournaments });
});

exports.getTournamentById = asyncHandler(async (req, res, next) => {
  const tournament = await Tournament.findById(req.params.id).populate('branch', 'name');
  if (!tournament) return next(new AppError('Tournament not found', 404));

  const filter = getBranchFilter(req);
  if (filter.branch && !filter.branch.$in.includes(tournament.branch._id.toString())) {
    return next(new AppError('You do not have access to this tournament', 403));
  }

  res.status(200).json({ success: true, data: tournament });
});

exports.updateTournament = asyncHandler(async (req, res, next) => {
  const tournament = await Tournament.findById(req.params.id);
  if (!tournament) return next(new AppError('Tournament not found', 404));

  const filter = getBranchFilter(req);
  if (filter.branch && !filter.branch.$in.includes(tournament.branch.toString())) {
    return next(new AppError('You do not have access to this tournament', 403));
  }

  const updatedTournament = await Tournament.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  });
  res.status(200).json({ success: true, data: updatedTournament });
});

exports.deleteTournament = asyncHandler(async (req, res, next) => {
  const tournament = await Tournament.findById(req.params.id);
  if (!tournament) return next(new AppError('Tournament not found', 404));

  const filter = getBranchFilter(req);
  if (filter.branch && !filter.branch.$in.includes(tournament.branch.toString())) {
    return next(new AppError('You do not have access to this tournament', 403));
  }

  await TournamentParticipant.deleteMany({ tournament: tournament._id });
  await TournamentMatch.deleteMany({ tournament: tournament._id });
  await tournament.deleteOne();

  res.status(200).json({ success: true, data: {} });
});

exports.registerParticipant = asyncHandler(async (req, res, next) => {
  const tournament = await Tournament.findById(req.params.id);
  if (!tournament) return next(new AppError('Tournament not found', 404));

  const filter = getBranchFilter(req);
  if (filter.branch && !filter.branch.$in.includes(tournament.branch.toString())) {
    return next(new AppError('You do not have access to this tournament', 403));
  }

  if (tournament.status !== 'pending') {
    return next(new AppError('Cannot add participants after tournament has started', 400));
  }

  const { customerId } = req.body;
  const count = await TournamentParticipant.countDocuments({ tournament: tournament._id });
  if (count >= tournament.maxParticipants) {
    return next(new AppError('Tournament is full', 400));
  }

  // Find customer by their custom customerId string (e.g. "TGF00015")
  const customer = await Customer.findOne({ customerId });
  if (!customer) {
    return next(new AppError(`Customer with ID ${customerId} not found`, 404));
  }

  const existing = await TournamentParticipant.findOne({ tournament: tournament._id, customer: customer._id });
  if (existing) {
    return next(new AppError('Customer is already registered for this tournament', 400));
  }

  const participant = await TournamentParticipant.create({
    tournament: tournament._id,
    customer: customer._id,
    seed: count + 1
  });

  res.status(201).json({ success: true, data: participant });
});

exports.getParticipants = asyncHandler(async (req, res, next) => {
  const participants = await TournamentParticipant.find({ tournament: req.params.id })
    .populate('customer', 'name phone')
    .sort('seed');
  res.status(200).json({ success: true, count: participants.length, data: participants });
});

// Helper for bracket size
function getNextPowerOf2(num) {
  let power = 1;
  while (power < num) power *= 2;
  return power;
}

// Fisher-Yates shuffle algorithm
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

exports.generateBracket = asyncHandler(async (req, res, next) => {
  const { forceRegenerate } = req.body || {};
  const tournament = await Tournament.findById(req.params.id);
  if (!tournament) return next(new AppError('Tournament not found', 404));

  if (tournament.status !== 'pending' && !forceRegenerate) {
    return next(new AppError('Tournament bracket already generated', 400));
  }

  if (forceRegenerate) {
    // Wipe old matches
    await TournamentMatch.deleteMany({ tournament: tournament._id });
    // Reset participants
    await TournamentParticipant.updateMany({ tournament: tournament._id }, { status: 'active' });
    tournament.status = 'pending';
    tournament.currentRound = 0;
  }

  const participants = await TournamentParticipant.find({ tournament: tournament._id });
  
  // Randomize the participants so initial pairings are random
  shuffleArray(participants);

  const numParticipants = participants.length;

  if (numParticipants < 2) {
    return next(new AppError('Need at least 2 participants to generate a bracket', 400));
  }

  const bracketSize = getNextPowerOf2(numParticipants);
  const byes = bracketSize - numParticipants;

  let paddedParticipants = new Array(bracketSize).fill(null);
  for (let i = 0; i < numParticipants; i++) {
    paddedParticipants[i] = participants[i];
  }

  // Create matches from bottom up
  let totalRounds = Math.log2(bracketSize);
  let matchesByRound = {};
  for (let r = 1; r <= totalRounds; r++) {
    matchesByRound[r] = [];
    const matchesInRound = bracketSize / Math.pow(2, r);
    for (let m = 1; m <= matchesInRound; m++) {
      matchesByRound[r].push({
        _id: new mongoose.Types.ObjectId(),
        tournament: tournament._id,
        round: r,
        matchNumber: m,
        player1: null,
        player2: null,
        status: 'pending',
        nextMatchId: null
      });
    }
  }

  // Link nextMatchIds
  for (let r = 1; r < totalRounds; r++) {
    const currentMatches = matchesByRound[r];
    const nextMatches = matchesByRound[r + 1];
    for (let i = 0; i < currentMatches.length; i++) {
      const nextMatchIndex = Math.floor(i / 2);
      currentMatches[i].nextMatchId = nextMatches[nextMatchIndex]._id;
    }
  }

  // Assign players to round 1 matches
  const round1Matches = matchesByRound[1];
  let pIndex = 0;
  for (let i = 0; i < round1Matches.length; i++) {
    round1Matches[i].player1 = paddedParticipants[pIndex++]?._id || null;
    round1Matches[i].player2 = paddedParticipants[pIndex++]?._id || null;
    
    // Auto advance if bye
    if (round1Matches[i].player1 && !round1Matches[i].player2) {
      round1Matches[i].status = 'completed';
      round1Matches[i].winner = round1Matches[i].player1;
    } else if (!round1Matches[i].player1 && round1Matches[i].player2) {
      round1Matches[i].status = 'completed';
      round1Matches[i].winner = round1Matches[i].player2;
    } else if (round1Matches[i].player1 && round1Matches[i].player2) {
      round1Matches[i].status = 'pending';
    } else {
      round1Matches[i].status = 'completed'; // Both null
    }
  }

  // Insert all matches
  let allMatches = [];
  for (let r = 1; r <= totalRounds; r++) {
    allMatches = allMatches.concat(matchesByRound[r]);
  }

  // Before inserting, we need to apply byes to next matches
  for (let i = 0; i < round1Matches.length; i++) {
    if (round1Matches[i].winner && round1Matches[i].nextMatchId) {
      const nextMatch = allMatches.find(m => m._id.equals(round1Matches[i].nextMatchId));
      if (nextMatch) {
        if (i % 2 === 0) nextMatch.player1 = round1Matches[i].winner;
        else nextMatch.player2 = round1Matches[i].winner;
      }
    }
  }

  await TournamentMatch.insertMany(allMatches);

  tournament.status = 'ongoing';
  tournament.currentRound = 1;
  await tournament.save();

  res.status(200).json({ success: true, message: 'Bracket generated successfully' });
});

exports.getBracket = asyncHandler(async (req, res, next) => {
  const matches = await TournamentMatch.find({ tournament: req.params.id })
    .populate({
      path: 'player1 player2 winner',
      populate: { path: 'customer', select: 'name phone' }
    })
    .sort({ round: 1, matchNumber: 1 });
  
  res.status(200).json({ success: true, count: matches.length, data: matches });
});

exports.updateMatchResult = asyncHandler(async (req, res, next) => {
  const { winnerId, table, startTime, endTime, duration, notes } = req.body;
  const match = await TournamentMatch.findById(req.params.matchId);
  if (!match) return next(new AppError('Match not found', 404));

  const tournament = await Tournament.findById(match.tournament);
  const filter = getBranchFilter(req);
  if (filter.branch && !filter.branch.$in.includes(tournament.branch.toString())) {
    return next(new AppError('You do not have access to this tournament', 403));
  }

  const isWinnerChanging = match.status === 'completed' && match.winner?.toString() !== winnerId.toString();

  // If winner is changing, check if downstream match is already completed
  if (isWinnerChanging && match.nextMatchId) {
    const nextMatch = await TournamentMatch.findById(match.nextMatchId);
    if (nextMatch && nextMatch.status === 'completed') {
      return next(new AppError('Cannot change winner because the subsequent match has already been completed.', 400));
    }
  }

  if (winnerId.toString() !== match.player1?.toString() && winnerId.toString() !== match.player2?.toString()) {
    return next(new AppError('Winner must be one of the players in this match', 400));
  }

  const loserId = winnerId.toString() === match.player1?.toString() ? match.player2 : match.player1;

  // Revert previous loser if winner is changing
  if (isWinnerChanging && match.loser) {
    await TournamentParticipant.findByIdAndUpdate(match.loser, { status: 'active' });
    // Also remove the previous winner from the final winner status if it was the final
    if (!match.nextMatchId) {
      await TournamentParticipant.findByIdAndUpdate(match.winner, { status: 'active' });
    }
  }

  // Update manual fields
  if (table !== undefined) match.table = table || null;
  if (startTime !== undefined) match.startTime = startTime;
  if (endTime !== undefined) match.endTime = endTime;
  if (duration !== undefined) match.duration = duration;
  if (notes !== undefined) match.notes = notes;

  match.winner = winnerId;
  match.loser = loserId;
  match.status = 'completed';
  await match.save();

  // Mark loser as eliminated
  if (loserId) {
    await TournamentParticipant.findByIdAndUpdate(loserId, { status: 'eliminated' });
  }

  // Advance winner to next match
  if (match.nextMatchId) {
    const nextMatch = await TournamentMatch.findById(match.nextMatchId);
    if (nextMatch) {
      if (match.matchNumber % 2 !== 0) {
        nextMatch.player1 = winnerId;
      } else {
        nextMatch.player2 = winnerId;
      }
      await nextMatch.save();
    }
  } else {
    // This was the final match
    await TournamentParticipant.findByIdAndUpdate(winnerId, { status: 'winner' });
    tournament.status = 'completed';
    await tournament.save();
  }

  res.status(200).json({ success: true, data: match });
});
