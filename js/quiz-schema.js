// quiz-schema.js
const ROUND_TYPES = Object.freeze({
  WHERE_ARE_WE_GOING: "where-are-we-going",
  DESTINATION_TRIVIA: "destination-trivia",
  MUSIC_ROUND: "music-round",
  CLOSEST_WINS: "closest-wins",
});

const ROUND_TYPE_LABELS = Object.freeze({
  [ROUND_TYPES.WHERE_ARE_WE_GOING]: "Where Are We Going?",
  [ROUND_TYPES.DESTINATION_TRIVIA]: "Destination Trivia",
  [ROUND_TYPES.MUSIC_ROUND]: "Music Round",
  [ROUND_TYPES.CLOSEST_WINS]: "Closest Wins",
});

const WHERE_ARE_WE_GOING_DEFAULT_POINTS = [10, 8, 6, 4, 2];
const WHERE_ARE_WE_GOING_CLUE_DURATION = 21;
const WHERE_ARE_WE_GOING_CLUE_COUNT = 5;

function generateId(prefix = "q") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createBlankQuestion(type) {
  switch (type) {
    case ROUND_TYPES.WHERE_ARE_WE_GOING:
      return { id: generateId("waw"), youtubeUrl: "", clues: ["","","","",""], answer: "", acceptedAnswers: [], pointsPerStage: [...WHERE_ARE_WE_GOING_DEFAULT_POINTS], clueDurationSeconds: WHERE_ARE_WE_GOING_CLUE_DURATION };
    case ROUND_TYPES.DESTINATION_TRIVIA:
      return { id: generateId("dt"), prompt: "", imageUrl: null, videoUrl: null, inputMode: "multiple-choice", options: ["","","",""], correctOption: 0, answer: null, acceptedAnswers: null, points: 1 };
    case ROUND_TYPES.MUSIC_ROUND:
      return { id: generateId("mr"), youtubeUrl: "", blanks: [
        { id: generateId("blank"), label: "Artist", type: "artist", answer: "", acceptedAnswers: [], points: 1 },
        { id: generateId("blank"), label: "Song Title", type: "title", answer: "", acceptedAnswers: [], points: 1 },
      ]};
    case ROUND_TYPES.CLOSEST_WINS:
      return { id: generateId("cw"), imageUrl: "", caption: null, targetLat: 0, targetLng: 0, points: 2, timeLimitSeconds: 30 };
    default:
      throw new Error(`Unknown round type: ${type}`);
  }
}

function createBlankRound(type) {
  return { type, title: ROUND_TYPE_LABELS[type] || "Untitled Round", questions: [] };
}

function createBlankQuiz() {
  return { title: "New Quiz", rounds: [] };
}

function validateQuestion(type, q, roundIdx, qIdx) {
  const errors = [];
  const loc = `Round ${roundIdx + 1}, Question ${qIdx + 1}`;
  switch (type) {
    case ROUND_TYPES.WHERE_ARE_WE_GOING:
      if (!q.youtubeUrl) errors.push(`${loc}: missing YouTube URL`);
      if (!Array.isArray(q.clues) || q.clues.length !== 5) errors.push(`${loc}: must have exactly 5 clues`);
      else if (q.clues.some(c => !c || !c.trim())) errors.push(`${loc}: all 5 clues must have text`);
      if (!q.answer || !q.answer.trim()) errors.push(`${loc}: missing answer`);
      break;
    case ROUND_TYPES.DESTINATION_TRIVIA:
      if (!q.prompt || !q.prompt.trim()) errors.push(`${loc}: missing prompt`);
      if (q.inputMode === "multiple-choice") {
        if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => !o || !o.trim())) errors.push(`${loc}: multiple-choice requires 4 non-empty options`);
        if (typeof q.correctOption !== "number" || q.correctOption < 0 || q.correctOption > 3) errors.push(`${loc}: correctOption must be 0-3`);
      } else if (q.inputMode === "free-text") {
        if (!q.answer || !q.answer.trim()) errors.push(`${loc}: free-text requires an answer`);
      }
      break;
    case ROUND_TYPES.MUSIC_ROUND:
      if (!q.youtubeUrl) errors.push(`${loc}: missing YouTube URL`);
      if (!Array.isArray(q.blanks) || q.blanks.length < 1 || q.blanks.length > 4) errors.push(`${loc}: must have 1-4 blanks`);
      else q.blanks.forEach((b, bIdx) => { if (!b.answer || !b.answer.trim()) errors.push(`${loc}, Blank ${bIdx+1}: missing answer`); });
      break;
    case ROUND_TYPES.CLOSEST_WINS:
      if (!q.imageUrl || !q.imageUrl.trim()) errors.push(`${loc}: missing location image URL`);
      if (typeof q.targetLat !== "number" || q.targetLat < -90 || q.targetLat > 90) errors.push(`${loc}: invalid targetLat`);
      if (typeof q.targetLng !== "number" || q.targetLng < -180 || q.targetLng > 180) errors.push(`${loc}: invalid targetLng`);
      break;
  }
  return errors;
}

