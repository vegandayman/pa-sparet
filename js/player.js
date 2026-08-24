// player.js — Mobile player view controller

import { initFirebase, ROOM_STATUS, joinRoom, submitAnswer, listenToRoom, roomExists } from "./firebase-sync.js";
import { ROUND_TYPES, WHERE_ARE_WE_GOING_DEFAULT_POINTS } from "./quiz-schema.js";

function getYTEmbedUrl(url) {
  if (!url) return "";
  const match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const id = match ? match[1] : "";
  return id ? `https://www.youtube.com/embed/${id}?autoplay=1` : "";
}

const ROUND_TYPE_ICONS = {
  [ROUND_TYPES.WHERE_ARE_WE_GOING]: "🚂",
  [ROUND_TYPES.DESTINATION_TRIVIA]: "❓",
  [ROUND_TYPES.MUSIC_ROUND]: "🎵",
  [ROUND_TYPES.CLOSEST_WINS]: "📍",
};

const ROUND_EXPLAINERS = {
  [ROUND_TYPES.WHERE_ARE_WE_GOING]: { title: "WHERE ARE WE GOING?", body: "You are going to see a video of a journey. Your task is to guess the destination. The host will read clues which get increasingly easier. The quicker you get the answer right, the more points you get. When you are ready to guess, type the name of the destination CITY into the box and click Submit, then sit tight and wait for the journey to finish." },
  [ROUND_TYPES.DESTINATION_TRIVIA]: { title: "DESTINATION TRIVIA", body: "You'll be asked a question about the destination — sometimes with an image. Some questions give you 4 multiple-choice options to pick from, others want you to type your own answer. Answer correctly to earn a point — speed doesn't matter here, so take your time and get it right." },
  [ROUND_TYPES.MUSIC_ROUND]: { title: "THE MUSIC ROUND", body: "A song will play on the big screen. Your job is to identify it — depending on the question, you might need to name the artist, the song title, or both. Type your answer into each box and submit. You get a point for every correct guess." },
  [ROUND_TYPES.CLOSEST_WINS]: { title: "CLOSEST WINS", body: "You'll see a photo of a location somewhere in the world. Drop a pin on the map where you think it is before time runs out. Closest guess to the real location takes all the points." },
};

const STORAGE_KEY = "po-sparet-player";

let state = {
  roomCode: null, playerId: null, playerName: null,
  currentQuestionId: null, hasSubmitted: false,
  playerMap: null, playerMarker: null, pendingLat: null, pendingLng: null,
  cwTimerInterval: null, unsubscribeRoom: null,
};

// All game state from Firebase — updated atomically from a single listener
let latestMeta = null, latestQuestion = null, latestPlayers = {}, latestQuiz = null;

