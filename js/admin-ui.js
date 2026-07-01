// admin-ui.js
// Pure-ish rendering functions for the admin tool. These functions take
// quiz state + a set of callback handlers and return/inject DOM. They do
// NOT own state themselves — admin.js holds the quiz object and re-renders
// after every mutation. This keeps the render layer simple to reason about
// at the cost of some re-render overhead, which is fine for an authoring
// tool used by one person.

import { ROUND_TYPES, ROUND_TYPE_LABELS, createBlankQuestion } from "./quiz-schema.js";

const ROUND_TYPE_ICONS = {
  [ROUND_TYPES.WHERE_ARE_WE_GOING]: "🚂",
  [ROUND_TYPES.DESTINATION_TRIVIA]: "❓",
  [ROUND_TYPES.MUSIC_ROUND]: "🎵",
  [ROUND_TYPES.CLOSEST_WINS]: "📍",
};

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Round rail ---

/**
 * Renders the round list into the #roundList element.
 * @param {Object} quiz
 * @param {number|null} activeRoundIndex
 * @param {Object} handlers - { onSelectRound, onDeleteRound, onMoveRound }
 */
function renderRoundRail(quiz, activeRoundIndex, handlers) {
  const listEl = document.getElementById("roundList");
  listEl.innerHTML = "";

  quiz.rounds.forEach((round, idx) => {
    const li = document.createElement("li");
    const entry = document.createElement("div");
    entry.className = "round-entry" + (idx === activeRoundIndex ? " is-active" : "");
    entry.setAttribute("role", "button");
    entry.setAttribute("tabindex", "0");

    const number = document.createElement("span");
    number.className = "round-entry-number mono";
    number.textContent = String(idx + 1).padStart(2, "0");

    const body = document.createElement("div");
    body.className = "round-entry-body";
    const title = document.createElement("div");
    title.className = "round-entry-title";
    title.textContent = round.title || ROUND_TYPE_LABELS[round.type];
    const meta = document.createElement("div");
    meta.className = "round-entry-meta";
    meta.textContent = `${ROUND_TYPE_ICONS[round.type] || ""} ${round.questions.length} question${round.questions.length === 1 ? "" : "s"}`;
    body.appendChild(title);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "round-entry-actions";

    const upBtn = document.createElement("button");
    upBtn.textContent = "▲";
    upBtn.title = "Move round up";
    upBtn.disabled = idx === 0;
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onMoveRound(idx, idx - 1);
    });

    const downBtn = document.createElement("button");
    downBtn.textContent = "▼";
    downBtn.title = "Move round down";
    downBtn.disabled = idx === quiz.rounds.length - 1;
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onMoveRound(idx, idx + 1);
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.title = "Delete round";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${round.title}"? This cannot be undone.`)) {
        handlers.onDeleteRound(idx);
      }
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(delBtn);

    entry.appendChild(number);
    entry.appendChild(body);
    entry.appendChild(actions);

    entry.addEventListener("click", () => handlers.onSelectRound(idx));
    entry.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handlers.onSelectRound(idx);
      }
    });

    li.appendChild(entry);
    listEl.appendChild(li);
  });
}

/**
 * Renders the "add round" type-picker grid into #addRoundGrid.
 */
function renderAddRoundGrid(handlers) {
  const grid = document.getElementById("addRoundGrid");
  grid.innerHTML = "";
  Object.values(ROUND_TYPES).forEach((type) => {
    const btn = document.createElement("button");
    btn.className = "round-type-btn";
    btn.innerHTML = `<span class="icon">${ROUND_TYPE_ICONS[type]}</span><span>${ROUND_TYPE_LABELS[type]}</span>`;
    btn.addEventListener("click", () => handlers.onAddRound(type));
    grid.appendChild(btn);
  });
}

// --- Main editor: round header + question list dispatch ---

/**
 * Renders the full editor for the active round into #adminMain.
 * Dispatches to the correct question-card renderer per round type.
 */
