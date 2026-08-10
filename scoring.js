// scoring.js — pure scoring functions

function normalizeAnswer(str) {
  if (typeof str !== "string") return "";
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9\s]/g,"").replace(/\s+/g," ").trim();
}

function isAnswerCorrect(submitted, primaryAnswer, acceptedAnswers = []) {
  const normSubmitted = normalizeAnswer(submitted);
  if (!normSubmitted) return false;
  return [primaryAnswer, ...(acceptedAnswers || [])].map(normalizeAnswer).includes(normSubmitted);
}

function getWhereAreWeGoingPoints(clueStageIndex, pointsPerStage) {
  if (typeof clueStageIndex !== "number" || clueStageIndex < 0 || clueStageIndex >= pointsPerStage.length) return 0;
  return pointsPerStage[clueStageIndex];
}

function getClueStageFromElapsedTime(elapsedSeconds, clueDurationSeconds, totalStages) {
  return Math.min(Math.floor(elapsedSeconds / clueDurationSeconds), totalStages - 1);
}

function scoreDestinationTrivia(question, submittedValue) {
  if (question.inputMode === "multiple-choice") return Number(submittedValue) === question.correctOption ? question.points : 0;
  return isAnswerCorrect(submittedValue, question.answer, question.acceptedAnswers) ? question.points : 0;
}

function scoreMusicBlank(blank, submittedValue) {
  return isAnswerCorrect(submittedValue, blank.answer, blank.acceptedAnswers) ? blank.points : 0;
}

function scoreMusicRoundQuestion(question, submittedByBlankId) {
  const perBlank = {};
  let totalPoints = 0;
  question.blanks.forEach(blank => {
    const points = scoreMusicBlank(blank, submittedByBlankId[blank.id] || "");
    perBlank[blank.id] = points;
    totalPoints += points;
  });
  return { totalPoints, perBlank };
}

const EARTH_RADIUS_KM = 6371;
function toRadians(d) { return d * Math.PI / 180; }

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1), dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng/2)**2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function scoreClosestWins(guesses, targetLat, targetLng, points, tieToleranceKm = 0.01) {
  if (!guesses || guesses.length === 0) return { results: [], winnerIds: [] };
  const withDistances = guesses.map(g => ({ playerId: g.playerId, distanceKm: haversineDistanceKm(g.lat, g.lng, targetLat, targetLng) }));
  const minDistance = Math.min(...withDistances.map(g => g.distanceKm));
  const winnerIds = withDistances.filter(g => g.distanceKm - minDistance <= tieToleranceKm).map(g => g.playerId);
  return { results: withDistances.map(g => ({ playerId: g.playerId, distanceKm: g.distanceKm, points: winnerIds.includes(g.playerId) ? points : 0 })), winnerIds };
}

function calculateTiebreakTime(playerId, allAnswers, questionStartTimes) {
  let totalMs = 0, answeredCount = 0;
  Object.keys(allAnswers || {}).forEach(questionId => {
    const answer = allAnswers[questionId]?.[playerId];
    if (!answer || !answer.pointsAwarded || answer.pointsAwarded <= 0) return;
    const startedAt = questionStartTimes[questionId];
    if (typeof startedAt !== "number" || typeof answer.submittedAt !== "number") return;
    const elapsed = answer.submittedAt - startedAt;
    if (elapsed < 0) return;
    totalMs += elapsed; answeredCount++;
  });
  return { totalMs, answeredCount };
}

function resolveFinalStandings(players, allAnswers, questionStartTimes) {
  if (!players || players.length === 0) return { needsTiebreak: false, winnerId: null, standings: [] };
  const maxScore = Math.max(...players.map(p => p.score || 0));
  const needsTiebreak = players.filter(p => (p.score || 0) === maxScore).length > 1;
  const standings = players.map(p => {
    const isTopTied = needsTiebreak && (p.score || 0) === maxScore;
    const tiebreak = isTopTied ? calculateTiebreakTime(p.playerId, allAnswers, questionStartTimes) : null;
    return { ...p, tiebreakMs: tiebreak ? tiebreak.totalMs : null, tiebreakAnsweredCount: tiebreak ? tiebreak.answeredCount : null };
  });
  standings.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    if (a.tiebreakMs != null && b.tiebreakMs != null) return a.tiebreakMs - b.tiebreakMs;
    return 0;
  });
  return { needsTiebreak, winnerId: standings.length > 0 ? standings[0].playerId : null, standings };
}

export { normalizeAnswer, isAnswerCorrect, getWhereAreWeGoingPoints, getClueStageFromElapsedTime, scoreDestinationTrivia, scoreMusicBlank, scoreMusicRoundQuestion, haversineDistanceKm, scoreClosestWins, calculateTiebreakTime, resolveFinalStandings };
