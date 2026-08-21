// host-ui.js — Pure rendering functions for the host view
import { ROUND_TYPES, ROUND_TYPE_LABELS, WHERE_ARE_WE_GOING_DEFAULT_POINTS } from "./quiz-schema.js";

const ROUND_TYPE_ICONS = { [ROUND_TYPES.WHERE_ARE_WE_GOING]: "🚂", [ROUND_TYPES.DESTINATION_TRIVIA]: "❓", [ROUND_TYPES.MUSIC_ROUND]: "🎵", [ROUND_TYPES.CLOSEST_WINS]: "📍" };

export function showHostScreen(id) {
  document.querySelectorAll(".host-screen").forEach(el => el.classList.remove("is-active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("is-active");
}

export function updateControlBar({ roomCode, statusLabel, nextLabel, nextDisabled, showPrev, showRevealClue, showLock, showRevealAnswer }) {
  document.getElementById("controlBarRoomCode").textContent = roomCode || "—";
  document.getElementById("controlBarStatus").textContent = statusLabel || "";
  const nextBtn = document.getElementById("hostNextBtn");
  nextBtn.textContent = nextLabel || "Next"; nextBtn.disabled = !!nextDisabled;
  document.getElementById("hostPrevBtn").style.display = showPrev ? "" : "none";
  document.getElementById("hostRevealClueBtn").style.display = showRevealClue ? "" : "none";
  document.getElementById("hostLockBtn").style.display = showLock ? "" : "none";
  document.getElementById("hostRevealAnswerBtn").style.display = showRevealAnswer ? "" : "none";
}

export function renderLobby(roomCode, players) {
  document.getElementById("hostLobbyCode").textContent = roomCode || "—";
  const list = document.getElementById("hostPlayerList");
  list.innerHTML = "";
  Object.values(players || {}).forEach(p => {
    const chip = document.createElement("div");
    chip.className = "lobby-player-chip" + (p.connected === false ? " is-disconnected" : "");
    const dot = document.createElement("span"); dot.className = "connected-dot";
    chip.appendChild(dot); chip.appendChild(document.createTextNode(p.name));
    list.appendChild(chip);
  });
}

export function renderQuizSummary(quiz) {
  const el = document.getElementById("lobbyQuizSummary");
  if (!el) return;
  if (!quiz) { el.style.display = "none"; return; }
  const totalQ = quiz.rounds.reduce((s, r) => s + r.questions.length, 0);
  el.innerHTML = "";
  el.style.display = "";
  const title = document.createElement("div"); title.className = "quiz-summary-title"; title.textContent = quiz.title;
  const meta = document.createElement("div"); meta.className = "quiz-summary-meta";
  meta.textContent = `${quiz.rounds.length} round${quiz.rounds.length === 1 ? "" : "s"} · ${totalQ} question${totalQ === 1 ? "" : "s"} total`;
  const roundsEl = document.createElement("div"); roundsEl.className = "quiz-summary-rounds";
  quiz.rounds.forEach((round, idx) => {
    const chip = document.createElement("div"); chip.className = "quiz-summary-round-chip";
    const num = document.createElement("span"); num.className = "chip-num"; num.textContent = `R${idx+1}`;
    const icon = document.createElement("span"); icon.textContent = ROUND_TYPE_ICONS[round.type] || "❓";
    const name = document.createElement("span"); name.textContent = round.title;
    const qs = document.createElement("span"); qs.className = "chip-qs"; qs.textContent = `×${round.questions.length}`;
    chip.appendChild(num); chip.appendChild(icon); chip.appendChild(name); chip.appendChild(qs);
    roundsEl.appendChild(chip);
  });
  el.appendChild(title); el.appendChild(meta); el.appendChild(roundsEl);
}

export function renderTransitionCard(round, roundIndex) {
  document.getElementById("hostTransitionIcon").textContent = ROUND_TYPE_ICONS[round.type] || "❓";
  document.getElementById("hostTransitionRoundNum").textContent = `Round ${roundIndex + 1}`;
  document.getElementById("hostTransitionTitle").textContent = round.title;
  showHostScreen("hostScreenTransition");
}

export function renderExplainer(roundType, explainerText) {
  document.getElementById("hostExplainerTitle").textContent = explainerText.title || ROUND_TYPE_LABELS[roundType];
  document.getElementById("hostExplainerBody").textContent = explainerText.body || "";
  showHostScreen("hostScreenExplainer");
}

export function renderWawgScreen(question, clueIndex, state) {
  const points = question.pointsPerStage || WHERE_ARE_WE_GOING_DEFAULT_POINTS;
  const cluesList = document.getElementById("wawgCluesList");
  cluesList.innerHTML = "";
  question.clues.forEach((clue, i) => {
    const el = document.createElement("div");
    el.className = "wawg-host-clue" + (i < clueIndex ? " is-revealed" : i === clueIndex ? " is-current" : "");
    const pts = document.createElement("span"); pts.className = "wawg-clue-pts"; pts.textContent = points[i] + " pts";
    const text = document.createElement("span"); text.textContent = i <= clueIndex ? clue : "···";
    el.appendChild(pts); el.appendChild(text); cluesList.appendChild(el);
  });
  const revealEl = document.getElementById("wawgAnswerReveal");
  if (state === "revealed") { revealEl.style.display = ""; document.getElementById("wawgAnswerText").textContent = question.answer; }
  else revealEl.style.display = "none";
  showHostScreen("hostScreenWawg");
}

export function renderTriviaScreen(question, state, getYTEmbedUrl) {
  const imgEl = document.getElementById("hostTriviaImage");
  const videoContainer = document.getElementById("hostTriviaVideoContainer");
  if (question.videoUrl && videoContainer) {
    let iframe = videoContainer.querySelector("iframe");
    if (!iframe) { iframe = document.createElement("iframe"); iframe.setAttribute("frameborder","0"); iframe.setAttribute("allowfullscreen",""); iframe.setAttribute("allow","autoplay"); iframe.style.cssText = "width:100%;aspect-ratio:16/9;border-radius:var(--radius-lg);"; videoContainer.appendChild(iframe); }
    iframe.src = getYTEmbedUrl(question.videoUrl); videoContainer.style.display = ""; imgEl.style.display = "none";
  } else if (question.imageUrl) {
    imgEl.src = question.imageUrl; imgEl.style.display = ""; if (videoContainer) videoContainer.style.display = "none";
  } else { imgEl.style.display = "none"; if (videoContainer) videoContainer.style.display = "none"; }
  document.getElementById("hostTriviaPrompt").textContent = question.prompt;
  const mcContainer = document.getElementById("hostTriviaMCOptions");
  if (question.inputMode === "multiple-choice") {
    mcContainer.style.display = ""; mcContainer.innerHTML = "";
    const letters = ["A","B","C","D"];
    (question.options || []).forEach((opt, i) => {
      const el = document.createElement("div");
      el.className = "trivia-mc-option" + (state === "revealed" ? (i === question.correctOption ? " is-correct" : " is-incorrect") : "");
      const letter = document.createElement("span"); letter.className = "trivia-mc-letter"; letter.textContent = letters[i];
      el.appendChild(letter); el.appendChild(document.createTextNode(opt)); mcContainer.appendChild(el);
    });
  } else mcContainer.style.display = "none";
  showHostScreen("hostScreenTrivia");
}

export function renderAnswerReview(panelId, rowsId, answers, players, correctChecker, onOverride) {
  const panel = document.getElementById(panelId), rowsEl = document.getElementById(rowsId);
  if (!panel || !rowsEl) return;
  panel.style.display = ""; rowsEl.innerHTML = "";
  Object.entries(answers || {}).forEach(([playerId, answer]) => {
    const player = players[playerId]; if (!player) return;
    const row = document.createElement("div"); row.className = "answer-row";
    const name = document.createElement("span"); name.className = "answer-row-name"; name.textContent = player.name;
    const value = document.createElement("span"); value.className = "answer-row-value"; value.textContent = formatAnswerValue(answer.value);
    const status = document.createElement("span"); status.className = "answer-row-status";
    if (answer.hostOverride === true) { status.className += " is-override"; status.textContent = "override ✓"; }
    else if (answer.pointsAwarded > 0) { status.className += " is-correct"; status.textContent = `+${answer.pointsAwarded} ✓`; }
    else if (answer.pointsAwarded === false || answer.pointsAwarded === undefined) {
      const isOk = correctChecker ? correctChecker(answer.value) : false;
      status.className += isOk ? " is-correct" : " is-wrong"; status.textContent = isOk ? "correct" : "wrong";
    } else { status.className += " is-wrong"; status.textContent = "wrong"; }
    row.appendChild(name); row.appendChild(value); row.appendChild(status);
    if (!answer.pointsAwarded || answer.pointsAwarded === 0) {
      const btn = document.createElement("button"); btn.className = "btn btn-secondary override-btn"; btn.textContent = "Award point";
      btn.addEventListener("click", () => { btn.disabled = true; onOverride(playerId, answer); }); row.appendChild(btn);
    }
    rowsEl.appendChild(row);
  });
}

function formatAnswerValue(value) {
  if (!value) return "(no answer)";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object") {
    if ("lat" in value) return `📍 ${Number(value.lat).toFixed(2)}°, ${Number(value.lng).toFixed(2)}°`;
    return Object.values(value).filter(Boolean).join(" · ");
  }
  return String(value);
}

export function renderMusicScreen(question, state) {
  const container = document.getElementById("musicBlanksHost"); container.innerHTML = "";
  (question.blanks || []).forEach(blank => {
    const el = document.createElement("div"); el.className = "music-blank-host";
    const label = document.createElement("div"); label.className = "music-blank-host-label"; label.textContent = blank.label || (blank.type === "artist" ? "Artist" : "Song Title");
    const answer = document.createElement("div"); answer.className = "music-blank-host-answer" + (state !== "revealed" ? " is-hidden" : ""); answer.textContent = blank.answer;
    el.appendChild(label); el.appendChild(answer); container.appendChild(el);
  });
  showHostScreen("hostScreenMusic");
}

export function renderCWScreen(question, state) {
  // Image view visible during active/locked, map view on reveal
  const imgView = document.getElementById("cwImageView");
  const mapView = document.getElementById("cwMapView");
  if (state === "revealed") {
    if (imgView) imgView.style.display = "none";
    if (mapView) mapView.style.display = "flex";
    const revealPrompt = document.getElementById("cwHostPromptReveal");
    if (revealPrompt) revealPrompt.textContent = question.caption || "Where was this photo taken?";
  } else {
    if (imgView) imgView.style.display = "flex";
    if (mapView) mapView.style.display = "none";
    const img = document.getElementById("cwHostImage");
    if (img && question.imageUrl) img.src = question.imageUrl;
    document.getElementById("cwHostPrompt").textContent = question.caption || "Where was this photo taken?";
  }
  showHostScreen("hostScreenCW");
}

export function renderCWPins(results, players) {
  const list = document.getElementById("cwPinsList"); list.innerHTML = "";
  (results || []).sort((a, b) => a.distanceKm - b.distanceKm).forEach(r => {
    const player = players[r.playerId]; if (!player) return;
    const el = document.createElement("div"); el.className = "cw-pin-entry" + (r.points > 0 ? " is-winner" : "");
    const name = document.createElement("span"); name.className = "cw-pin-name"; name.textContent = player.name + (r.points > 0 ? " 🏆" : "");
    const dist = document.createElement("span"); dist.className = "cw-pin-dist";
    dist.textContent = r.distanceKm < 1 ? `${Math.round(r.distanceKm * 1000)} m` : `${r.distanceKm.toFixed(1)} km`;
    el.appendChild(name); el.appendChild(dist); list.appendChild(el);
  });
}

export function updateCWTimer(seconds) {
  const el = document.getElementById("cwHostTimer"); if (!el) return;
  el.textContent = String(Math.max(0, Math.ceil(seconds))).padStart(2, "0");
  el.classList.toggle("is-low", seconds <= 10);
}

export function renderRoundRecap(roundTitle, questions, allAnswers, players) {
  document.getElementById("recapTitle").textContent = `Round recap — ${roundTitle}`;
  const content = document.getElementById("recapContent"); content.innerHTML = "";
  questions.forEach(q => {
    const answers = allAnswers[q.id] || {};
    if (Object.keys(answers).length === 0) return;
    const block = document.createElement("div"); block.className = "recap-question-block";
    const prompt = document.createElement("div"); prompt.className = "recap-question-prompt";
    prompt.textContent = q.prompt || q.answer || (q.blanks ? q.blanks.map(b => b.answer).join(" / ") : "Question");
    block.appendChild(prompt);
    const reviewEl = document.createElement("div");
    Object.entries(answers).forEach(([playerId, answer]) => {
      const player = players[playerId]; if (!player) return;
      const row = document.createElement("div"); row.className = "answer-row";
      const name = document.createElement("span"); name.className = "answer-row-name"; name.textContent = player.name;
      const value = document.createElement("span"); value.className = "answer-row-value"; value.textContent = formatAnswerValue(answer.value);
      row.appendChild(name); row.appendChild(value); reviewEl.appendChild(row);
    });
    block.appendChild(reviewEl); content.appendChild(block);
  });
  showHostScreen("hostScreenRecap");
}

export function renderScoreboard(title, players) {
  document.getElementById("scoreboardHostTitle").textContent = title;
  const list = document.getElementById("scoreboardHostList"); list.innerHTML = "";
  const sorted = Object.entries(players || {}).map(([id, p]) => ({ id, name: p.name, score: p.score || 0 })).sort((a, b) => b.score - a.score);
  sorted.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "scoreboard-host-entry" + (idx === 0 ? " is-top" : "");
    li.style.animationDelay = `${idx * 80}ms`;
    const rank = document.createElement("span"); rank.className = "scoreboard-host-rank" + (idx === 0 ? " is-first" : idx === 1 ? " is-second" : idx === 2 ? " is-third" : ""); rank.textContent = idx + 1;
    const name = document.createElement("span"); name.className = "scoreboard-host-name"; name.textContent = p.name;
    const score = document.createElement("span"); score.className = "scoreboard-host-score"; score.textContent = `${p.score} pt${p.score === 1 ? "" : "s"}`;
    li.appendChild(rank); li.appendChild(name); li.appendChild(score); list.appendChild(li);
  });
  showHostScreen("hostScreenScoreboard");
}

