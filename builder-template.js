// =============================================================================
// builder-template.js
// -----------------------------------------------------------------------------
// Worksheet HTML template for student-facing activity files.
// Compiled by builder.js — slot markers below are replaced at build time.
//
// SLOTS (filled by builder.js compileActivity()):
//   {{TITLE}}              — Activity title (HTML-escaped)
//   {{ACTIVITY_SLUG}}      — Slugified title, used for localStorage keys
//   {{WEBHOOK_URL}}        — Apps Script Web App URL for submissions
//   {{GOOGLE_CLIENT_ID}}   — Google OAuth client ID for student sign-in
//   {{DESMOS_API_SCRIPT}}  — <script> tag for Desmos API (empty if no Desmos tool used)
//   {{PROBLEMS_HTML}}      — Compiled problem cells
//   {{SIDEBAR_TOOLS_JSON}} — JSON array of sidebar tool configs (rendered at runtime)
//   {{BUILDER_STATE_JSON}} — Full builder state (round-trip editing seed)
//
// CRITICAL: The inline <script> blocks inside this template are wrapped in the
// outer template literal. Inside those inner scripts we MUST use:
//   - string concatenation only (no backticks, no ${} interpolation)
//   - <\/script> in any string that contains the closing script tag
// =============================================================================

const WORKSHEET_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<title>{{TITLE}} &mdash; Algebra II</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,400&amp;family=DM+Mono:wght@400;500&amp;family=DM+Sans:wght@300;400;500;600&amp;display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"><\/script>
<script src="https://accounts.google.com/gsi/client" async defer><\/script>
{{DESMOS_API_SCRIPT}}
{{MARKDOWN_PARSER_SCRIPT}}
<style>
:root{
  --ink:#1a1814;--ink-mid:#4a4540;--ink-light:#8a857e;
  --rule:#d8d2c8;--page:#faf8f4;--cream:#f0ece4;
  --accent:#1a4a8a;--accent-lt:#e8eef7;
  --green:#1a6640;--green-bg:#eaf4ee;--green-rule:#7abf9a;
  --red:#8a1a1a;--red-bg:#f4e8e8;--red-rule:#d49090;
  --amber:#6b5500;--amber-bg:#fff8e8;
  --serif:'Source Serif 4',Georgia,serif;
  --sans:'DM Sans',system-ui,sans-serif;
  --mono:'DM Mono',monospace;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--sans);background:var(--cream);color:var(--ink);min-height:100vh;padding:24px 16px 80px 96px}
.shell{max-width:920px;margin:0 auto}

/* ---------- HEADER ---------- */
.page-header{margin-bottom:18px}
.district-badge{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-light);margin-bottom:6px}
.badge-dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
.page-header h1{font-family:var(--serif);font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1.15;margin-bottom:4px}
.page-header p{font-size:13px;color:var(--ink-mid);font-weight:300}

/* ---------- STUDENT BAR ---------- */
.student-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:14px 16px;background:var(--page);border:1px solid var(--rule);border-radius:5px;margin-bottom:24px}
.student-bar label{font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-light);display:flex;flex-direction:column;gap:4px;flex:1;min-width:130px}
.student-bar input,.student-bar select{font-family:var(--sans);font-size:13px;padding:6px 8px;border:1px solid var(--rule);border-radius:3px;background:white;color:var(--ink);font-weight:400;letter-spacing:0;text-transform:none;outline:none;transition:border-color .15s}
.student-bar input:focus,.student-bar select:focus{border-color:var(--accent)}
#gsiHolder{margin-left:auto;display:flex;align-items:center;gap:10px}
#gsiUserChip{display:none;font-size:12px;color:var(--ink-mid);align-items:center;gap:6px}
#gsiUserChip.active{display:inline-flex}
#gsiUserChip button{font-family:var(--mono);font-size:10px;padding:3px 8px;border:1px solid var(--rule);background:white;border-radius:3px;cursor:pointer;color:var(--ink-light)}

/* ---------- STICKY RIBBON (sidebar) ---------- */
.sticky-panel{position:fixed;top:24px;left:0;width:72px;background:var(--page);border-right:1px solid var(--rule);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);border-radius:0 6px 6px 0;padding:8px 6px;display:flex;flex-direction:column;gap:6px;z-index:20;max-height:calc(100vh - 48px);overflow-y:auto}
.ribbon-btn{font-family:var(--sans);font-size:10px;font-weight:500;letter-spacing:.04em;padding:8px 4px;border:1px solid transparent;border-radius:4px;cursor:pointer;background:transparent;color:var(--ink-mid);display:flex;flex-direction:column;align-items:center;gap:4px;transition:all .12s;line-height:1.2;text-align:center}
.ribbon-btn:hover{background:var(--cream);border-color:var(--rule);color:var(--ink)}
.ribbon-btn.active{background:var(--accent-lt);border-color:#8aaad4;color:var(--accent)}
.rb-icon{font-size:18px;line-height:1}
.rb-label{font-size:9.5px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}
.ribbon-divider{height:1px;background:var(--rule);margin:4px 6px}

/* ---------- FLOATING WINDOWS ---------- */
.float-window{position:fixed;background:white;border:1px solid var(--rule);border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;min-width:300px;min-height:220px}
.float-win-header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 8px 14px;background:var(--page);border-bottom:1px solid var(--rule);cursor:move;user-select:none;touch-action:none;flex-shrink:0}
.float-win-title{font-size:12px;font-weight:500;color:var(--ink-mid);letter-spacing:.04em}
.float-win-close{width:22px;height:22px;border:none;background:transparent;color:var(--ink-light);font-size:14px;cursor:pointer;border-radius:3px;display:flex;align-items:center;justify-content:center;line-height:1}
.float-win-close:hover{background:var(--red-bg);color:var(--red)}
.float-win-body{flex:1;position:relative;overflow:hidden;background:white}
.float-win-body iframe{width:100%;height:100%;border:0;display:block}
.float-win-resize{position:absolute;bottom:0;right:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none;z-index:5;background:linear-gradient(135deg,transparent 0 55%,var(--ink-light) 55% 62%,transparent 62% 72%,var(--ink-light) 72% 79%,transparent 79%)}

/* ---------- REFERENCE SHEET (rendered inside a float window) ---------- */
.ref-sheet{padding:18px 22px 24px;font-family:var(--serif);color:var(--ink);overflow-y:auto;height:100%;font-size:14px;line-height:1.55}
.ref-sheet-title{font-family:var(--serif);font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--ink);margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid var(--rule)}
.ref-sheet h3.ref-section{font-family:var(--sans);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:18px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--rule)}
.ref-sheet h3.ref-section:first-child,.ref-sheet-title + h3.ref-section{margin-top:0}
.ref-sheet h4.ref-subsection{font-family:var(--sans);font-size:12px;font-weight:500;letter-spacing:.04em;color:var(--ink-mid);margin:12px 0 6px;text-transform:none}
.ref-sheet .ref-row{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:14px;align-items:baseline;padding:6px 0;border-bottom:1px dotted var(--rule)}
.ref-sheet .ref-row:last-child{border-bottom:none}
.ref-sheet .ref-label{font-family:var(--sans);font-size:12px;font-weight:500;color:var(--ink-mid);letter-spacing:.01em}
.ref-sheet .ref-body{font-family:var(--serif);font-size:15px;color:var(--ink);overflow-x:auto}
.ref-sheet .ref-para{margin:6px 0;font-size:14px;line-height:1.6}
.ref-sheet ul.ref-list{margin:6px 0 6px 22px;padding:0;font-size:14px}
.ref-sheet ul.ref-list li{margin:3px 0}
.ref-sheet hr.ref-hr{border:none;border-top:1px solid var(--rule);margin:14px 0}
.ref-sheet-empty{padding:24px;color:var(--ink-light);font-size:13px;text-align:center;font-family:var(--sans)}

/* ---------- EXTENDED MARKDOWN COMPONENTS ---------- */
/* Used inside .ref-sheet (reference sheets) and .prob-stem (problem stems). */
.md-heading{font-family:var(--sans)}
.md-heading-1{font-family:var(--serif);font-size:20px;font-weight:600;letter-spacing:-.01em;color:var(--ink);margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--rule)}
/* h2 (.md-heading-2) and h3 (.md-heading-3) reuse .ref-section / .ref-subsection styling above */

.md-para{margin:8px 0;line-height:1.6}
.md-list{margin:8px 0 8px 22px;padding:0;font-size:14px}
.md-list li{margin:3px 0}
.md-hr{border:none;border-top:1px solid var(--rule);margin:14px 0}

