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
.stem-text{display:inline}
.ans-num{font-family:var(--mono);font-size:14px;padding:7px 11px;border:1px solid var(--rule);border-radius:3px;background:white;color:var(--ink);min-width:200px;outline:none;transition:border-color .15s,background .15s}
.ans-num:focus{border-color:var(--accent)}
.ans-num.correct{border-color:var(--green-rule);background:var(--green-bg)}
.ans-num.incorrect{border-color:var(--red-rule);background:var(--red-bg)}
.feedback{display:inline-block;margin-left:10px;font-size:13px;font-weight:500}
.feedback.correct{color:var(--green)}
.feedback.incorrect{color:var(--red)}
.prob-feedback{margin-left:0;display:block;margin-top:8px;min-height:1em}

/* Embedded static graphs (pre-rendered from Desmos at compile time) */
.prob-graph-wrap{display:block;margin:14px 0;text-align:center}
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
.inline-blank-wrap .md-dropdown{min-width:140px}
.inline-blank-wrap .md-trigger{padding:4px 9px;font-size:13px}

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
.md-trigger{font-family:var(--mono);font-size:14px;padding:7px 11px;border:1px solid var(--rule);border-radius:3px;background:white;color:var(--ink);cursor:pointer;list-style:none;display:inline-flex;justify-content:space-between;align-items:center;gap:10px;transition:border-color .15s,background .15s}
.md-trigger::-webkit-details-marker{display:none}
.md-trigger::marker{display:none;content:''}
.md-trigger::after{content:'\\25BE';color:var(--ink-light);font-size:11px;flex-shrink:0}
.md-trigger:hover{border-color:var(--accent)}
.md-dropdown[open] .md-trigger{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-lt)}
.md-trigger.correct{border-color:var(--green-rule);background:var(--green-bg)}
.md-trigger.incorrect{border-color:var(--red-rule);background:var(--red-bg)}
.md-trigger-label{display:inline-block;flex:1}
.md-placeholder{color:var(--ink-light);font-style:italic}
.md-options{position:absolute;top:calc(100% + 4px);left:0;right:0;background:white;border:1px solid var(--rule);border-radius:3px;box-shadow:0 4px 14px rgba(0,0,0,.1);max-height:280px;overflow-y:auto;z-index:50;padding:2px;min-width:160px}
.md-option{padding:8px 11px;cursor:pointer;border-radius:2px;font-family:var(--mono);font-size:14px;color:var(--ink);transition:background .1s}
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
  /* Inline blanks stay inline */
  .ans-num.inline-blank,.inline-blank-wrap .ans-num{
    width:auto;min-width:80px;display:inline-block;font-size:14px;padding:4px 10px
  }

  /* Dropdowns: full-width unless inline */
  .md-dropdown{display:block;min-width:0;width:100%}
  .md-trigger{font-size:16px;padding:10px 12px;width:100%}
  .md-option{padding:10px 12px;font-size:15px}
  .inline-blank-wrap .md-dropdown{display:inline-block;width:auto;min-width:140px}
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

@page{size:letter portrait;margin:0.75in}

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
</style>
</head>
<body>

<div class="shell">

  <div class="page-header">
    <div class="district-badge"><span class="badge-dot"></span>Dallas ISD &middot; Algebra II</div>
    <h1>{{TITLE}}</h1>
    <p>Complete each problem, then click Submit to record your work.</p>
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
    {{PROBLEMS_HTML}}

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
  if (e && e.data && e.data.type === 'request-print') {
    window.print();
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

    // Wire option clicks
    optsBox.querySelectorAll('.md-option').forEach(function(opt){
      function pick(){
        label.classList.remove('md-placeholder');
        label.innerHTML = opt.innerHTML;
        input.value = opt.getAttribute('data-value') || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        wrap.removeAttribute('open');
      }
      opt.addEventListener('click', pick);
      opt.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    });
  });

  // Close-on-outside-click
  document.addEventListener('click', function(e){
    document.querySelectorAll('.md-dropdown[open]').forEach(function(d){
      if (!d.contains(e.target)) d.removeAttribute('open');
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
  var dropdown = parent.querySelector('.md-dropdown');
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
