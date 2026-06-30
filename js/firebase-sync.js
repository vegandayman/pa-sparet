// firebase-sync.js
//
// Thin wrapper around Firebase Realtime Database. Every other module talks
// to Firebase only through the functions exported here — nothing else in
// the app should import the Firebase SDK directly. This keeps the sync
// layer swappable/debuggable in one place.
//
// DATA MODEL (see also quiz-schema.js for the quiz JSON shape):
//
// rooms/{roomCode}/
//   meta/
//     hostId: string
//     status: see ROOM_STATUS below — drives which screen host & players show
//     currentRoundIndex: number
//     currentQuestionIndex: number
//     explainedRoundTypes: { [roundType]: true }  <- which round types have
//                            already had their rule-explainer shown this
//                            game, so it only appears the first time. Lives
//                            in Firebase (not local state) so a host
//                            refresh doesn't cause explainers to repeat.
//     createdAt: number (timestamp)
//   quiz/                <- full quiz object, copied in at game start
//   players/{playerId}/
//     name: string        <- player/team name, chosen at join time, editable
//     score: number
//     connected: boolean
//     lastSeen: number
//   currentQuestion/
//     questionId: string
//     type: string
//     state: "idle" | "active" | "locked" | "revealed"
//     startedAt: number (server timestamp)
//     clueIndex: number          (Where Are We Going only)
//     revealedClueIndices: number[]  (Where Are We Going only)
//   questionMeta/{questionId}/
//     startedAt: number   <- archived copy of startedAt, kept even after the
//                            question is no longer "current". Used at game
//                            end to compute the speed tiebreak across every
//                            question played, since currentQuestion itself
//                            gets overwritten each time a new question starts.
//     roundIndex: number
//     questionIndex: number
//   answers/{questionId}/{playerId}/
//     value: any                 (shape depends on round type)
//     submittedAt: number
//     clueStageAtSubmit: number  (Where Are We Going only)
//     pointsAwarded: number | null   (filled in once scored)
//     hostOverride: boolean | null
//
// ROOM STATUS FLOW (meta.status), per round, in order:
//   "lobby"              -> waiting room before game starts
//   "transition-card"    -> flash card announcing the round type
//   "rule-explainer"     -> first-time-only explanation of how this round
//                            type works (skipped on repeat rounds of the
//                            same type — see explainedRoundTypes above)
//   "question-active"    -> a question within the round is live
//                            (currentQuestion.state tracks active/locked/revealed
//                            within this status)
//   "round-recap"        -> host reviews every answer submitted this round
//                            (funny/wrong answers, called out by the host)
//   "round-scoreboard"   -> standings after this round
//   ... repeats per round ...
//   "final-ceremony"     -> pomp/build-up reveal of the overall winner
//   "ended"              -> game over

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  get,
  push,
  onValue,
  onDisconnect,
  serverTimestamp,
  runTransaction,
  remove,
  off,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

let app = null;
let db = null;

/**
 * Must be called once before any other function in this module is used.
 * Throws a clear error if the config still contains placeholder values,
 * since that's the single most likely setup mistake.
 */
function initFirebase() {
  if (app) return; // already initialized

  if (
    !firebaseConfig ||
    firebaseConfig.apiKey === "YOUR_API_KEY_HERE" ||
    !firebaseConfig.databaseURL
  ) {
    throw new Error(
      "Firebase config is still using placeholder values. " +
        "Open js/firebase-config.js and paste in your real Firebase project config. " +
        "See README.md for step-by-step setup instructions."
    );
  }

  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

function getDb() {
  if (!db) {
    throw new Error("Firebase has not been initialized. Call initFirebase() first.");
  }
  return db;
}

// --- Room status enum ---
// Use these constants everywhere instead of typing raw strings, so a typo
// in a status string fails loudly (ReferenceError) rather than silently
// leaving host/player views stuck.

const ROOM_STATUS = Object.freeze({
  LOBBY: "lobby",
  TRANSITION_CARD: "transition-card",
  RULE_EXPLAINER: "rule-explainer",
  QUESTION_ACTIVE: "question-active",
  ROUND_RECAP: "round-recap",
  ROUND_SCOREBOARD: "round-scoreboard",
  FINAL_CEREMONY: "final-ceremony",
  ENDED: "ended",
});

// --- Room codes ---

const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // excludes 0/O, 1/I/L for readability

function generateRoomCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

/**
 * Generates a room code and checks it doesn't collide with an existing
 * active room. Retries a handful of times before giving up (collision is
 * astronomically unlikely with a 4-char code over 32 symbols, but worth
 * guarding against).
 */
async function generateUniqueRoomCode() {
  const database = getDb();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRoomCode();
    const snapshot = await get(ref(database, `rooms/${code}/meta`));
    if (!snapshot.exists()) {
      return code;
    }
  }
  throw new Error("Could not generate a unique room code after 10 attempts. Try again.");
}