function saveSession() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode: state.roomCode, playerId: state.playerId, playerName: state.playerName })); } catch (e) {} }
function loadSession() { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function clearSession() { try { localStorage.removeItem(STORAGE_KEY); } catch (e) {} }

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("is-active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("is-active");
}

// ---------------------------------------------------------------------------
// Single room listener — no race conditions
// ---------------------------------------------------------------------------

function startListening() {
  if (state.unsubscribeRoom) state.unsubscribeRoom();
  state.unsubscribeRoom = listenToRoom(state.roomCode, handleRoomChange);
}

function handleRoomChange(room) {
  if (!room) return;

  const prevQuestionId = latestQuestion?.questionId;

  latestMeta = room.meta || null;
  latestQuestion = room.currentQuestion || null;
  latestPlayers = room.players || {};
  if (!latestQuiz && room.quiz) latestQuiz = room.quiz;

  if (!latestMeta) return;

  // Reset submission state when a genuinely new question arrives
  if (latestQuestion?.questionId && latestQuestion.questionId !== prevQuestionId) {
    state.currentQuestionId = latestQuestion.questionId;
    state.hasSubmitted = false;
  }

  renderForStatus(latestMeta.status, latestMeta);
}

// ---------------------------------------------------------------------------
// Join flow
// ---------------------------------------------------------------------------

async function handleJoin() {
  const roomCode = document.getElementById("joinRoomCode").value.trim().toUpperCase();
  const playerName = document.getElementById("joinPlayerName").value.trim();
  const errorEl = document.getElementById("joinError");
  errorEl.textContent = "";
  if (!roomCode || roomCode.length !== 4) { errorEl.textContent = "Enter the 4-character room code from the host screen."; return; }
  if (!playerName) { errorEl.textContent = "Enter your name or team name."; return; }
  document.getElementById("joinBtn").disabled = true;
  document.getElementById("joinBtn").textContent = "Joining…";
  try {
    const exists = await roomExists(roomCode);
    if (!exists) { errorEl.textContent = "Room not found. Check the code and try again."; document.getElementById("joinBtn").disabled = false; document.getElementById("joinBtn").textContent = "Join game"; return; }
    const playerId = await joinRoom(roomCode, playerName);
    state.roomCode = roomCode; state.playerId = playerId; state.playerName = playerName;
    saveSession();
    enterLobby();
    startListening();
  } catch (err) {
    errorEl.textContent = "Could not join: " + err.message;
    document.getElementById("joinBtn").disabled = false;
    document.getElementById("joinBtn").textContent = "Join game";
  }
}

async function tryRejoin(session) {
  try {
    const exists = await roomExists(session.roomCode);
    if (!exists) { clearSession(); return false; }
    const playerId = await joinRoom(session.roomCode, session.playerName, session.playerId);
    state.roomCode = session.roomCode; state.playerId = playerId; state.playerName = session.playerName;
    saveSession(); enterLobby(); startListening(); return true;
  } catch (e) { clearSession(); return false; }
}

function enterLobby() {
  document.getElementById("lobbyRoomCode").textContent = state.roomCode;
  document.getElementById("lobbyPlayerName").textContent = state.playerName;
  showScreen("screenLobby");
}

// ---------------------------------------------------------------------------
// Status router
// ---------------------------------------------------------------------------

function renderForStatus(status, meta) {
  switch (status) {
    case ROOM_STATUS.LOBBY: enterLobby(); break;
    case ROOM_STATUS.TRANSITION_CARD:
      if (!latestQuiz) { showWaiting("Get ready…", "Loading round info…"); return; }
      renderTransitionCard(meta); break;
    case ROOM_STATUS.RULE_EXPLAINER:
      if (!latestQuiz) { showWaiting("Get ready…", "Loading round info…"); return; }
      renderExplainer(meta); break;
    case ROOM_STATUS.QUESTION_ACTIVE:
      if (!latestQuiz) { showWaiting("Get ready…", "Loading question…"); return; }
      if (!latestQuestion) { showWaiting("Get ready…", "Question incoming…"); return; }
      renderActiveQuestion(latestQuestion, meta); break;
    case ROOM_STATUS.ROUND_RECAP: showWaiting("Round recap", "The host is reviewing everyone's answers…"); break;
    case ROOM_STATUS.ROUND_SCOREBOARD: renderScoreboard(meta); break;
    case ROOM_STATUS.FINAL_CEREMONY: renderCeremony(); break;
    case ROOM_STATUS.ENDED: showWaiting("Game over", "Thanks for playing!"); break;
    default: showWaiting("One moment…", "");
  }
}

// ---------------------------------------------------------------------------
// Transition card + rule explainer
// ---------------------------------------------------------------------------

function renderTransitionCard(meta) {
  const round = latestQuiz.rounds[meta.currentRoundIndex];
  if (!round) return;
  document.getElementById("transitionIcon").textContent = ROUND_TYPE_ICONS[round.type] || "❓";
  document.getElementById("transitionRoundNumber").textContent = `Round ${meta.currentRoundIndex + 1}`;
  document.getElementById("transitionRoundTitle").textContent = round.title;
  showScreen("screenTransition");
}

function renderExplainer(meta) {
  const round = latestQuiz.rounds[meta.currentRoundIndex];
  if (!round) return;
  const exp = ROUND_EXPLAINERS[round.type];
  document.getElementById("explainerTitle").textContent = exp?.title || round.title;
  document.getElementById("explainerBody").textContent = exp?.body || "";
  showScreen("screenExplainer");
}

// ---------------------------------------------------------------------------
// Active question dispatcher
// ---------------------------------------------------------------------------

function renderActiveQuestion(question, meta) {
  if (!question || !latestQuiz) return;
  if (state.hasSubmitted) { showScreen("screenSubmitted"); return; }
  if (question.state === "locked" || question.state === "revealed") {
    if (state.hasSubmitted) showScreen("screenSubmitted");
    else showWaiting("Time's up", "The host is revealing the answer…");
    return;
  }
  const round = latestQuiz.rounds[meta.currentRoundIndex];
  if (!round) return;
  const questionData = round.questions[meta.currentQuestionIndex];
  if (!questionData) return;

  switch (round.type) {
    case ROUND_TYPES.WHERE_ARE_WE_GOING: renderWawgScreen(question, questionData); break;
    case ROUND_TYPES.DESTINATION_TRIVIA:
      if (questionData.inputMode === "multiple-choice") renderTriviaMCScreen(questionData);
      else renderTriviaFTScreen(questionData);
      break;
    case ROUND_TYPES.MUSIC_ROUND: renderMusicScreen(questionData); break;
    case ROUND_TYPES.CLOSEST_WINS: renderClosestWinsScreen(question, questionData); break;
  }
}

// ---------------------------------------------------------------------------
// Where Are We Going
// ---------------------------------------------------------------------------

function renderWawgScreen(questionState, questionData) {
  const clueIndex = questionState.clueIndex ?? 0;
  const clue = questionData.clues[clueIndex] || "Waiting for clue…";
  const points = (questionData.pointsPerStage || WHERE_ARE_WE_GOING_DEFAULT_POINTS)[clueIndex];
  document.getElementById("wawgScoreChip").textContent = `${points} pts`;
  const clueEl = document.getElementById("wawgClue");
  if (clueEl.dataset.lastClue !== clue) {
    clueEl.textContent = clue;
    clueEl.dataset.lastClue = clue;
    clueEl.classList.remove("is-new");
    void clueEl.offsetWidth;
    clueEl.classList.add("is-new");
  }
  const indicator = document.getElementById("wawgStageIndicator");
  indicator.innerHTML = "";
  questionData.clues.forEach((_, i) => {
    const dot = document.createElement("div");
    dot.className = "wawg-stage-dot" + (i < clueIndex ? " is-past" : i === clueIndex ? " is-active" : "");
    indicator.appendChild(dot);
  });
  document.getElementById("wawgInput").disabled = false;
  document.getElementById("wawgSubmitBtn").disabled = false;
  showScreen("screenWawg");
}

function handleWawgSubmit() {
  if (state.hasSubmitted) return;
  const value = document.getElementById("wawgInput").value.trim();
  if (!value) return;
  const clueIndex = latestQuestion?.clueIndex ?? 0;
  state.hasSubmitted = true;
  document.getElementById("wawgInput").disabled = true;
  document.getElementById("wawgSubmitBtn").disabled = true;
  showSubmitted(`"${value}"`);
  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId, value, { clueStageAtSubmit: clueIndex }).catch(console.error);
}

