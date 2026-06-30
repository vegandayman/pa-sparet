// scoring.js
// Pure functions only — no DOM access, no Firebase. Keeping this isolated
// means it can be unit-tested (or just sanity-checked in a console) without
// spinning up the whole app.

// --- Text normalization & matching (Destination Trivia, Music Round) ---

/**
 * Normalizes a string for answer comparison:
 * lowercase, trim, strip diacritics, strip punctuation, collapse whitespace.
 */
function normalizeAnswer(str) {
  if (typeof str !== "string") return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s]/g, "") // strip punctuation/symbols
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks a submitted answer against a primary answer and a list of accepted
 * alternates. All comparisons are normalized. Returns boolean.
 */
function isAnswerCorrect(submitted, primaryAnswer, acceptedAnswers = []) {
  const normSubmitted = normalizeAnswer(submitted);
  if (!normSubmitted) return false;
  const candidates = [primaryAnswer, ...(acceptedAnswers || [])].map(normalizeAnswer);
  return candidates.includes(normSubmitted);
}

// --- Where Are We Going: clue-stage scoring ---

/**
 * Given the clue stage active at the moment a player answered (0-indexed,
 * 0 = first clue stage), returns the points awarded for a correct answer
 * during that stage. All players who answer correctly during the same
 * stage receive the same points — there's no within-stage speed bonus.
 *
 * @param {number} clueStageIndex - 0-4, which clue was active when answered
 * @param {number[]} pointsPerStage - e.g. [10, 8, 6, 4, 2]
 * @returns {number} points awarded, or 0 if the stage index is out of range
 */
function getWhereAreWeGoingPoints(clueStageIndex, pointsPerStage) {
  if (
    typeof clueStageIndex !== "number" ||
    clueStageIndex < 0 ||
    clueStageIndex >= pointsPerStage.length
  ) {
    return 0;
  }
  return pointsPerStage[clueStageIndex];
}

/**
 * Determines which clue stage is "active" based on elapsed seconds since
 * the round started, given a fixed duration per stage. Useful as a
 * fallback / sanity check — in practice the host's `clueIndex` in the DB
 * is the source of truth, since the host manually triggers clue reveals
 * rather than relying purely on a timer.
 */
function getClueStageFromElapsedTime(elapsedSeconds, clueDurationSeconds, totalStages) {
  const stage = Math.floor(elapsedSeconds / clueDurationSeconds);
  return Math.min(stage, totalStages - 1);
}

// --- Destination Trivia: flat scoring ---

/**
 * Destination Trivia is flat-rate: correct = full points, no time factor.
 * For multiple-choice, compare selected index to correctOption.
 * For free-text, use isAnswerCorrect.
 */
function scoreDestinationTrivia(question, submittedValue) {
  if (question.inputMode === "multiple-choice") {
    const selectedIndex = Number(submittedValue);
    return selectedIndex === question.correctOption ? question.points : 0;
  }
  // free-text
  const correct = isAnswerCorrect(submittedValue, question.answer, question.acceptedAnswers);
  return correct ? question.points : 0;
}

// --- Music Round: per-blank scoring ---

/**
 * Scores a single blank (artist or title guess) against its definition.
 * Returns the points for that blank (0 or blank.points).
 */
function scoreMusicBlank(blank, submittedValue) {
  const correct = isAnswerCorrect(submittedValue, blank.answer, blank.acceptedAnswers);
  return correct ? blank.points : 0;
}

/**
 * Scores all blanks for a music round question given a map of
 * { blankId: submittedValue }. Returns { totalPoints, perBlank: { blankId: points } }.
 */
function scoreMusicRoundQuestion(question, submittedByBlankId) {
  const perBlank = {};
  let totalPoints = 0;
  question.blanks.forEach((blank) => {
    const submitted = submittedByBlankId[blank.id] || "";
    const points = scoreMusicBlank(blank, submitted);
    perBlank[blank.id] = points;
    totalPoints += points;
  });
  return { totalPoints, perBlank };
}

// --- Closest Wins: Haversine distance, winner-takes-all ---

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine formula: great-circle distance between two lat/lng points, in km.
 */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Determines winner(s) of a Closest Wins question.
 * Winner-takes-all: the closest pin(s) get full points. Exact ties (after
 * rounding to avoid floating-point near-misses) all receive full points.
 *
 * @param {Object[]} guesses - [{ playerId, lat, lng }]
 * @param {number} targetLat
 * @param {number} targetLng
 * @param {number} points - points to award to winner(s)
 * @param {number} tieToleranceKm - distances within this of each other count as tied (default 0.01km = 10m)
 * @returns {Object} { results: [{ playerId, distanceKm, points }], winnerIds: string[] }
 */