.md-code{font-family:var(--mono);font-size:13px;padding:1px 5px;background:var(--cream);border:1px solid var(--rule);border-radius:3px;color:var(--ink)}
.md-highlight{background:linear-gradient(transparent 55%,#fff09a 55%);padding:0 2px;color:var(--ink)}

/* Tables */
.md-table-wrap{overflow-x:auto;margin:10px 0}
.md-table{border-collapse:collapse;width:100%;font-size:14px;font-family:var(--sans)}
.md-table th,.md-table td{border:1px solid var(--rule);padding:7px 11px;text-align:left;vertical-align:top}
.md-table th{background:var(--page);font-size:11px;font-weight:600;color:var(--ink-mid);letter-spacing:.06em;text-transform:uppercase}
.md-table tbody tr:nth-child(even){background:rgba(240,236,228,.4)}
.md-table td{font-family:var(--serif);font-size:14px;line-height:1.5}

/* Callouts */
.md-callout{display:flex;gap:10px;padding:10px 14px;border-left:3px solid;border-radius:4px;margin:10px 0;font-size:14px}
.md-callout-icon{flex-shrink:0;font-size:16px;line-height:1.55;color:inherit;opacity:.85}
.md-callout-body{flex:1;min-width:0}
.md-callout-body > :first-child{margin-top:0}
.md-callout-body > :last-child{margin-bottom:0}
.md-callout-note{background:var(--accent-lt);border-left-color:var(--accent);color:var(--ink)}
.md-callout-tip{background:var(--green-bg);border-left-color:var(--green-rule);color:var(--ink)}
.md-callout-warning{background:#fff8e8;border-left-color:#d4b76a;color:var(--ink)}
.md-callout-example{background:var(--cream);border-left-color:var(--ink-light);color:var(--ink)}
.md-callout-definition{background:#f3edf7;border-left-color:#a78bbf;color:var(--ink)}
.md-callout-theorem{background:#eef0f2;border-left-color:#90979f;color:var(--ink)}

/* Multi-column layouts */
.md-columns{display:grid;gap:14px;margin:12px 0;align-items:start}
.md-columns-2{grid-template-columns:1fr 1fr}
.md-columns-3{grid-template-columns:1fr 1fr 1fr}
.md-columns-4{grid-template-columns:1fr 1fr 1fr 1fr}
.md-column > :first-child{margin-top:0}
.md-column > :last-child{margin-bottom:0}
@media (max-width:560px){
  .md-columns-2,.md-columns-3,.md-columns-4{grid-template-columns:1fr}
}

/* Section color tinting */
.md-section{padding:8px 14px 12px;border-left:3px solid;border-radius:4px;margin:14px 0;background:transparent}
.md-section > :first-child{margin-top:6px}
.md-section > :last-child{margin-bottom:0}
.md-section-blue{background:rgba(26,74,138,.04);border-left-color:var(--accent)}
.md-section-green{background:rgba(26,102,64,.04);border-left-color:var(--green)}
.md-section-amber{background:rgba(107,85,0,.05);border-left-color:#d4b76a}
.md-section-red{background:rgba(138,26,26,.04);border-left-color:var(--red)}
.md-section-purple{background:rgba(125,79,170,.04);border-left-color:#a78bbf}
.md-section-gray{background:rgba(74,69,64,.04);border-left-color:var(--ink-light)}
.md-section-teal{background:rgba(26,102,102,.04);border-left-color:#3a8a8a}

/* Heading text color (when {color=X} used without section grouping) */
.md-color-blue{color:var(--accent)}
.md-color-green{color:var(--green)}
.md-color-amber{color:#8a7000}
.md-color-red{color:var(--red)}
.md-color-purple{color:#7d4faa}
.md-color-gray{color:var(--ink-mid)}
.md-color-teal{color:#3a8a8a}

/* ---------- PROBLEM CELLS ---------- */
.main-content{margin-top:12px}
.problem-cell{background:var(--page);border:1px solid var(--rule);border-radius:5px;padding:18px 22px;margin-bottom:14px}
.prob-num{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--ink-light);margin-bottom:8px}
.prob-stem{font-family:var(--serif);font-size:17px;line-height:1.7;color:var(--ink)}
/* Stems may contain multiple <p class="md-para"> chunks emitted by the
   markdown parser when LaTeX line-break commands or paragraph breaks are
   present. Default <p> margins create unwanted vertical gaps between
   adjacent stem lines, so we zero them. The dropdown markup is span-based
   (phase 7+) so it nests cleanly inside <p> without forcing structural
   breaks. Block-level constructs intentionally placed in stems (lists,
   callouts, tables) keep their margins via their own selectors. */
.prob-stem > p,
.prob-stem > .md-para,
.prob-stem p.md-para{
  margin:0;
}
/* Collapse any double <br> the parser emitted at line breaks. */
.prob-stem br + br{display:none}

/* Phase 8: answer-key text. When the activity is compiled in answer-key
   mode (builder-only, via the "Print answer key" button), each blank's
   underline/dropdown is replaced with a gray-text span containing the
   correct answer. The wrap uses the SAME width formula as a regular blank
   (calc with --ans-len) so the answer-key layout has identical horizontal
   geometry to the student version — easy side-by-side grading. The answer
   text sits inside, with an underline matching where the student would
   write. The styling reads like a teacher's pencil annotation:
   light gray, slightly italic. Visible in both on-screen preview and
   actual print. */
.ans-key-wrap{
  display:inline-block;
  margin:0 4px;
  vertical-align:baseline;
  /* Match the screen-mode inline blank width. The +1em bias matches what
     input.ans-num.inline-blank uses (line ~196), so the underline below
     this answer aligns exactly with where the student-version underline
     would have been. */
  width:calc(var(--ans-len, 8) * 0.7em + 2.5em);
  min-width:60px;
  border-bottom:1px solid #aaa;
  text-align:center;
  /* Slight padding to keep the answer text from butting against the edges
     when it's near the wrap's full width. */
  padding:0 4px 1px 4px;
  box-sizing:border-box;
}
.ans-key{
  color:#888;
  font-style:italic;
  font-family:var(--serif);
  font-weight:500;
}
.ans-key-missing{color:#c00;font-style:italic;font-size:0.9em}

/* In print mode, scale the answer-key wrap to match print-mode blank
   geometry (which uses a slightly different calc). The print blank uses
   calc(var(--ans-len, 8) * 0.55em + 1em); we mirror it here so a printed
   key and printed student version overlay perfectly. */
body.print-preview .ans-key-wrap,
@media print{}
body.print-preview .ans-key-wrap{
  width:calc(var(--ans-len, 8) * 0.55em + 1em);
  min-width:60px;
  border-bottom:1.5px solid #000;
  padding:0 4px 1px 4px;
}
body.print-preview .ans-key{
  /* Slightly darker in print so the gray actually shows on paper —
     ink-jet/laser printers can wash out very light grays. */
  color:#444;
}
@media print{
  .ans-key-wrap{
    width:calc(var(--ans-len, 8) * 0.55em + 1em);
    min-width:60px;
    border-bottom:1.5px solid #000;
    padding:0 4px 1px 4px;
  }
  .ans-key{color:#444}
}
.stem-text{display:inline}
.ans-num{font-family:var(--mono);font-size:14px;padding:7px 11px;border:1px solid var(--rule);border-radius:3px;background:white;color:var(--ink);min-width:200px;outline:none;transition:border-color .15s,background .15s}
.ans-num:focus{border-color:var(--accent)}
.ans-num.correct{border-color:var(--green-rule);background:var(--green-bg)}
.ans-num.incorrect{border-color:var(--red-rule);background:var(--red-bg)}
.feedback{display:inline-block;margin-left:10px;font-size:13px;font-weight:500}
.feedback.correct{color:var(--green)}
.feedback.incorrect{color:var(--red)}
.prob-feedback{margin-left:0;display:block;margin-top:8px;min-height:1em}

/* Embedded static graphs (pre-rendered from Desmos at compile time)
   The wrap is a <span> (so it nests cleanly inside the parser's <p class="md-para">)
   but we display it as a block-level image container via CSS. inline-block
   plus width:100% gives block-like layout while remaining HTML-valid inside
   inline content. The image scales to its container width via max-width:100%
   on .prob-graph. */
.prob-graph-wrap{display:inline-block;width:100%;margin:14px 0;text-align:center}
.prob-graph{display:inline-block;max-width:100%;height:auto;border:1px solid var(--rule);border-radius:4px;background:white}
.prob-graph-caption{display:block;font-family:var(--sans);font-size:11px;color:var(--ink-light);margin-top:4px;font-style:italic}

@media print {
  .prob-graph-wrap{break-inside:avoid;page-break-inside:avoid;margin:10px 0}
  .prob-graph{border-color:#999;max-width:100%;height:auto}
  .prob-graph-caption{display:none}
}

/* Inline blanks (placed mid-sentence in stem) */
.inline-blank{min-width:80px;width:auto;padding:3px 8px;font-size:14px;vertical-align:baseline;margin:0 4px}
.inline-blank-wrap{display:inline-block;margin:0 4px;vertical-align:baseline}
/* Dropdown width inside an inline blank: scale to expected answer length
   via --ans-len (set on the wrap by _compileBlankInput). Cap minimum at
   60px (enough for 1-2 char answers like "y" or "up") rather than the
   prior 140px which forced 6+ blanks per stem to wrap onto separate
   lines. The em-based formula matches the print-mode underline logic
   so screen and print look proportional. */
.inline-blank-wrap .md-dropdown{
  min-width:60px;
  width:calc(var(--ans-len, 8) * 0.7em + 2.5em);
}
.inline-blank-wrap .md-trigger{padding:4px 9px;font-size:13px}
/* Inline fill-in (text input) needs the same scaling. The base .ans-num rule
   sets min-width:200px which would force every fill-in inline blank onto its
   own line in a multi-blank stem. Override here. --ans-len is set on the
   input element directly by _compileBlankInput. */
input.ans-num.inline-blank{
  min-width:60px;
  width:calc(var(--ans-len, 8) * 0.7em + 2.5em);
  font-size:14px;
  padding:4px 9px;
}

/* Suppress per-problem feedback when score-only mode is on */
.problem-cell[data-score-only="1"] .ans-num.correct,
.problem-cell[data-score-only="1"] .ans-num.incorrect{border-color:var(--rule);background:white}
.problem-cell[data-score-only="1"] .md-trigger.correct,
.problem-cell[data-score-only="1"] .md-trigger.incorrect{border-color:var(--rule);background:white}
.problem-cell[data-score-only="1"] .feedback{display:none}

/* Suppress live feedback (only show on Submit) — JS adds .live-suppressed when feedback should hide */
.live-suppressed .ans-num.correct,
.live-suppressed .ans-num.incorrect{border-color:var(--rule);background:white}
.live-suppressed .md-trigger.correct,
.live-suppressed .md-trigger.incorrect{border-color:var(--rule);background:white}
.live-suppressed .feedback{display:none}

.missing-blank{display:inline-block;padding:2px 8px;background:var(--red-bg);border:1px solid var(--red-rule);border-radius:3px;color:var(--red);font-family:var(--mono);font-size:11px;margin:0 4px}

/* ---------- CUSTOM DROPDOWN (math + text choices) ---------- */
.md-dropdown{position:relative;display:inline-block;min-width:240px;vertical-align:baseline}
.md-trigger{font-family:var(--mono);font-size:14px;padding:7px 11px;border:1px solid var(--rule);border-radius:3px;background:white;color:var(--ink);cursor:pointer;display:inline-flex;justify-content:space-between;align-items:center;gap:10px;transition:border-color .15s,background .15s;user-select:none}
.md-trigger::after{content:'\\25BE';color:var(--ink-light);font-size:11px;flex-shrink:0}
.md-trigger:hover{border-color:var(--accent)}
.md-dropdown[data-open] .md-trigger{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-lt)}
.md-trigger.correct{border-color:var(--green-rule);background:var(--green-bg)}
.md-trigger.incorrect{border-color:var(--red-rule);background:var(--red-bg)}
.md-trigger-label{display:inline-block;flex:1}
.md-placeholder{color:var(--ink-light);font-style:italic}
.md-options{display:none;position:absolute;top:calc(100% + 4px);left:0;background:white;border:1px solid var(--rule);border-radius:3px;box-shadow:0 4px 14px rgba(0,0,0,.1);max-height:280px;overflow-y:auto;z-index:50;padding:2px;min-width:160px}
.md-dropdown[data-open] .md-options{display:block}
.md-option{display:block;padding:8px 11px;cursor:pointer;border-radius:2px;font-family:var(--mono);font-size:14px;color:var(--ink);transition:background .1s;white-space:nowrap}
.md-option:hover,.md-option:focus{background:var(--accent-lt);color:var(--accent);outline:none}

/* ---------- SCORE BADGE ---------- */
.score-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:white;border:1px solid var(--rule);border-radius:20px;font-family:var(--mono);font-size:12px;font-weight:600;color:var(--ink);margin-left:12px}
.score-badge .score-val{color:var(--accent);font-size:14px}
.score-badge .score-pct{color:var(--ink-light);font-size:10px;font-weight:500}

/* ---------- SUBMIT ---------- */
.submit-wrap{margin-top:24px;padding:18px 22px;background:var(--accent-lt);border:1px solid #8aaad4;border-radius:5px;display:flex;align-items:center;gap:14px}
#submitBtn{font-family:var(--sans);font-size:13px;font-weight:600;padding:9px 20px;border:none;border-radius:3px;cursor:pointer;background:var(--accent);color:white;transition:background .15s}
#submitBtn:hover{background:#143a6a}
#submitBtn:disabled{background:var(--ink-light);cursor:not-allowed}
#submitMsg{font-size:13px;color:var(--ink-mid)}
#submitMsg.success{color:var(--green);font-weight:500}
#submitMsg.error{color:var(--red);font-weight:500}

/* ---------- MOBILE LAYOUT ---------- */
/* Sidebar ribbon -> fixed bottom toolbar.
   Tool windows -> bottom sheet that fills lower 62vh.
   One window open at a time on mobile (enforced in JS). */
@media (max-width:720px){
  body{
    padding:14px 12px calc(76px + env(safe-area-inset-bottom)) 12px;
    -webkit-text-size-adjust:100%;
  }

  /* Header */
  .page-header h1{font-size:24px}
  .page-header p{font-size:12px}

  /* Student bar: 2-up grid; GSI button drops to its own row */
  .student-bar{padding:12px;gap:10px}
  .student-bar label{min-width:0;flex:1 1 calc(50% - 5px)}
  .student-bar input,.student-bar select{font-size:16px;padding:9px 10px}
  #gsiHolder{margin-left:0;flex:1 1 100%;justify-content:flex-start;flex-wrap:wrap}

  /* Sidebar -> bottom toolbar (horizontal scroll) */
  .sticky-panel{
    position:fixed;
    top:auto;
    bottom:0;
    left:0;
    right:0;
    width:auto;
    flex-direction:row;
    flex-wrap:nowrap;
    overflow-x:auto;
    overflow-y:hidden;
    max-height:none;
    border-radius:0;
    border-top:1px solid var(--rule);
    border-right:none;
    border-left:none;
    border-bottom:none;
    box-shadow:0 -2px 10px rgba(0,0,0,.08);
    padding:6px 8px calc(6px + env(safe-area-inset-bottom));
    gap:4px;
    -webkit-overflow-scrolling:touch;
  }
  .ribbon-btn{
    flex-shrink:0;
    min-width:64px;
    min-height:48px;
    padding:6px 10px;
    flex-direction:column;
  }
  .ribbon-divider{
    width:1px;height:auto;margin:6px 2px;flex-shrink:0;align-self:stretch;
  }

  /* Float windows -> bottom sheets (CSS pins them; ignores inline left/top) */
  .float-window{
    position:fixed !important;
    left:0 !important;
    right:0 !important;
    top:auto !important;
    bottom:calc(60px + env(safe-area-inset-bottom)) !important;
    width:auto !important;
    height:62vh !important;
    max-height:calc(100vh - 60px - env(safe-area-inset-bottom) - 24px) !important;
    border-radius:14px 14px 0 0;
    box-shadow:0 -8px 28px rgba(0,0,0,.18);
    animation:sheetSlideUp .22s ease-out;
  }
  @keyframes sheetSlideUp{
    from{transform:translateY(100%)}
    to{transform:translateY(0)}
  }
  .float-win-header{
    cursor:default;
    padding:18px 12px 10px 16px;
    position:relative;
    touch-action:auto;
  }
  /* Grab-handle visual at top of sheet */
  .float-win-header::before{
    content:'';
    position:absolute;
    top:6px;
    left:50%;
    transform:translateX(-50%);
    width:36px;
    height:4px;
    border-radius:2px;
    background:var(--rule);
  }
  .float-win-close{width:36px;height:36px;font-size:18px}
  .float-win-resize{display:none}

  /* Problem cells: tighter padding; full-width inputs (16px font = no iOS zoom) */
  .problem-cell{padding:14px 16px}
  .ans-num{min-width:0;width:100%;font-size:16px;padding:10px 12px}
  /* Inline blanks stay inline — scale to --ans-len like desktop, just with
     slightly larger touch-target padding/font. */
  .ans-num.inline-blank,.inline-blank-wrap .ans-num{
    width:calc(var(--ans-len, 8) * 0.7em + 2.5em);min-width:60px;display:inline-block;font-size:14px;padding:4px 10px
  }

  /* Dropdowns: full-width unless inline */
  .md-dropdown{display:block;min-width:0;width:100%}
  .md-trigger{font-size:16px;padding:10px 12px;width:100%}
  .md-option{padding:10px 12px;font-size:15px}
  .inline-blank-wrap .md-dropdown{display:inline-block;width:calc(var(--ans-len, 8) * 0.7em + 2.5em);min-width:60px}
  .inline-blank-wrap .md-trigger{font-size:14px;padding:5px 10px;width:auto}

  /* Math overflow: long display equations scroll horizontally instead of breaking layout */
  .katex-display{overflow-x:auto;overflow-y:hidden;max-width:100%;padding:4px 0}

  /* Submit area */
  .submit-wrap{flex-wrap:wrap;padding:14px 16px;gap:10px}
  .score-badge{margin-left:0}
  #submitBtn{font-size:15px;padding:11px 22px;flex:0 0 auto}

  /* Reference sheets: stack the two-column rows */
  .ref-sheet{padding:14px 16px 18px;font-size:13px}
  .ref-sheet .ref-row{grid-template-columns:1fr;gap:4px;padding:8px 0}
  .ref-sheet .ref-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  .ref-sheet .ref-body{font-size:14px}
}

/* Narrow phones: stack student bar to 1-up */
@media (max-width:420px){
  .student-bar label{flex:1 1 100%}
  .ribbon-btn{min-width:58px}
  .rb-label{font-size:9px}
}

/* ============================================================================
   PRINT MODE — phase 1 skeleton
   ============================================================================
   Two activation paths share one rule set:
     - body.print-preview        on-screen preview (simulated paper sheet)
     - @media print              actual paper output

   Phase 1 establishes:
     - @page geometry (letter portrait, 0.75in margins)
     - On-screen sheet simulation (white paper on gray void background)
     - Hiding of non-printable UI (ribbon, submit, sign-in, student-bar, floats)
     - Body & shell padding overrides so cream background and ribbon-left
       padding (96px) do not bleed into the print layout

   Phases 2-9 will add modifier classes layered onto .print-preview:
     - body.pm-booklet           letter-landscape with 4-page imposition
     - body.pm-cols-{1,2,3}      column counts + width presets
     - body.pm-units-cm          unit toggle for workspace sizes
     - body.pm-answer-key        inline answer rendering
     - body.pm-show-page-guides  dashed informational page-break boundaries

   The existing graph-specific @media print block (above, near .prob-graph) is
   left in place; it composes with the rules below.
   ============================================================================ */

/* @page geometry — mode-dependent, baked in at compile time. The slot is
   filled by compileActivity() based on builderState.print.mode. Letter
   mode uses portrait + 0.75in margins (matches the rest of the print
   layout); booklet mode uses landscape + 0 margins (the .sheet element
   provides its own margins via its own padding/margin scheme). */
{{PRINT_PAGE_RULE}}

/* ---- ON-SCREEN PREVIEW ----
   Simulates how a teacher would see the activity laid out on paper, so they
   can see content layout before committing to a print run. The simulated
   sheet sits on a gray void so the white page is visible. */
body.print-preview{
  background:#6a6a6a !important;
  padding:0 !important;
  display:flex;
  justify-content:center;
  align-items:flex-start;
  min-height:100vh;
}
body.print-preview .shell{
  background:white;
  width:8.5in;
  min-height:11in;
  margin:24px auto;
  padding:0.75in;
  box-shadow:0 2px 14px rgba(0,0,0,.25);
  max-width:none;
  border:1px solid #444;
  position:relative;
}

/* Hide non-printable interactive UI during preview. Same selectors are
   repeated under @media print below so a Ctrl+P without entering preview
   mode still produces a clean print. */
body.print-preview .sticky-panel,
body.print-preview .submit-wrap,
body.print-preview #floatingWindowContainer,
body.print-preview #gsiHolder,
body.print-preview .student-bar{display:none !important}

/* In preview, problem cells should already look print-clean (no cream
   background, neutral border) so what teachers see matches paper output. */
body.print-preview .problem-cell{
  background:white;
  border-color:#999;
  page-break-inside:avoid;
  break-inside:avoid;
}

/* ---- ACTUAL PRINT ---- */
@media print{
  /* Hide non-printables regardless of whether preview class is on. */
  .sticky-panel,
  .submit-wrap,
  #floatingWindowContainer,
  #gsiHolder,
  .student-bar{display:none !important}

  /* Body: clear cream background and the 96px ribbon-left padding. */
  body{
    background:white !important;
    color:black;
    padding:0 !important;
    min-height:0;
  }

  /* Shell: drop the 920px max-width and auto-centering — @page margin
     handles paper margins now. */
  .shell{
    max-width:none !important;
    margin:0 !important;
    padding:0 !important;
  }

  /* Problem cells: ink-friendly + don't split a problem across pages. */
  .problem-cell{
    background:white;
    border-color:#999;
    page-break-inside:avoid;
    break-inside:avoid;
  }

  /* If preview class is still on when printing (later phases will add a JS
     beforeprint hook), strip the simulated-sheet styling — the printer
     applies paper and margins itself. */
  body.print-preview{
    background:white !important;
    display:block;
  }
  body.print-preview .shell{
    background:white;
    width:auto;
    min-height:0;
    margin:0;
    padding:0;
    box-shadow:none;
    border:none;
  }
}

/* ============================================================================
   PRINT MODE — phase 3: element transforms
   ============================================================================
   Blanks become underlines, dropdowns become underlines (per design — choices
   are not shown on paper; students get them from teacher/board), and grading
   feedback is stripped.

   Underline width scales to expected answer length via the --ans-len CSS
   variable set at compile time on each blank/wrapper (see _compileBlankInput
   in builder.js). Floor of 4 chars in the compiler + min-width safety here
   keeps very-short answers from collapsing to invisible underlines.

   All rules live under body.print-preview and rely on the beforeprint hook
   (above, in runtime script) to apply the class for direct Ctrl+P prints.
   The phase 1 @media print block is kept as a defense-in-depth fallback for
   any environment where beforeprint doesn't fire.
   ============================================================================ */

/* ---- Fill-in blanks → underline ---- */
body.print-preview input.inline-blank,
body.print-preview input.ans-num:not([type="hidden"]){
  width:calc(var(--ans-len, 8) * 0.55em + 1em) !important;
  min-width:60px;
  border:none !important;
  border-bottom:1.5px solid #000 !important;
  background:transparent !important;
  border-radius:0 !important;
  padding:0 4px 1px 4px !important;
  color:#000 !important;
  box-shadow:none !important;
  font-family:var(--serif);
}
/* Standalone (non-inline) full-width blanks get a longer underline floor */
body.print-preview input.ans-num:not(.inline-blank):not([type="hidden"]){
  min-width:180px;
}

/* ---- Dropdowns → underline (no choices shown) ---- */
body.print-preview .inline-blank-wrap{
  vertical-align:baseline;
}
body.print-preview .md-dropdown{
  display:inline-block;
  width:calc(var(--ans-len, 8) * 0.55em + 1em);
  min-width:80px;
}
body.print-preview .md-trigger{
  display:inline-block;
  width:100%;
  border:none !important;
  border-bottom:1.5px solid #000 !important;
  border-radius:0 !important;
  background:transparent !important;
  padding:0 4px 1px 4px !important;
  color:#000 !important;
  box-shadow:none !important;
  font-family:var(--serif);
  font-size:14px;
}
body.print-preview .md-trigger::after{display:none !important}
body.print-preview .md-options{display:none !important}
/* Hide the "— Select —" placeholder content but keep layout space */
body.print-preview .md-trigger .md-placeholder{visibility:hidden}

/* ---- Grading colors stripped (ink-heavy + irrelevant on paper) ----
   Phase 8 (answer key) will introduce a separate visual treatment for
   showing correct answers. */
body.print-preview .ans-num.correct,
body.print-preview .ans-num.incorrect,
body.print-preview .md-trigger.correct,
body.print-preview .md-trigger.incorrect{
  background:transparent !important;
  border-color:transparent transparent #000 transparent !important;
}

/* ---- Feedback messages dropped ---- */
body.print-preview .feedback,
body.print-preview .prob-feedback{display:none !important}

/* ---- Problem number / stem: ink-friendly tweaks ---- */
body.print-preview .prob-num{
  color:#000;
  font-weight:600;
}

/* ---- Graphs: extend the existing @media print rule to preview mode too,
   so what teachers see in preview matches what comes out of the printer. */
body.print-preview .prob-graph-caption{display:none}
body.print-preview .prob-graph{border-color:#999}
body.print-preview .prob-graph-wrap{
  break-inside:avoid;
  page-break-inside:avoid;
  margin:10px 0;
}

/* ============================================================================
   PRINT MODE — phase 4: workspace areas
   ============================================================================
   Per-problem work space rendered below each problem when its size is set.
   Compile-time output is a single div carrying:
     - data-format  one of {blank, lines, dots, squares, coord}
     - --ws-h       canonical height in inches
   Format selects the background pattern; height is honored verbatim.

   Hidden in screen mode (only the print view shows them). Patterns use
   linear-gradient/radial-gradient backgrounds so they print cleanly on any
   printer without needing image assets.
   ============================================================================ */

/* Hidden by default — only renders in print mode */
.prob-workspace{display:none}

body.print-preview .prob-workspace{
  display:block;
  height:var(--ws-h, 1in);
  margin-top:14px;
  border:1px solid #999;
  border-radius:2px;
  background-color:white;
  page-break-inside:avoid;
  break-inside:avoid;
}

/* Blank format — just the bordered box, no pattern. */
body.print-preview .prob-workspace[data-format="blank"]{
  background-image:none;
}

/* Dot grid — radial gradient at 1/4" spacing. Default for new problems. */
body.print-preview .prob-workspace[data-format="dots"]{
  background-image:radial-gradient(circle, #999 0.6px, transparent 0.7px);
  background-size:0.25in 0.25in;
  background-position:0.125in 0.125in;
}

/* Ruled lines — horizontal lines at 0.3" spacing (notebook-paper density). */
body.print-preview .prob-workspace[data-format="lines"]{
  background-image:linear-gradient(
    to bottom,
    transparent calc(0.3in - 1px),
    #bbb calc(0.3in - 1px),
    #bbb 0.3in,
    transparent 0.3in
  );
  background-size:100% 0.3in;
  background-position:0 0.3in;  /* offset so first line isn't flush with top */
}

/* Square grid — full graph paper at 1/4" spacing. */
body.print-preview .prob-workspace[data-format="squares"]{
  background-image:
    linear-gradient(#ddd 1px, transparent 1px),
    linear-gradient(90deg, #ddd 1px, transparent 1px);
  background-size:0.25in 0.25in;
}

/* Coordinate plane — light 1/4" grid + bold centered axes. The axes are two
   thin gradient bands positioned at exactly 50% of width/height. Works for
   any size, though small workspaces (1in) will look cramped. */
body.print-preview .prob-workspace[data-format="coord"]{
  background-image:
    /* horizontal axis */
    linear-gradient(to bottom, transparent calc(50% - 0.7px), #444 calc(50% - 0.7px), #444 calc(50% + 0.7px), transparent calc(50% + 0.7px)),
    /* vertical axis */
    linear-gradient(to right, transparent calc(50% - 0.7px), #444 calc(50% - 0.7px), #444 calc(50% + 0.7px), transparent calc(50% + 0.7px)),
    /* light horizontal grid */
    linear-gradient(#e0e0e0 1px, transparent 1px),
    /* light vertical grid */
    linear-gradient(90deg, #e0e0e0 1px, transparent 1px);
  background-size:
    100% 100%,
    100% 100%,
    0.25in 0.25in,
    0.25in 0.25in;
}

/* ============================================================================
   PRINT MODE — phase 5: column system (CSS Grid)
   ============================================================================
   Activity-wide column count + width preset come from body classes set at
   compile time (e.g. "pm-cols-2 pm-cols-2-60-40"). Per-problem span comes
   from data-span on each .problem-cell. Auto-flow handles natural placement
   so a span-2 problem lands in the next available 2-wide slot.

   Grid only activates in print mode. Screen mode keeps the existing single
   -column flow untouched, so this is purely additive.

   Container: .problems-grid (added in phase 5, wraps PROBLEMS_HTML so the
   submit-wrap and other siblings inside .main-content are not part of the
   grid even when hidden). Default 1-column produces a single-track grid
   that's identical visually to the existing flow but lets data-span="full"
   still work as a no-op.
   ============================================================================ */

/* Grid activates only in print mode. */
body.print-preview .problems-grid{
  display:grid;
  /* Slightly tighter row gap than column gap to match worksheet feel. */
  column-gap:0.3in;
  row-gap:0.18in;
  /* grid-template-columns set per body class below */
}

/* ---- Grid templates per column-count + preset ---- */
body.print-preview.pm-cols-1-equal .problems-grid{
  grid-template-columns:1fr;
}
body.print-preview.pm-cols-2-equal .problems-grid{
  grid-template-columns:1fr 1fr;
}
body.print-preview.pm-cols-2-60-40 .problems-grid{
  grid-template-columns:6fr 4fr;
}
body.print-preview.pm-cols-2-40-60 .problems-grid{
  grid-template-columns:4fr 6fr;
}
body.print-preview.pm-cols-3-equal .problems-grid{
  grid-template-columns:1fr 1fr 1fr;
}
body.print-preview.pm-cols-3-25-37-37 .problems-grid{
  grid-template-columns:25fr 37.5fr 37.5fr;
}

/* ---- Per-problem span ---- */
/* Default (data-span="1") — single column, no rule needed (Grid auto-flow). */

body.print-preview .problem-cell[data-span="2"]{
  grid-column:span 2;
}
body.print-preview .problem-cell[data-span="3"]{
  grid-column:span 3;
}
/* Full-width: span every track regardless of count. 1/-1 is the Grid idiom
   for "from the first line to the last", which always equals the full row. */
body.print-preview .problem-cell[data-span="full"]{
  grid-column:1 / -1;
}

/* In 1-column mode, every problem occupies the whole row anyway. The span
   attributes above still apply but visually collapse to the same outcome —
   no special handling needed. */

/* Tighten cell padding slightly in multi-column layouts so 3-col 1.4"
   columns don't feel claustrophobic. */
body.print-preview.pm-cols-2 .problem-cell,
body.print-preview.pm-cols-3 .problem-cell{
  padding:10px 12px;
}
body.print-preview.pm-cols-3 .problem-cell{
  font-size:13px;
}
body.print-preview.pm-cols-3 .prob-num{
  font-size:9px;
}

/* ============================================================================
   PRINT MODE — phase 6: forced page breaks + informational page guides
   ============================================================================
   Two independent features that share a phase:

   1. Forced page break before a problem
      Per-problem opt-in via [data-page-break-before="1"]. In actual print
      output, browsers honor 'page-break-before: always' (legacy) and
      'break-before: page' (CSS Fragmentation L3). Both are emitted for
      maximum compatibility (Firefox/Chrome/Safari).

      In on-screen preview, a page break can't actually start a new sheet
      (the simulated sheet is a single scrollable .shell), so we instead
      render a thick dashed amber rule above the problem to communicate
      visually: "this is where the next page begins." Combined with the
      page-guide overlay (feature #2), the teacher sees a clear "page X"
      label at the forced-break location.

   2. Informational page guides
      Toggleable via the Page Guides button in the builder. Shows where
      natural page boundaries fall in the simulated sheet. Implemented
      runtime-side (in worksheet runtime script) because we need to know
      the actual rendered shell height to compute boundaries, and that's
      only available after layout. Runtime injects a .page-guide-overlay
      with N child .page-guide elements positioned at multiples of the
      content-area height.

      Guides are presentational only: they do not affect compiled output
      and are never visible to students. CSS hides them by default; the
      pm-show-page-guides body class reveals them.
   ============================================================================ */

/* ---- 1. Forced page break before a problem ---- */

@media print {
  .problem-cell[data-page-break-before="1"]{
    page-break-before:always;
    break-before:page;
  }
}

/* On-screen preview: render an amber rule above the cell so teachers see
   the break location. The rule sits above the cell via a ::before pseudo-
   element so it doesn't disrupt grid placement of the cell itself. */
body.print-preview .problem-cell[data-page-break-before="1"]{
  position:relative;
}
body.print-preview .problem-cell[data-page-break-before="1"]::before{
  content:"\\21B5  Page break before this problem";
  position:absolute;
  top:-18px;
  left:0;
  right:0;
  font-family:var(--mono, monospace);
  font-size:9px;
  font-weight:600;
  letter-spacing:0.05em;
  text-transform:uppercase;
  color:#b8860b;
  border-top:2px dashed #d4a017;
  padding-top:3px;
  pointer-events:none;
}

/* ---- 2. Page-guide overlay ---- */

/* Hidden by default; runtime renders the overlay regardless, but only this
   class makes it visible. Lets the toggle work without re-rendering. */
.page-guide-overlay{display:none;position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;z-index:5}
body.print-preview.pm-show-page-guides .page-guide-overlay{display:block}

/* Each guide is a horizontal dashed line with a "Page N" tag. Positioned
   from top using inline 'top' style set by the runtime. Tag sits at the
   right edge so it doesn't collide with content. */
.page-guide{
  position:absolute;
  left:-12px;
  right:-12px;
  height:0;
  border-top:1.5px dashed #b8860b;
}
.page-guide-label{
  position:absolute;
  right:-4px;
  top:-9px;
  background:#b8860b;
  color:white;
  font-family:var(--mono, monospace);
  font-size:9px;
  font-weight:600;
  letter-spacing:0.05em;
  padding:2px 6px;
  border-radius:2px;
  text-transform:uppercase;
}

/* Shell needs position:relative so absolute-positioned overlay aligns. The
   default .shell rule already sets position:relative in the phase 1 block,
   but reassert here so the dependency is documented. */
body.print-preview .shell{position:relative}

/* ============================================================================
   PRINT MODE — phase 7: header simplification + booklet imposition
   ============================================================================
   Two related features:

   1. Print header simplification (applies to both letter and booklet)
      Drops the district badge ("Dallas ISD · Algebra II") and the
      instruction line ("Complete each problem...") to save paper. Title
      stays. On screen these elements remain visible — only the print
      stylesheet hides them.

   2. Booklet mode (un-nested saddle-stitch)
      Triggered by body.pm-booklet. Each physical sheet is letter-landscape;
      content is split into 5.5"x8.5" logical pages with imposition handled
      at runtime by _renderBooklet. The on-page geometry uses 0.5" outer /
      0.6" inner / 0.5" top-bottom margins per logical page (per spec).

      Reading-order mode (.pm-booklet-reading-order) bypasses imposition and
      shows logical pages in 1..N reading sequence, useful for proofreading.
   ============================================================================ */

/* ---- 1. Print header simplification ---- */
body.print-preview .page-header .district-badge,
body.print-preview .page-header p{display:none !important}
body.print-preview .page-header{
  border-bottom:none;
  margin-bottom:14px;
  padding-bottom:0;
}
body.print-preview .page-header h1{
  margin-top:0;
  margin-bottom:8px;
}
@media print{
  .page-header .district-badge,
  .page-header p{display:none !important}
  .page-header{border-bottom:none;margin-bottom:14px;padding-bottom:0}
  .page-header h1{margin-top:0;margin-bottom:8px}
}

/* ============================================================================
   PRINT MODE — phase 7+: print-only student header strip
   ============================================================================
   The .print-student-header is emitted by _buildPrintHeaderHTML at compile
   time and lives inside .page-header so it inherits "first-page-only"
   behavior in booklet mode (booklet imposition hides .page-header on all
   sheets except the cover, and clones it onto the cover).

   Hidden in screen mode entirely (the existing .student-bar covers digital
   data entry; the print-student-header is purely for paper). Layout:
     - Letter mode: single horizontal row with fields wrapping naturally
       if the activity title is long
     - Booklet mode: two-row stack (Name+Period on row 1, the rest on
       row 2) since 4.4in width is too narrow for the full row inline

   Each field is a label + horizontal underline that the student writes on.
   The Score box is pinned to the right via margin-left:auto on its element.
   ============================================================================ */

.print-student-header{display:none}

body.print-preview .print-student-header,
@media print{} /* placeholder — actual @media print rules below */
body.print-preview .print-student-header{
  display:flex;
  flex-wrap:wrap;
  align-items:flex-end;
  gap:14px 22px;
  margin-top:8px;
  margin-bottom:6px;
  font-family:var(--sans);
  font-size:12px;
  color:#000;
}

.pf-field{display:inline-flex;align-items:flex-end;gap:6px}
.pf-label{font-weight:600;color:#000;letter-spacing:0.02em;flex-shrink:0}
.pf-line{display:inline-block;border-bottom:1px solid #000;height:1.1em;flex-shrink:0}
.pf-w-narrow .pf-line{width:0.7in}
.pf-w-medium .pf-line{width:1.2in}
.pf-w-wide   .pf-line{width:2.4in}

/* Score box: pinned right via margin-left:auto. Two short underlines with
   a "/" between them; teacher fills numerator + denominator (some teachers
   prefer percentages, others prefer score totals — leaving both blank
   accommodates either). */
.pf-score-box{display:inline-flex;align-items:flex-end;gap:5px;margin-left:auto}
.pf-score-box .pf-line{width:0.55in}
.pf-divider{font-weight:600;color:#000;padding:0 1px}

/* Booklet mode: 2-row stack. The cover is only 4.4in wide so we wrap. */
body.print-preview.pm-booklet .print-student-header{
  font-size:11px;
  gap:10px 16px;
}
body.print-preview.pm-booklet .pf-w-wide .pf-line{width:1.8in}
body.print-preview.pm-booklet .pf-w-medium .pf-line{width:0.9in}
body.print-preview.pm-booklet .pf-score-box{
  /* In booklet, score box drops to its own row to avoid cramming */
  margin-left:0;
  flex-basis:100%;
  justify-content:flex-end;
}

@media print{
  .print-student-header{
    display:flex !important;
    flex-wrap:wrap;
    align-items:flex-end;
    gap:14px 22px;
    margin-top:8px;
    margin-bottom:6px;
    font-family:var(--sans);
    font-size:12px;
    color:#000;
  }
  body.pm-booklet .print-student-header{
    font-size:11px;
    gap:10px 16px;
  }
  body.pm-booklet .pf-w-wide .pf-line{width:1.8in}
  body.pm-booklet .pf-w-medium .pf-line{width:0.9in}
  body.pm-booklet .pf-score-box{
    margin-left:0;
    flex-basis:100%;
    justify-content:flex-end;
  }
}

/* ---- 2. Booklet mode ---- */

/* Booklet mode replaces the letter-portrait simulated sheet with sheet-by
   -sheet rendering. The .shell constraints from phase 1 (8.5in width,
   11in min-height) need to be relaxed so multiple landscape sheets can
   stack vertically without clipping. */
body.print-preview.pm-booklet{
  /* Body keeps the gray void; sheets sit on it. */
  align-items:flex-start;
}
body.print-preview.pm-booklet .shell{
  width:auto;
  min-height:0;
  background:transparent;
  padding:24px;
  box-shadow:none;
  border:none;
  display:block;
}

/* In booklet mode the @page geometry is letter landscape — set at compile
   time via the {{PRINT_PAGE_RULE}} slot above. The print dialog should
   open in landscape on most browsers; some printer drivers may still need
   the user to confirm landscape in the dialog manually. */
/* Note: @page rules inside a media query body selector aren't supported,
   so we declare an unscoped @page that only applies in booklet mode by way
   of the body class gate elsewhere. The simplest cross-browser approach is
   to require teachers to manually pick "Landscape" in the print dialog when
   booklet mode is active — most browsers respect that. We document this
   in the UI hint. */

/* Sheet container = one physical letter-landscape sheet (11" x 8.5") */
body.print-preview.pm-booklet .sheet,
@media print{}

body.print-preview.pm-booklet .problems-grid{
  /* Override the grid display from phase 5 — booklet uses sheet-based flow
     instead of a grid template. */
  display:block;
  column-gap:0;
  row-gap:0;
}

body.print-preview.pm-booklet .sheet{
  display:flex;
  flex-direction:row;
  width:11in;
  height:8.5in;
  margin:0 auto 24px auto;
  background:white;
  box-shadow:0 2px 14px rgba(0,0,0,.25);
  border:1px solid #444;
  position:relative;
  page-break-after:always;
  break-after:page;
  overflow:hidden;
}
body.print-preview.pm-booklet .sheet:last-child{
  page-break-after:auto;
  break-after:auto;
}

/* Subtle visual separator between left and right halves so teachers see
   the fold line. Hidden on actual print to avoid confusion. */
body.print-preview.pm-booklet .sheet::after{
  content:"";
  position:absolute;
  left:50%;
  top:0;
  bottom:0;
  width:0;
  border-left:1px dashed #c0c0c0;
  pointer-events:none;
}

/* Sheet label tag — small "Sheet 1 — front" indicator in preview only. */
body.print-preview.pm-booklet .sheet::before{
  content:"Sheet " attr(data-booklet) " \\2014  " attr(data-side, "");
  position:absolute;
  top:-18px;
  left:0;
  font-family:var(--mono, monospace);
  font-size:9px;
  font-weight:600;
  letter-spacing:0.05em;
  color:#888;
  text-transform:uppercase;
}
body.print-preview.pm-booklet .sheet-front::before{content:"Sheet " attr(data-booklet) " \\2014  Front"}
body.print-preview.pm-booklet .sheet-back::before{content:"Sheet " attr(data-booklet) " \\2014  Back"}

/* Logical page — half of a sheet, 5.5" wide x 8.5" tall.
   Margin scheme (per spec): 0.5" outer / 0.6" inner / 0.5" top/bottom.
   Outer = away from spine, Inner = toward spine. For sheet-front, the LEFT
   half is page 4 (glue, back cover) and the RIGHT half is page 1 (front
   cover) — so on sheet-front, the inner edges face each other (right edge
   of left page, left edge of right page). Same on sheet-back. */
body.print-preview.pm-booklet .logical-page{
  width:5.5in;
  height:8.5in;
  position:relative;
  background:white;
  overflow:hidden;
  font-size:13px;
  /* Default symmetric — overridden per-half below */
  padding:0.5in 0.5in 0.5in 0.5in;
  box-sizing:border-box;
}
/* Left half of a sheet: inner margin (right edge) is wider than outer */
body.print-preview.pm-booklet .sheet > .logical-page:first-child{
  padding:0.5in 0.6in 0.5in 0.5in;
  border-right:1px dashed transparent;  /* placeholder; fold line drawn by ::after on .sheet */
}
/* Right half of a sheet: inner margin (left edge) is wider than outer */
body.print-preview.pm-booklet .sheet > .logical-page:last-child{
  padding:0.5in 0.5in 0.5in 0.6in;
}

/* Page-number footer in bottom-outer corner. Skipped on glue page. */
body.print-preview.pm-booklet .logical-page:not(.lp-glue)::after{
  content:attr(data-page-num);
  position:absolute;
  bottom:0.25in;
  font-family:var(--mono, monospace);
  font-size:9px;
  color:#999;
}
body.print-preview.pm-booklet .sheet > .logical-page:first-child:not(.lp-glue)::after{left:0.5in}
body.print-preview.pm-booklet .sheet > .logical-page:last-child:not(.lp-glue)::after{right:0.5in}

/* Glue page = blank back cover. Render mostly empty with a small corner
   mark so the teacher sees this is the side that gets glued into the
   journal. The mark is preview-only; it does NOT print (otherwise it'd
   show up on student-facing booklets). */
body.print-preview.pm-booklet .logical-page.lp-glue{}

/* Cover header: the cloned title block sits at the top of the first cover
   logical page. Original .page-header above .problems-grid is hidden in
   booklet imposed mode (its content is on the cover instead). In reading-
   order mode, the original page-header reappears since we're showing the
   plain flow. */
body.print-preview.pm-booklet:not(.pm-booklet-reading-order) .shell > .page-header{display:none}
.lp-cover-header{
  margin-bottom:0.3in;
  padding-bottom:0.15in;
  border-bottom:2px solid #000;
}
.lp-cover-header h1{
  margin:0;
  font-size:18px;
  line-height:1.2;
}
.lp-glue-mark{
  position:absolute;
  top:0.5in;
  left:0.5in;
  font-family:var(--mono, monospace);
  font-size:8px;
  font-weight:600;
  letter-spacing:0.1em;
  color:#aaa;
  border:1px dashed #ccc;
  padding:3px 8px;
  border-radius:2px;
}
@media print{
  .lp-glue-mark{display:none}
}

/* Cover-only header: we want the title only on the FIRST logical page of
   the entire activity (the page-header lives in .shell, not in a logical
   page, so this is handled by selectively hiding .shell > .page-header
   when booklet mode is active and inserting it into the cover instead.) */

/* In booklet mode the original .page-header is hidden from print (its
   content has been duplicated into the cover at compile time — but since
   we don't actually move it, we instead show it ONLY when on the first
   logical page. Simpler: keep the page-header outside any logical page
   for now and let teachers see it in the preview. The first logical page
   visually carries the title because in our DOM, the page-header sits
   above .problems-grid at the top of .shell. In booklet preview, we'll
   tuck it inside the first sheet's cover via CSS positioning.) */

/* For the cover (first logical page), make extra room for the title.
   Implementation note: the actual title rendering is via .shell > .page-header
   which sits ABOVE the .problems-grid. In booklet preview, the page-header
   visually leads the document and the cover content begins below it. To make
   the cover layout look right, we hide the title for non-first sheets via
   the shell:has(.sheet:nth-child(...)) pattern — simpler is to render the
   page-header ONCE at the top and let it be the implicit cover content. */

/* Content area inside a non-glue logical page — multi-column flow if needed
   so problem cells stack naturally. Single-column by default; teachers who
   want columns inside booklet pages can do that via the existing column UI
   (which still works since data-span attrs flow through). */
.lp-content{
  /* overflow:hidden mirrors the .logical-page parent so content that
     overflows the page (rare with the 15% measurement buffer in
     _renderBooklet) is clipped rather than printing onto the adjacent
     sheet half. The buffer makes overflow rare; when it happens, clipping
     is the visual signal to the teacher to split that problem manually
     via a forced page break. */
  height:100%;
  overflow:hidden;
  display:flex;
  flex-direction:column;
  gap:8px;
}
.lp-content .problem-cell{
  background:white;
  border:1px solid #ccc;
  padding:8px 10px;
  break-inside:avoid;
  page-break-inside:avoid;
}

/* Columns inside a booklet logical page (phase 7+).
   When the activity is in booklet mode AND has multi-column layout, each
   logical page's content area becomes a grid mirroring the phase-5 column
   templates. This means a 5.5" booklet page with 2 columns gives ~2" wide
   columns — quite cramped for math, but explicitly requested. The column
   templates here use percentages directly rather than fr units because
   .lp-content has overflow:hidden which can interact poorly with fr in
   some browsers. */
body.print-preview.pm-booklet.pm-cols-2 .lp-content,
body.print-preview.pm-booklet.pm-cols-3 .lp-content{
  display:grid;
  column-gap:0.18in;
  row-gap:0.12in;
  align-content:start;
}
body.print-preview.pm-booklet.pm-cols-2-equal .lp-content{grid-template-columns:1fr 1fr}
body.print-preview.pm-booklet.pm-cols-2-60-40 .lp-content{grid-template-columns:6fr 4fr}
body.print-preview.pm-booklet.pm-cols-2-40-60 .lp-content{grid-template-columns:4fr 6fr}
body.print-preview.pm-booklet.pm-cols-3-equal .lp-content{grid-template-columns:1fr 1fr 1fr}
body.print-preview.pm-booklet.pm-cols-3-25-37-37 .lp-content{grid-template-columns:25fr 37.5fr 37.5fr}

/* Per-problem span attributes already work because .lp-content's children
   are .problem-cell elements with data-span set at compile time. The
   grid-column rules from phase 5 already match those, so no extra rules
   needed here. */

/* @media print parallels for actual print output. */
@media print{
  body.pm-booklet.pm-cols-2 .lp-content,
  body.pm-booklet.pm-cols-3 .lp-content{
    display:grid;
    column-gap:0.18in;
    row-gap:0.12in;
    align-content:start;
  }
  body.pm-booklet.pm-cols-2-equal .lp-content{grid-template-columns:1fr 1fr}
  body.pm-booklet.pm-cols-2-60-40 .lp-content{grid-template-columns:6fr 4fr}
  body.pm-booklet.pm-cols-2-40-60 .lp-content{grid-template-columns:4fr 6fr}
  body.pm-booklet.pm-cols-3-equal .lp-content{grid-template-columns:1fr 1fr 1fr}
  body.pm-booklet.pm-cols-3-25-37-37 .lp-content{grid-template-columns:25fr 37.5fr 37.5fr}
}

/* ---- Reading-order mode: bypass imposition, show 1..N pages in sequence.
   In this mode, _renderBooklet stuffs cells back into the grid in source
   order (no .sheet wrappers), so we just need a slightly different look —
   no fold line, no sheet label. Inherit baseline preview styles from
   phase 1. */
body.print-preview.pm-booklet.pm-booklet-reading-order .sheet{display:none}
body.print-preview.pm-booklet.pm-booklet-reading-order .problems-grid{
  display:block;
}

/* ---- Print: in booklet mode, hide the simulated-sheet shadow/border
   chrome (printer applies its own paper). The .sheet still functions as a
   page-break-after container, but visually flat. */
@media print{
  body.pm-booklet .sheet{
    box-shadow:none;
    border:none;
    margin:0 auto;
    width:11in;
    height:8.5in;
    display:flex;
  }
  body.pm-booklet .sheet::before,
  body.pm-booklet .sheet::after{display:none}
  body.pm-booklet .logical-page{
    width:5.5in;
    height:8.5in;
  }
  body.pm-booklet .lp-glue-mark{display:none}
  /* Hide the global page-header on every sheet except the very first
     (which is sheet-front of booklet 1, containing the cover on its right
     half). Easiest: keep the page-header outside .problems-grid; it prints
     on the first page naturally. Sheets after the first naturally start
     fresh because of page-break-after. */
}
/* ============================================================================
   PRINT MODE — phase 7+: density and font-size scales
   ============================================================================
   Two independent dial controls applied via body classes:

   Density: pm-density-compact | pm-density-tight
     Tightens gaps between problem cells, cell padding, and the spacing
     above workspace blocks. Standard (no class) keeps current spacing.

   Font-size: pm-fontsize-compact | pm-fontsize-tight
     Scales problem text and dependent elements (numbers, feedback) down
     proportionally. KaTeX math scales with parent font-size automatically.

   Both work in letter and booklet modes. Together with Tight workspace
   sizing, an aggressive teacher can fit ~50% more problems per sheet.
   ============================================================================ */

/* ---- Density ---- */
/* Compact: ~30% padding reduction, tighter gaps. Still readable. */
body.print-preview.pm-density-compact .problems-grid{
  row-gap:0.08in;
  column-gap:0.18in;
}
body.print-preview.pm-density-compact .problem-cell{
  padding:7px 9px;
}
body.print-preview.pm-density-compact .prob-stem{
  margin:4px 0;
}
body.print-preview.pm-density-compact .prob-num{
  margin-bottom:3px;
}
body.print-preview.pm-density-compact .prob-workspace{
  margin-top:8px;
}
body.print-preview.pm-density-compact.pm-booklet .lp-content{
  gap:5px;
}

/* Tight: minimal spacing, max density. Padding reduced by ~60%. */
body.print-preview.pm-density-tight .problems-grid{
  row-gap:0.04in;
  column-gap:0.12in;
}
body.print-preview.pm-density-tight .problem-cell{
  padding:4px 7px;
}
body.print-preview.pm-density-tight .prob-stem{
  margin:2px 0;
}
body.print-preview.pm-density-tight .prob-num{
  margin-bottom:1px;
  font-size:8px;
}
body.print-preview.pm-density-tight .prob-workspace{
  margin-top:4px;
}
body.print-preview.pm-density-tight.pm-booklet .lp-content{
  gap:3px;
}

/* Flush: zero spacing between cells; borders collapse into shared edges.
   Each cell drops its top border (except the first) and uses a -1px top
   margin so its top edge overlaps the previous cell's bottom edge — net
   effect is single-thickness shared border between adjacent cells.

   For grid layouts (multi-column), the same trick works: cells in the
   same column collapse vertically. Cells in adjacent columns retain
   their independent left/right borders since column-gap is 0.

   Workspace blocks inside cells are unaffected — they keep their own
   border for visual separation between problem and work area.

   Three pieces are needed to fully eliminate gaps:
     1. row-gap/column-gap on .problems-grid → 0
     2. margin-bottom on .problem-cell → 0   (the base rule has 14px)
     3. border-radius on .problem-cell → 0   (rounded corners leave visible
        gaps at the overlap point even when borders touch)
   The negative margin-top is then a polish step that collapses the doubled
   border thickness at the shared edge. */
body.print-preview.pm-density-flush .problems-grid{
  row-gap:0;
  column-gap:0;
}
body.print-preview.pm-density-flush .problem-cell{
  padding:5px 8px;
  margin-top:-1px;
  margin-bottom:0;
  border-radius:0;
}
body.print-preview.pm-density-flush .problem-cell:first-child{
  margin-top:0;
}
body.print-preview.pm-density-flush .prob-stem{
  margin:2px 0;
}
body.print-preview.pm-density-flush .prob-num{
  margin-bottom:2px;
  font-size:9px;
}
body.print-preview.pm-density-flush .prob-workspace{
  margin-top:5px;
}
body.print-preview.pm-density-flush.pm-booklet .lp-content{
  gap:0;
}
/* Booklet mode: .lp-content .problem-cell rule (line ~1103) has higher
   specificity than the unscoped flush rule above, so we re-specify the
   flush values at matching specificity to win the cascade. */
body.print-preview.pm-density-flush.pm-booklet .lp-content .problem-cell{
  padding:5px 8px;
  margin-top:-1px;
  margin-bottom:0;
  border-radius:0;
}
body.print-preview.pm-density-flush.pm-booklet .lp-content > .problem-cell:first-child{
  margin-top:0;
}

/* Same rules apply when actually printing (no .print-preview prefix needed
   on the body since classes are baked into the body element directly). */
@media print{
  body.pm-density-compact .problems-grid{row-gap:0.08in;column-gap:0.18in}
  body.pm-density-compact .problem-cell{padding:7px 9px}
  body.pm-density-compact .prob-stem{margin:4px 0}
  body.pm-density-compact .prob-num{margin-bottom:3px}
  body.pm-density-compact .prob-workspace{margin-top:8px}
  body.pm-density-compact.pm-booklet .lp-content{gap:5px}

  body.pm-density-tight .problems-grid{row-gap:0.04in;column-gap:0.12in}
  body.pm-density-tight .problem-cell{padding:4px 7px}
  body.pm-density-tight .prob-stem{margin:2px 0}
  body.pm-density-tight .prob-num{margin-bottom:1px;font-size:8px}
  body.pm-density-tight .prob-workspace{margin-top:4px}
  body.pm-density-tight.pm-booklet .lp-content{gap:3px}

  body.pm-density-flush .problems-grid{row-gap:0;column-gap:0}
  body.pm-density-flush .problem-cell{padding:5px 8px;margin-top:-1px;margin-bottom:0;border-radius:0}
  body.pm-density-flush .problem-cell:first-child{margin-top:0}
  body.pm-density-flush .prob-stem{margin:2px 0}
  body.pm-density-flush .prob-num{margin-bottom:2px;font-size:9px}
  body.pm-density-flush .prob-workspace{margin-top:5px}
  body.pm-density-flush.pm-booklet .lp-content{gap:0}
  body.pm-density-flush.pm-booklet .lp-content .problem-cell{padding:5px 8px;margin-top:-1px;margin-bottom:0;border-radius:0}
  body.pm-density-flush.pm-booklet .lp-content > .problem-cell:first-child{margin-top:0}
}

/* ---- Font size ----
   The base .prob-stem rule sets font-size:17px and .ans-num sets 14px,
   each as explicit absolute values that beat any parent .problem-cell
   rule via CSS specificity. The font-size dial therefore has to target
   .prob-stem and .ans-num directly to actually scale the visible content.
   We also scale .prob-num down for visual balance — at smaller stem sizes
   the small-caps PROBLEM N label reads too prominently otherwise. */

/* Compact: ~88% scale (17 → 15, 14 → 12.5, 10 → 9). */
body.print-preview.pm-fontsize-compact .prob-stem{font-size:15px;line-height:1.55}
body.print-preview.pm-fontsize-compact .ans-num{font-size:12.5px;padding:5px 8px;min-width:140px}
body.print-preview.pm-fontsize-compact .prob-num{font-size:9px}
body.print-preview.pm-fontsize-compact.pm-booklet .prob-stem{font-size:14px;line-height:1.5}
body.print-preview.pm-fontsize-compact.pm-booklet .ans-num{font-size:11.5px}

/* Tight: ~76% scale (17 → 13, 14 → 11, 10 → 8). */
body.print-preview.pm-fontsize-tight .prob-stem{font-size:13px;line-height:1.45}
body.print-preview.pm-fontsize-tight .ans-num{font-size:11px;padding:3px 6px;min-width:110px}
body.print-preview.pm-fontsize-tight .prob-num{font-size:8px}
body.print-preview.pm-fontsize-tight.pm-booklet .prob-stem{font-size:12px;line-height:1.4}
body.print-preview.pm-fontsize-tight.pm-booklet .ans-num{font-size:10px}

@media print{
  body.pm-fontsize-compact .prob-stem{font-size:15px;line-height:1.55}
  body.pm-fontsize-compact .ans-num{font-size:12.5px;padding:5px 8px;min-width:140px}
  body.pm-fontsize-compact .prob-num{font-size:9px}
  body.pm-fontsize-compact.pm-booklet .prob-stem{font-size:14px;line-height:1.5}
  body.pm-fontsize-compact.pm-booklet .ans-num{font-size:11.5px}

  body.pm-fontsize-tight .prob-stem{font-size:13px;line-height:1.45}
  body.pm-fontsize-tight .ans-num{font-size:11px;padding:3px 6px;min-width:110px}
  body.pm-fontsize-tight .prob-num{font-size:8px}
  body.pm-fontsize-tight.pm-booklet .prob-stem{font-size:12px;line-height:1.4}
  body.pm-fontsize-tight.pm-booklet .ans-num{font-size:10px}
}
</style>
</head>
<body class="{{BODY_CLASSES}}">

<div class="shell">

  <div class="page-header">
    <div class="district-badge"><span class="badge-dot"></span>Dallas ISD &middot; Algebra II</div>
    <h1>{{TITLE}}</h1>
    <p>Complete each problem, then click Submit to record your work.</p>
    {{PRINT_HEADER_HTML}}
  </div>

  <div class="student-bar">
    <label>Name
      <input type="text" id="studentName" autocomplete="off">
    </label>
    <label>ID / Email
      <input type="text" id="studentId" autocomplete="off">
    </label>
    <label>Period
      <input type="text" id="period" autocomplete="off" maxlength="3">
    </label>
    <label>Teacher
      <select id="teacher">
        <option value="">&mdash; Select &mdash;</option>
        <option value="Mueller">Mueller</option>
        <option value="Reed">Reed</option>
        <option value="Singleton">Singleton</option>
        <option value="Pacayra">Pacayra</option>
        <option value="Jafari">Jafari</option>
      </select>
    </label>
    <div id="gsiHolder">
      <div id="gsiBtnHolder"></div>
      <span id="gsiUserChip">
        <span id="gsiUserEmail"></span>
        <button onclick="signOutStudent()">Sign out</button>
      </span>
    </div>
  </div>

  <main class="main-content">
    <div class="problems-grid">
      {{PROBLEMS_HTML}}
    </div>

    <div class="submit-wrap">
      <button id="submitBtn" data-webhook="{{WEBHOOK_URL}}" onclick="submitActivity()">Submit work</button>
      <span class="score-badge" id="scoreBadge">
        Score: <span class="score-val" id="scoreVal">0 / 0</span>
        <span class="score-pct" id="scorePct"></span>
      </span>
      <span id="submitMsg"></span>
    </div>
  </main>

</div>

<aside class="sticky-panel" id="sidebarRibbon"></aside>
<div id="floatingWindowContainer"></div>

<script id="builder-state" type="application/json">{{BUILDER_STATE_JSON}}<\/script>
<script id="sidebar-tools-config" type="application/json">{{SIDEBAR_TOOLS_JSON}}<\/script>
<script id="activity-settings" type="application/json">{{ACTIVITY_SETTINGS_JSON}}<\/script>

<script>
// =============================================================================
// RUNTIME — student-facing activity logic
// CONSTRAINTS: no backticks, no \${} template literals (we live inside one).
// =============================================================================

var ACTIVITY_SLUG = '{{ACTIVITY_SLUG}}';
var GOOGLE_CLIENT_ID = '{{GOOGLE_CLIENT_ID}}';

// ---------- Parent-frame print trigger -------------------------------------
// When the activity runs inside the builder's preview iframe, the builder's
// "Print" button posts {type:'request-print'} so the print() call originates
// inside this realm (preserves user-activation, satisfies sandbox modal
// permissions). Harmless on the standalone published activity — no parent
// will ever post such a message.
window.addEventListener('message', function(e){
  if (!e || !e.data) return;
  if (e.data.type === 'request-print') {
    // Phase 7: ensure booklet imposition is current before printing. The
    // renderer is idempotent and cheap when nothing changed.
    if (document.body.classList.contains('pm-booklet')) _renderBooklet();
    window.print();
  } else if (e.data.type === 'render-page-guides') {
    _renderPageGuides();
    if (document.body.classList.contains('pm-booklet')) {
      // Defer so KaTeX/MathJax has a chance to render math before we
      // measure cell heights — otherwise unrendered formulas measure
      // shorter than they actually are, and cells overflow their pages
      // after math typesets. The 220ms is empirical; KaTeX auto-render
      // typically finishes within ~100ms even for moderate worksheets.
      // We also re-run again at 600ms to catch slow renders.
      setTimeout(_renderBooklet, 220);
      setTimeout(_renderBooklet, 600);
    }
  }
});

// ---------- Booklet imposition (phase 7) -----------------------------------
// Un-nested saddle-stitch booklets: each physical letter-landscape sheet
// folds vertically into 4 logical pages (front cover | inside spread | back
// cover blank-glue). For each booklet:
//   logical 1 -> sheet front, right half  (cover)
//   logical 2 -> sheet back,  left half
//   logical 3 -> sheet back,  right half
//   logical 4 -> sheet front, left half   (blank glue page)
//
// Multi-booklet activities chain: pages 1..3 in booklet 1, pages 5..7 in
// booklet 2, etc. Pages 4, 8, 12... are always glue. Rounding to a multiple
// of 4 may leave content-pad pages right before glue.
//
// This runs at print-preview entry and before each print. It DOM-rearranges
// problem cells into a sheet>logical-page hierarchy. Reading-order mode
// short-circuits the rearrange and shows the original flow.

function _renderBooklet() {
  // Need a canonical source of problem cells to repack. The first time this
  // runs, capture the original .problems-grid children into a hidden cache
  // div so subsequent rebuilds don't lose information.
  var grid = document.querySelector('.problems-grid');
  if (!grid) return;

  // Cache original children once. _bookletSourceCells survives reflows.
  if (!window._bookletSourceCells) {
    window._bookletSourceCells = Array.prototype.slice.call(grid.children);
  }
  var sourceCells = window._bookletSourceCells;
  if (sourceCells.length === 0) return;

  // Reading-order mode: just put cells back in source order in the grid,
  // no sheet wrapping. CSS hides booklet-only chrome under
  // .pm-booklet-reading-order.
  if (document.body.classList.contains('pm-booklet-reading-order')) {
    grid.innerHTML = '';
    grid.classList.remove('booklet-imposed');
    sourceCells.forEach(function(c){ grid.appendChild(c); });
    return;
  }

  // Imposed mode: pack cells into logical pages, then arrange logical pages
  // into sheets with the imposition mapping above.
  //
  // Pagination uses a measurement pass: we render cells off-screen in a
  // hidden ruler element with the same width as a logical-page content
  // area, measure each cell's outerHeight, and pack greedily into pages
  // that fit within the logical-page content height. Forced page breaks
  // (data-page-break-before="1") start a new page regardless of remaining
  // space. The first logical page (cover) reserves vertical space for the
  // title block, so its capacity is reduced.

  // Logical-page geometry (must match CSS):
  //   total: 5.5in wide x 8.5in tall
  //   margins: 0.5in top + 0.5in bottom = content area is 7.5in tall
  //   width content area: 5.5 - 0.5 - 0.6 = 4.4in (approximate; varies by side)
  //
  // For multi-column logical pages, the measurement width shrinks to the
  // column width and the effective vertical capacity multiplies by column
  // count (since cells can flow into adjacent columns). This is an
  // approximation — true bin-packing across columns is significantly more
  // complex — but it gives a reasonable cell-to-page distribution. Force-
  // page-break flags still respected.
  var DPI = 96;
  var pr = (window._builderPrintCfg) || {};
  var colCount = 1;
  if (document.body.classList.contains('pm-cols-2')) colCount = 2;
  else if (document.body.classList.contains('pm-cols-3')) colCount = 3;
  var contentH = 7.5 * DPI;            // 7.5in tall per column
  var pageCapacity = contentH * colCount; // total vertical area in column-inches
  var contentW = (4.4 / colCount) * DPI - (0.18 * DPI * (colCount - 1) / colCount);
  if (contentW < 60) contentW = 60;    // safety floor
  // Cover page: -0.8in for the title (full width subtraction).
  var coverPageCapacity = pageCapacity - (0.8 * DPI * colCount);

  // Build a hidden measurement ruler so we can measure cells without
  // disturbing layout. Append to body (outside .problems-grid).
  var ruler = document.getElementById('_booklet_ruler');
  if (!ruler) {
    ruler = document.createElement('div');
    ruler.id = '_booklet_ruler';
    ruler.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;' +
      'pointer-events:none;font-size:13px;';
    document.body.appendChild(ruler);
  }
  ruler.style.width = contentW + 'px';

  var logicalPages = [];
  var current = [];
  var currentH = 0;
  var pageNum = 0;
  var capacityFor = function(idx){ return idx === 0 ? coverPageCapacity : pageCapacity; };

  function flushPage() {
    if (current.length > 0) {
      logicalPages.push(current);
      current = [];
      currentH = 0;
      pageNum++;
    }
  }

  sourceCells.forEach(function(cell, i) {
    // Forced break starts a new logical page.
    var forceBreak = (i > 0) && cell.getAttribute('data-page-break-before') === '1';
    if (forceBreak) flushPage();

    // Measure cell height. Move into ruler temporarily; the ruler is
    // hidden, but visibility:hidden preserves layout — works for measurement.
    ruler.appendChild(cell);
    // Apply a safety buffer to the measured height to handle async-rendered
    // content. Most cells get 15%; cells with embedded graph images get 30%
    // because the image's intrinsic dimensions aren't known until the
    // browser actually loads/decodes the data URI, which can finish after
    // both our measurement passes (220ms and 600ms post-render). The
    // larger buffer pushes graph problems to their own page slightly
    // earlier — the cost is more wasted space on those pages, but the
    // benefit is graph problems never get clipped.
    var rawH = cell.offsetHeight + 8; // +gap
    var hasGraph = !!cell.querySelector('.prob-graph-wrap');
    var bufferFactor = hasGraph ? 1.30 : 1.15;
    var h = Math.ceil(rawH * bufferFactor);

    var cap = capacityFor(logicalPages.length); // index of the page we're filling
    if (currentH + h > cap && current.length > 0) {
      flushPage();
    }
    current.push(cell);
    currentH += h;
  });
  flushPage();

  // Clean up ruler — no longer needed once pages are packed.
  ruler.parentNode && ruler.parentNode.removeChild(ruler);

  if (logicalPages.length === 0) return;

  // Round logical-page count up to a multiple of 4 (un-nested booklet rule).
  // Each booklet's logical pages: [1=cover, 2=inside-L, 3=inside-R, 4=glue].
  var totalPages = Math.ceil(logicalPages.length / 4) * 4;
  // Pad with empty pages, but distinguish which are glue (last in each
  // booklet) vs content-padding (filler before glue if rounding adds slack).
  while (logicalPages.length < totalPages) logicalPages.push(null);

  // Build sheet wrappers. Each booklet uses 2 physical sheets (front + back).
  // Sheet front: [glue (page 4) | cover (page 1)]   (left | right)
  // Sheet back:  [page 2         | page 3        ]
  //
  // For booklet B (0-indexed), logical pages are at indices:
  //   cover = 4B + 0
  //   inside-L = 4B + 1
  //   inside-R = 4B + 2
  //   glue    = 4B + 3
  grid.innerHTML = '';
  grid.classList.add('booklet-imposed');

  var bookletCount = totalPages / 4;
  for (var b = 0; b < bookletCount; b++) {
    var coverIdx = 4 * b;
    var insideLIdx = 4 * b + 1;
    var insideRIdx = 4 * b + 2;
    var glueIdx = 4 * b + 3;

    // ---- Sheet front: [glue(page 4) | cover(page 1)] ----
    var sheetFront = document.createElement('div');
    sheetFront.className = 'sheet sheet-front';
    sheetFront.setAttribute('data-booklet', String(b + 1));
    var glueLP = _makeLogicalPage(logicalPages[glueIdx], glueIdx, true);
    var coverLP = _makeLogicalPage(logicalPages[coverIdx], coverIdx, false);
    // Mark cover with .lp-cover so first-only header CSS can target it.
    if (coverIdx === 0) {
      coverLP.classList.add('lp-first');
      // Inject the activity title at the top of the very first cover page,
      // cloned from the original .page-header. Cloning rather than moving
      // means the original stays in the DOM — useful for reading-order mode.
      var origHeader = document.querySelector('.shell > .page-header');
      if (origHeader) {
        var coverHeader = origHeader.cloneNode(true);
        coverHeader.classList.add('lp-cover-header');
        coverLP.insertBefore(coverHeader, coverLP.firstChild);
      }
    }
    sheetFront.appendChild(glueLP);
    sheetFront.appendChild(coverLP);
    grid.appendChild(sheetFront);

    // ---- Sheet back: [page 2 | page 3] ----
    var sheetBack = document.createElement('div');
    sheetBack.className = 'sheet sheet-back';
    sheetBack.setAttribute('data-booklet', String(b + 1));
    sheetBack.appendChild(_makeLogicalPage(logicalPages[insideLIdx], insideLIdx, false));
    sheetBack.appendChild(_makeLogicalPage(logicalPages[insideRIdx], insideRIdx, false));
    grid.appendChild(sheetBack);
  }
}

// Build a single logical-page DOM node. cells may be null (glue page),
// in which case we render an empty page that visually communicates its
// blank-glue purpose.
function _makeLogicalPage(cells, pageIndex, isGluePage) {
  var lp = document.createElement('div');
  lp.className = 'logical-page';
  lp.setAttribute('data-page-num', String(pageIndex + 1));
  if (isGluePage) {
    lp.classList.add('lp-glue');
    // Tiny corner mark so a teacher folding paper knows which side is glue.
    var mark = document.createElement('div');
    mark.className = 'lp-glue-mark';
    mark.textContent = 'GLUE';
    lp.appendChild(mark);
  } else if (cells && cells.length > 0) {
    var inner = document.createElement('div');
    inner.className = 'lp-content';
    cells.forEach(function(c){ inner.appendChild(c); });
    lp.appendChild(inner);
  }
  return lp;
}

// ---------- Page guide overlay (phase 6) -----------------------------------
// Builder-only visual aid: dashed lines at every page boundary in the
// simulated paper sheet. Computed from the actual rendered shell height so
// it stays accurate as content grows or shrinks. Idempotent — calling it
// multiple times rebuilds rather than appending duplicates. The runtime
// also auto-rebuilds on resize so the guides track layout reflows.
function _renderPageGuides() {
  var shell = document.querySelector('.shell');
  if (!shell) return;

  // Remove any existing overlay so we always rebuild from current measurements.
  var existing = shell.querySelector('.page-guide-overlay');
  if (existing) existing.parentNode.removeChild(existing);

  // Only rebuild when in print preview — otherwise the overlay is stale and
  // its layout wouldn't make sense anyway. (CSS hides it regardless, but
  // skipping the work avoids needless DOM churn.)
  if (!document.body.classList.contains('print-preview')) return;

  // Letter portrait, 0.75in margins → 9.5in of usable content per page.
  // We use the shell's scrollHeight (full content height) to determine total
  // pages, then space guides at content-page intervals.
  var DPI = 96; // CSS pixel reference DPI for in→px conversion.
  var contentInchesPerPage = 9.5;
  var contentPxPerPage = contentInchesPerPage * DPI;

  // Padding inside the shell is 0.75in (54px) — guides are positioned
  // relative to the .shell box, so the first page boundary sits at 9.5in
  // from the top of the content area, i.e. (0.75 + 9.5)in = 10.25in from
  // the top of the .shell box.
  var topPaddingInches = 0.75;
  var topPaddingPx = topPaddingInches * DPI;

  var totalContentPx = shell.scrollHeight - (topPaddingPx * 2); // strip top + bottom padding
  if (totalContentPx <= contentPxPerPage) return; // single page, no guides needed

  var pageCount = Math.ceil(totalContentPx / contentPxPerPage);

  var overlay = document.createElement('div');
  overlay.className = 'page-guide-overlay';

  // Draw guides between pages: page 1→2 boundary, page 2→3 boundary, etc.
  // The label on each guide says the page number that BEGINS below the line.
  for (var i = 1; i < pageCount; i++) {
    var guide = document.createElement('div');
    guide.className = 'page-guide';
    var topPx = topPaddingPx + (i * contentPxPerPage);
    guide.style.top = topPx + 'px';
    var label = document.createElement('div');
    label.className = 'page-guide-label';
    label.textContent = 'Page ' + (i + 1);
    guide.appendChild(label);
    overlay.appendChild(guide);
  }

  shell.appendChild(overlay);
}

// Re-render guides on resize (debounced) so reflows update boundaries.
var _guideResizeTimer = null;
window.addEventListener('resize', function(){
  if (_guideResizeTimer) clearTimeout(_guideResizeTimer);
  _guideResizeTimer = setTimeout(_renderPageGuides, 120);
});

// ---------- Print preparation hook (phase 3) -------------------------------
// Add the .print-preview class on beforeprint so element-transform CSS fires
// even when the user prints without first clicking the preview toggle (e.g.
// Ctrl+P, browser menu). Restore prior state on afterprint so a manually
// toggled preview survives a print-and-cancel.
var _previewWasManual = false;
window.addEventListener('beforeprint', function(){
  _previewWasManual = document.body.classList.contains('print-preview');
  document.body.classList.add('print-preview');
});
window.addEventListener('afterprint', function(){
  if (!_previewWasManual) document.body.classList.remove('print-preview');
  // Phase 8: notify the builder parent (if we're inside the preview iframe)
  // that printing finished. Builder uses this to revert _answerKeyMode and
  // recompile back to normal interactive preview. Harmless when the
  // activity is opened standalone — there's no parent to receive it.
  if (window.parent && window.parent !== window) {
    try { window.parent.postMessage({ type: 'print-completed' }, '*'); } catch (e) {}
  }
});

// ---------- Window manager -------------------------------------------------
var WindowManager = (function(){
  var windows = {};       // toolId -> { el, instance, config, body }
  var zCounter = 100;
  var defaultPositions = { offsetX: 100, offsetY: 80, stagger: 28 };
  var openCount = 0;

  function _isMobile(){
    return !!(window.matchMedia && window.matchMedia('(max-width:720px)').matches);
  }

  function nextZ(){ zCounter += 1; return zCounter; }

  function defaultRect(){
    var stag = openCount * defaultPositions.stagger;
    openCount += 1;
    return {
      left: defaultPositions.offsetX + stag,
      top:  defaultPositions.offsetY + stag,
      width: 560,
      height: 420
    };
  }

  function bringToFront(toolId){
    var w = windows[toolId];
    if (!w) return;
    w.el.style.zIndex = nextZ();
  }

  function close(toolId){
    var w = windows[toolId];
    if (!w) return;
    if (w.config && typeof w.config.destroy === 'function') {
      try { w.config.destroy(w.instance, w.body); } catch (e) { console.warn('destroy hook failed:', e); }
    }
    if (w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el);
    delete windows[toolId];
    openCount = Math.max(0, openCount - 1);
    var btn = document.querySelector('[data-tool-id="' + toolId + '"]');
    if (btn) btn.classList.remove('active');
  }

  function open(toolId, config){
    // Mobile: only one drawer open at a time. Close any others first.
    if (_isMobile()) {
      Object.keys(windows).forEach(function(id){
        if (id !== toolId) close(id);
      });
    }
    var rect = defaultRect();
    var container = document.getElementById('floatingWindowContainer');

    var win = document.createElement('div');
    win.className = 'float-window';
    win.style.left   = rect.left + 'px';
    win.style.top    = rect.top + 'px';
    win.style.width  = rect.width + 'px';
    win.style.height = rect.height + 'px';
    win.style.zIndex = nextZ();
    win.setAttribute('data-tool-id', toolId);

    var header = document.createElement('div');
    header.className = 'float-win-header';
    var title = document.createElement('span');
    title.className = 'float-win-title';
    title.textContent = config.label || toolId;
    var close_btn = document.createElement('button');
    close_btn.className = 'float-win-close';
    close_btn.innerHTML = '&times;';
    close_btn.setAttribute('aria-label', 'Close');
    close_btn.onclick = function(){ close(toolId); };
    header.appendChild(title);
    header.appendChild(close_btn);

    var body = document.createElement('div');
    body.className = 'float-win-body';

    var resize = document.createElement('div');
    resize.className = 'float-win-resize';

    win.appendChild(header);
    win.appendChild(body);
    win.appendChild(resize);
    container.appendChild(win);

    attachDrag(win, header);
    attachResize(win, resize, config);

    win.addEventListener('mousedown', function(){ bringToFront(toolId); });

    var instance = null;
    if (typeof config.render === 'function') {
      // Defer render to next frame so the body has measurable dimensions
      requestAnimationFrame(function(){
        try { instance = config.render(body, config); }
        catch (e) { console.error('render hook failed:', e); body.textContent = 'Error: ' + e.message; }
        if (windows[toolId]) windows[toolId].instance = instance;
      });
    }

    windows[toolId] = { el: win, instance: null, config: config, body: body };
    var btn = document.querySelector('[data-tool-id="' + toolId + '"]');
    if (btn) btn.classList.add('active');
  }

  function toggle(toolId, config){
    if (windows[toolId]) close(toolId);
    else open(toolId, config);
  }

  function attachDrag(win, header){
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;

    function start(clientX, clientY, target){
      // No drag on mobile: CSS pins the sheet to the bottom.
      if (_isMobile()) return false;
      if (target && target.tagName === 'BUTTON') return false;
      dragging = true;
      sx = clientX; sy = clientY;
      ox = parseInt(win.style.left, 10) || 0;
      oy = parseInt(win.style.top, 10) || 0;
      return true;
    }
    function move(clientX, clientY){
      if (!dragging) return;
      win.style.left = (ox + clientX - sx) + 'px';
      win.style.top  = (oy + clientY - sy) + 'px';
    }
    function end(){ dragging = false; }

    header.addEventListener('mousedown', function(e){
      if (start(e.clientX, e.clientY, e.target)) e.preventDefault();
    });
    document.addEventListener('mousemove', function(e){ move(e.clientX, e.clientY); });
    document.addEventListener('mouseup', end);

    header.addEventListener('touchstart', function(e){
      var t = e.touches[0];
      if (start(t.clientX, t.clientY, e.target)) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function(e){
      if (!dragging) return;
      var t = e.touches[0];
      move(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
  }

  function attachResize(win, handle, config){
    var resizing = false, sx = 0, sy = 0, ow = 0, oh = 0;

    function start(clientX, clientY){
      // No resize on mobile.
      if (_isMobile()) return false;
      resizing = true;
      sx = clientX; sy = clientY;
      ow = win.offsetWidth; oh = win.offsetHeight;
      return true;
    }
    function move(clientX, clientY){
      if (!resizing) return;
      var nw = Math.max(300, ow + clientX - sx);
      var nh = Math.max(220, oh + clientY - sy);
      win.style.width = nw + 'px';
      win.style.height = nh + 'px';
      if (config && typeof config.onResize === 'function') {
        try { config.onResize(windows[win.getAttribute('data-tool-id')]); } catch (e) {}
      }
    }
    function end(){ resizing = false; }

    handle.addEventListener('mousedown', function(e){
      if (start(e.clientX, e.clientY)) { e.preventDefault(); e.stopPropagation(); }
    });
    document.addEventListener('mousemove', function(e){ move(e.clientX, e.clientY); });
    document.addEventListener('mouseup', end);

    handle.addEventListener('touchstart', function(e){
      var t = e.touches[0];
      if (start(t.clientX, t.clientY)) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });
    document.addEventListener('touchmove', function(e){
      if (!resizing) return;
      var t = e.touches[0];
      move(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
  }

  // Re-fire onResize on viewport changes (orientation, browser resize, mobile
  // keyboard) so Desmos and other tools can re-measure the bottom sheet.
  var _resizeTimer;
  window.addEventListener('resize', function(){
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function(){
      Object.keys(windows).forEach(function(toolId){
        var w = windows[toolId];
        if (w && w.config && typeof w.config.onResize === 'function') {
          try { w.config.onResize(w); } catch (e) {}
        }
      });
    }, 150);
  });

  return { open: open, close: close, toggle: toggle, bringToFront: bringToFront, _windows: windows };
})();

// ---------- Tool registry --------------------------------------------------
var ToolRegistry = {
  video: function(cfg){
  return {
    label: cfg.label || 'Video',
    icon: '\u25B6',
    render: function(body){
      var src = cfg.embedUrl || '';

      // Normalize common YouTube URL formats to embed format
      var watchMatch = src.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      var shortMatch = src.match(/youtu\\.be\\/([a-zA-Z0-9_-]{11})/);
      var id = (watchMatch && watchMatch[1]) || (shortMatch && shortMatch[1]);
      if (id && src.indexOf('/embed/') === -1) {
        src = 'https://www.youtube.com/embed/' + id;
      }

      if (!src) {
        body.innerHTML = '<div style="padding:18px;font-family:var(--sans);color:var(--ink-light);font-size:13px">No video URL configured.</div>';
        return null;
      }

      var iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen');
      iframe.setAttribute('allowfullscreen', '');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      iframe.style.display = 'block';
      body.appendChild(iframe);
      return { iframe: iframe };
    },
    destroy: function(state){ if (state && state.iframe) state.iframe.src = 'about:blank'; }
  };
},
  desmos_graphing: function(cfg){
    return _desmosTool(cfg, 'GraphingCalculator');
  },
  desmos_scientific: function(cfg){
    return _desmosTool(cfg, 'ScientificCalculator');
  },
  desmos_geometry: function(cfg){
    return _desmosTool(cfg, 'Geometry');
  },
  reference_sheet: function(cfg){
    return {
      label: cfg.label || 'Reference',
      icon: '\uD83D\uDCCB', // clipboard
      render: function(body){
        var raw = (cfg.content || '').toString();
        if (!raw.trim()) {
          body.innerHTML = '<div class="ref-sheet-empty">No reference content configured.</div>';
          return null;
        }
        var sheet = document.createElement('div');
        sheet.className = 'ref-sheet';
        var html = '';
        if (cfg.title && cfg.title.trim()) {
          html += '<div class="ref-sheet-title">' + _refEscape(cfg.title) + '</div>';
        }
        // Use the unified markdown parser if available, falling back to the
        // legacy mini-parser if it isn't (defensive — parser is always
        // inlined into compiled activities, but during local dev the
        // ordering in the host page might not be guaranteed).
        if (typeof window.parseMarkdown === 'function') {
          html += window.parseMarkdown(raw);
        } else {
          html += _parseReferenceSheet(raw);
        }
        sheet.innerHTML = html;
        body.appendChild(sheet);

        // Trigger KaTeX render on this subtree once auto-render is available.
        _renderRefMath(sheet);

        return { sheet: sheet };
      },
      destroy: function(state){
        if (state && state.sheet && state.sheet.parentNode) {
          state.sheet.parentNode.removeChild(state.sheet);
        }
      }
    };
  }
};

// ---------- Reference-sheet parser ----------------------------------------
// Intentionally tiny markdown subset; math passes through verbatim and is
// rendered by KaTeX after insertion. Only block-level structure is parsed.
function _parseReferenceSheet(text){
  var lines = text.split(/\\r?\\n/);
  var out = '';
  var listOpen = false;
  function closeList(){ if (listOpen) { out += '</ul>'; listOpen = false; } }

  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var trimmed = raw.replace(/^\\s+|\\s+$/g, '');

    if (!trimmed) { closeList(); continue; }

    // ### subsection (check before ## so we don't match ## inside ###)
    if (trimmed.indexOf('### ') === 0) {
      closeList();
      out += '<h4 class="ref-subsection">' + _refEscape(trimmed.slice(4)) + '</h4>';
      continue;
    }
    // ## section
    if (trimmed.indexOf('## ') === 0) {
      closeList();
      out += '<h3 class="ref-section">' + _refEscape(trimmed.slice(3)) + '</h3>';
      continue;
    }
    // --- horizontal rule
    if (/^-{3,}$/.test(trimmed)) {
      closeList();
      out += '<hr class="ref-hr">';
      continue;
    }
    // - or * bullet
    if (trimmed.indexOf('- ') === 0 || trimmed.indexOf('* ') === 0) {
      if (!listOpen) { out += '<ul class="ref-list">'; listOpen = true; }
      out += '<li>' + _refEscape(trimmed.slice(2)) + '</li>';
      continue;
    }
    // Label :: body  -> two-column row
    var sep = trimmed.indexOf(' :: ');
    if (sep > 0) {
      closeList();
      var label = trimmed.slice(0, sep);
      var bodyText = trimmed.slice(sep + 4);
      out += '<div class="ref-row">' +
               '<div class="ref-label">' + _refEscape(label) + '</div>' +
               '<div class="ref-body">' + _refEscape(bodyText) + '</div>' +
             '</div>';
      continue;
    }
    // Plain paragraph
    closeList();
    out += '<p class="ref-para">' + _refEscape(trimmed) + '</p>';
  }
  closeList();
  return out;
}

function _refEscape(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _renderRefMath(el){
  function attempt(retries){
    if (typeof renderMathInElement === 'function') {
      try {
        renderMathInElement(el, {
          delimiters: [
            { left: '\\\\(', right: '\\\\)', display: false },
            { left: '\\\\[', right: '\\\\]', display: true },
            { left: '$$',    right: '$$',    display: true }
          ],
          throwOnError: false
        });
      } catch (e) { console.warn('ref-sheet KaTeX render failed:', e); }
      return;
    }
    if (retries > 0) setTimeout(function(){ attempt(retries - 1); }, 100);
  }
  attempt(50);
}

function _desmosTool(cfg, calcType){
  return {
    label: cfg.label || ('Desmos ' + calcType.replace('Calculator', '')),
    icon: calcType === 'GraphingCalculator' ? '\u2A0F' : (calcType === 'Geometry' ? '\u25B3' : '\u232B'),
    render: function(body, config){
      if (typeof Desmos === 'undefined') {
        body.innerHTML = '<div style="padding:18px;font-family:var(--sans);color:var(--red)">Desmos API failed to load.</div>';
        return null;
      }
      var inner = document.createElement('div');
      inner.style.position = 'absolute';
      inner.style.inset = '0';
      body.appendChild(inner);
      _setDesmosSize(inner, body);

      var opts = _buildDesmosOpts(cfg);
      var calc;
      if (calcType === 'GraphingCalculator')      calc = Desmos.GraphingCalculator(inner, opts);
      else if (calcType === 'ScientificCalculator') calc = Desmos.ScientificCalculator(inner);
      else if (calcType === 'Geometry')             calc = Desmos.Geometry(inner, opts);
      else                                          calc = Desmos.GraphingCalculator(inner, opts);

      // Load expressions (graphing only)
      if (calcType === 'GraphingCalculator' && cfg.expressions && cfg.expressions.length) {
        cfg.expressions.forEach(function(latex, i){
          if (!latex || !latex.trim()) return;
          calc.setExpression({ id: 'exp' + i, latex: latex });
        });
      }

      // Apply viewport (graphing only)
      if (calcType === 'GraphingCalculator' && cfg.advanced && cfg.viewport) {
        try { calc.setMathBounds(cfg.viewport); } catch (e) {}
      }

      // Re-measure shortly after for layout settle
      setTimeout(function(){ _setDesmosSize(inner, body); if (calc.resize) calc.resize(); }, 60);

      return { calc: calc, inner: inner };
    },
    onResize: function(winState){
      if (!winState || !winState.instance) return;
      var s = winState.instance;
      _setDesmosSize(s.inner, winState.body);
      if (s.calc && s.calc.resize) s.calc.resize();
    },
    destroy: function(state){
      if (state && state.calc && state.calc.destroy) {
        try { state.calc.destroy(); } catch (e) {}
      }
    }
  };
}

function _setDesmosSize(inner, body){
  inner.style.width = body.offsetWidth + 'px';
  inner.style.height = body.offsetHeight + 'px';
}

function _buildDesmosOpts(cfg){
  var o = { expressions: true, settingsMenu: true, zoomButtons: true };
  // Feature permissions are applied unconditionally (off by default).
  // Teachers opt features back on via the Advanced settings panel.
  if (!cfg.allowImages) o.images = false;
  if (!cfg.allowFolders) o.folders = false;
  if (!cfg.allowNotes) o.notes = false;
  if (!cfg.allowSliders) o.sliders = false;
  if (!cfg.allowInequalities) o.plotInequalities = false;
  if (!cfg.allowImplicits) o.plotImplicits = false;
  if (!cfg.allowSingleVarImplicits) o.plotSingleVariableImplicitEquations = false;
  if (!cfg.advanced) return o;
  if (cfg.hideExpressionList) o.expressions = false;
  if (cfg.hideSettings) o.settingsMenu = false;
  if (cfg.viewport && cfg.viewport.locked) o.lockViewport = true;
  if (cfg.polar) o.polarMode = true;
  if (cfg.projectorMode) o.projectorMode = true;
  return o;
}

// ---------- Sidebar ribbon -------------------------------------------------
function renderSidebar(){
  var ribbon = document.getElementById('sidebarRibbon');
  if (!ribbon) return;
  var raw = document.getElementById('sidebar-tools-config');
  var tools = [];
  try { tools = JSON.parse((raw ? raw.textContent : '').trim() || '[]'); }
  catch (e) { console.error('sidebar-tools-config parse failed:', e); return; }

  ribbon.innerHTML = '';
  tools.forEach(function(tool, idx){
    if (idx > 0) {
      var div = document.createElement('div');
      div.className = 'ribbon-divider';
      ribbon.appendChild(div);
    }
    var btn;
    if (tool.type === 'save') {
      btn = _actionBtn('\uD83D\uDCBE', 'Save', function(){ saveProgress(); });
    } else if (tool.type === 'load') {
      btn = _actionBtn('\uD83D\uDCC2', 'Load', function(){ loadProgress(); });
    } else {
      var factory = ToolRegistry[tool.type];
      if (!factory) {
        console.warn('Unknown tool type:', tool.type);
        return;
      }
      var config = factory(tool);
      btn = _toolBtn(tool.id, config.icon, config.label, function(){
        WindowManager.toggle(tool.id, config);
      });
    }
    ribbon.appendChild(btn);
  });

  // ---- Print button -------------------------------------------------------
  // Always present at the bottom of the ribbon. Calls window.print(); the
  // @media print rules in the stylesheet hide the ribbon (and everything else
  // non-printable) before the printer captures output. A divider separates it
  // from any tools above when present.
  if (tools.length > 0) {
    var printDivider = document.createElement('div');
    printDivider.className = 'ribbon-divider';
    ribbon.appendChild(printDivider);
  }
  var printBtn = _actionBtn('\uD83D\uDDA8', 'Print', function(){ window.print(); });
  printBtn.setAttribute('data-action', 'print');
  ribbon.appendChild(printBtn);
}

function _actionBtn(icon, label, onClick){
  var b = document.createElement('button');
  b.className = 'ribbon-btn';
  b.innerHTML = '<span class="rb-icon">' + icon + '</span><span class="rb-label">' + label + '</span>';
  b.onclick = onClick;
  return b;
}

function _toolBtn(toolId, icon, label, onClick){
  var b = _actionBtn(icon, label, onClick);
  b.setAttribute('data-tool-id', toolId);
  return b;
}

// ---------- Save / load (localStorage) ------------------------------------
function _storageKey(){
  var sid = (document.getElementById('studentId').value || 'anon').trim();
  return 'activity:' + ACTIVITY_SLUG + ':' + sid;
}

function _collectState(){
  var inputs = document.querySelectorAll('.ans-num');
  var answers = {};
  inputs.forEach(function(inp){ answers[inp.id] = inp.value; });
  return {
    name: document.getElementById('studentName').value,
    id: document.getElementById('studentId').value,
    period: document.getElementById('period').value,
    teacher: document.getElementById('teacher').value,
    answers: answers,
    savedAt: new Date().toISOString()
  };
}

function _applyState(s){
  if (!s) return;
  if (s.name)    document.getElementById('studentName').value = s.name;
  if (s.id)      document.getElementById('studentId').value = s.id;
  if (s.period)  document.getElementById('period').value = s.period;
  if (s.teacher) document.getElementById('teacher').value = s.teacher;
  if (s.answers) {
    Object.keys(s.answers).forEach(function(k){
      var el = document.getElementById(k);
      if (!el) return;
      el.value = s.answers[k];
      // If this input is the hidden value-holder of a custom dropdown,
      // also restore the visible trigger label so the student can see
      // which option was previously selected.
      var parent = el.parentNode;
      var dropdown = parent ? parent.querySelector('.md-dropdown') : null;
      if (dropdown) {
        var label = dropdown.querySelector('.md-trigger-label');
        var opts = dropdown.querySelectorAll('.md-option');
        for (var i = 0; i < opts.length; i++) {
          if (opts[i].getAttribute('data-value') === s.answers[k]) {
            if (label) {
              label.classList.remove('md-placeholder');
              label.innerHTML = opts[i].innerHTML;
            }
            break;
          }
        }
      }
      validateInput(el);
    });
  }
}

function saveProgress(){
  try {
    localStorage.setItem(_storageKey(), JSON.stringify(_collectState()));
    _flashSubmitMsg('Saved locally.', 'success');
  } catch (e) {
    _flashSubmitMsg('Save failed: ' + e.message, 'error');
  }
}

function loadProgress(){
  try {
    var raw = localStorage.getItem(_storageKey());
    if (!raw) { _flashSubmitMsg('No saved work for this ID.', 'error'); return; }
    _applyState(JSON.parse(raw));
    _flashSubmitMsg('Loaded saved work.', 'success');
  } catch (e) {
    _flashSubmitMsg('Load failed: ' + e.message, 'error');
  }
}

// ---------- Custom dropdowns (shuffle + click + close-on-outside) --------
function _shuffle(arr){
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function _initDropdowns(){
  document.querySelectorAll('.md-dropdown').forEach(function(wrap){
    var input   = wrap.parentNode.querySelector('input.ans-num');
    var trigger = wrap.querySelector('.md-trigger');
    var label   = wrap.querySelector('.md-trigger-label');
    var optsBox = wrap.querySelector('.md-options');
    if (!input || !trigger || !optsBox) return;

    // Shuffle options if requested
    if (wrap.getAttribute('data-randomize') === '1') {
      var shuffled = _shuffle(Array.from(optsBox.querySelectorAll('.md-option')));
      shuffled.forEach(function(el){ optsBox.appendChild(el); });
    }

    // Open/close behavior. Was previously via <details> native open/close;
    // now we manage the data-open attribute manually since the structure is
    // span-based (block-element <details> couldn't legally nest inside a
    // <p>, which broke inline stem flow). Toggle on trigger click; close
    // on outside click (handled below outside this loop).
    function toggleOpen(){
      var isOpen = wrap.hasAttribute('data-open');
      // Close any other open dropdowns first so only one is open at a time.
      document.querySelectorAll('.md-dropdown[data-open]').forEach(function(d){
        if (d !== wrap) {
          d.removeAttribute('data-open');
          d.setAttribute('aria-expanded', 'false');
        }
      });
      if (isOpen) {
        wrap.removeAttribute('data-open');
        wrap.setAttribute('aria-expanded', 'false');
      } else {
        wrap.setAttribute('data-open', '');
        wrap.setAttribute('aria-expanded', 'true');
      }
    }
    trigger.addEventListener('click', function(e){
      e.stopPropagation();
      toggleOpen();
    });
    // Keyboard: Enter/Space on the dropdown wrapper opens; Escape closes.
    wrap.addEventListener('keydown', function(e){
      if (e.target === wrap || e.target === trigger) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleOpen();
        } else if (e.key === 'Escape') {
          wrap.removeAttribute('data-open');
          wrap.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // Wire option clicks
    optsBox.querySelectorAll('.md-option').forEach(function(opt){
      function pick(){
        label.classList.remove('md-placeholder');
        label.innerHTML = opt.innerHTML;
        input.value = opt.getAttribute('data-value') || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        wrap.removeAttribute('data-open');
        wrap.setAttribute('aria-expanded', 'false');
      }
      opt.addEventListener('click', function(e){ e.stopPropagation(); pick(); });
      opt.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    });
  });

  // Close-on-outside-click
  document.addEventListener('click', function(e){
    document.querySelectorAll('.md-dropdown[data-open]').forEach(function(d){
      if (!d.contains(e.target)) {
        d.removeAttribute('data-open');
        d.setAttribute('aria-expanded', 'false');
      }
    });
  });
}
// ---------- Validation ----------------------------------------------------
// Per-problem feedback flags:
//   data-live="0"        — suppress live feedback until submit
//   data-score-only="1"  — never show per-problem feedback (only score)
// We always compute correctness and stash it on the input as data-is-correct,
// because the score badge needs to know — but visual feedback is gated by
// the problem cell's classes (CSS handles the suppression).
function validateInput(el){
  var correct = el.getAttribute('data-correct');
  if (correct === null) return;
  var tol = parseFloat(el.getAttribute('data-tol') || '0');
  var cell = el.closest ? el.closest('.problem-cell') : null;
  var fb = cell ? cell.querySelector('.prob-feedback') : null;
  var hasValue = !!el.value.trim();

  if (!hasValue) {
    el.classList.remove('correct', 'incorrect');
    el.removeAttribute('data-is-correct');
    _mirrorDropdownState(el, null);
    if (fb) fb.textContent = '';
    _updateScoreBadge();
    return;
  }
  var ok = false;
  var v = el.value.trim();
  if (tol > 0) {
    var nv = parseFloat(v), nc = parseFloat(correct);
    ok = !isNaN(nv) && !isNaN(nc) && Math.abs(nv - nc) <= tol;
  } else {
    ok = (v.toLowerCase() === correct.trim().toLowerCase());
  }
  el.classList.toggle('correct', ok);
  el.classList.toggle('incorrect', !ok);
  el.setAttribute('data-is-correct', ok ? '1' : '0');
  _mirrorDropdownState(el, ok);
  if (fb) {
    fb.className = 'feedback prob-feedback ' + (ok ? 'correct' : 'incorrect');
    fb.textContent = ok ? '\u2713' : '\u2717';
  }
  _updateScoreBadge();
}

// If the input is the hidden value-holder of a custom dropdown, mirror the
// correct/incorrect state to the visible trigger so the student sees feedback.
function _mirrorDropdownState(el, ok){
  var parent = el.parentNode;
  if (!parent) return;
  // Find the dropdown that is a SIBLING of this input (within the same
  // .inline-blank-wrap), not a descendant of one. Using parent.querySelector
  // would scan deep, which could in theory pick up a nested dropdown.
  // Direct-child '> .md-dropdown' guarantees we only get the one paired
  // with this hidden input.
  var dropdown = null;
  for (var i = 0; i < parent.children.length; i++) {
    var c = parent.children[i];
    if (c.classList && c.classList.contains('md-dropdown')) { dropdown = c; break; }
  }
  if (!dropdown) return;
  var trigger = dropdown.querySelector('.md-trigger');
  if (!trigger) return;
  trigger.classList.remove('correct', 'incorrect');
  if (ok === true)  trigger.classList.add('correct');
  if (ok === false) trigger.classList.add('incorrect');
}

function _wireValidation(){
  document.querySelectorAll('.ans-num').forEach(function(el){
    el.addEventListener('input', function(){ validateInput(el); });
    el.addEventListener('blur', function(){ validateInput(el); });
  });

  // Apply initial live-suppressed class to cells that have live feedback off
  document.querySelectorAll('.problem-cell[data-live="0"]').forEach(function(cell){
    cell.classList.add('live-suppressed');
  });
}

// ---------- Score badge --------------------------------------------------
function _updateScoreBadge(){
  // Count correct vs total inputs that have data-correct (i.e., gradable)
  var inputs = document.querySelectorAll('.ans-num[data-correct]');
  var total = inputs.length;
  var correct = 0;
  inputs.forEach(function(el){
    if (el.getAttribute('data-is-correct') === '1') correct += 1;
  });
  var valEl = document.getElementById('scoreVal');
  var pctEl = document.getElementById('scorePct');
  if (valEl) valEl.textContent = correct + ' / ' + total;
  if (pctEl) pctEl.textContent = total > 0 ? '(' + Math.round(100 * correct / total) + '%)' : '';
}

// ---------- Submit (Apps Script) ------------------------------------------
function submitActivity(){
  var btn = document.getElementById('submitBtn');
  var url = btn.getAttribute('data-webhook');
  if (!url) { _flashSubmitMsg('No webhook configured.', 'error'); return; }
  var name = document.getElementById('studentName').value.trim();
  var sid  = document.getElementById('studentId').value.trim();
  if (!name || !sid) { _flashSubmitMsg('Name and ID required.', 'error'); return; }

  // Reveal correctness on submit: any cell that had live feedback suppressed
  // gets it shown now. Cells with score-only stay suppressed (CSS rule on
  // [data-score-only="1"] takes over).
  document.querySelectorAll('.problem-cell.live-suppressed').forEach(function(cell){
    cell.classList.remove('live-suppressed');
  });
  // Re-run validation so the visible state matches data-is-correct
  document.querySelectorAll('.ans-num').forEach(function(el){ validateInput(el); });
  _updateScoreBadge();

  var payload = Object.assign({ activity: ACTIVITY_SLUG }, _collectState());
  // Include score in submission so the spreadsheet captures it
  var inputs = document.querySelectorAll('.ans-num[data-correct]');
  var correctCount = 0;
  inputs.forEach(function(el){ if (el.getAttribute('data-is-correct') === '1') correctCount += 1; });
  payload.score = { correct: correctCount, total: inputs.length };

  btn.disabled = true;
  _flashSubmitMsg('Submitting...', null);

  fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(JSON.stringify(payload))
  }).then(function(){
    _flashSubmitMsg('Submitted! \u2713', 'success');
    btn.disabled = false;
  }).catch(function(e){
    _flashSubmitMsg('Submit failed: ' + e.message, 'error');
    btn.disabled = false;
  });
}

function _flashSubmitMsg(msg, kind){
  var el = document.getElementById('submitMsg');
  el.className = kind ? kind : '';
  el.textContent = msg;
}

// ---------- Google Sign-In (student) --------------------------------------
function _gsiSessionKey(){ return 'gsiUser_' + ACTIVITY_SLUG; }

function _initGSI(){
  if (!GOOGLE_CLIENT_ID || !window.google || !google.accounts || !google.accounts.id) {
    setTimeout(_initGSI, 200);
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: _onGsiCredential
  });
  google.accounts.id.renderButton(
    document.getElementById('gsiBtnHolder'),
    { type: 'standard', theme: 'outline', size: 'medium', text: 'signin_with' }
  );
  // Restore session if present
  try {
    var saved = sessionStorage.getItem(_gsiSessionKey());
    if (saved) _applyGsiUser(JSON.parse(saved));
  } catch (e) {}
}

function _onGsiCredential(resp){
  try {
    var parts = resp.credential.split('.');
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var payload = JSON.parse(atob(b64));
    var user = { email: payload.email, name: payload.name, sub: payload.sub };
    sessionStorage.setItem(_gsiSessionKey(), JSON.stringify(user));
    _applyGsiUser(user);
  } catch (e) { console.error('GSI parse failed:', e); }
}

function _applyGsiUser(user){
  var nameEl = document.getElementById('studentName');
  var idEl = document.getElementById('studentId');
  if (!nameEl.value && user.name) nameEl.value = user.name;
  if (!idEl.value && user.email) idEl.value = user.email;
  document.getElementById('gsiBtnHolder').style.display = 'none';
  var chip = document.getElementById('gsiUserChip');
  document.getElementById('gsiUserEmail').textContent = user.email;
  chip.classList.add('active');
}

function signOutStudent(){
  sessionStorage.removeItem(_gsiSessionKey());
  document.getElementById('gsiBtnHolder').style.display = '';
  document.getElementById('gsiUserChip').classList.remove('active');
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
}

// ---------- KaTeX auto-render ---------------------------------------------
function _renderMath(){
  _renderMath._retries = (_renderMath._retries || 0) + 1;
  if (typeof renderMathInElement !== 'function') {
    if (_renderMath._retries < 50) {
      setTimeout(_renderMath, 100);
    } else {
      console.warn('[activity] KaTeX auto-render did not load after 5s. Math will not render. Check cdn.jsdelivr.net is reachable.');
    }
    return;
  }
  renderMathInElement(document.body, {
    delimiters: [
      { left: '\\\\(', right: '\\\\)', display: false },
      { left: '\\\\[', right: '\\\\]', display: true },
      { left: '$$',    right: '$$',    display: true }
    ],
    throwOnError: false
  });
}

// ---------- Init ----------------------------------------------------------
document.addEventListener('DOMContentLoaded', function(){
  renderSidebar();
  _wireValidation();
  _renderMath();
  _initDropdowns();
  _initGSI();
});
<\/script>

</body>
</html>`;

// Export for builder.js (browser global)
if (typeof window !== 'undefined') {
  window.WORKSHEET_TEMPLATE = WORKSHEET_TEMPLATE;
}
