// firebase-sync.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, update, get, push, onValue, onDisconnect, serverTimestamp, runTransaction, remove, off } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

let app = null, db = null;

function initFirebase() {
  if (app) return;
  if (!firebaseConfig || firebaseConfig.apiKey === "YOUR_API_KEY_HERE" || !firebaseConfig.databaseURL) {
    throw new Error("Firebase config is still using placeholder values. Open js/firebase-config.js and paste in your real Firebase project config.");
  }
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

function getDb() {
  if (!db) throw new Error("Firebase has not been initialized. Call initFirebase() first.");
  return db;
}

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

const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateRoomCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return code;
}

async function generateUniqueRoomCode() {
  const database = getDb();
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRoomCode();
    const snapshot = await get(ref(database, `rooms/${code}/meta`));
    if (!snapshot.exists()) return code;
  }
  throw new Error("Could not generate a unique room code after 10 attempts.");
}

async function createRoom(quiz, hostId) {
  const database = getDb();
  const roomCode = await generateUniqueRoomCode();
  await set(ref(database, `rooms/${roomCode}`), {
    meta: { hostId, status: ROOM_STATUS.LOBBY, currentRoundIndex: 0, currentQuestionIndex: 0, explainedRoundTypes: {}, createdAt: serverTimestamp() },
    quiz: quiz || null,
    players: {},
    currentQuestion: null,
    answers: {},
  });
  return roomCode;
}

async function setRoomStatus(roomCode, status) {
  await update(ref(getDb(), `rooms/${roomCode}/meta`), { status });
}

async function setCurrentRoundQuestion(roomCode, roundIndex, questionIndex) {
  await update(ref(getDb(), `rooms/${roomCode}/meta`), { currentRoundIndex: roundIndex, currentQuestionIndex: questionIndex });
}

async function hasRoundTypeBeenExplained(roomCode, roundType) {
  const snapshot = await get(ref(getDb(), `rooms/${roomCode}/meta/explainedRoundTypes/${roundType}`));
  return snapshot.val() === true;
}

async function markRoundTypeExplained(roomCode, roundType) {
  await update(ref(getDb(), `rooms/${roomCode}/meta/explainedRoundTypes`), { [roundType]: true });
}

async function deleteRoom(roomCode) { await remove(ref(getDb(), `rooms/${roomCode}`)); }

async function roomExists(roomCode) {
  const snapshot = await get(ref(getDb(), `rooms/${roomCode}/meta`));
  return snapshot.exists();
}

async function setCurrentQuestion(roomCode, questionId, type, extra = {}, roundIndex = null, questionIndex = null) {
  const database = getDb();
  await set(ref(database, `rooms/${roomCode}/currentQuestion`), { questionId, type, state: "active", startedAt: serverTimestamp(), ...extra });
  const snapshot = await get(ref(database, `rooms/${roomCode}/currentQuestion/startedAt`));
  await set(ref(database, `rooms/${roomCode}/questionMeta/${questionId}`), { startedAt: snapshot.val(), roundIndex, questionIndex });
}

async function updateCurrentQuestion(roomCode, updates) { await update(ref(getDb(), `rooms/${roomCode}/currentQuestion`), updates); }
async function lockCurrentQuestion(roomCode) { await updateCurrentQuestion(roomCode, { state: "locked" }); }
async function revealCurrentQuestion(roomCode) { await updateCurrentQuestion(roomCode, { state: "revealed" }); }

async function joinRoom(roomCode, playerName, existingPlayerId = null) {
  const database = getDb();
  if (existingPlayerId) {
    const snapshot = await get(ref(database, `rooms/${roomCode}/players/${existingPlayerId}`));
    if (snapshot.exists()) {
      const playerRef = ref(database, `rooms/${roomCode}/players/${existingPlayerId}`);
      await update(playerRef, { connected: true, lastSeen: serverTimestamp() });
      onDisconnect(playerRef).update({ connected: false, lastSeen: serverTimestamp() });
      return existingPlayerId;
    }
  }
  const newPlayerRef = push(ref(database, `rooms/${roomCode}/players`));
  const playerId = newPlayerRef.key;
  await set(newPlayerRef, { name: playerName, score: 0, connected: true, lastSeen: serverTimestamp() });
  onDisconnect(newPlayerRef).update({ connected: false, lastSeen: serverTimestamp() });
  return playerId;
}