// ---------------------------------------------------------------------------
// Destination Trivia — multiple choice
// ---------------------------------------------------------------------------

function renderTriviaMCScreen(questionData) {
  const imgEl = document.getElementById("triviaMCImage");
  const videoEl = document.getElementById("triviaMCVideo");
  if (questionData.videoUrl) {
    if (videoEl) { videoEl.src = getYTEmbedUrl(questionData.videoUrl); videoEl.style.display = "block"; }
    imgEl.style.display = "none";
  } else if (questionData.imageUrl) {
    imgEl.src = questionData.imageUrl; imgEl.style.display = "block";
    if (videoEl) videoEl.style.display = "none";
  } else {
    imgEl.style.display = "none";
    if (videoEl) videoEl.style.display = "none";
  }
  document.getElementById("triviaMCPrompt").textContent = questionData.prompt;
  const container = document.getElementById("triviaMCOptions");
  container.innerHTML = "";
  (questionData.options || []).forEach((option, idx) => {
    const btn = document.createElement("button");
    btn.className = "mc-option-btn";
    btn.textContent = option;
    btn.addEventListener("click", () => handleMCSelect(idx, questionData, container));
    container.appendChild(btn);
  });
  showScreen("screenTriviaMC");
}

function handleMCSelect(selectedIdx, questionData, container) {
  if (state.hasSubmitted) return;
  container.querySelectorAll(".mc-option-btn").forEach((btn, i) => { btn.disabled = true; if (i === selectedIdx) btn.classList.add("is-selected"); });
  state.hasSubmitted = true;
  showSubmitted(`Option ${selectedIdx + 1}: "${questionData.options[selectedIdx]}"`);
  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId, String(selectedIdx)).catch(console.error);
}

