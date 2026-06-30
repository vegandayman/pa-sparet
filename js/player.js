// player.js
// Mobile player view controller. Owns local player state (roomCode, playerId,
// playerName), listens to Firebase for game state changes, and switches
// between screen states accordingly. All answer submission goes through here.

import { initFirebase, ROOM_STATUS, joinRoom, submitAnswer,
  listenToMeta, listenToCurrentQuestion, listenToPlayers,
  roomExists, renamePlayer } from "./firebase-sync.js";

import { ROUND_TYPES, ROUND_TYPE_LABELS, WHERE_ARE_WE_GOING_DEFAULT_POINTS }
  from "./quiz-schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "po-sparet-player";

const ROUND_TYPE_ICONS = {
  [ROUND_TYPES.WHERE_ARE_WE_GOING]: "🚂",
  [ROUND_TYPES.DESTINATION_TRIVIA]: "❓",
  [ROUND_TYPES.MUSIC_ROUND]: "🎵",
  [ROUND_TYPES.CLOSEST_WINS]: "📍",
};

// Rule explainer texts — one per round type.
// WHERE_ARE_WE_GOING text is final (confirmed by Robbie).
// Others are placeholders pending Robbie's edits.
const ROUND_EXPLAINERS = {
  [ROUND_TYPES.WHERE_ARE_WE_GOING]: {
    title: "WHERE ARE WE GOING?",
    body: "You are going to see a video of a journey. Your task is to guess the destination. The host will read clues which get increasingly easier. The quicker you get the answer right, the more points you get. When you are ready to guess, type the name of the destination CITY into the box and click Submit, then sit tight and wait for the journey to finish.",
  },
  [ROUND_TYPES.DESTINATION_TRIVIA]: {
    title: "DESTINATION TRIVIA",
    body: "You'll be asked a question about the destination — sometimes with an image. Some questions give you 4 multiple-choice options to pick from, others want you to type your own answer. Answer correctly to earn a point — speed doesn't matter here, so take your time and get it right.",
  },
  [ROUND_TYPES.MUSIC_ROUND]: {
    title: "THE MUSIC ROUND",
    body: "A song will play on the big screen. Your job is to identify it — depending on the question, you might need to name the artist, the song title, or both (sometimes more than one of each!). Type your answer into each box and submit. You get a point for every correct guess, so even a partial answer is worth something.",
  },
  [ROUND_TYPES.CLOSEST_WINS]: {
    title: "CLOSEST WINS",
    body: "You'll see a world map and a clue about a location. Drop a pin where you think it is before time runs out. Closest guess to the real location takes all the points — so trust your instincts and don't overthink it.",
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {
  roomCode: null,
  playerId: null,
  playerName: null,
  currentQuestionId: null,
  hasSubmitted: false,
  playerMap: null,
  playerMarker: null,
  cwTimerInterval: null,
  unsubscribeMeta: null,
  unsubscribeQuestion: null,
  unsubscribePlayers: null,
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function saveSession() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      roomCode: state.roomCode,
      playerId: state.playerId,
      playerName: state.playerName,
    }));
  } catch (e) { /* ignore */ }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Screen switching
// ---------------------------------------------------------------------------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("is-active"));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add("is-active");
}

// ---------------------------------------------------------------------------
// Join flow
// ---------------------------------------------------------------------------

