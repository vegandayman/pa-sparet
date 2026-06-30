// admin.js
// Owns the in-memory quiz state for the admin tool. Every mutation goes
// through a small set of functions here, which then trigger a re-render.
// This is intentionally simple (no framework, no diffing) since the admin
// tool is single-user and re-rendering the whole editor panel on every
// change is cheap enough not to matter.

import {
  ROUND_TYPES,
  createBlankQuestion,
  createBlankRound,
  createBlankQuiz,
  validateQuiz,
  createSampleQuiz,
} from "./quiz-schema.js";

import {
  renderRoundRail,
  renderAddRoundGrid,
  renderRoundEditor,
  initClosestWinsMap,
  showToast,
} from "./admin-ui.js";

// --- State ---

let quiz = createBlankQuiz();
let activeRoundIndex = null;

const STORAGE_KEY = "po-sparet-admin-draft";

// --- Persistence (so an accidental tab close does not lose work) ---

function saveDraftToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quiz));
  } catch (e) {
    console.warn("Could not save draft to localStorage:", e);
  }
}

function loadDraftFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Could not load draft from localStorage:", e);
    return null;
  }
}

// --- Render orchestration ---

function rerender() {
  renderRoundRail(quiz, activeRoundIndex, {
    onSelectRound: handleSelectRound,
    onDeleteRound: handleDeleteRound,
    onMoveRound: handleMoveRound,
  });

  document.getElementById("quizTitleDisplay").textContent = quiz.title;
  document.title = quiz.title + " — Quiz Builder";

  if (activeRoundIndex === null || !quiz.rounds[activeRoundIndex]) {
    renderEmptyState();
  } else {
    const round = quiz.rounds[activeRoundIndex];
    const validation = validateQuiz(quiz);
    const roundErrors = validation.errors.filter(function(err) {
      return err.startsWith("Round " + (activeRoundIndex + 1));
    });
    renderRoundEditor(round, activeRoundIndex, roundErrors, {
      onRoundTitleChange: handleRoundTitleChange,
      onAddQuestion: handleAddQuestion,
      onDeleteQuestion: handleDeleteQuestion,
      onQuestionChange: handleQuestionChange,
    });

    if (round.type === ROUND_TYPES.CLOSEST_WINS) {
      document.querySelectorAll("[data-deferred-map-init]").forEach(function(card) {
        const mapId = card.dataset.deferredMapInit;
        const questionId = card.dataset.questionId;
        const qIdx = round.questions.findIndex(function(q) { return q.id === questionId; });
        if (qIdx !== -1) {
          initClosestWinsMap(mapId, round.questions[qIdx], activeRoundIndex, qIdx, {
            onQuestionChange: handleQuestionChange,
          });
        }
      });
    }
  }

  saveDraftToLocalStorage();
}

function renderEmptyState() {
  const main = document.getElementById("adminMain");
  main.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "editor-empty-state";
  empty.innerHTML = "<h2>No round selected</h2><p>Add a round on the left, or load the sample quiz to explore the builder.</p>";
  main.appendChild(empty);
}

// --- Handlers: rounds ---

function handleSelectRound(idx) {
  activeRoundIndex = idx;
  rerender();
}

function handleAddRound(type) {
  const newRound = createBlankRound(type);
  quiz.rounds.push(newRound);
  activeRoundIndex = quiz.rounds.length - 1;
  rerender();
}

function handleDeleteRound(idx) {
  quiz.rounds.splice(idx, 1);
  if (activeRoundIndex === idx) {
    activeRoundIndex = quiz.rounds.length > 0 ? Math.max(0, idx - 1) : null;
  } else if (activeRoundIndex !== null && activeRoundIndex > idx) {
    activeRoundIndex -= 1;
  }
  rerender();
}

function handleMoveRound(fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= quiz.rounds.length) return;
  const moved = quiz.rounds.splice(fromIdx, 1)[0];
  quiz.rounds.splice(toIdx, 0, moved);
  if (activeRoundIndex === fromIdx) activeRoundIndex = toIdx;
  rerender();
}

