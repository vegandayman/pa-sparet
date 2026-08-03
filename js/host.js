// host.js
// Host view controller. Owns the game state machine, drives Firebase writes,
// and delegates all rendering to host-ui.js. The host is the sole writer of
// game state — players only read from Firebase and write their own answers.

import { initFirebase, ROOM_STATUS, createRoom, setRoomStatus,
  setCurrentRoundQuestion, setCurrentQuestion, updateCurrentQuestion,
  lockCurrentQuestion, revealCurrentQuestion, joinRoom, awardPoints,
  listenToMeta, listenToPlayers, listenToAnswersForQuestion,
  listenToCurrentQuestion, fetchAnswersForQuestions, fetchFinalGameData,
  hasRoundTypeBeenExplained, markRoundTypeExplained, roomExists,
  deleteRoom } from "./firebase-sync.js";

import { ROUND_TYPES, ROUND_TYPE_LABELS, validateQuiz,
  WHERE_ARE_WE_GOING_DEFAULT_POINTS, WHERE_ARE_WE_GOING_CLUE_COUNT }
  from "./quiz-schema.js";

import { scoreDestinationTrivia, scoreMusicRoundQuestion,
  scoreClosestWins, getWhereAreWeGoingPoints,
  isAnswerCorrect, resolveFinalStandings } from "./scoring.js";

import { createPlayer, play, pause, stop, destroyAll } from "./host-media.js";

import { showHostScreen, updateControlBar, renderLobby, renderTransitionCard,
  renderExplainer, renderWawgScreen, renderTriviaScreen, renderAnswerReview,
  renderMusicScreen, renderCWScreen, renderCWPins, updateCWTimer,
  renderRoundRecap, renderScoreboard, renderCeremony,
  renderQuizSummary } from "./host-ui.js";

// ---------------------------------------------------------------------------
// Explainer texts (same copy as player.js — single source ideally, but kept
// here too so host sees them and can read them aloud if needed)
// ---------------------------------------------------------------------------

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
    body: "A song will play on the big screen. Your job is to identify it — depending on the question, you might need to name the artist, the song title, or both. Type your answer into each box and submit. You get a point for every correct guess.",
  },
  [ROUND_TYPES.CLOSEST_WINS]: {
    title: "CLOSEST WINS",
    body: "You'll see a photo of a location somewhere in the world. Drop a pin on the map where you think it is before time runs out. Closest guess to the real location takes all the points.",
  },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let quiz = null;
let roomCode = null;
let hostId = null;

// Answers currently being listened to (for the active question).
let activeAnswerUnsub = null;
let activeAnswers = {};

// Closest wins map (Leaflet instance on the host screen).
let hostMap = null;
let hostMapMarkers = {};
let targetMarker = null;
let cwTimerInterval = null;

// Firebase listeners.
let unsubMeta = null;
let unsubPlayers = null;
let unsubCurrentQuestion = null;
let latestPlayers = {};
let latestMeta = null;
let latestCurrentQuestion = null;

const HOST_STORAGE_KEY = "po-sparet-host-session";

// ---------------------------------------------------------------------------
// Persistence
// Using sessionStorage (not localStorage) so the room is only rejoined
// within the same browser tab session — a new tab or window always gets
// a fresh room. localStorage was causing stale rooms to persist between games.
// ---------------------------------------------------------------------------

function saveHostSession() {
  try {
    sessionStorage.setItem(HOST_STORAGE_KEY, JSON.stringify({ roomCode, hostId }));
  } catch (e) { /* ignore */ }
}