async function handleJoin() {
  const roomCode = document.getElementById("joinRoomCode").value.trim().toUpperCase();
  const playerName = document.getElementById("joinPlayerName").value.trim();
  const errorEl = document.getElementById("joinError");
  errorEl.textContent = "";

  if (!roomCode || roomCode.length !== 4) {
    errorEl.textContent = "Enter the 4-character room code from the host screen.";
    return;
  }
  if (!playerName) {
    errorEl.textContent = "Enter your name or team name.";
    return;
  }

  document.getElementById("joinBtn").disabled = true;
  document.getElementById("joinBtn").textContent = "Joining…";

  try {
    const exists = await roomExists(roomCode);
    if (!exists) {
      errorEl.textContent = "Room not found. Check the code and try again.";
      document.getElementById("joinBtn").disabled = false;
      document.getElementById("joinBtn").textContent = "Join game";
      return;
    }

    const playerId = await joinRoom(roomCode, playerName);
    state.roomCode = roomCode;
    state.playerId = playerId;
    state.playerName = playerName;
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
  // Try to silently rejoin with the stored session.
  try {
    const exists = await roomExists(session.roomCode);
    if (!exists) { clearSession(); return false; }

    const playerId = await joinRoom(session.roomCode, session.playerName, session.playerId);
    state.roomCode = session.roomCode;
    state.playerId = playerId;
    state.playerName = session.playerName;
    // playerId may differ if the original no longer exists in the room.
    saveSession();

    enterLobby();
    startListening();
    return true;
  } catch (e) {
    clearSession();
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function enterLobby() {
  document.getElementById("lobbyRoomCode").textContent = state.roomCode;
  document.getElementById("lobbyPlayerName").textContent = state.playerName;
  showScreen("screenLobby");
}

// ---------------------------------------------------------------------------
// Firebase listeners
// ---------------------------------------------------------------------------

function startListening() {
  // Clean up any previous listeners.
  if (state.unsubscribeMeta) state.unsubscribeMeta();
  if (state.unsubscribeQuestion) state.unsubscribeQuestion();
  if (state.unsubscribePlayers) state.unsubscribePlayers();

  state.unsubscribeMeta = listenToMeta(state.roomCode, handleMetaChange);
  state.unsubscribeQuestion = listenToCurrentQuestion(state.roomCode, handleQuestionChange);
  state.unsubscribePlayers = listenToPlayers(state.roomCode, handlePlayersChange);
}

// Latest copies of remote state, so handlers can cross-reference.
let latestMeta = null;
let latestQuestion = null;
let latestPlayers = {};
let latestQuiz = null;

function handleMetaChange(meta) {
  if (!meta) return;
  latestMeta = meta;

  // Fetch the quiz if we don't have it yet (needed to render questions
  // and transition cards).
  if (!latestQuiz) {
    fetchQuiz();
  }

  renderForStatus(meta.status, meta);
}

async function fetchQuiz() {
  // Lightweight one-time read of the quiz object from the room.
  // firebase-sync doesn't expose a fetchQuiz helper, so we use the
  // underlying Firebase get() directly via a listenToRoom trick:
  // we read the whole room once and pull out quiz.
  // (A one-time read is fine here; the quiz never changes mid-game.)
  const { get, ref, getDatabase } = await import(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js"
  );
  const db = getDatabase();
  const snap = await get(ref(db, `rooms/${state.roomCode}/quiz`));
  latestQuiz = snap.val();
}

function handleQuestionChange(question) {
  latestQuestion = question;
  if (!latestMeta) return;
  renderForStatus(latestMeta.status, latestMeta);
}

function handlePlayersChange(players) {
  latestPlayers = players || {};
  // If the scoreboard is currently showing, re-render it with fresh data.
  if (latestMeta && (latestMeta.status === ROOM_STATUS.ROUND_SCOREBOARD ||
      latestMeta.status === ROOM_STATUS.FINAL_CEREMONY)) {
    renderForStatus(latestMeta.status, latestMeta);
  }
}

// ---------------------------------------------------------------------------
// Status → screen router
// ---------------------------------------------------------------------------

function renderForStatus(status, meta) {
  switch (status) {
    case ROOM_STATUS.LOBBY:
      enterLobby();
      break;

    case ROOM_STATUS.TRANSITION_CARD:
      renderTransitionCard(meta);
      break;

    case ROOM_STATUS.RULE_EXPLAINER:
      renderExplainer(meta);
      break;

    case ROOM_STATUS.QUESTION_ACTIVE:
      renderActiveQuestion(latestQuestion, meta);
      break;

    case ROOM_STATUS.ROUND_RECAP:
      // Players see a waiting screen during the host's round-recap display —
      // the funny answers are the host's moment, not shown on phones.
      showWaiting("Round recap", "The host is reviewing everyone's answers…");
      break;

    case ROOM_STATUS.ROUND_SCOREBOARD:
      renderScoreboard(meta, false);
      break;

    case ROOM_STATUS.FINAL_CEREMONY:
      renderCeremony(meta);
      break;

    case ROOM_STATUS.ENDED:
      showWaiting("Game over", "Thanks for playing!");
      break;

    default:
      showWaiting("One moment…", "");
  }
}

// ---------------------------------------------------------------------------
// Transition card
// ---------------------------------------------------------------------------

function renderTransitionCard(meta) {
  if (!latestQuiz) { showWaiting("Loading…", ""); return; }
  const round = latestQuiz.rounds[meta.currentRoundIndex];
  if (!round) return;

  document.getElementById("transitionIcon").textContent = ROUND_TYPE_ICONS[round.type] || "❓";
  document.getElementById("transitionRoundNumber").textContent =
    `Round ${meta.currentRoundIndex + 1}`;
  document.getElementById("transitionRoundTitle").textContent = round.title;
  showScreen("screenTransition");
}

// ---------------------------------------------------------------------------
// Rule explainer
// ---------------------------------------------------------------------------

function renderExplainer(meta) {
  if (!latestQuiz) { showWaiting("Loading…", ""); return; }
  const round = latestQuiz.rounds[meta.currentRoundIndex];
  if (!round) return;

  const explainer = ROUND_EXPLAINERS[round.type];
  document.getElementById("explainerTitle").textContent = explainer?.title || round.title;
  document.getElementById("explainerBody").textContent =
    explainer?.body || "Get ready for this round!";
  showScreen("screenExplainer");
}

// ---------------------------------------------------------------------------
// Active question rendering
// ---------------------------------------------------------------------------

function renderActiveQuestion(question, meta) {
  if (!question || !latestQuiz) { showWaiting("Loading question…", ""); return; }

  // If this is a new question (different ID), reset submission state.
  if (question.questionId !== state.currentQuestionId) {
    state.currentQuestionId = question.questionId;
    state.hasSubmitted = false;
  }

  // If already submitted, show the submitted screen immediately.
  if (state.hasSubmitted) {
    showScreen("screenSubmitted");
    return;
  }

  // If question is locked/revealed, also show submitted or waiting.
  if (question.state === "locked" || question.state === "revealed") {
    if (state.hasSubmitted) {
      showScreen("screenSubmitted");
    } else {
      showWaiting("Time's up", "The host is revealing the answer…");
    }
    return;
  }

  const round = latestQuiz.rounds[meta.currentRoundIndex];
  if (!round) return;

  // Get the actual question object from the quiz.
  const questionData = round.questions[meta.currentQuestionIndex];
  if (!questionData) return;

  switch (round.type) {
    case ROUND_TYPES.WHERE_ARE_WE_GOING:
      renderWawgScreen(question, questionData);
      break;
    case ROUND_TYPES.DESTINATION_TRIVIA:
      if (questionData.inputMode === "multiple-choice") {
        renderTriviaMCScreen(questionData);
      } else {
        renderTriviaFTScreen(questionData);
      }
      break;
    case ROUND_TYPES.MUSIC_ROUND:
      renderMusicScreen(questionData);
      break;
    case ROUND_TYPES.CLOSEST_WINS:
      renderClosestWinsScreen(question, questionData);
      break;
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

  // Flash animation on new clue.
  if (clueEl.dataset.lastClue !== clue) {
    clueEl.textContent = clue;
    clueEl.dataset.lastClue = clue;
    clueEl.classList.remove("is-new");
    void clueEl.offsetWidth; // force reflow to restart animation
    clueEl.classList.add("is-new");
  }

  // Stage indicator dots.
  const indicator = document.getElementById("wawgStageIndicator");
  indicator.innerHTML = "";
  const total = questionData.clues.length;
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("div");
    dot.className = "wawg-stage-dot" +
      (i < clueIndex ? " is-past" : i === clueIndex ? " is-active" : "");
    indicator.appendChild(dot);
  }

  document.getElementById("wawgInput").disabled = false;
  document.getElementById("wawgSubmitBtn").disabled = false;
  showScreen("screenWawg");
}

// ---------------------------------------------------------------------------
// Destination Trivia: multiple choice
// ---------------------------------------------------------------------------

function renderTriviaMCScreen(questionData) {
  const imgEl = document.getElementById("triviaMCImage");
  if (questionData.imageUrl) {
    imgEl.src = questionData.imageUrl;
    imgEl.style.display = "block";
  } else {
    imgEl.style.display = "none";
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

  // Immediately lock UI, mark selected visually.
  const btns = container.querySelectorAll(".mc-option-btn");
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i === selectedIdx) btn.classList.add("is-selected");
  });

  state.hasSubmitted = true;
  showSubmitted(`Option ${selectedIdx + 1}: "${questionData.options[selectedIdx]}"`);

  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId,
    String(selectedIdx)).catch(console.error);
}