export function renderCeremony(standings, needsTiebreak) {
  const winner = standings[0]; if (!winner) return;
  document.getElementById("ceremonyHostWinner").textContent = winner.name;
  document.getElementById("ceremonyHostScore").textContent = `${winner.score} pt${winner.score === 1 ? "" : "s"}`;
  const tieEl = document.getElementById("ceremonyHostTiebreak");
  if (needsTiebreak) { tieEl.textContent = "Won on tiebreak — fastest total answer time"; tieEl.style.display = ""; } else tieEl.style.display = "none";
  const standingsList = document.getElementById("ceremonyFinalStandings"); standingsList.innerHTML = "";
  standings.forEach((p, idx) => {
    if (idx === 0) return;
    const li = document.createElement("li"); li.className = "ceremony-standing-row";
    const rank = document.createElement("span"); rank.className = "ceremony-standing-rank"; rank.textContent = idx + 1;
    const name = document.createElement("span"); name.className = "ceremony-standing-name"; name.textContent = p.name;
    const score = document.createElement("span"); score.className = "ceremony-standing-score"; score.textContent = `${p.score} pt${p.score === 1 ? "" : "s"}`;
    li.appendChild(rank); li.appendChild(name); li.appendChild(score); standingsList.appendChild(li);
  });
  showHostScreen("hostScreenCeremony");
}