function renderRoundEditor(round, roundIndex, validationErrors, handlers) {
  const main = document.getElementById("adminMain");
  main.innerHTML = "";

  if (validationErrors && validationErrors.length > 0) {
    main.appendChild(renderValidationPanel(validationErrors));
  }

  const header = document.createElement("div");
  header.className = "round-editor-header";

  const titleWrap = document.createElement("div");
  titleWrap.style.flex = "1";
  const titleInput = document.createElement("input");
  titleInput.className = "round-title-input";
  titleInput.value = round.title;
  titleInput.addEventListener("change", () => handlers.onRoundTitleChange(roundIndex, titleInput.value));
  const typeLabel = document.createElement("div");
  typeLabel.className = "round-type-label";
  typeLabel.innerHTML = `<span>${ROUND_TYPE_ICONS[round.type]}</span><span>${ROUND_TYPE_LABELS[round.type]}</span>`;
  titleWrap.appendChild(titleInput);
  titleWrap.appendChild(typeLabel);

  header.appendChild(titleWrap);
  main.appendChild(header);

  const questionList = document.createElement("div");
  questionList.className = "question-list";

  round.questions.forEach((q, qIdx) => {
    const card = renderQuestionCard(round.type, q, qIdx, roundIndex, handlers);
    questionList.appendChild(card);
  });

  main.appendChild(questionList);

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-secondary add-question-btn";
  addBtn.textContent = "+ Add question";
  addBtn.addEventListener("click", () => handlers.onAddQuestion(roundIndex, round.type));
  main.appendChild(addBtn);
}

function renderValidationPanel(errors) {
  const panel = document.createElement("div");
  panel.className = "panel validation-panel";
  const h3 = document.createElement("h3");
  h3.textContent = `${errors.length} issue${errors.length === 1 ? "" : "s"} found — fix before exporting`;
  const ul = document.createElement("ul");
  errors.forEach((err) => {
    const li = document.createElement("li");
    li.textContent = err;
    ul.appendChild(li);
  });
  panel.appendChild(h3);
  panel.appendChild(ul);
  return panel;
}

function renderQuestionCardShell(qIdx, roundIndex, handlers) {
  const card = document.createElement("div");
  card.className = "panel question-card";

  const headerEl = document.createElement("div");
  headerEl.className = "question-card-header";
  const numberEl = document.createElement("span");
  numberEl.className = "question-number";
  numberEl.textContent = `Question ${qIdx + 1}`;

  const actionsEl = document.createElement("div");
  actionsEl.className = "question-card-actions";
  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-danger";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", () => {
    if (confirm(`Delete question ${qIdx + 1}?`)) {
      handlers.onDeleteQuestion(roundIndex, qIdx);
    }
  });
  actionsEl.appendChild(delBtn);

  headerEl.appendChild(numberEl);
  headerEl.appendChild(actionsEl);
  card.appendChild(headerEl);

  return card;
}

function makeField(labelText, inputEl) {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.className = "label";
  label.textContent = labelText;
  field.appendChild(label);
  field.appendChild(inputEl);
  return field;
}

// --- Where Are We Going question card ---

function renderQuestionCard(type, question, qIdx, roundIndex, handlers) {
  switch (type) {
    case ROUND_TYPES.WHERE_ARE_WE_GOING:
      return renderWhereAreWeGoingCard(question, qIdx, roundIndex, handlers);
    case ROUND_TYPES.DESTINATION_TRIVIA:
      return renderDestinationTriviaCard(question, qIdx, roundIndex, handlers);
    case ROUND_TYPES.MUSIC_ROUND:
      return renderMusicRoundCard(question, qIdx, roundIndex, handlers);
    case ROUND_TYPES.CLOSEST_WINS:
      return renderClosestWinsCard(question, qIdx, roundIndex, handlers);
    default:
      const fallback = document.createElement("div");
      fallback.textContent = `Unknown question type: ${type}`;
      return fallback;
  }
}