// --- Room lifecycle (host side) ---

/**
 * Creates a new room with the given quiz loaded in, in "lobby" status.
 * Returns the generated room code.
 */
async function createRoom(quiz, hostId) {
  const database = getDb();
  const roomCode = await generateUniqueRoomCode();
  await set(ref(database, `rooms/${roomCode}`), {
    meta: {
      hostId,
      status: ROOM_STATUS.LOBBY,
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      explainedRoundTypes: {},
      createdAt: serverTimestamp(),
    },
    quiz,
    players: {},
    currentQuestion: null,
    answers: {},
  });
  return roomCode;
}

async function setRoomStatus(roomCode, status) {
  const database = getDb();
  await update(ref(database, `rooms/${roomCode}/meta`), { status });
}

async function setCurrentRoundQuestion(roomCode, roundIndex, questionIndex) {
  const database = getDb();
  await update(ref(database, `rooms/${roomCode}/meta`), {
    currentRoundIndex: roundIndex,
    currentQuestionIndex: questionIndex,
  });
}

/**
 * Checks whether the rule-explainer for a given round type has already
 * been shown this game. Host calls this before deciding whether to
 * transition into ROOM_STATUS.RULE_EXPLAINER or skip straight to the
 * first question.
 */
async function hasRoundTypeBeenExplained(roomCode, roundType) {
  const database = getDb();
  const snapshot = await get(
    ref(database, `rooms/${roomCode}/meta/explainedRoundTypes/${roundType}`)
  );
  return snapshot.val() === true;
}

/**
 * Marks a round type as having had its rule-explainer shown. Call this
 * once, when the explainer screen is first displayed for that type.
 */
async function markRoundTypeExplained(roomCode, roundType) {
  const database = getDb();
  await update(ref(database, `rooms/${roomCode}/meta/explainedRoundTypes`), {
    [roundType]: true,
  });
}

async function deleteRoom(roomCode) {
  const database = getDb();
  await remove(ref(database, `rooms/${roomCode}`));
}

async function roomExists(roomCode) {
  const database = getDb();
  const snapshot = await get(ref(database, `rooms/${roomCode}/meta`));
  return snapshot.exists();
}

// --- Current question control (host side) ---

/**
 * Sets the active question. `extra` can carry round-type-specific fields,
 * e.g. { clueIndex: 0, revealedClueIndices: [0] } for Where Are We Going.
 *
 * Also archives the start time into questionMeta/{questionId}, since
 * currentQuestion gets overwritten by the next question — but we need the
 * full history of start times at game end to compute the speed tiebreak.
 */
async function setCurrentQuestion(roomCode, questionId, type, extra = {}, roundIndex = null, questionIndex = null) {
  const database = getDb();
  await set(ref(database, `rooms/${roomCode}/currentQuestion`), {
    questionId,
    type,
    state: "active",
    startedAt: serverTimestamp(),
    ...extra,
  });

  // Read back the resolved server timestamp (serverTimestamp() is a write
  // sentinel, not a usable number) and archive it.
  const snapshot = await get(ref(database, `rooms/${roomCode}/currentQuestion/startedAt`));
  const resolvedStartedAt = snapshot.val();
  await set(ref(database, `rooms/${roomCode}/questionMeta/${questionId}`), {
    startedAt: resolvedStartedAt,
    roundIndex,
    questionIndex,
  });
}