function handleRoundTitleChange(roundIndex, newTitle) {
  quiz.rounds[roundIndex].title = newTitle;
  rerender();
}

// --- Handlers: questions ---

function handleAddQuestion(roundIndex, type) {
  quiz.rounds[roundIndex].questions.push(createBlankQuestion(type));
  rerender();
}

function handleDeleteQuestion(roundIndex, qIdx) {
  quiz.rounds[roundIndex].questions.splice(qIdx, 1);
  rerender();
}

function handleQuestionChange(roundIndex, qIdx, patch) {
  const question = quiz.rounds[roundIndex].questions[qIdx];
  Object.assign(question, patch);
  rerender();
}

// --- Import / Export ---

function handleExport() {
  const validation = validateQuiz(quiz);
  if (!validation.valid) {
    showToast("Cannot export: " + validation.errors.length + " validation issue(s). Check the round editor for details.", true);
    return;
  }
  const blob = new Blob([JSON.stringify(quiz, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeFileName = quiz.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  a.href = url;
  a.download = (safeFileName || "quiz") + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Quiz exported successfully.");
}

function handleImportFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function() {
    try {
      const parsed = JSON.parse(reader.result);
      const validation = validateQuiz(parsed);
      if (!validation.valid) {
        showToast("Imported file has " + validation.errors.length + " issue(s) — loaded anyway, please fix before exporting.", true);
      } else {
        showToast("Quiz imported successfully.");
      }
      quiz = parsed;
      activeRoundIndex = quiz.rounds.length > 0 ? 0 : null;
      rerender();
    } catch (e) {
      showToast("Could not parse file as JSON: " + e.message, true);
    }
  };
  reader.onerror = function() {
    showToast("Could not read the selected file.", true);
  };
  reader.readAsText(file);
  event.target.value = "";
}

function handleLoadSample() {
  if (quiz.rounds.length > 0) {
    if (!confirm("Loading the sample quiz will replace your current draft. Continue?")) return;
  }
  quiz = createSampleQuiz();
  activeRoundIndex = 0;
  rerender();
  showToast("Sample quiz loaded.");
}

// --- Title modal ---

function openTitleModal() {
  document.getElementById("quizTitleInput").value = quiz.title;
  document.getElementById("titleModalBackdrop").classList.remove("visually-hidden");
  document.getElementById("quizTitleInput").focus();
}

function closeTitleModal() {
  document.getElementById("titleModalBackdrop").classList.add("visually-hidden");
}

function saveTitleModal() {
  const newTitle = document.getElementById("quizTitleInput").value.trim();
  if (newTitle) {
    quiz.title = newTitle;
    rerender();
  }
  closeTitleModal();
}

// --- Init ---

function init() {
  renderAddRoundGrid({ onAddRound: handleAddRound });

  document.getElementById("exportBtn").addEventListener("click", handleExport);
  document.getElementById("importBtn").addEventListener("click", function() {
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", handleImportFileSelected);
  document.getElementById("loadSampleBtn").addEventListener("click", handleLoadSample);
  document.getElementById("editTitleBtn").addEventListener("click", openTitleModal);
  document.getElementById("titleModalCancel").addEventListener("click", closeTitleModal);
  document.getElementById("titleModalSave").addEventListener("click", saveTitleModal);
  document.getElementById("titleModalBackdrop").addEventListener("click", function(e) {
    if (e.target.id === "titleModalBackdrop") closeTitleModal();
  });
  document.getElementById("quizTitleInput").addEventListener("keydown", function(e) {
    if (e.key === "Enter") saveTitleModal();
    if (e.key === "Escape") closeTitleModal();
  });

  const draft = loadDraftFromLocalStorage();
  if (draft && draft.rounds && draft.rounds.length > 0) {
    quiz = draft;
    activeRoundIndex = 0;
  }

  rerender();
}

document.addEventListener("DOMContentLoaded", init);