// ---------------------------------------------------------------------------
// Destination Trivia — free text
// ---------------------------------------------------------------------------

function renderTriviaFTScreen(questionData) {
  const imgEl = document.getElementById("triviaFTImage");
  const videoEl = document.getElementById("triviaFTVideo");
  if (questionData.videoUrl) {
    if (videoEl) { videoEl.src = getYTEmbedUrl(questionData.videoUrl); videoEl.style.display = "block"; }
    imgEl.style.display = "none";
  } else if (questionData.imageUrl) {
    imgEl.src = questionData.imageUrl; imgEl.style.display = "block";
    if (videoEl) videoEl.style.display = "none";
  } else {
    imgEl.style.display = "none";
    if (videoEl) videoEl.style.display = "none";
  }
  document.getElementById("triviaFTPrompt").textContent = questionData.prompt;
  document.getElementById("triviaFTInput").value = "";
  document.getElementById("triviaFTInput").disabled = false;
  document.getElementById("triviaFTSubmitBtn").disabled = false;
  showScreen("screenTriviaFT");
}

function handleTriviaFTSubmit() {
  if (state.hasSubmitted) return;
  const value = document.getElementById("triviaFTInput").value.trim();
  if (!value) return;
  state.hasSubmitted = true;
  document.getElementById("triviaFTInput").disabled = true;
  document.getElementById("triviaFTSubmitBtn").disabled = true;
  showSubmitted(`"${value}"`);
  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId, value).catch(console.error);
}

// ---------------------------------------------------------------------------
// Music Round
// ---------------------------------------------------------------------------

function renderMusicScreen(questionData) {
  const container = document.getElementById("musicBlanksContainer");
  container.innerHTML = "";
  (questionData.blanks || []).forEach(blank => {
    const wrapper = document.createElement("div"); wrapper.className = "answer-blank";
    const label = document.createElement("label"); label.className = "answer-blank-label";
    label.textContent = blank.label || (blank.type === "artist" ? "Artist" : "Song Title");
    label.htmlFor = `music-blank-${blank.id}`;
    const input = document.createElement("input"); input.type = "text";
    input.className = "answer-text-input"; input.id = `music-blank-${blank.id}`;
    input.dataset.blankId = blank.id;
    input.placeholder = blank.type === "artist" ? "Artist name…" : "Song title…";
    input.autocomplete = "off";
    wrapper.appendChild(label); wrapper.appendChild(input); container.appendChild(wrapper);
  });
  document.getElementById("musicSubmitBtn").disabled = false;
  showScreen("screenMusic");
}