async function updateCurrentQuestion(roomCode, updates) {
  const database = getDb();
  await update(ref(database, `rooms/${roomCode}/currentQuestion`), updates);
}

async function lockCurrentQuestion(roomCode) {
  await updateCurrentQuestion(roomCode, { state: "locked" });
}

async function revealCurrentQuestion(roomCode) {
  await updateCurrentQuestion(roomCode, { state: "revealed" });
}

// --- Players (player side joins, host side reads/manages) ---

/**
 * Registers a new player in a room. Sets up onDisconnect so they're marked
 * disconnected (NOT removed) if they close the tab / lose connection.
 * Returns the playerId, which the caller should persist (localStorage) so
 * the same browser can resume the same player identity later.
 */
async function joinRoom(roomCode, playerName, existingPlayerId = null) {
  const database = getDb();

  if (existingPlayerId) {
    // Rejoin flow: check the player still exists in this room.
    const snapshot = await get(ref(database, `rooms/${roomCode}/players/${existingPlayerId}`));
    if (snapshot.exists()) {
      const playerRef = ref(database, `rooms/${roomCode}/players/${existingPlayerId}`);
      await update(playerRef, { connected: true, lastSeen: serverTimestamp() });
      onDisconnect(playerRef).update({ connected: false, lastSeen: serverTimestamp() });
      return existingPlayerId;
    }
    // Fall through to creating a new player if the old one no longer exists
    // (e.g. room was reset) — caller should be told this happened via the
    // return value being a *new* id, which won't match existingPlayerId.
  }

  const playersRef = ref(database, `rooms/${roomCode}/players`);
  const newPlayerRef = push(playersRef);
  const playerId = newPlayerRef.key;

  await set(newPlayerRef, {
    name: playerName,
    score: 0,
    connected: true,
    lastSeen: serverTimestamp(),
  });

  onDisconnect(newPlayerRef).update({ connected: false, lastSeen: serverTimestamp() });

  return playerId;
}

/**
 * Atomically increments a player's score. Using a transaction avoids race
 * conditions if multiple score updates land close together.
 */
async function incrementPlayerScore(roomCode, playerId, delta) {
  const database = getDb();
  const scoreRef = ref(database, `rooms/${roomCode}/players/${playerId}/score`);
  await runTransaction(scoreRef, (currentScore) => (currentScore || 0) + delta);
}

async function setPlayerScore(roomCode, playerId, score) {
  const database = getDb();
  await update(ref(database, `rooms/${roomCode}/players/${playerId}`), { score });
}

/**
 * Lets a player change their own display name after joining (e.g. to fix
 * a typo). Should only ever be called by the player themselves for their
 * own playerId — enforce in security rules.
 */
async function renamePlayer(roomCode, playerId, newName) {
  const database = getDb();
  await update(ref(database, `rooms/${roomCode}/players/${playerId}`), { name: newName });
}

async function kickPlayer(roomCode, playerId) {
  const database = getDb();
  await remove(ref(database, `rooms/${roomCode}/players/${playerId}`));
}

// --- Answers ---

/**
 * Submits (or overwrites) a player's answer for a question. Players should
 * only ever be allowed to write to their OWN answer node — enforce this in
 * Firebase security rules (see README.md), not just in client code.
 */
async function submitAnswer(roomCode, questionId, playerId, value, extra = {}) {
  const database = getDb();
  await set(ref(database, `rooms/${roomCode}/answers/${questionId}/${playerId}`), {
    value,
    submittedAt: serverTimestamp(),
    pointsAwarded: null,
    hostOverride: null,
    ...extra,
  });
}

/**
 * Host-side: records points awarded for a given player's answer, and
 * whether it was a host override (i.e. the automated matcher said "wrong"
 * but the host judged it close enough).
 */