// ---------------------------------------------------------------------------
// Destination Trivia: free text
// ---------------------------------------------------------------------------

function renderTriviaFTScreen(questionData) {
  const imgEl = document.getElementById("triviaFTImage");
  if (questionData.imageUrl) {
    imgEl.src = questionData.imageUrl;
    imgEl.style.display = "block";
  } else {
    imgEl.style.display = "none";
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

  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId, value)
    .catch(console.error);
}

// ---------------------------------------------------------------------------
// Where Are We Going submit
// ---------------------------------------------------------------------------

function handleWawgSubmit() {
  if (state.hasSubmitted) return;
  const value = document.getElementById("wawgInput").value.trim();
  if (!value) return;

  const clueIndex = latestQuestion?.clueIndex ?? 0;
  state.hasSubmitted = true;
  document.getElementById("wawgInput").disabled = true;
  document.getElementById("wawgSubmitBtn").disabled = true;
  showSubmitted(`"${value}"`);

  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId, value,
    { clueStageAtSubmit: clueIndex }).catch(console.error);
}

// ---------------------------------------------------------------------------
// Music Round
// ---------------------------------------------------------------------------

function renderMusicScreen(questionData) {
  const container = document.getElementById("musicBlanksContainer");
  container.innerHTML = "";

  (questionData.blanks || []).forEach((blank) => {
    const wrapper = document.createElement("div");
    wrapper.className = "answer-blank";
    const label = document.createElement("label");
    label.className = "answer-blank-label";
    label.textContent = blank.label || (blank.type === "artist" ? "Artist" : "Song Title");
    label.htmlFor = `music-blank-${blank.id}`;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "answer-text-input";
    input.id = `music-blank-${blank.id}`;
    input.dataset.blankId = blank.id;
    input.placeholder = blank.type === "artist" ? "Artist name…" : "Song title…";
    input.autocomplete = "off";
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
  });

  document.getElementById("musicSubmitBtn").disabled = false;
  showScreen("screenMusic");
}