function handleMusicSubmit() {
  if (state.hasSubmitted) return;
  if (!latestQuiz || !latestMeta) return;
  const round = latestQuiz.rounds[latestMeta.currentRoundIndex];
  const questionData = round?.questions[latestMeta.currentQuestionIndex];
  if (!questionData) return;
  const blanks = questionData.blanks || [];
  const values = {};
  let anyFilled = false;
  blanks.forEach(blank => {
    const input = document.getElementById(`music-blank-${blank.id}`);
    const val = input ? input.value.trim() : "";
    values[blank.id] = val;
    if (val) anyFilled = true;
  });
  if (!anyFilled) return;
  state.hasSubmitted = true;
  document.querySelectorAll("#musicBlanksContainer .answer-text-input").forEach(inp => { inp.disabled = true; });
  document.getElementById("musicSubmitBtn").disabled = true;
  const echoText = blanks.map(b => values[b.id] ? `${b.label || b.type}: "${values[b.id]}"` : "").filter(Boolean).join(" · ");
  showSubmitted(echoText);
  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId, values).catch(console.error);
}

// ---------------------------------------------------------------------------
// Closest Wins
// ---------------------------------------------------------------------------

function renderClosestWinsScreen(questionState, questionData) {
  // Show image
  const cwImageEl = document.getElementById("cwImage");
  const cwPromptEl = document.getElementById("cwPrompt");
  if (cwImageEl) {
    if (questionData.imageUrl) { cwImageEl.src = questionData.imageUrl; cwImageEl.style.display = "block"; }
    else cwImageEl.style.display = "none";
  }
  cwPromptEl.textContent = questionData.caption || "Where was this photo taken?";

  // Timer
  clearInterval(state.cwTimerInterval);
  const totalSecs = questionData.timeLimitSeconds || 30;
  const startedAt = questionState.startedAt;
  const elapsed = startedAt ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
  let remaining = Math.max(0, totalSecs - elapsed);
  const bar = document.getElementById("cwTimerBar");
  bar.style.width = (remaining / totalSecs * 100) + "%";
  bar.classList.toggle("is-low", remaining < totalSecs * 0.25);
  state.cwTimerInterval = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    bar.style.width = (remaining / totalSecs * 100) + "%";
    bar.classList.toggle("is-low", remaining < totalSecs * 0.25);
    if (remaining <= 0) { clearInterval(state.cwTimerInterval); if (!state.hasSubmitted) handleCWSubmit(); }
  }, 1000);

  document.getElementById("cwSubmitBtn").disabled = true;
  document.getElementById("cwSubmitBtn").textContent = "Drop a pin first";
  // Show the screen FIRST so the map container has real dimensions,
  // then init/reset the map — Leaflet fails silently on hidden elements.
  showScreen("screenClosestWins");
  if (!state.playerMap) {
    setTimeout(() => initPlayerMap(), 50);
  } else {
    if (state.playerMarker) { state.playerMap.removeLayer(state.playerMarker); state.playerMarker = null; }
    state.pendingLat = null; state.pendingLng = null;
    state.playerMap.setView([20, 0], 2);
    setTimeout(() => state.playerMap.invalidateSize(), 100);
  }
}

function initPlayerMap() {
  const map = L.map("playerMap", { zoomControl: true }).setView([20, 0], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap contributors © CARTO", subdomains: "abcd", maxZoom: 19,
  }).addTo(map);
  map.on("click", e => {
    if (state.hasSubmitted) return;
    const { lat, lng } = e.latlng;
    if (state.playerMarker) state.playerMarker.setLatLng([lat, lng]);
    else state.playerMarker = L.marker([lat, lng]).addTo(map);
    state.pendingLat = lat; state.pendingLng = lng;
    const btn = document.getElementById("cwSubmitBtn");
    btn.disabled = false; btn.textContent = "Submit pin";
  });
  state.playerMap = map;
  setTimeout(() => map.invalidateSize(), 150);
}