function loadHostSession() {
  try {
    const raw = sessionStorage.getItem(HOST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearHostSession() {
  try { sessionStorage.removeItem(HOST_STORAGE_KEY); } catch (e) { /* ignore */ }
}

function getYTEmbedUrl(url) {
  if (!url) return "";
  const match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const id = match ? match[1] : "";
  return id ? `https://www.youtube.com/embed/${id}?autoplay=1` : "";
}

// ---------------------------------------------------------------------------
// Firebase listeners
// ---------------------------------------------------------------------------

function startListening() {
  if (unsubMeta) unsubMeta();
  if (unsubPlayers) unsubPlayers();
  if (unsubCurrentQuestion) unsubCurrentQuestion();

  unsubMeta = listenToMeta(roomCode, meta => {
    latestMeta = meta;
    syncControlBar(meta);
    // Re-render the active question screen if we're in QUESTION_ACTIVE state,
    // so a host page refresh correctly restores the current question view.
    if (meta?.status === ROOM_STATUS.QUESTION_ACTIVE && quiz && latestCurrentQuestion) {
      const round = quiz.rounds[meta.currentRoundIndex];
      const q = round?.questions[meta.currentQuestionIndex];
      if (q) renderQuestion(round, q, meta.currentRoundIndex, meta.currentQuestionIndex, gamePhase);
    }
  });
  unsubPlayers = listenToPlayers(roomCode, players => {
    latestPlayers = players || {};
    if (latestMeta?.status === ROOM_STATUS.LOBBY) {
      renderLobby(roomCode, latestPlayers);
    }
  });
  unsubCurrentQuestion = listenToCurrentQuestion(roomCode, cq => {
    latestCurrentQuestion = cq;
  });
}

function listenToActiveAnswers(questionId) {
  if (activeAnswerUnsub) activeAnswerUnsub();
  activeAnswers = {};
  activeAnswerUnsub = listenToAnswersForQuestion(roomCode, questionId, answers => {
    activeAnswers = answers || {};
    onAnswersUpdated();
  });
}

function onAnswersUpdated() {
  if (!latestMeta || !quiz) return;
  const round = quiz.rounds[latestMeta.currentRoundIndex];
  if (!round) return;
  const q = round.questions[latestMeta.currentQuestionIndex];
  if (!q) return;

  if (round.type === ROUND_TYPES.DESTINATION_TRIVIA) {
    renderAnswerReview("triviaAnswerReview", "triviaAnswerRows",
      activeAnswers, latestPlayers,
      (val) => scoreDestinationTrivia(q, val) > 0,
      (playerId, answer) => handleHostOverride(q, playerId, answer));
  }

  if (round.type === ROUND_TYPES.MUSIC_ROUND) {
    renderAnswerReview("musicAnswerReview", "musicAnswerRows",
      activeAnswers, latestPlayers, null,
      (playerId, answer) => handleMusicOverride(q, playerId, answer));
  }

  if (round.type === ROUND_TYPES.CLOSEST_WINS) {
    updateCWPinsOnMap(q);
  }
}

// ---------------------------------------------------------------------------
// Game flow state machine
// The host advances through states by pressing the Next button.
// Each call to advanceGame() moves to the next logical state.
// ---------------------------------------------------------------------------

let gamePhase = "pre-game"; // tracks host-side sub-state within Firebase statuses

async function advanceGame() {
  if (!quiz || !roomCode) return;

  const meta = latestMeta;
  const status = meta?.status || ROOM_STATUS.LOBBY;

  switch (status) {
    case ROOM_STATUS.LOBBY:
      await startFirstRound();
      break;

    case ROOM_STATUS.TRANSITION_CARD: {
      const round = quiz.rounds[meta.currentRoundIndex];
      const alreadyExplained = await hasRoundTypeBeenExplained(roomCode, round.type);
      if (alreadyExplained) {
        await startFirstQuestion(meta.currentRoundIndex);
      } else {
        await markRoundTypeExplained(roomCode, round.type);
        await setRoomStatus(roomCode, ROOM_STATUS.RULE_EXPLAINER);
        renderExplainer(round.type, ROUND_EXPLAINERS[round.type]);
        syncControlBar({ ...meta, status: ROOM_STATUS.RULE_EXPLAINER });
      }
      break;
    }

    case ROOM_STATUS.RULE_EXPLAINER:
      await startFirstQuestion(meta.currentRoundIndex);
      break;

    case ROOM_STATUS.QUESTION_ACTIVE: {
      const questionState = gamePhase;
      if (questionState === "active") {
        await lockAndScore();
      } else if (questionState === "locked") {
        await revealAnswer();
      } else if (questionState === "revealed") {
        await advanceToNextQuestion();
      }
      break;
    }

    case ROOM_STATUS.ROUND_RECAP:
      await showRoundScoreboard();
      break;

    case ROOM_STATUS.ROUND_SCOREBOARD:
      await startNextRoundOrEnd();
      break;

    case ROOM_STATUS.FINAL_CEREMONY:
      // Nothing to advance to — game is over.
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Round / question navigation
// ---------------------------------------------------------------------------

async function startFirstRound() {
  await setRoomStatus(roomCode, ROOM_STATUS.TRANSITION_CARD);
  await setCurrentRoundQuestion(roomCode, 0, 0);
  const round = quiz.rounds[0];
  renderTransitionCard(round, 0);
  syncControlBar({ status: ROOM_STATUS.TRANSITION_CARD, currentRoundIndex: 0 });
}

async function startFirstQuestion(roundIndex) {
  await startQuestion(roundIndex, 0);
}

async function startQuestion(roundIndex, questionIndex) {
  const round = quiz.rounds[roundIndex];
  const q = round.questions[questionIndex];

  await setCurrentRoundQuestion(roomCode, roundIndex, questionIndex);
  await setRoomStatus(roomCode, ROOM_STATUS.QUESTION_ACTIVE);

  const extra = {};
  if (round.type === ROUND_TYPES.WHERE_ARE_WE_GOING) {
    extra.clueIndex = 0;
  }

  await setCurrentQuestion(roomCode, q.id, round.type, extra, roundIndex, questionIndex);
  gamePhase = "active";

  listenToActiveAnswers(q.id);
  renderQuestion(round, q, roundIndex, questionIndex, "active");
  syncControlBar({ status: ROOM_STATUS.QUESTION_ACTIVE, currentRoundIndex: roundIndex });
}

async function lockAndScore() {
  if (!latestMeta || !quiz) return;
  const round = quiz.rounds[latestMeta.currentRoundIndex];
  const q = round.questions[latestMeta.currentQuestionIndex];

  await lockCurrentQuestion(roomCode);
  gamePhase = "locked";

  // Score all submitted answers automatically.
  await scoreAllAnswers(round, q);

  renderQuestion(round, q, latestMeta.currentRoundIndex,
    latestMeta.currentQuestionIndex, "locked");
  syncControlBar({ ...latestMeta, status: ROOM_STATUS.QUESTION_ACTIVE });
}

async function revealAnswer() {
  if (!latestMeta || !quiz) return;
  const round = quiz.rounds[latestMeta.currentRoundIndex];
  const q = round.questions[latestMeta.currentQuestionIndex];

  await revealCurrentQuestion(roomCode);
  gamePhase = "revealed";

  // Stop any media.
  if (round.type === ROUND_TYPES.WHERE_ARE_WE_GOING) stop("wawgYTPlayer");
  if (round.type === ROUND_TYPES.MUSIC_ROUND) stop("musicYTPlayer");
  if (round.type === ROUND_TYPES.CLOSEST_WINS) {
    clearInterval(cwTimerInterval);
    revealTargetOnMap(q);
  }

  renderQuestion(round, q, latestMeta.currentRoundIndex,
    latestMeta.currentQuestionIndex, "revealed");
  syncControlBar({ ...latestMeta, status: ROOM_STATUS.QUESTION_ACTIVE });
}

async function advanceToNextQuestion() {
  if (!latestMeta || !quiz) return;
  const roundIndex = latestMeta.currentRoundIndex;
  const round = quiz.rounds[roundIndex];
  const nextQIdx = latestMeta.currentQuestionIndex + 1;

  if (nextQIdx < round.questions.length) {
    await startQuestion(roundIndex, nextQIdx);
  } else {
    // End of round — show recap.
    await showRoundRecap(roundIndex);
  }
}

async function showRoundRecap(roundIndex) {
  const round = quiz.rounds[roundIndex];
  const questionIds = round.questions.map(q => q.id);
  const allAnswers = await fetchAnswersForQuestions(roomCode, questionIds);
  await setRoomStatus(roomCode, ROOM_STATUS.ROUND_RECAP);
  renderRoundRecap(round.title, round.questions, allAnswers, latestPlayers);
  syncControlBar({ status: ROOM_STATUS.ROUND_RECAP, currentRoundIndex: roundIndex });
}

async function showRoundScoreboard() {
  if (!latestMeta) return;
  await setRoomStatus(roomCode, ROOM_STATUS.ROUND_SCOREBOARD);
  const roundIndex = latestMeta.currentRoundIndex;
  renderScoreboard(
    `After Round ${roundIndex + 1}`,
    latestPlayers
  );
  syncControlBar({ status: ROOM_STATUS.ROUND_SCOREBOARD, currentRoundIndex: roundIndex });
}

async function startNextRoundOrEnd() {
  if (!latestMeta || !quiz) return;
  const nextRoundIndex = latestMeta.currentRoundIndex + 1;

  if (nextRoundIndex < quiz.rounds.length) {
    await setCurrentRoundQuestion(roomCode, nextRoundIndex, 0);
    await setRoomStatus(roomCode, ROOM_STATUS.TRANSITION_CARD);
    renderTransitionCard(quiz.rounds[nextRoundIndex], nextRoundIndex);
    syncControlBar({ status: ROOM_STATUS.TRANSITION_CARD, currentRoundIndex: nextRoundIndex });
  } else {
    await showFinalCeremony();
  }
}

async function showFinalCeremony() {
  const { allAnswers, questionStartTimes } = await fetchFinalGameData(roomCode);
  const playersList = Object.entries(latestPlayers).map(([id, p]) => ({
    playerId: id, name: p.name, score: p.score || 0
  }));
  const { needsTiebreak, standings } = resolveFinalStandings(
    playersList, allAnswers, questionStartTimes
  );

  await setRoomStatus(roomCode, ROOM_STATUS.FINAL_CEREMONY);
  renderCeremony(standings, needsTiebreak);
  syncControlBar({ status: ROOM_STATUS.FINAL_CEREMONY });
}

// ---------------------------------------------------------------------------
// Question rendering dispatch
// ---------------------------------------------------------------------------

function renderQuestion(round, q, roundIndex, questionIndex, state) {
  destroyAllMedia();

  switch (round.type) {
    case ROUND_TYPES.WHERE_ARE_WE_GOING: {
      const clueIndex = latestCurrentQuestion?.clueIndex ?? 0;
      renderWawgScreen(q, clueIndex, state);
      if (state === "active") {
        createPlayer("wawgYTPlayer", q.youtubeUrl, { autoplay: false })
          .catch(err => console.warn("YT player error:", err));
      }
      break;
    }
    case ROUND_TYPES.DESTINATION_TRIVIA:
      renderTriviaScreen(q, state, getYTEmbedUrl);
      if (state === "locked" || state === "revealed") {
        document.getElementById("triviaAnswerReview").style.display = "";
      }
      break;
    case ROUND_TYPES.MUSIC_ROUND:
      renderMusicScreen(q, state);
      if (state === "active") {
        createPlayer("musicYTPlayer", q.youtubeUrl, { autoplay: true })
          .catch(err => console.warn("YT player error:", err));
      }
      if (state === "locked" || state === "revealed") {
        document.getElementById("musicAnswerReview").style.display = "";
      }
      break;
    case ROUND_TYPES.CLOSEST_WINS:
      renderCWScreen(q, state);
      if (state === "active" || state === "locked") {
        // Show image, hide map
        const imgView = document.getElementById("cwImageView");
        const mapView = document.getElementById("cwMapView");
        if (imgView) imgView.style.display = "flex";
        if (mapView) mapView.style.display = "none";
        if (q.imageUrl) {
          const img = document.getElementById("cwHostImage");
          if (img) { img.src = q.imageUrl; }
        }
        if (state === "active") startCWTimer(q.timeLimitSeconds);
      } else if (state === "revealed") {
        // Swap to map view
        const imgView = document.getElementById("cwImageView");
        const mapView = document.getElementById("cwMapView");
        if (imgView) imgView.style.display = "none";
        if (mapView) { mapView.style.display = "flex"; }
        // Copy prompt to reveal panel
        const revealPrompt = document.getElementById("cwHostPromptReveal");
        if (revealPrompt) revealPrompt.textContent = q.caption || "Where was this photo taken?";
        initOrResetHostMap(q, state);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Where Are We Going: clue reveal
// ---------------------------------------------------------------------------

async function revealNextClue() {
  if (!latestMeta || !quiz) return;
  const round = quiz.rounds[latestMeta.currentRoundIndex];
  if (round.type !== ROUND_TYPES.WHERE_ARE_WE_GOING) return;

  const currentClue = latestCurrentQuestion?.clueIndex ?? 0;
  const q = round.questions[latestMeta.currentQuestionIndex];
  const nextClue = Math.min(currentClue + 1, q.clues.length - 1);

  if (nextClue === currentClue) return; // already on last clue, nothing to do

  await updateCurrentQuestion(roomCode, { clueIndex: nextClue });
  // latestCurrentQuestion will update via the listener, but re-render
  // immediately so the host sees the change without waiting for the round trip.
  renderWawgScreen(q, nextClue, gamePhase === "revealed" ? "revealed" : "active");
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

async function scoreAllAnswers(round, q) {
  const promises = Object.entries(activeAnswers).map(async ([playerId, answer]) => {
    if (answer.pointsAwarded !== null) return; // already scored

    let points = 0;
    switch (round.type) {
      case ROUND_TYPES.WHERE_ARE_WE_GOING: {
        const isCorrect = isAnswerCorrect(answer.value, q.answer, q.acceptedAnswers);
        if (isCorrect) {
          points = getWhereAreWeGoingPoints(
            answer.clueStageAtSubmit ?? 0,
            q.pointsPerStage || WHERE_ARE_WE_GOING_DEFAULT_POINTS
          );
        }
        break;
      }
      case ROUND_TYPES.DESTINATION_TRIVIA:
        points = scoreDestinationTrivia(q, answer.value);
        break;
      case ROUND_TYPES.MUSIC_ROUND: {
        const { totalPoints } = scoreMusicRoundQuestion(q, answer.value || {});
        points = totalPoints;
        break;
      }
      case ROUND_TYPES.CLOSEST_WINS:
        // CW is scored as a group below.
        return;
    }
    await awardPoints(roomCode, q.id, playerId, points);
  });

  await Promise.all(promises);

  // Closest Wins: score as a group (winner-takes-all).
  if (round.type === ROUND_TYPES.CLOSEST_WINS) {
    const guesses = Object.entries(activeAnswers)
      .filter(([, a]) => a.value?.lat != null)
      .map(([playerId, a]) => ({ playerId, lat: a.value.lat, lng: a.value.lng }));
    const { results } = scoreClosestWins(guesses, q.targetLat, q.targetLng, q.points);
    await Promise.all(results.map(r => awardPoints(roomCode, q.id, r.playerId, r.points)));
    renderCWPins(results, latestPlayers);
  }
}

// ---------------------------------------------------------------------------
// Host override (manual point award)
// ---------------------------------------------------------------------------

async function handleHostOverride(q, playerId, answer) {
  await awardPoints(roomCode, q.id, playerId, q.points ?? 1, true);
}

async function handleMusicOverride(q, playerId, answer) {
  // Award 1 point for each blank that hasn't already been scored.
  const existing = answer.pointsAwarded || 0;
  const maxPoints = (q.blanks || []).reduce((sum, b) => sum + b.points, 0);
  const delta = maxPoints - existing;
  if (delta > 0) {
    await awardPoints(roomCode, q.id, playerId, delta, true);
  }
}

// ---------------------------------------------------------------------------
// Closest Wins host map
// ---------------------------------------------------------------------------

function initOrResetHostMap(q, state) {
  // Defer map init until the map container is visible — Leaflet won't
  // render correctly into a hidden element.
  setTimeout(() => {
    if (!hostMap) {
      hostMap = L.map("hostMap").setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 18,
      }).addTo(hostMap);
    } else {
      // Clear all old markers.
      Object.values(hostMapMarkers).forEach(m => hostMap.removeLayer(m));
      hostMapMarkers = {};
      if (targetMarker) { hostMap.removeLayer(targetMarker); targetMarker = null; }
      hostMap.setView([20, 0], 2);
    }
    hostMap.invalidateSize();

    // Place any pins already submitted before reveal.
    if (latestCurrentQuestion) updateCWPinsOnMap(q);
    if (state === "revealed") revealTargetOnMap(q);
  }, 150);
}

function revealTargetOnMap(q) {
  if (!hostMap) return;
  if (targetMarker) hostMap.removeLayer(targetMarker);
  targetMarker = L.marker([q.targetLat, q.targetLng], {
    icon: L.divIcon({
      className: "",
      html: '<div style="font-size:1.5rem;transform:translate(-50%,-100%)">📍</div>',
      iconSize: [30, 30],
    })
  }).addTo(hostMap);
  hostMap.flyTo([q.targetLat, q.targetLng], 6, { duration: 1.5 });
}

function updateCWPinsOnMap(q) {
  if (!hostMap) return;
  const playerIds = Object.keys(activeAnswers);
  playerIds.forEach(playerId => {
    const answer = activeAnswers[playerId];
    if (!answer?.value?.lat) return;
    const player = latestPlayers[playerId];
    if (!player) return;
    if (hostMapMarkers[playerId]) {
      hostMapMarkers[playerId].setLatLng([answer.value.lat, answer.value.lng]);
    } else {
      hostMapMarkers[playerId] = L.marker([answer.value.lat, answer.value.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="background:var(--color-brass);color:#14171c;font-size:0.65rem;font-weight:700;padding:2px 4px;border-radius:3px;white-space:nowrap;transform:translate(-50%,-100%)">${player.name}</div>`,
          iconSize: [60, 24],
        })
      }).addTo(hostMap);
    }
  });
}

// ---------------------------------------------------------------------------
// Closest Wins timer
// ---------------------------------------------------------------------------

function startCWTimer(totalSeconds) {
  clearInterval(cwTimerInterval);
  let remaining = totalSeconds;
  updateCWTimer(remaining);
  cwTimerInterval = setInterval(async () => {
    remaining--;
    updateCWTimer(remaining);
    if (remaining <= 0) {
      clearInterval(cwTimerInterval);
      await lockAndScore();
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// Control bar sync
// ---------------------------------------------------------------------------

function syncControlBar(meta) {
  if (!meta) return;
  const status = meta.status;
  const roundIndex = meta.currentRoundIndex ?? 0;

  let nextLabel = "Next →";
  let statusLabel = "";
  let showRevealClue = false;
  let showLock = false;
  let showRevealAnswer = false;

  switch (status) {
    case ROOM_STATUS.LOBBY:
      nextLabel = quiz ? "Start game →" : "Load a quiz first";
      statusLabel = "Lobby";
      break;
    case ROOM_STATUS.TRANSITION_CARD:
      nextLabel = "Continue →";
      statusLabel = `Round ${roundIndex + 1}`;
      break;
    case ROOM_STATUS.RULE_EXPLAINER:
      nextLabel = "Start round →";
      statusLabel = "Rules";
      break;
    case ROOM_STATUS.QUESTION_ACTIVE:
      statusLabel = `Round ${roundIndex + 1} · Q${(meta.currentQuestionIndex ?? 0) + 1}`;
      if (gamePhase === "active") {
        nextLabel = "Lock answers";
        showLock = true;
        if (quiz?.rounds[roundIndex]?.type === ROUND_TYPES.WHERE_ARE_WE_GOING) {
          showRevealClue = true;
        }
      } else if (gamePhase === "locked") {
        nextLabel = "Reveal answer →";
        showRevealAnswer = true;
      } else {
        nextLabel = "Next question →";
      }
      break;
    case ROOM_STATUS.ROUND_RECAP:
      nextLabel = "Show scoreboard →";
      statusLabel = "Recap";
      break;
    case ROOM_STATUS.ROUND_SCOREBOARD:
      const isLastRound = quiz && roundIndex >= quiz.rounds.length - 1;
      nextLabel = isLastRound ? "Final results →" : "Next round →";
      statusLabel = "Scoreboard";
      break;
    case ROOM_STATUS.FINAL_CEREMONY:
      nextLabel = "—";
      statusLabel = "Game over";
      break;
  }

  updateControlBar({
    roomCode,
    statusLabel,
    nextLabel,
    nextDisabled: status === ROOM_STATUS.FINAL_CEREMONY || (!quiz && status === ROOM_STATUS.LOBBY),
    showRevealClue,
    showLock,
    showRevealAnswer,
  });
}

// ---------------------------------------------------------------------------
// Media cleanup
// ---------------------------------------------------------------------------

function destroyAllMedia() {
  destroyAll();
  clearInterval(cwTimerInterval);
}

// ---------------------------------------------------------------------------
// Quiz loading
// ---------------------------------------------------------------------------

function handleQuizFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const { valid, errors } = validateQuiz(parsed);
      if (!valid) {
        alert("Quiz has validation errors:\n" + errors.join("\n"));
        return;
      }
      quiz = parsed;
      renderQuizSummary(quiz);
      syncControlBar(latestMeta || { status: ROOM_STATUS.LOBBY });
    } catch (e) {
      alert("Could not parse quiz file: " + e.message);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

// ---------------------------------------------------------------------------
// New room (reset between games)
// ---------------------------------------------------------------------------

async function handleNewRoom() {
  if (!confirm("Start a new room? This will end the current game for all players.")) return;
  try {
    if (roomCode) await deleteRoom(roomCode);
  } catch (e) { /* ignore if already gone */ }
  clearHostSession();
  if (unsubMeta) { unsubMeta(); unsubMeta = null; }
  if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
  if (unsubCurrentQuestion) { unsubCurrentQuestion(); unsubCurrentQuestion = null; }
  if (activeAnswerUnsub) { activeAnswerUnsub(); activeAnswerUnsub = null; }
  destroyAllMedia();
  quiz = null;
  roomCode = null;
  latestMeta = null;
  latestPlayers = {};
  latestCurrentQuestion = null;
  activeAnswers = {};
  gamePhase = "pre-game";

  try {
    roomCode = await createRoom(null, hostId);
    saveHostSession();
    startListening();
    showHostScreen("hostScreenLobby");
    renderLobby(roomCode, {});
    renderQuizSummary(null);
    syncControlBar({ status: ROOM_STATUS.LOBBY });
  } catch (e) {
    console.error("Failed to create new room:", e);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  try {
    initFirebase();
  } catch (e) {
    console.error("Firebase init error:", e);
    showHostScreen("hostScreenLobby");
    document.getElementById("hostLobbyCode").textContent = "Setup error";
    document.querySelector(".lobby-join-instruction").textContent = e.message;
    return;
  }

  // Generate or restore host identity.
  const session = loadHostSession();
  hostId = session?.hostId || ("host_" + Math.random().toString(36).slice(2, 10));

  // Wire up control buttons.
  document.getElementById("hostNextBtn").addEventListener("click", advanceGame);
  document.getElementById("hostRevealClueBtn").addEventListener("click", revealNextClue);
  document.getElementById("hostLockBtn").addEventListener("click", lockAndScore);
  document.getElementById("hostRevealAnswerBtn").addEventListener("click", revealAnswer);
  document.getElementById("hostLoadQuizBtn").addEventListener("click", () => {
    document.getElementById("hostQuizFileInput").click();
  });
  document.getElementById("hostQuizFileInput").addEventListener("change", handleQuizFile);
  document.getElementById("hostNewRoomBtn").addEventListener("click", handleNewRoom);

  // Try to rejoin an existing room (host browser refresh mid-game).
  if (session?.roomCode) {
    const exists = await roomExists(session.roomCode);
    if (exists) {
      roomCode = session.roomCode;
      startListening();
      showHostScreen("hostScreenLobby");
      renderLobby(roomCode, {});
      syncControlBar({ status: ROOM_STATUS.LOBBY });
      return;
    }
  }

  // Create a fresh room.
  try {
    roomCode = await createRoom(null, hostId);
    saveHostSession();
    startListening();
    showHostScreen("hostScreenLobby");
    renderLobby(roomCode, {});
    syncControlBar({ status: ROOM_STATUS.LOBBY });
  } catch (e) {
    console.error("Failed to create room:", e);
    showHostScreen("hostScreenLobby");
    document.getElementById("hostLobbyCode").textContent = "Error";
    document.querySelector(".lobby-join-instruction").textContent =
      "Could not create room: " + e.message + " — check the console for details.";
  }
}

document.addEventListener("DOMContentLoaded", init);