function handleMusicSubmit(questionData) {
  if (state.hasSubmitted) return;

  const blanks = questionData?.blanks || [];
  const values = {};
  let anyFilled = false;
  blanks.forEach((blank) => {
    const input = document.getElementById(`music-blank-${blank.id}`);
    const val = input ? input.value.trim() : "";
    values[blank.id] = val;
    if (val) anyFilled = true;
  });

  if (!anyFilled) return;

  state.hasSubmitted = true;
  document.querySelectorAll("#musicBlanksContainer .answer-text-input")
    .forEach(inp => { inp.disabled = true; });
  document.getElementById("musicSubmitBtn").disabled = true;

  const echoText = blanks.map(b => values[b.id] ? `${b.label || b.type}: "${values[b.id]}"` : "")
    .filter(Boolean).join(" · ");
  showSubmitted(echoText);

  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId, values)
    .catch(console.error);
}

// ---------------------------------------------------------------------------
// Closest Wins
// ---------------------------------------------------------------------------

function renderClosestWinsScreen(questionState, questionData) {
  document.getElementById("cwPrompt").textContent = questionData.prompt;

  // Timer bar.
  clearInterval(state.cwTimerInterval);
  const totalSecs = questionData.timeLimitSeconds || 30;
  const startedAt = questionState.startedAt;
  const nowApprox = Date.now();
  const elapsed = startedAt ? Math.max(0, (nowApprox - startedAt) / 1000) : 0;
  let remaining = Math.max(0, totalSecs - elapsed);

  const bar = document.getElementById("cwTimerBar");
  bar.style.width = (remaining / totalSecs * 100) + "%";
  bar.classList.toggle("is-low", remaining < totalSecs * 0.25);

  state.cwTimerInterval = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    bar.style.width = (remaining / totalSecs * 100) + "%";
    bar.classList.toggle("is-low", remaining < totalSecs * 0.25);
    if (remaining <= 0) {
      clearInterval(state.cwTimerInterval);
      if (!state.hasSubmitted) {
        // Auto-submit whatever pin is placed (or nothing, if no pin).
        handleCWSubmit(questionData);
      }
    }
  }, 1000);

  // Map — initialise only once per question.
  if (!state.playerMap) {
    initPlayerMap(questionData);
  } else {
    // Reset marker from previous question.
    if (state.playerMarker) {
      state.playerMap.removeLayer(state.playerMarker);
      state.playerMarker = null;
    }
    state.playerMap.setView([20, 0], 2);
    setTimeout(() => state.playerMap.invalidateSize(), 100);
  }

  document.getElementById("cwSubmitBtn").disabled = true;
  document.getElementById("cwSubmitBtn").textContent = "Drop a pin first";
  showScreen("screenClosestWins");
}

