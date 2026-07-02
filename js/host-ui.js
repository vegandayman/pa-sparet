// host-ui.js
// Pure rendering functions for the host view. No Firebase, no state.
// host.js owns all state and calls these to update the DOM.

import { ROUND_TYPES, ROUND_TYPE_LABELS } from "./quiz-schema.js";
import { WHERE_ARE_WE_GOING_DEFAULT_POINTS } from "./quiz-schema.js";

const ROUND_TYPE_ICONS = {
  [ROUND_TYPES.WHERE_ARE_WE_GOING]: "🚂",
  [ROUND_TYPES.DESTINATION_TRIVIA]: "❓",
  [ROUND_TYPES.MUSIC_ROUND]: "🎵",
  [ROUND_TYPES.CLOSEST_WINS]: "📍",
};

// ---------------------------------------------------------------------------
// Screen switching
// ---------------------------------------------------------------------------

export function showHostScreen(id) {
  document.querySelectorAll(".host-screen")
    .forEach(el => el.classList.remove("is-active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("is-active");
}

// ---------------------------------------------------------------------------
// Control bar
// ---------------------------------------------------------------------------

export function updateControlBar({ roomCode, statusLabel, nextLabel, nextDisabled,
  showPrev, showRevealClue, showLock, showRevealAnswer }) {
  document.getElementById("controlBarRoomCode").textContent = roomCode || "—";
  document.getElementById("controlBarStatus").textContent = statusLabel || "";

  const nextBtn = document.getElementById("hostNextBtn");
  nextBtn.textContent = nextLabel || "Next";
  nextBtn.disabled = !!nextDisabled;

  const prevBtn = document.getElementById("hostPrevBtn");
  prevBtn.style.display = showPrev ? "" : "none";

  document.getElementById("hostRevealClueBtn").style.display = showRevealClue ? "" : "none";
  document.getElementById("hostLockBtn").style.display = showLock ? "" : "none";
  document.getElementById("hostRevealAnswerBtn").style.display = showRevealAnswer ? "" : "none";
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export function renderLobby(roomCode, players) {
  document.getElementById("hostLobbyCode").textContent = roomCode || "—";
  const list = document.getElementById("hostPlayerList");
  list.innerHTML = "";
  Object.values(players || {}).forEach(p => {
    const chip = document.createElement("div");
    chip.className = "lobby-player-chip" + (p.connected === false ? " is-disconnected" : "");
    const dot = document.createElement("span");
    dot.className = "connected-dot";
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(p.name));
    list.appendChild(chip);
  });
}

// ---------------------------------------------------------------------------
// Quiz summary (shown in lobby after a quiz is loaded)
// ---------------------------------------------------------------------------

export function renderQuizSummary(quiz) {
  const el = document.getElementById("lobbyQuizSummary");
  if (!el) return;

  if (!quiz) {
    el.style.display = "none";
    return;
  }

  const totalQuestions = quiz.rounds.reduce((sum, r) => sum + r.questions.length, 0);

  el.innerHTML = "";
  el.style.display = "";

  const title = document.createElement("div");
  title.className = "quiz-summary-title";
  title.textContent = quiz.title;
  el.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "quiz-summary-meta";
  meta.textContent = `${quiz.rounds.length} round${quiz.rounds.length === 1 ? "" : "s"} · ${totalQuestions} question${totalQuestions === 1 ? "" : "s"} total`;
  el.appendChild(meta);

  const roundsEl = document.createElement("div");
  roundsEl.className = "quiz-summary-rounds";

  quiz.rounds.forEach((round, idx) => {
    const chip = document.createElement("div");
    chip.className = "quiz-summary-round-chip";

    const num = document.createElement("span");
    num.className = "chip-num";
    num.textContent = `R${idx + 1}`;

    const icon = document.createElement("span");
    icon.textContent = ROUND_TYPE_ICONS[round.type] || "❓";

    const name = document.createElement("span");
    name.textContent = round.title;

    const qs = document.createElement("span");
    qs.className = "chip-qs";
    qs.textContent = `×${round.questions.length}`;

    chip.appendChild(num);
    chip.appendChild(icon);
    chip.appendChild(name);
    chip.appendChild(qs);
    roundsEl.appendChild(chip);
  });

  el.appendChild(roundsEl);
}

// ---------------------------------------------------------------------------
// Transition card
// ---------------------------------------------------------------------------

export function renderTransitionCard(round, roundIndex) {
  document.getElementById("hostTransitionIcon").textContent =
    ROUND_TYPE_ICONS[round.type] || "❓";
  document.getElementById("hostTransitionRoundNum").textContent =
    `Round ${roundIndex + 1}`;
  document.getElementById("hostTransitionTitle").textContent = round.title;
  showHostScreen("hostScreenTransition");
}

// ---------------------------------------------------------------------------
// Rule explainer
// ---------------------------------------------------------------------------

export function renderExplainer(roundType, explainerText) {
  document.getElementById("hostExplainerTitle").textContent =
    explainerText.title || ROUND_TYPE_LABELS[roundType];
  document.getElementById("hostExplainerBody").textContent =
    explainerText.body || "";
  showHostScreen("hostScreenExplainer");
}

// ---------------------------------------------------------------------------
// Where Are We Going
// ---------------------------------------------------------------------------

export function renderWawgScreen(question, clueIndex, state) {
  const points = (question.pointsPerStage || WHERE_ARE_WE_GOING_DEFAULT_POINTS);
  const cluesList = document.getElementById("wawgCluesList");
  cluesList.innerHTML = "";

  question.clues.forEach((clue, i) => {
    const el = document.createElement("div");
    el.className = "wawg-host-clue" +
      (i < clueIndex ? " is-revealed" : i === clueIndex ? " is-current" : "");
    const pts = document.createElement("span");
    pts.className = "wawg-clue-pts";
    pts.textContent = points[i] + " pts";
    const text = document.createElement("span");
    text.textContent = i <= clueIndex ? clue : "···";
    el.appendChild(pts);
    el.appendChild(text);
    cluesList.appendChild(el);
  });

  // Answer reveal (shown after host clicks Reveal Answer).
  const revealEl = document.getElementById("wawgAnswerReveal");
  if (state === "revealed") {
    revealEl.style.display = "";
    document.getElementById("wawgAnswerText").textContent = question.answer;
  } else {
    revealEl.style.display = "none";
  }

  showHostScreen("hostScreenWawg");
}

// ---------------------------------------------------------------------------
// Destination Trivia
// ---------------------------------------------------------------------------

export function renderTriviaScreen(question, state, getYTEmbedUrl) {
  // Image / video clue
  const imgEl = document.getElementById("hostTriviaImage");
  const videoContainer = document.getElementById("hostTriviaVideoContainer");

  if (question.videoUrl && videoContainer) {
    const iframe = videoContainer.querySelector("iframe") ||
      (() => {
        const f = document.createElement("iframe");
        f.setAttribute("frameborder", "0");
        f.setAttribute("allowfullscreen", "");
        f.setAttribute("allow", "autoplay");
        f.style.cssText = "width:100%;aspect-ratio:16/9;border-radius:var(--radius-lg);";
        videoContainer.appendChild(f);
        return f;
      })();
    iframe.src = getYTEmbedUrl(question.videoUrl);
    videoContainer.style.display = "";
    imgEl.style.display = "none";
  } else if (question.imageUrl) {
    imgEl.src = question.imageUrl;
    imgEl.style.display = "";
    if (videoContainer) videoContainer.style.display = "none";
  } else {
    imgEl.style.display = "none";
    if (videoContainer) videoContainer.style.display = "none";
  }

  // Prompt
  document.getElementById("hostTriviaPrompt").textContent = question.prompt;

  // MC options
  const mcContainer = document.getElementById("hostTriviaMCOptions");
  if (question.inputMode === "multiple-choice") {
    mcContainer.style.display = "";
    mcContainer.innerHTML = "";
    const letters = ["A", "B", "C", "D"];
    (question.options || []).forEach((opt, i) => {
      const el = document.createElement("div");
      el.className = "trivia-mc-option" +
        (state === "revealed"
          ? (i === question.correctOption ? " is-correct" : " is-incorrect")
          : "");
      const letter = document.createElement("span");
      letter.className = "trivia-mc-letter";
      letter.textContent = letters[i];
      el.appendChild(letter);
      el.appendChild(document.createTextNode(opt));
      mcContainer.appendChild(el);
    });
  } else {
    mcContainer.style.display = "none";
  }

  showHostScreen("hostScreenTrivia");
}

// ---------------------------------------------------------------------------
// Answer review panel (shown after locking, for host override)
// ---------------------------------------------------------------------------

export function renderAnswerReview(panelId, rowsId, answers, players,
  correctChecker, onOverride) {
  const panel = document.getElementById(panelId);
  const rowsEl = document.getElementById(rowsId);
  if (!panel || !rowsEl) return;

  panel.style.display = "";
  rowsEl.innerHTML = "";

  Object.entries(answers || {}).forEach(([playerId, answer]) => {
    const player = players[playerId];
    if (!player) return;

    const row = document.createElement("div");
    row.className = "answer-row";

    const name = document.createElement("span");
    name.className = "answer-row-name";
    name.textContent = player.name;

    const value = document.createElement("span");
    value.className = "answer-row-value";
    value.textContent = formatAnswerValue(answer.value);

    const status = document.createElement("span");
    status.className = "answer-row-status";

    if (answer.hostOverride) {
      status.className += " is-override";
      status.textContent = "override ✓";
    } else if (answer.pointsAwarded > 0) {
      status.className += " is-correct";
      status.textContent = `+${answer.pointsAwarded} ✓`;
    } else if (answer.pointsAwarded === 0) {
      const isCorrect = correctChecker ? correctChecker(answer.value) : false;
      if (isCorrect) {
        status.className += " is-correct";
        status.textContent = "correct";
      } else {
        status.className += " is-wrong";
        status.textContent = "wrong";
      }
    } else {
      status.className += " is-wrong";
      status.textContent = "pending";
    }

    row.appendChild(name);
    row.appendChild(value);
    row.appendChild(status);

    // Override button — only shown for answers not already awarded points.
    if (answer.pointsAwarded === null || answer.pointsAwarded === 0) {
      const overrideBtn = document.createElement("button");
      overrideBtn.className = "btn btn-secondary override-btn";
      overrideBtn.textContent = "Award point";
      overrideBtn.addEventListener("click", () => {
        overrideBtn.disabled = true;
        onOverride(playerId, answer);
      });
      row.appendChild(overrideBtn);
    }

    rowsEl.appendChild(row);
  });
}

function formatAnswerValue(value) {
  if (!value) return "(no answer)";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object") {
    // Music round: { blankId: value } or CW: { lat, lng }
    if ("lat" in value) return `📍 ${Number(value.lat).toFixed(2)}°, ${Number(value.lng).toFixed(2)}°`;
    return Object.values(value).filter(Boolean).join(" · ");
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Music Round
// ---------------------------------------------------------------------------

export function renderMusicScreen(question, state) {
  const container = document.getElementById("musicBlanksHost");
  container.innerHTML = "";

  (question.blanks || []).forEach(blank => {
    const el = document.createElement("div");
    el.className = "music-blank-host";
    const label = document.createElement("div");
    label.className = "music-blank-host-label";
    label.textContent = blank.label || (blank.type === "artist" ? "Artist" : "Song Title");
    const answer = document.createElement("div");
    answer.className = "music-blank-host-answer" + (state !== "revealed" ? " is-hidden" : "");
    answer.textContent = state === "revealed" ? blank.answer : blank.answer;
    el.appendChild(label);
    el.appendChild(answer);
    container.appendChild(el);
  });

  showHostScreen("hostScreenMusic");
}

// ---------------------------------------------------------------------------
// Closest Wins
// ---------------------------------------------------------------------------

export function renderCWScreen(question) {
  document.getElementById("cwHostPrompt").textContent =
    question.caption || "Where was this photo taken?";
  showHostScreen("hostScreenCW");
}

export function renderCWPins(results, players) {
  const list = document.getElementById("cwPinsList");
  list.innerHTML = "";
  (results || [])
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .forEach(r => {
      const player = players[r.playerId];
      if (!player) return;
      const el = document.createElement("div");
      el.className = "cw-pin-entry" + (r.points > 0 ? " is-winner" : "");
      const name = document.createElement("span");
      name.className = "cw-pin-name";
      name.textContent = player.name + (r.points > 0 ? " 🏆" : "");
      const dist = document.createElement("span");
      dist.className = "cw-pin-dist";
      dist.textContent = r.distanceKm < 1
        ? `${Math.round(r.distanceKm * 1000)} m`
        : `${r.distanceKm.toFixed(1)} km`;
      el.appendChild(name);
      el.appendChild(dist);
      list.appendChild(el);
    });
}

export function updateCWTimer(seconds) {
  const el = document.getElementById("cwHostTimer");
  if (!el) return;
  el.textContent = String(Math.max(0, Math.ceil(seconds))).padStart(2, "0");
  el.classList.toggle("is-low", seconds <= 10);
}

// ---------------------------------------------------------------------------
// Round recap
// ---------------------------------------------------------------------------

export function renderRoundRecap(roundTitle, questions, allAnswers, players) {
  document.getElementById("recapTitle").textContent =
    `Round recap — ${roundTitle}`;
  const content = document.getElementById("recapContent");
  content.innerHTML = "";

  questions.forEach(q => {
    const answers = allAnswers[q.id] || {};
    const hasAnswers = Object.keys(answers).length > 0;
    if (!hasAnswers) return;

    const block = document.createElement("div");
    block.className = "recap-question-block";

    const prompt = document.createElement("div");
    prompt.className = "recap-question-prompt";
    prompt.textContent = getQuestionLabel(q);
    block.appendChild(prompt);

    const answerReview = document.createElement("div");
    Object.entries(answers).forEach(([playerId, answer]) => {
      const player = players[playerId];
      if (!player) return;
      const row = document.createElement("div");
      row.className = "answer-row";
      const name = document.createElement("span");
      name.className = "answer-row-name";
      name.textContent = player.name;
      const value = document.createElement("span");
      value.className = "answer-row-value";
      value.textContent = formatAnswerValue(answer.value);
      row.appendChild(name);
      row.appendChild(value);
      answerReview.appendChild(row);
    });
    block.appendChild(answerReview);
    content.appendChild(block);
  });

  showHostScreen("hostScreenRecap");
}

function getQuestionLabel(q) {
  if (q.prompt) return q.prompt;
  if (q.answer) return `Answer: ${q.answer}`;
  if (q.blanks) return q.blanks.map(b => b.answer).join(" / ");
  if (q.imageUrl) return "📷 Photo question";
  return "Question";
}

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

export function renderScoreboard(title, players, highlightId) {
  document.getElementById("scoreboardHostTitle").textContent = title;
  const list = document.getElementById("scoreboardHostList");
  list.innerHTML = "";

  const sorted = Object.entries(players || {})
    .map(([id, p]) => ({ id, name: p.name, score: p.score || 0 }))
    .sort((a, b) => b.score - a.score);

  sorted.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "scoreboard-host-entry" +
      (idx === 0 ? " is-top" : "") +
      (p.id === highlightId ? " is-you" : "");
    li.style.animationDelay = `${idx * 80}ms`;

    const rank = document.createElement("span");
    rank.className = "scoreboard-host-rank" +
      (idx === 0 ? " is-first" : idx === 1 ? " is-second" : idx === 2 ? " is-third" : "");
    rank.textContent = idx + 1;

    const name = document.createElement("span");
    name.className = "scoreboard-host-name";
    name.textContent = p.name;

    const score = document.createElement("span");
    score.className = "scoreboard-host-score";
    score.textContent = `${p.score} pt${p.score === 1 ? "" : "s"}`;

    li.appendChild(rank);
    li.appendChild(name);
    li.appendChild(score);
    list.appendChild(li);
  });

  showHostScreen("hostScreenScoreboard");
}

// ---------------------------------------------------------------------------
// Final ceremony
// ---------------------------------------------------------------------------

export function renderCeremony(standings, needsTiebreak) {
  const winner = standings[0];
  if (!winner) return;

  document.getElementById("ceremonyHostWinner").textContent = winner.name;
  document.getElementById("ceremonyHostScore").textContent =
    `${winner.score} pt${winner.score === 1 ? "" : "s"}`;

  const tieEl = document.getElementById("ceremonyHostTiebreak");
  if (needsTiebreak) {
    tieEl.textContent = "Won on tiebreak — fastest total answer time";
    tieEl.style.display = "";
  } else {
    tieEl.style.display = "none";
  }

  const standingsList = document.getElementById("ceremonyFinalStandings");
  standingsList.innerHTML = "";
  standings.forEach((p, idx) => {
    if (idx === 0) return; // winner already shown above
    const li = document.createElement("li");
    li.className = "ceremony-standing-row";
    const rank = document.createElement("span");
    rank.className = "ceremony-standing-rank";
    rank.textContent = idx + 1;
    const name = document.createElement("span");
    name.className = "ceremony-standing-name";
    name.textContent = p.name;
    const score = document.createElement("span");
    score.className = "ceremony-standing-score";
    score.textContent = `${p.score} pt${p.score === 1 ? "" : "s"}`;
    li.appendChild(rank);
    li.appendChild(name);
    li.appendChild(score);
    standingsList.appendChild(li);
  });

  showHostScreen("hostScreenCeremony");
}