function validateQuiz(quiz) {
  const errors = [];
  if (!quiz || typeof quiz !== "object") return { valid: false, errors: ["Quiz must be a JSON object"] };
  if (!quiz.title || !quiz.title.trim()) errors.push("Quiz is missing a title");
  if (!Array.isArray(quiz.rounds) || quiz.rounds.length === 0) { errors.push("Quiz must have at least one round"); return { valid: errors.length === 0, errors }; }
  quiz.rounds.forEach((round, roundIdx) => {
    if (!Object.values(ROUND_TYPES).includes(round.type)) { errors.push(`Round ${roundIdx+1}: unknown type "${round.type}"`); return; }
    if (!Array.isArray(round.questions) || round.questions.length === 0) { errors.push(`Round ${roundIdx+1}: has no questions`); return; }
    round.questions.forEach((q, qIdx) => errors.push(...validateQuestion(round.type, q, roundIdx, qIdx)));
  });
  return { valid: errors.length === 0, errors };
}

function createSampleQuiz() {
  return {
    title: "Sample På Spåret Quiz",
    rounds: [
      { type: ROUND_TYPES.WHERE_ARE_WE_GOING, title: "Round 1: Where Are We Going?", questions: [{
        id: generateId("waw"), youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        clues: ["This journey begins near a large body of water.","The region is known for its mountains.","A famous bridge can be seen partway through.","The local cuisine features fresh seafood.","You arrive in a city founded over 800 years ago."],
        answer: "Stockholm", acceptedAnswers: ["stockholm sweden"], pointsPerStage: [10,8,6,4,2], clueDurationSeconds: 21,
      }]},
      { type: ROUND_TYPES.DESTINATION_TRIVIA, title: "Round 2: Destination Trivia", questions: [
        { id: generateId("dt"), prompt: "What is the capital of Norway?", imageUrl: null, videoUrl: null, inputMode: "multiple-choice", options: ["Oslo","Bergen","Trondheim","Stavanger"], correctOption: 0, answer: null, acceptedAnswers: null, points: 1 },
        { id: generateId("dt"), prompt: "Name the longest river in Europe.", imageUrl: null, videoUrl: null, inputMode: "free-text", options: null, correctOption: null, answer: "Volga", acceptedAnswers: ["the volga","volga river"], points: 1 },
      ]},
      { type: ROUND_TYPES.MUSIC_ROUND, title: "Round 3: Music Round", questions: [{
        id: generateId("mr"), youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        blanks: [
          { id: generateId("blank"), label: "Artist", type: "artist", answer: "Rick Astley", acceptedAnswers: [], points: 1 },
          { id: generateId("blank"), label: "Song Title", type: "title", answer: "Never Gonna Give You Up", acceptedAnswers: [], points: 1 },
        ],
      }]},
      { type: ROUND_TYPES.CLOSEST_WINS, title: "Round 4: Closest Wins", questions: [{
        id: generateId("cw"),
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg/800px-Tour_Eiffel_Wikimedia_Commons.jpg",
        caption: "Where was this photo taken?", targetLat: 48.8584, targetLng: 2.2945, points: 2, timeLimitSeconds: 30,
      }]},
    ],
  };
}

export { ROUND_TYPES, ROUND_TYPE_LABELS, WHERE_ARE_WE_GOING_DEFAULT_POINTS, WHERE_ARE_WE_GOING_CLUE_DURATION, WHERE_ARE_WE_GOING_CLUE_COUNT, generateId, createBlankQuestion, createBlankRound, createBlankQuiz, validateQuiz, createSampleQuiz };