function handleCWSubmit() {
  if (state.hasSubmitted) return;
  if (state.pendingLat == null) return;
  clearInterval(state.cwTimerInterval);
  state.hasSubmitted = true;
  document.getElementById("cwSubmitBtn").disabled = true;
  const lat = state.pendingLat, lng = state.pendingLng;
  showSubmitted(`Pin dropped at ${lat.toFixed(2)}°, ${lng.toFixed(2)}°`);
  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId, { lat, lng }, { lat, lng }).catch(console.error);
}

// ---------------------------------------------------------------------------
// Submitted screen
// ---------------------------------------------------------------------------

function showSubmitted(echoText) {
  document.getElementById("submittedEcho").textContent = echoText || "";
  showScreen("screenSubmitted");
}

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

function renderScoreboard(meta) {
  document.getElementById("scoreboardTitle").textContent = `After round ${(meta.currentRoundIndex ?? 0) + 1}`;
  const players = Object.entries(latestPlayers).map(([id, p]) => ({ id, name: p.name, score: p.score || 0 })).sort((a, b) => b.score - a.score);
  const list = document.getElementById("scoreboardList");
  list.innerHTML = "";
  players.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "scoreboard-entry" + (p.id === state.playerId ? " is-you" : "");
    const rank = document.createElement("span");
    rank.className = "scoreboard-rank" + (idx === 0 ? " is-first" : idx === 1 ? " is-second" : idx === 2 ? " is-third" : "");
    rank.textContent = idx + 1;
    const name = document.createElement("span"); name.className = "scoreboard-name";
    name.textContent = p.name + (p.id === state.playerId ? " (you)" : "");
    const score = document.createElement("span"); score.className = "scoreboard-score";
    score.textContent = `${p.score} pt${p.score === 1 ? "" : "s"}`;
    li.appendChild(rank); li.appendChild(name); li.appendChild(score);
    list.appendChild(li);
  });
  showScreen("screenScoreboard");
}

// ---------------------------------------------------------------------------
// Final ceremony
// ---------------------------------------------------------------------------

function renderCeremony() {
  const players = Object.entries(latestPlayers).map(([id, p]) => ({ id, name: p.name, score: p.score || 0 })).sort((a, b) => b.score - a.score);
  if (players.length === 0) return;
  const winner = players[0];
  document.getElementById("ceremonyWinnerName").textContent = winner.name;
  document.getElementById("ceremonyWinnerScore").textContent = `${winner.score} pt${winner.score === 1 ? "" : "s"}`;
  showScreen("screenCeremony");
}

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

function showWaiting(title, subtitle) {
  document.getElementById("waitingTitle").textContent = title;
  document.getElementById("waitingSubtitle").textContent = subtitle;
  showScreen("screenWaiting");
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try { initFirebase(); } catch (e) { showWaiting("Setup error", e.message); return; }

  document.getElementById("joinBtn").addEventListener("click", handleJoin);
  document.getElementById("joinRoomCode").addEventListener("keydown", e => { if (e.key === "Enter") handleJoin(); });
  document.getElementById("joinPlayerName").addEventListener("keydown", e => { if (e.key === "Enter") handleJoin(); });
  document.getElementById("wawgSubmitBtn").addEventListener("click", handleWawgSubmit);
  document.getElementById("wawgInput").addEventListener("keydown", e => { if (e.key === "Enter") handleWawgSubmit(); });
  document.getElementById("triviaFTSubmitBtn").addEventListener("click", handleTriviaFTSubmit);
  document.getElementById("triviaFTInput").addEventListener("keydown", e => { if (e.key === "Enter") handleTriviaFTSubmit(); });
  document.getElementById("musicSubmitBtn").addEventListener("click", handleMusicSubmit);
  document.getElementById("cwSubmitBtn").addEventListener("click", handleCWSubmit);

  const session = loadSession();
  if (session?.roomCode && session?.playerId) {
    const rejoined = await tryRejoin(session);
    if (rejoined) return;
  }
  showScreen("screenJoin");
}

document.addEventListener("DOMContentLoaded", init);