function renderWhereAreWeGoingCard(q, qIdx, roundIndex, handlers) {
  const card = renderQuestionCardShell(qIdx, roundIndex, handlers);
  const onChange = (patch) => handlers.onQuestionChange(roundIndex, qIdx, patch);

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "https://www.youtube.com/watch?v=...";
  urlInput.value = q.youtubeUrl;
  urlInput.addEventListener("change", () => onChange({ youtubeUrl: urlInput.value }));
  card.appendChild(makeField("YouTube journey video URL (must be 1:45 long)", urlInput));

  const answerInput = document.createElement("input");
  answerInput.type = "text";
  answerInput.placeholder = "e.g. Stockholm";
  answerInput.value = q.answer;
  answerInput.addEventListener("change", () => onChange({ answer: answerInput.value }));
  card.appendChild(makeField("Destination (primary answer)", answerInput));

  const acceptedInput = document.createElement("input");
  acceptedInput.type = "text";
  acceptedInput.placeholder = "Comma-separated alternates, e.g. stockholm sweden, stockholm city";
  acceptedInput.value = (q.acceptedAnswers || []).join(", ");
  acceptedInput.addEventListener("change", () =>
    onChange({ acceptedAnswers: splitCommaList(acceptedInput.value) })
  );
  card.appendChild(makeField("Accepted alternate answers (optional)", acceptedInput));

  const clueListField = document.createElement("div");
  clueListField.className = "field";
  const clueLabel = document.createElement("label");
  clueLabel.className = "label";
  clueLabel.textContent = "Clues (revealed in order, one every 21 seconds)";
  clueListField.appendChild(clueLabel);

  const clueList = document.createElement("div");
  clueList.className = "clue-list";
  const pointsPerStage = q.pointsPerStage || [10, 8, 6, 4, 2];

  q.clues.forEach((clue, clueIdx) => {
    const row = document.createElement("div");
    row.className = "clue-row";
    const badge = document.createElement("span");
    badge.className = "clue-stage-badge mono";
    badge.textContent = `${pointsPerStage[clueIdx]} pts`;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = `Clue ${clueIdx + 1}`;
    input.value = clue;
    input.addEventListener("change", () => {
      const newClues = [...q.clues];
      newClues[clueIdx] = input.value;
      onChange({ clues: newClues });
    });
    row.appendChild(badge);
    row.appendChild(input);
    clueList.appendChild(row);
  });

  clueListField.appendChild(clueList);
  card.appendChild(clueListField);

  return card;
}

// --- Destination Trivia question card ---

function renderDestinationTriviaCard(q, qIdx, roundIndex, handlers) {
  const card = renderQuestionCardShell(qIdx, roundIndex, handlers);
  const onChange = (patch) => handlers.onQuestionChange(roundIndex, qIdx, patch);

  const promptInput = document.createElement("textarea");
  promptInput.rows = 2;
  promptInput.placeholder = "What is the question?";
  promptInput.value = q.prompt;
  promptInput.addEventListener("change", () => onChange({ prompt: promptInput.value }));
  card.appendChild(makeField("Question prompt", promptInput));

  const imageInput = document.createElement("input");
  imageInput.type = "text";
  imageInput.placeholder = "https://... (optional)";
  imageInput.value = q.imageUrl || "";
  imageInput.addEventListener("change", () => onChange({ imageUrl: imageInput.value || null }));
  card.appendChild(makeField("Image URL (optional)", imageInput));

  const videoInput = document.createElement("input");
  videoInput.type = "text";
  videoInput.placeholder = "https://www.youtube.com/watch?v=... (optional — shown instead of image if set)";
  videoInput.value = q.videoUrl || "";
  videoInput.addEventListener("change", () => onChange({ videoUrl: videoInput.value || null }));
  card.appendChild(makeField("Video clue URL (optional, overrides image)", videoInput));

  const toggle = document.createElement("div");
  toggle.className = "input-mode-toggle";
  const mcBtn = document.createElement("button");
  mcBtn.textContent = "Multiple choice";
  mcBtn.className = q.inputMode === "multiple-choice" ? "is-active" : "";
  const ftBtn = document.createElement("button");
  ftBtn.textContent = "Free text";
  ftBtn.className = q.inputMode === "free-text" ? "is-active" : "";

  mcBtn.addEventListener("click", () => {
    onChange({
      inputMode: "multiple-choice",
      options: q.options || ["", "", "", ""],
      correctOption: q.correctOption ?? 0,
    });
  });
  ftBtn.addEventListener("click", () => {
    onChange({ inputMode: "free-text", answer: q.answer || "", acceptedAnswers: q.acceptedAnswers || [] });
  });

  toggle.appendChild(mcBtn);
  toggle.appendChild(ftBtn);
  card.appendChild(toggle);

  if (q.inputMode === "multiple-choice") {
    const optionsField = document.createElement("div");
    optionsField.className = "field";
    const label = document.createElement("label");
    label.className = "label";
    label.textContent = "Options (select the correct one)";
    optionsField.appendChild(label);

    const options = q.options || ["", "", "", ""];
    options.forEach((opt, optIdx) => {
      const row = document.createElement("div");
      row.className = "option-row";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `correct-${q.id}`;
      radio.checked = q.correctOption === optIdx;
      radio.addEventListener("change", () => onChange({ correctOption: optIdx }));
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = `Option ${optIdx + 1}`;
      input.value = opt;
      input.addEventListener("change", () => {
        const newOptions = [...options];
        newOptions[optIdx] = input.value;
        onChange({ options: newOptions });
      });
      row.appendChild(radio);
      row.appendChild(input);
      optionsField.appendChild(row);
    });
    card.appendChild(optionsField);
  } else {
    const answerInput = document.createElement("input");
    answerInput.type = "text";
    answerInput.placeholder = "Correct answer";
    answerInput.value = q.answer || "";
    answerInput.addEventListener("change", () => onChange({ answer: answerInput.value }));
    card.appendChild(makeField("Correct answer", answerInput));

    const acceptedInput = document.createElement("input");
    acceptedInput.type = "text";
    acceptedInput.placeholder = "Comma-separated alternates";
    acceptedInput.value = (q.acceptedAnswers || []).join(", ");
    acceptedInput.addEventListener("change", () =>
      onChange({ acceptedAnswers: splitCommaList(acceptedInput.value) })
    );
    const field = makeField("Accepted alternate answers (optional)", acceptedInput);
    card.appendChild(field);
  }

  return card;
}

