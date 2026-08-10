// admin.js
import { ROUND_TYPES, createBlankQuestion, createBlankRound, createBlankQuiz, validateQuiz, createSampleQuiz } from "./quiz-schema.js";
import { renderRoundRail, renderAddRoundGrid, renderRoundEditor, initClosestWinsMap, showToast } from "./admin-ui.js";

let quiz = createBlankQuiz(), activeRoundIndex = null;
const STORAGE_KEY = "po-sparet-admin-draft";

function saveDraft() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(quiz)); } catch(e){} }
function loadDraft() { try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch(e){return null;} }

function rerender() {
  renderRoundRail(quiz, activeRoundIndex, { onSelectRound: handleSelectRound, onDeleteRound: handleDeleteRound, onMoveRound: handleMoveRound });
  document.getElementById("quizTitleDisplay").textContent = quiz.title;
  document.title = quiz.title + " — Quiz Builder";
  if (activeRoundIndex === null || !quiz.rounds[activeRoundIndex]) { renderEmptyState(); }
  else {
    const round = quiz.rounds[activeRoundIndex];
    const validation = validateQuiz(quiz);
    const roundErrors = validation.errors.filter(err => err.startsWith(`Round ${activeRoundIndex+1}`));
    renderRoundEditor(round, activeRoundIndex, roundErrors, { onRoundTitleChange: handleRoundTitleChange, onAddQuestion: handleAddQuestion, onDeleteQuestion: handleDeleteQuestion, onQuestionChange: handleQuestionChange });
    if (round.type === ROUND_TYPES.CLOSEST_WINS) {
      document.querySelectorAll("[data-deferred-map-init]").forEach(card => {
        const mapId=card.dataset.deferredMapInit, questionId=card.dataset.questionId;
        const qIdx=round.questions.findIndex(q=>q.id===questionId);
        if(qIdx!==-1) initClosestWinsMap(mapId,round.questions[qIdx],activeRoundIndex,qIdx,{onQuestionChange:handleQuestionChange});
      });
    }
  }
  saveDraft();
}

function renderEmptyState() {
  const main=document.getElementById("adminMain");main.innerHTML="";
  const empty=document.createElement("div");empty.className="editor-empty-state";
  empty.innerHTML="<h2>No round selected</h2><p>Add a round on the left, or load the sample quiz to explore the builder.</p>";
  main.appendChild(empty);
}

function handleSelectRound(idx){activeRoundIndex=idx;rerender();}
function handleAddRound(type){quiz.rounds.push(createBlankRound(type));activeRoundIndex=quiz.rounds.length-1;rerender();}
function handleDeleteRound(idx){quiz.rounds.splice(idx,1);if(activeRoundIndex===idx){activeRoundIndex=quiz.rounds.length>0?Math.max(0,idx-1):null;}else if(activeRoundIndex!==null&&activeRoundIndex>idx){activeRoundIndex--;}rerender();}
function handleMoveRound(fromIdx,toIdx){if(toIdx<0||toIdx>=quiz.rounds.length)return;const moved=quiz.rounds.splice(fromIdx,1)[0];quiz.rounds.splice(toIdx,0,moved);if(activeRoundIndex===fromIdx)activeRoundIndex=toIdx;rerender();}
function handleRoundTitleChange(roundIndex,newTitle){quiz.rounds[roundIndex].title=newTitle;rerender();}
function handleAddQuestion(roundIndex,type){quiz.rounds[roundIndex].questions.push(createBlankQuestion(type));rerender();}
function handleDeleteQuestion(roundIndex,qIdx){quiz.rounds[roundIndex].questions.splice(qIdx,1);rerender();}
function handleQuestionChange(roundIndex,qIdx,patch){Object.assign(quiz.rounds[roundIndex].questions[qIdx],patch);rerender();}

function handleExport(){
  const v=validateQuiz(quiz);if(!v.valid){showToast(`Cannot export: ${v.errors.length} issue(s). Fix in the editor.`,true);return;}
  const blob=new Blob([JSON.stringify(quiz,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");
  const safe=quiz.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  a.href=url;a.download=(safe||"quiz")+".json";document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);showToast("Quiz exported successfully.");
}

function handleImportFileSelected(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{try{const parsed=JSON.parse(reader.result);const v=validateQuiz(parsed);if(!v.valid)showToast(`Imported with ${v.errors.length} issue(s) — please fix before exporting.`,true);else showToast("Quiz imported successfully.");quiz=parsed;activeRoundIndex=quiz.rounds.length>0?0:null;rerender();}catch(e){showToast("Could not parse file: "+e.message,true);}};
  reader.readAsText(file);event.target.value="";
}

function handleLoadSample(){if(quiz.rounds.length>0&&!confirm("Replace current draft with sample quiz?"))return;quiz=createSampleQuiz();activeRoundIndex=0;rerender();showToast("Sample quiz loaded.");}

function openTitleModal(){document.getElementById("quizTitleInput").value=quiz.title;document.getElementById("titleModalBackdrop").classList.remove("visually-hidden");document.getElementById("quizTitleInput").focus();}
function closeTitleModal(){document.getElementById("titleModalBackdrop").classList.add("visually-hidden");}
function saveTitleModal(){const t=document.getElementById("quizTitleInput").value.trim();if(t){quiz.title=t;rerender();}closeTitleModal();}

function init(){
  renderAddRoundGrid({onAddRound:handleAddRound});
  document.getElementById("exportBtn").addEventListener("click",handleExport);
  document.getElementById("importBtn").addEventListener("click",()=>document.getElementById("importFileInput").click());
  document.getElementById("importFileInput").addEventListener("change",handleImportFileSelected);
  document.getElementById("loadSampleBtn").addEventListener("click",handleLoadSample);
  document.getElementById("editTitleBtn").addEventListener("click",openTitleModal);
  document.getElementById("titleModalCancel").addEventListener("click",closeTitleModal);
  document.getElementById("titleModalSave").addEventListener("click",saveTitleModal);
  document.getElementById("titleModalBackdrop").addEventListener("click",e=>{if(e.target.id==="titleModalBackdrop")closeTitleModal();});
  document.getElementById("quizTitleInput").addEventListener("keydown",e=>{if(e.key==="Enter")saveTitleModal();if(e.key==="Escape")closeTitleModal();});
  const draft=loadDraft();if(draft&&draft.rounds&&draft.rounds.length>0){quiz=draft;activeRoundIndex=0;}
  rerender();
}
document.addEventListener("DOMContentLoaded",init);