async function incrementPlayerScore(roomCode, playerId, delta) {
  await runTransaction(ref(getDb(), `rooms/${roomCode}/players/${playerId}/score`), current => (current || 0) + delta);
}

async function setPlayerScore(roomCode, playerId, score) { await update(ref(getDb(), `rooms/${roomCode}/players/${playerId}`), { score }); }
async function renamePlayer(roomCode, playerId, newName) { await update(ref(getDb(), `rooms/${roomCode}/players/${playerId}`), { name: newName }); }
async function kickPlayer(roomCode, playerId) { await remove(ref(getDb(), `rooms/${roomCode}/players/${playerId}`)); }

async function submitAnswer(roomCode, questionId, playerId, value, extra = {}) {
  await set(ref(getDb(), `rooms/${roomCode}/answers/${questionId}/${playerId}`), { value, submittedAt: serverTimestamp(), pointsAwarded: null, hostOverride: null, ...extra });
}

async function updateQuiz(roomCode, quiz) {
  await set(ref(getDb(), `rooms/${roomCode}/quiz`), quiz);
}

async function awardPoints(roomCode, questionId, playerId, points, isOverride = false) {
  await update(ref(getDb(), `rooms/${roomCode}/answers/${questionId}/${playerId}`), { pointsAwarded: points, hostOverride: isOverride });
  await incrementPlayerScore(roomCode, playerId, points);
}

async function fetchAnswersForQuestions(roomCode, questionIds) {
  const results = {};
  await Promise.all(questionIds.map(async qId => {
    const snap = await get(ref(getDb(), `rooms/${roomCode}/answers/${qId}`));
    results[qId] = snap.val() || {};
  }));
  return results;
}

async function fetchFinalGameData(roomCode) {
  const [answersSnap, metaSnap] = await Promise.all([
    get(ref(getDb(), `rooms/${roomCode}/answers`)),
    get(ref(getDb(), `rooms/${roomCode}/questionMeta`)),
  ]);
  const allAnswers = answersSnap.val() || {};
  const questionMeta = metaSnap.val() || {};
  const questionStartTimes = {};
  Object.keys(questionMeta).forEach(qId => { questionStartTimes[qId] = questionMeta[qId].startedAt; });
  return { allAnswers, questionStartTimes };
}

function listenToRoom(roomCode, callback) {
  const r = ref(getDb(), `rooms/${roomCode}`);
  onValue(r, snap => callback(snap.val()));
  return () => off(r);
}

function listenToMeta(roomCode, callback) {
  const r = ref(getDb(), `rooms/${roomCode}/meta`);
  onValue(r, snap => callback(snap.val()));
  return () => off(r);
}

function listenToPlayers(roomCode, callback) {
  const r = ref(getDb(), `rooms/${roomCode}/players`);
  onValue(r, snap => callback(snap.val() || {}));
  return () => off(r);
}

function listenToCurrentQuestion(roomCode, callback) {
  const r = ref(getDb(), `rooms/${roomCode}/currentQuestion`);
  onValue(r, snap => callback(snap.val()));
  return () => off(r);
}

function listenToAnswersForQuestion(roomCode, questionId, callback) {
  const r = ref(getDb(), `rooms/${roomCode}/answers/${questionId}`);
  onValue(r, snap => callback(snap.val() || {}));
  return () => off(r);
}

export { ROOM_STATUS, initFirebase, generateRoomCode, generateUniqueRoomCode, createRoom, setRoomStatus, setCurrentRoundQuestion, hasRoundTypeBeenExplained, markRoundTypeExplained, deleteRoom, roomExists, setCurrentQuestion, updateCurrentQuestion, lockCurrentQuestion, revealCurrentQuestion, joinRoom, incrementPlayerScore, setPlayerScore, renamePlayer, kickPlayer, fetchAnswersForQuestions, fetchFinalGameData, submitAnswer, awardPoints, listenToRoom, listenToMeta, listenToPlayers, listenToCurrentQuestion, listenToAnswersForQuestion, updateQuiz };