// --- Music Round question card ---

function renderMusicRoundCard(q, qIdx, roundIndex, handlers) {
  const card = renderQuestionCardShell(qIdx, roundIndex, handlers);
  const onChange = (patch) => handlers.onQuestionChange(roundIndex, qIdx, patch);

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "https://www.youtube.com/watch?v=...";
  urlInput.value = q.youtubeUrl;
  urlInput.addEventListener("change", () => onChange({ youtubeUrl: urlInput.value }));
  card.appendChild(makeField("YouTube song video URL", urlInput));

  const blanksField = document.createElement("div");
  blanksField.className = "field";
  const label = document.createElement("label");
  label.className = "label";
  label.textContent = "Blanks (1 point each, up to 4)";
  blanksField.appendChild(label);

  const blankList = document.createElement("div");
  blankList.className = "blank-list";

  q.blanks.forEach((blank, blankIdx) => {
    const row = document.createElement("div");
    row.className = "blank-row";

    const typeSelect = document.createElement("select");
    ["artist", "title"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t === "artist" ? "Artist" : "Title";
      if (blank.type === t) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener("change", () => {
      const newBlanks = [...q.blanks];
      newBlanks[blankIdx] = { ...blank, type: typeSelect.value };
      onChange({ blanks: newBlanks });
    });

    const answerInput = document.createElement("input");
    answerInput.type = "text";
    answerInput.placeholder = "Correct answer";
    answerInput.value = blank.answer;
    answerInput.addEventListener("change", () => {
      const newBlanks = [...q.blanks];
      newBlanks[blankIdx] = { ...blank, answer: answerInput.value };
      onChange({ blanks: newBlanks });
    });

    const acceptedInput = document.createElement("input");
    acceptedInput.type = "text";
    acceptedInput.placeholder = "Alternates (comma-separated)";
    acceptedInput.value = (blank.acceptedAnswers || []).join(", ");
    acceptedInput.addEventListener("change", () => {
      const newBlanks = [...q.blanks];
      newBlanks[blankIdx] = { ...blank, acceptedAnswers: splitCommaList(acceptedInput.value) };
      onChange({ blanks: newBlanks });
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "blank-remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove blank";
    removeBtn.disabled = q.blanks.length <= 1;
    removeBtn.addEventListener("click", () => {
      onChange({ blanks: q.blanks.filter((_, i) => i !== blankIdx) });
    });

    row.appendChild(typeSelect);
    row.appendChild(answerInput);
    row.appendChild(acceptedInput);
    row.appendChild(removeBtn);
    blankList.appendChild(row);
  });

  blanksField.appendChild(blankList);

  const addBlankBtn = document.createElement("button");
  addBlankBtn.className = "btn btn-secondary";
  addBlankBtn.style.marginTop = "0.75rem";
  addBlankBtn.textContent = "+ Add blank";
  addBlankBtn.disabled = q.blanks.length >= 4;
  addBlankBtn.addEventListener("click", () => {
    onChange({
      blanks: [
        ...q.blanks,
        { id: `blank_${Date.now().toString(36)}`, label: "", type: "artist", answer: "", acceptedAnswers: [], points: 1 },
      ],
    });
  });
  blanksField.appendChild(addBlankBtn);

  card.appendChild(blanksField);
  return card;
}

// --- Closest Wins question card ---

function renderClosestWinsCard(q, qIdx, roundIndex, handlers) {
  const card = renderQuestionCardShell(qIdx, roundIndex, handlers);
  const onChange = (patch) => handlers.onQuestionChange(roundIndex, qIdx, patch);

  const imageInput = document.createElement("input");
  imageInput.type = "text";
  imageInput.placeholder = "https://... (photo shown to players as the location clue)";
  imageInput.value = q.imageUrl || "";
  imageInput.addEventListener("change", () => onChange({ imageUrl: imageInput.value }));
  card.appendChild(makeField("Location image URL (required)", imageInput));

  // Live preview of the image so the author can verify it loads.
  const preview = document.createElement("img");
  preview.style.cssText = "max-width:100%;max-height:180px;border-radius:6px;object-fit:cover;display:" + (q.imageUrl ? "block" : "none") + ";margin-bottom:1rem;border:1px solid var(--color-slate-dim)";
  if (q.imageUrl) preview.src = q.imageUrl;
  imageInput.addEventListener("change", () => {
    if (imageInput.value) { preview.src = imageInput.value; preview.style.display = "block"; }
    else { preview.style.display = "none"; }
  });
  card.appendChild(preview);

  const captionInput = document.createElement("input");
  captionInput.type = "text";
  captionInput.placeholder = "e.g. Where was this photo taken? (optional)";
  captionInput.value = q.caption || "";
  captionInput.addEventListener("change", () => onChange({ caption: captionInput.value || null }));
  card.appendChild(makeField("Caption (optional hint shown below image)", captionInput));

  const mapField = document.createElement("div");
  mapField.className = "field";
  const mapLabel = document.createElement("label");
  mapLabel.className = "label";
  mapLabel.textContent = "Click the map to set the target location";
  mapField.appendChild(mapLabel);

  const mapDiv = document.createElement("div");
  mapDiv.className = "map-picker";
  const mapId = `map-${q.id}`;
  mapDiv.id = mapId;
  mapField.appendChild(mapDiv);

  const coordDisplay = document.createElement("div");
  coordDisplay.className = "coord-display mono";
  coordDisplay.id = `coord-${q.id}`;
  coordDisplay.textContent = `lat: ${q.targetLat.toFixed(4)}, lng: ${q.targetLng.toFixed(4)}`;
  mapField.appendChild(coordDisplay);

  card.appendChild(mapField);

  const timeLimitInput = document.createElement("input");
  timeLimitInput.type = "number";
  timeLimitInput.min = "5";
  timeLimitInput.value = q.timeLimitSeconds;
  timeLimitInput.addEventListener("change", () =>
    onChange({ timeLimitSeconds: Number(timeLimitInput.value) || 30 })
  );
  card.appendChild(makeField("Time limit (seconds)", timeLimitInput));

  // Defer map init until the card is in the DOM (Leaflet needs a real
  // rendered container with dimensions). The caller is responsible for
  // calling initClosestWinsMap after appending this card.
  card.dataset.deferredMapInit = mapId;
  card.dataset.questionId = q.id;

  return card;
}

/**
 * Initializes the Leaflet map picker for a Closest Wins question card.
 * Must be called AFTER the card has been appended to the DOM (Leaflet
 * needs the container to have real layout dimensions to render correctly).
 */
function initClosestWinsMap(mapId, q, roundIndex, qIdx, handlers) {
  const mapEl = document.getElementById(mapId);
  if (!mapEl || mapEl.dataset.leafletInitialized) return;
  mapEl.dataset.leafletInitialized = "true";

  const startLat = q.targetLat || 20;
  const startLng = q.targetLng || 0;
  const map = L.map(mapId).setView([startLat, startLng], q.targetLat ? 5 : 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);

  let marker = null;
  if (q.targetLat && q.targetLng) {
    marker = L.marker([q.targetLat, q.targetLng]).addTo(map);
  }

  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    if (marker) {
      marker.setLatLng([lat, lng]);
    } else {
      marker = L.marker([lat, lng]).addTo(map);
    }
    const coordDisplay = document.getElementById(`coord-${q.id}`);
    if (coordDisplay) {
      coordDisplay.textContent = `lat: ${lat.toFixed(4)}, lng: ${lng.toFixed(4)}`;
    }
    handlers.onQuestionChange(roundIndex, qIdx, { targetLat: lat, targetLng: lng });
  });

  // Leaflet sometimes mis-measures its container if the map was created
  // while hidden or mid-layout-transition; a deferred invalidateSize fixes
  // grey-tile rendering glitches.
  setTimeout(() => map.invalidateSize(), 100);
}

function splitCommaList(str) {
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function showToast(message, isError = false) {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = "toast" + (isError ? " toast-error" : "");
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

export {
  renderRoundRail,
  renderAddRoundGrid,
  renderRoundEditor,
  renderValidationPanel,
  initClosestWinsMap,
  showToast,
  escapeHtml,
};