async function awardPoints(roomCode, questionId, playerId, points, isOverride = false) {
  const database = getDb();
  await update(ref(database, `rooms/${roomCode}/answers/${questionId}/${playerId}`), {
    pointsAwarded: points,
    hostOverride: isOverride,
  });
  await incrementPlayerScore(roomCode, playerId, points);
}

/**
 * Fetches all answers for a list of question IDs in one go — used to build
 * the host's round-recap screen ("here's everything everyone answered this
 * round") after the last question in a round is revealed/scored.
 *
 * @returns {Object} shape: { [questionId]: { [playerId]: answerObject } }
 */
async function fetchAnswersForQuestions(roomCode, questionIds) {
  const database = getDb();
  const results = {};
  await Promise.all(
    questionIds.map(async (questionId) => {
      const snapshot = await get(ref(database, `rooms/${roomCode}/answers/${questionId}`));
      results[questionId] = snapshot.val() || {};
    })
  );
  return results;
}

/**
 * Fetches everything needed to compute final standings / the speed
 * tiebreak at game end: every answer ever submitted in the room, and the
 * archived start time of every question played.
 *
 * @returns {{ allAnswers: Object, questionStartTimes: Object }}
 *   allAnswers shape: { [questionId]: { [playerId]: answerObject } }
 *   questionStartTimes shape: { [questionId]: number }
 */
async function fetchFinalGameData(roomCode) {
  const database = getDb();
  const [answersSnapshot, questionMetaSnapshot] = await Promise.all([
    get(ref(database, `rooms/${roomCode}/answers`)),
    get(ref(database, `rooms/${roomCode}/questionMeta`)),
  ]);

  const allAnswers = answersSnapshot.val() || {};
  const questionMeta = questionMetaSnapshot.val() || {};

  const questionStartTimes = {};
  Object.keys(questionMeta).forEach((questionId) => {
    questionStartTimes[questionId] = questionMeta[questionId].startedAt;
  });

  return { allAnswers, questionStartTimes };
}

// --- Listeners ---
// All listener functions return an unsubscribe function for cleanup.

function listenToRoom(roomCode, callback) {
  const database = getDb();
  const roomRef = ref(database, `rooms/${roomCode}`);
  onValue(roomRef, (snapshot) => callback(snapshot.val()));
  return () => off(roomRef);
}

function listenToMeta(roomCode, callback) {
  const database = getDb();
  const metaRef = ref(database, `rooms/${roomCode}/meta`);
  onValue(metaRef, (snapshot) => callback(snapshot.val()));
  return () => off(metaRef);
}

function listenToPlayers(roomCode, callback) {
  const database = getDb();
  const playersRef = ref(database, `rooms/${roomCode}/players`);
  onValue(playersRef, (snapshot) => callback(snapshot.val() || {}));
  return () => off(playersRef);
}

function listenToCurrentQuestion(roomCode, callback) {
  const database = getDb();
  const cqRef = ref(database, `rooms/${roomCode}/currentQuestion`);
  onValue(cqRef, (snapshot) => callback(snapshot.val()));
  return () => off(cqRef);
}

function listenToAnswersForQuestion(roomCode, questionId, callback) {
  const database = getDb();
  const answersRef = ref(database, `rooms/${roomCode}/answers/${questionId}`);
  onValue(answersRef, (snapshot) => callback(snapshot.val() || {}));
  return () => off(answersRef);
}

export {
  ROOM_STATUS,
  initFirebase,
  generateRoomCode,
  generateUniqueRoomCode,
  createRoom,
  setRoomStatus,
  setCurrentRoundQuestion,
  hasRoundTypeBeenExplained,
  markRoundTypeExplained,
  deleteRoom,
  roomExists,
  setCurrentQuestion,
  updateCurrentQuestion,
  lockCurrentQuestion,
  revealCurrentQuestion,
  joinRoom,
  incrementPlayerScore,
  setPlayerScore,
  renamePlayer,
  kickPlayer,
  fetchAnswersForQuestions,
  fetchFinalGameData,
  submitAnswer,
  awardPoints,
  listenToRoom,
  listenToMeta,
  listenToPlayers,
  listenToCurrentQuestion,
  listenToAnswersForQuestion,
};