function initPlayerMap(questionData) {
  // Blank tile layer — no place names, just geography. This matches
  // the show's map which shows shapes but not labels.
  const map = L.map("playerMap", { zoomControl: true }).setView([20, 0], 2);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap contributors © CARTO",
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  map.on("click", (e) => {
    if (state.hasSubmitted) return;
    const { lat, lng } = e.latlng;
    if (state.playerMarker) {
      state.playerMarker.setLatLng([lat, lng]);
    } else {
      state.playerMarker = L.marker([lat, lng]).addTo(map);
    }
    const btn = document.getElementById("cwSubmitBtn");
    btn.disabled = false;
    btn.textContent = "Submit pin";
    state.pendingLat = lat;
    state.pendingLng = lng;
  });

  state.playerMap = map;
  setTimeout(() => map.invalidateSize(), 150);
}

function handleCWSubmit(questionData) {
  if (state.hasSubmitted) return;
  if (!state.pendingLat && !state.pendingLng) return;

  clearInterval(state.cwTimerInterval);
  state.hasSubmitted = true;
  document.getElementById("cwSubmitBtn").disabled = true;

  const lat = state.pendingLat;
  const lng = state.pendingLng;
  showSubmitted(`Pin dropped at ${lat.toFixed(2)}°, ${lng.toFixed(2)}°`);

  submitAnswer(state.roomCode, state.currentQuestionId, state.playerId,
    { lat, lng }, { lat, lng }).catch(console.error);
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

function renderScoreboard(meta, isFinal) {
  document.getElementById("scoreboardTitle").textContent =
    isFinal ? "Final scores" : `After round ${(meta.currentRoundIndex ?? 0) + 1}`;

  const players = Object.entries(latestPlayers)
    .map(([id, p]) => ({ id, name: p.name, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score);

  const list = document.getElementById("scoreboardList");
  list.innerHTML = "";

  players.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "scoreboard-entry" + (p.id === state.playerId ? " is-you" : "");

    const rank = document.createElement("span");
    rank.className = "scoreboard-rank" +
      (idx === 0 ? " is-first" : idx === 1 ? " is-second" : idx === 2 ? " is-third" : "");
    rank.textContent = idx + 1;

    const name = document.createElement("span");
    name.className = "scoreboard-name";
    name.textContent = p.name + (p.id === state.playerId ? " (you)" : "");

    const score = document.createElement("span");
    score.className = "scoreboard-score";
    score.textContent = p.score + " pt" + (p.score === 1 ? "" : "s");

    li.appendChild(rank);
    li.appendChild(name);
    li.appendChild(score);
    list.appendChild(li);
  });

  showScreen("screenScoreboard");
}

// ---------------------------------------------------------------------------
// Final ceremony
// ---------------------------------------------------------------------------

function renderCeremony(meta) {
  const players = Object.entries(latestPlayers)
    .map(([id, p]) => ({ id, name: p.name, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score);

  if (players.length === 0) return;

  const winner = players[0];
  document.getElementById("ceremonyWinnerName").textContent = winner.name;
  document.getElementById("ceremonyWinnerScore").textContent =
    winner.score + " pt" + (winner.score === 1 ? "" : "s");

  // Check for tiebreak note from meta.
  const tieNote = document.getElementById("ceremonyTiebreakNote");
  if (meta.tiebreakResolved) {
    tieNote.textContent = "Won on tiebreak — fastest total answer time";
    tieNote.style.display = "block";
  } else {
    tieNote.style.display = "none";
  }

  showScreen("screenCeremony");
}

// ---------------------------------------------------------------------------
// Generic waiting
// ---------------------------------------------------------------------------

function showWaiting(title, subtitle) {
  document.getElementById("waitingTitle").textContent = title;
  document.getElementById("waitingSubtitle").textContent = subtitle;
  showScreen("screenWaiting");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  try {
    initFirebase();
  } catch (e) {
    showWaiting("Setup error", e.message);
    return;
  }

  // Wire up static event listeners.
  document.getElementById("joinBtn").addEventListener("click", handleJoin);
  document.getElementById("joinRoomCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleJoin();
  });
  document.getElementById("joinPlayerName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleJoin();
  });

  document.getElementById("wawgSubmitBtn").addEventListener("click", handleWawgSubmit);
  document.getElementById("wawgInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleWawgSubmit();
  });

  document.getElementById("triviaFTSubmitBtn").addEventListener("click", handleTriviaFTSubmit);
  document.getElementById("triviaFTInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleTriviaFTSubmit();
  });

  // Music submit needs current question data — wire via a closure that
  // reads latestQuiz/latestMeta at click time.
  document.getElementById("musicSubmitBtn").addEventListener("click", () => {
    if (!latestQuiz || !latestMeta) return;
    const round = latestQuiz.rounds[latestMeta.currentRoundIndex];
    const q = round?.questions[latestMeta.currentQuestionIndex];
    handleMusicSubmit(q);
  });

  document.getElementById("cwSubmitBtn").addEventListener("click", () => {
    if (!latestQuiz || !latestMeta) return;
    const round = latestQuiz.rounds[latestMeta.currentRoundIndex];
    const q = round?.questions[latestMeta.currentQuestionIndex];
    handleCWSubmit(q);
  });

  // Try silent rejoin from localStorage.
  const session = loadSession();
  if (session?.roomCode && session?.playerId) {
    const rejoined = await tryRejoin(session);
    if (rejoined) return;
  }

  // Fall through to the join screen.
  showScreen("screenJoin");
}

document.addEventListener("DOMContentLoaded", init);