function scoreClosestWins(guesses, targetLat, targetLng, points, tieToleranceKm = 0.01) {
  if (!guesses || guesses.length === 0) {
    return { results: [], winnerIds: [] };
  }

  const withDistances = guesses.map((g) => ({
    playerId: g.playerId,
    distanceKm: haversineDistanceKm(g.lat, g.lng, targetLat, targetLng),
  }));

  const minDistance = Math.min(...withDistances.map((g) => g.distanceKm));

  const winnerIds = withDistances
    .filter((g) => g.distanceKm - minDistance <= tieToleranceKm)
    .map((g) => g.playerId);

  const results = withDistances.map((g) => ({
    playerId: g.playerId,
    distanceKm: g.distanceKm,
    points: winnerIds.includes(g.playerId) ? points : 0,
  }));

  return { results, winnerIds };
}

// --- Final tiebreak: total time-to-correct-answer across all questions ---

/**
 * Computes a tiebreak time for a single player: the sum of
 * (submittedAt - questionStartedAt) across every question they answered
 * CORRECTLY (pointsAwarded > 0), across every round type. Lower is better
 * (faster). Questions the player answered incorrectly, or never answered,
 * are excluded entirely — speed only matters on points actually earned.
 *
 * @param {string} playerId
 * @param {Object} allAnswers - shape: { [questionId]: { [playerId]: { submittedAt, pointsAwarded, ... } } }
 * @param {Object} questionStartTimes - shape: { [questionId]: number (timestamp the question went active) }
 * @returns {{ totalMs: number, answeredCount: number }} totalMs is the sum
 *   of response times in ms; answeredCount is how many correct answers
 *   contributed (useful for display / breaking further ties by volume).
 */
function calculateTiebreakTime(playerId, allAnswers, questionStartTimes) {
  let totalMs = 0;
  let answeredCount = 0;

  Object.keys(allAnswers || {}).forEach((questionId) => {
    const answer = allAnswers[questionId]?.[playerId];
    if (!answer || !answer.pointsAwarded || answer.pointsAwarded <= 0) return;

    const startedAt = questionStartTimes[questionId];
    if (typeof startedAt !== "number" || typeof answer.submittedAt !== "number") return;

    const elapsed = answer.submittedAt - startedAt;
    if (elapsed < 0) return; // clock skew guard, shouldn't happen with server timestamps

    totalMs += elapsed;
    answeredCount += 1;
  });

  return { totalMs, answeredCount };
}

/**
 * Given final scores and tiebreak data, determines whether a tiebreak is
 * needed (i.e. 2+ players share the top score) and resolves it.
 *
 * @param {Object[]} players - [{ playerId, name, score }]
 * @param {Object} allAnswers
 * @param {Object} questionStartTimes
 * @returns {{ needsTiebreak: boolean, winnerId: string|null, standings: Object[] }}
 *   standings is the full player list, sorted by score desc then tiebreak
 *   time asc, each annotated with tiebreakMs (or null if not tied/relevant).
 */
function resolveFinalStandings(players, allAnswers, questionStartTimes) {
  if (!players || players.length === 0) {
    return { needsTiebreak: false, winnerId: null, standings: [] };
  }

  const maxScore = Math.max(...players.map((p) => p.score || 0));
  const topPlayers = players.filter((p) => (p.score || 0) === maxScore);
  const needsTiebreak = topPlayers.length > 1;

  const standings = players.map((p) => {
    const isTopTied = needsTiebreak && (p.score || 0) === maxScore;
    const tiebreak = isTopTied
      ? calculateTiebreakTime(p.playerId, allAnswers, questionStartTimes)
      : null;
    return {
      ...p,
      tiebreakMs: tiebreak ? tiebreak.totalMs : null,
      tiebreakAnsweredCount: tiebreak ? tiebreak.answeredCount : null,
    };
  });

  standings.sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    // Same score: if both have a tiebreak time, faster (lower ms) wins.
    if (a.tiebreakMs != null && b.tiebreakMs != null) return a.tiebreakMs - b.tiebreakMs;
    return 0;
  });

  const winnerId = standings.length > 0 ? standings[0].playerId : null;

  return { needsTiebreak, winnerId, standings };
}

export {
  normalizeAnswer,
  isAnswerCorrect,
  getWhereAreWeGoingPoints,
  getClueStageFromElapsedTime,
  scoreDestinationTrivia,
  scoreMusicBlank,
  scoreMusicRoundQuestion,
  haversineDistanceKm,
  scoreClosestWins,
  calculateTiebreakTime,
  resolveFinalStandings,
};
