// =============================================================================
// builder.js — Editor engine for the activity builder
// -----------------------------------------------------------------------------
// Manages: builder state, MathLive-powered problem editing, sidebar-tool
// configuration, live preview compilation, PIN unlock, GitHub publish.
//
// PAIRS WITH: builder-template.js (defines window.WORKSHEET_TEMPLATE)
// REUSES:    auth.js (PIN_HASH, GITHUB_OWNER, GITHUB_REPO, GOOGLE_CLIENT_ID,
//            TOKEN_STORAGE_KEY, _decryptedToken, hashPin, getDecryptedToken,
//            decryptToken, encryptToken, _encodePath, toBase64, fromBase64,
//            publishToGitHub) — must be loaded BEFORE this file.
// =============================================================================

// Builder-specific constants (auth constants come from auth.js).
// DRAFT_STORAGE_KEY  — current in-progress edit, written on every saveDraft().
//                     Always equals JSON.stringify(builderState).
// LAST_SAVED_STATE_KEY — snapshot of builderState taken at the last successful
//                     publish or load. Used by _isDraftDirty() to detect
//                     unsaved changes before destructive actions (Load).
//                     Compared with `updatedAt` stripped (saveDraft churns
//                     that on every keystroke; if we left it in, every draft
//                     would read as dirty after the first edit).
const DRAFT_STORAGE_KEY      = 'builder_draft_v1';
const LAST_SAVED_STATE_KEY   = 'builder_last_saved_v1';

// =============================================================================
// BUILDER STATE
// =============================================================================
// Placeholder; replaced at init by either _freshState() or loadDraft().
// Declared as `let` so loadDraft and clearDraft can reassign.
let builderState = null;

// =============================================================================
// EDITOR UI STATE — purely presentational, not serialized
// =============================================================================
// Collapsed-problem tracking and drag-and-drop state. Kept OUT of builderState
// on purpose: this is local-session UI noise, not activity content. It must
// not appear in saved JSON, must not round-trip through GitHub or Drive, and
// should reset to a sensible default whenever the editor (re-)mounts.
//
// Default rule (chosen with the user): when a saved activity is restored from
// localStorage, every problem starts collapsed so the editor opens to a tidy
// table-of-contents view rather than a wall of expanded cards. Newly added
// problems start expanded so the teacher can edit them immediately.
const editorUI = {
  collapsed: new Set(),  // problem/figure block IDs currently collapsed
  dragSrcId: null,       // ID of the block being dragged (null when idle)
  dropIndicator: null    // shared DOM node moved between cards during dragover
};

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'untitled';
}

function _newId() { return 'x' + Math.random().toString(36).slice(2, 9); }

// State schema version — bump when the shape changes incompatibly
// v3 (May 2026): introduces graph_block — a top-level figure that flows as
// a sibling to problems in the print grid, lets a graph span multiple columns
// while leaving question text in a single column. Block discriminator is
// `type: 'problem' | 'graph_block'` on each entry of builderState.problems[].
const STATE_VERSION = 3;

function _freshState() {
  return {
    version: STATE_VERSION,
    title: 'New Activity',
    slug: 'new_activity',
    webhook: localStorage.getItem('appsScriptURL') || '',
    // Global defaults that new problems inherit
    defaults: {
      liveFeedback: true,
      scoreOnly: false
    },
    // Print-mode defaults (phase 4+). Per-problem workspace/print settings
    // live on each problem object (p.workspace etc); these are the activity
    // -wide fallbacks. Stored under .print so future print-related fields
    // (booklet, answer-key prefs, etc) have a natural home.
    print: {
      defaultWorkspaceFormat: 'dots',  // 'blank' | 'lines' | 'dots' | 'squares' | 'coord'
      units: 'in',                     // 'in' | 'cm' — display-only toggle; spacing is canonical inches
      // Phase 5 — column layout. columns is the count (1/2/3); preset is a
      // width distribution key matched to a CSS class on body (pm-cols-...).
      // The presets vary by column count; switching count resets the preset
      // to the count-appropriate default.
      columns: 1,
      columnPreset: 'equal',           // 'equal' | '60-40' | '40-60' | '25-37-37'
      // Phase 7 — print mode. 'letter' is single-sided letter-portrait
      // (existing behavior). 'booklet' is un-nested saddle-stitch (each sheet
      // = 4 logical pages, last page is the glue page = blank back cover,
      // letter-landscape physical paper). Modes are mutually exclusive.
      mode: 'letter',
      // Phase 7+: density and font-size scales for print output. Both have
      // three levels: 'standard' (default), 'compact', 'tight'. Density
      // tightens gaps, padding, and margins between problems. Font-size
      // shrinks problem text proportionally. Independent settings — a
      // teacher can use Tight font with Standard spacing or vice versa.
      density: 'standard',
      fontSize: 'standard',
      // Phase 7+: print-header field options. Name and Period always print
      // (a worksheet without a name line is uncommon enough that auto-on
      // is the right default). Date and Score are optional. Two custom
      // fields let teachers add Phone/Table/Group/etc. — each is gated on
      // its label being non-empty (no label → field doesn't print, even
      // if the show-flag is on). Custom field 1 prints before custom 2,
      // both after Date but before Score (which is always pinned right).
      headerOptions: {
        showDate: false,
        showScore: false,
        custom1Label: '',
        custom2Label: ''
      }
    },
    problems: [],
    sidebarTools: [{ id: 'save', type: 'save' }, { id: 'load', type: 'load' }],
    filename: 'activities/new_activity.html',
    // Index-card metadata (unit, description, type, tags) for index.html.
    // Pre-fills the publish modal so a load → re-publish round-trip doesn't
    // require re-typing the four fields. Populated by _loadActivity() when
    // an activity is loaded from GitHub, and by confirmPublish() whenever
    // the teacher publishes (so this always reflects the most recently
    // committed metadata, not stale load data).
    indexMeta: { unit: '', desc: '', tags: [], type: 'activity' },
    createdAt: null,
    updatedAt: null
  };
}

function saveDraft() {
  builderState.updatedAt = new Date().toISOString();
  try { localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(builderState)); }
  catch (e) { console.warn('Draft save failed:', e); }
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    builderState = _migrateState(parsed);
    // UI: when a saved activity is restored, start every problem collapsed so
    // the editor opens to an at-a-glance overview. Re-expanding is one click.
    editorUI.collapsed.clear();
    builderState.problems.forEach(p => editorUI.collapsed.add(p.id));
  } catch (e) {
    console.warn('Draft load failed:', e);
  }
}
function clearDraft() {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  builderState = _freshState();
  editorUI.collapsed.clear();
  renderAll();
}

// =============================================================================
// MIGRATION — silently upgrades v1 drafts to v2 (unified problem model)
// =============================================================================
function _migrateState(s) {
  if (!s || typeof s !== 'object') return _freshState();
  // Ensure top-level fields exist
  if (!s.defaults) s.defaults = { liveFeedback: true, scoreOnly: false };
  if (typeof s.defaults.liveFeedback !== 'boolean') s.defaults.liveFeedback = true;
  if (typeof s.defaults.scoreOnly !== 'boolean')    s.defaults.scoreOnly = false;
  // Phase 4: print-mode defaults. Older drafts won't have this; add silently.
  if (!s.print) s.print = { defaultWorkspaceFormat: 'dots', units: 'in' };
  if (typeof s.print.defaultWorkspaceFormat !== 'string') s.print.defaultWorkspaceFormat = 'dots';
  if (s.print.units !== 'cm') s.print.units = 'in';
  // Phase 5: column layout fields.
  if (![1, 2, 3].includes(s.print.columns)) s.print.columns = 1;
  if (typeof s.print.columnPreset !== 'string') s.print.columnPreset = 'equal';
  // Phase 7: print mode.
  if (s.print.mode !== 'booklet') s.print.mode = 'letter';
  // Phase 7+: density and font-size scales.
  if (!['standard','compact','tight','flush'].includes(s.print.density)) s.print.density = 'standard';
  if (!['standard','compact','tight'].includes(s.print.fontSize)) s.print.fontSize = 'standard';
  // Phase 7+: header options. Older drafts won't have the object; create it.
  if (!s.print.headerOptions || typeof s.print.headerOptions !== 'object') {
    s.print.headerOptions = { showDate: false, showScore: false, custom1Label: '', custom2Label: '' };
  } else {
    if (typeof s.print.headerOptions.showDate     !== 'boolean') s.print.headerOptions.showDate = false;
    if (typeof s.print.headerOptions.showScore    !== 'boolean') s.print.headerOptions.showScore = false;
    if (typeof s.print.headerOptions.custom1Label !== 'string')  s.print.headerOptions.custom1Label = '';
    if (typeof s.print.headerOptions.custom2Label !== 'string')  s.print.headerOptions.custom2Label = '';
  }
  if (!Array.isArray(s.problems))     s.problems = [];
  if (!Array.isArray(s.sidebarTools)) s.sidebarTools = [{ id: 'save', type: 'save' }, { id: 'load', type: 'load' }];

  // Index-card metadata. Added with the load-activity feature (May 2026).
  // Older drafts and GitHub-loaded activities published before this point
  // won't have it — seed defaults so the publish modal pre-fill code can
  // read these fields unconditionally.
  //
  // FORWARD-COMPAT NOTE: any new top-level builderState field added after
  // this point MUST get a defensive default here. Loaded activities can be
  // arbitrarily old (any version that ever shipped a builder-state block),
  // so _migrateState is the single chokepoint that keeps round-trip safe.
  // Adding a field without a migration entry will mean activities loaded
  // from GitHub crash or render with undefined values. See _loadActivity().
  if (!s.indexMeta || typeof s.indexMeta !== 'object') {
    s.indexMeta = { unit: '', desc: '', tags: [], type: 'activity' };
  } else {
    if (typeof s.indexMeta.unit !== 'string') s.indexMeta.unit = '';
    if (typeof s.indexMeta.desc !== 'string') s.indexMeta.desc = '';
    if (!Array.isArray(s.indexMeta.tags))     s.indexMeta.tags = [];
    if (typeof s.indexMeta.type !== 'string') s.indexMeta.type = 'activity';
  }

  // Migrate each block. v3 introduces graph_block (siblings to problems in
  // the same array). Dispatch on type so problem-shaped legacy entries keep
  // running through _migrateProblem (which also handles v1 → v2 cleanup),
  // and graph_block entries go through their own path.
  s.problems = s.problems.map(b => {
    if (b && b.type === 'graph_block') return _migrateGraphBlock(b);
    return _migrateProblem(b);
  });

  s.version = STATE_VERSION;
  return s;
}

function _migrateProblem(p) {
  if (!p || typeof p !== 'object') {
    return _newProblem();
  }

  // Already migrated (has blanks array and no legacy fields)
  if (Array.isArray(p.blanks) && (!p.type || p.type === 'problem')) {
    // v3: stamp explicit type on every block so the dispatch in _migrateState
    // and the compile/render passes can rely on it.
    p.type = 'problem';
    // Touch up missing flags
    if (typeof p.liveFeedback !== 'boolean') p.liveFeedback = true;
    if (typeof p.scoreOnly !== 'boolean')    p.scoreOnly = false;
    if (!p.id) p.id = _newId();
    if (typeof p.stem !== 'string') p.stem = '';
    if (!Array.isArray(p.graphs)) p.graphs = [];
    // Phase 4: workspace settings (per-problem). 'default' format means
    // "use the activity-wide default" (resolved at compile time).
    if (!p.workspace || typeof p.workspace !== 'object') {
      p.workspace = { size: 'none', format: 'default' };
    } else {
      if (typeof p.workspace.size !== 'string')   p.workspace.size = 'none';
      if (typeof p.workspace.format !== 'string') p.workspace.format = 'default';
    }
    // Phase 5: per-problem print settings (column span + future fields).
    // 'auto' = obey the activity-wide column count. '1' / '2' / '3' force
    // a specific span; 'full' forces the row-spanning treatment regardless
    // of column count. Span is silently clamped at compile time so it never
    // exceeds the active column count.
    if (!p.print || typeof p.print !== 'object') {
      p.print = { span: 'auto', pageBreakBefore: false };
    } else {
      if (typeof p.print.span !== 'string') p.print.span = 'auto';
      // Phase 6: force page break before this problem in print mode.
      if (typeof p.print.pageBreakBefore !== 'boolean') p.print.pageBreakBefore = false;
    }
    // Phase 8+: per-blank width override. Migration: any blank without a
    // width field gets 'auto'. Old activities will continue to render at
    // smarter auto widths than before — single-digit answers get 1-char
    // blanks rather than the prior 4-char floor — but no behavior breaks
    // (the old hardcoded floor of 4 was width waste, not correctness).
    if (Array.isArray(p.blanks)) {
      p.blanks.forEach(b => {
        if (b && typeof b.width !== 'string') b.width = 'auto';
      });
    }
    return p;
  }

  // Legacy: build a unified problem with a trailing {{blank:1}}
  const stem = (p.stem || '') + ' {{blank:1}}';
  const blank = (p.type === 'dropdown')
    ? {
        id: _newId(),
        kind: 'dropdown',
        choices: _normalizeChoices(p.choices || []),
        correctChoice: typeof p.correctChoice === 'number' ? p.correctChoice : 0,
        randomize: p.randomize !== false,
        width: 'auto'
      }
    : {
        id: _newId(),
        kind: 'fill_in',
        answer: p.answer || '',
        tol: parseFloat(p.tol) || 0,
        width: 'auto'
      };

  return {
    id: p.id || _newId(),
    type: 'problem',
    stem: stem,
    blanks: [blank],
    graphs: [],
    liveFeedback: true,
    scoreOnly: false,
    workspace: { size: 'none', format: 'default' },
    print: { span: 'auto', pageBreakBefore: false }
  };
}

// v3: validate / fill defaults on a graph_block. Mirrors _migrateProblem but
// for graph blocks. Idempotent — safe to run on already-valid v3 blocks.
function _migrateGraphBlock(b) {
  if (!b || typeof b !== 'object') return _newGraphBlock();
  if (!b.id) b.id = _newId();
  b.type = 'graph_block';
  // Graph payload (state, alt, width, height, imageDataUri) — same shape as
  // today's inline p.graphs[i]. May be null if the block was created but the
  // teacher cancelled the editor before saving a graph.
  if (!b.graph || typeof b.graph !== 'object') b.graph = null;
  if (b.graph) {
    if (typeof b.graph.alt    !== 'string') b.graph.alt = '';
    if (typeof b.graph.width  !== 'number') b.graph.width = GRAPH_DEFAULT_W;
    if (typeof b.graph.height !== 'number') b.graph.height = GRAPH_DEFAULT_H;
  }
  if (typeof b.caption !== 'string') b.caption = '';
  if (b.captionPosition !== 'above' && b.captionPosition !== 'below') {
    b.captionPosition = 'below';
  }
  if (!b.print || typeof b.print !== 'object') {
    b.print = { span: 'auto', pageBreakBefore: false };
  } else {
    if (typeof b.print.span !== 'string')                 b.print.span = 'auto';
    if (typeof b.print.pageBreakBefore !== 'boolean')     b.print.pageBreakBefore = false;
  }
  return b;
}

function _normalizeChoices(arr) {
  return (arr || []).map(c => {
    if (typeof c === 'string') return { mode: 'text', value: c };
    if (!c || typeof c !== 'object') return { mode: 'text', value: '' };
    return { mode: c.mode === 'math' ? 'math' : 'text', value: c.value || '' };
  });
}

// =============================================================================
// PROBLEM MANAGEMENT
// =============================================================================
function _newProblem() {
  return {
    id: _newId(),
    type: 'problem',
    stem: '',
    blanks: [],
    graphs: [],
    // Inherit current global defaults at creation time
    liveFeedback: builderState && builderState.defaults ? builderState.defaults.liveFeedback : true,
    scoreOnly:    builderState && builderState.defaults ? builderState.defaults.scoreOnly    : false,
    // Phase 4: per-problem workspace settings. 'default' format = use the
    // activity-wide default (resolved at compile time in _compileProblem).
    workspace: { size: 'none', format: 'default' },
    // Phase 5: per-problem print-layout settings. 'auto' span = problem fills
    // one column slot; explicit numbers force span; 'full' = full-row span.
    // Phase 6: pageBreakBefore forces a hard page break before this problem
    // in print mode.
    print: { span: 'auto', pageBreakBefore: false }
  };
}

// v3: graph_block factory. Top-level figure that flows next to problems in
// the print grid. Use case: 2-column layouts where the question text stays
// in one column but the graph needs to span both. Default span is 'auto'
// (one column); teacher can promote to 'full' or '2'/'3' via the same span
// dropdown problems use. graph is null until the editor saves one.
function _newGraphBlock() {
  return {
    id: _newId(),
    type: 'graph_block',
    graph: null,            // { state, alt, width, height, imageDataUri } when saved
    caption: '',
    captionPosition: 'below',
    print: { span: 'auto', pageBreakBefore: false }
  };
}

function _newBlank(kind) {
  if (kind === 'dropdown') {
    return {
      id: _newId(),
      kind: 'dropdown',
      choices: [
        { mode: 'text', value: '' },
        { mode: 'text', value: '' },
        { mode: 'text', value: '' },
        { mode: 'text', value: '' }
      ],
      correctChoice: 0,
      randomize: true,
      // Phase 8+: per-blank width override. 'auto' uses smart sizing based
      // on answer length (short answers get tight blanks); preset keys
      // override with fixed widths. See _BLANK_WIDTH_PRESETS.
      width: 'auto'
    };
  }
  return {
    id: _newId(),
    kind: 'fill_in',
    answer: '',
    tol: 0,
    width: 'auto'
  };
}

// Phase 8+: blank-width presets. Values are character-equivalents that get
// fed into the existing --ans-len CSS variable, which the input/dropdown
// width formula multiplies by 0.55em + bias. The 'auto' mode is handled
// separately in _resolveBlankWidth — it uses a curve that gives short
// answers tight blanks and long answers proportional space.
const _BLANK_WIDTH_PRESETS = {
  'tiny':   1,    // single digit / single letter
  'small':  3,    // 2-3 chars
  'medium': 6,    // short word or 4-6 char number
  'large':  12,   // phrase or long expression
  'xlarge': 20    // sentence-fragment or very long
};

const _BLANK_WIDTH_LABELS = {
  'auto':   'Auto (based on answer length)',
  'tiny':   'Tiny (~1 char)',
  'small':  'Small (~3 chars)',
  'medium': 'Medium (~6 chars)',
  'large':  'Large (~12 chars)',
  'xlarge': 'Extra large (~20 chars)'
};

// Resolve the effective character-length for a blank's width. Used by
// _compileBlankInput to set --ans-len. The 'auto' curve is intentionally
// non-linear: very short answers (1-2 chars) get a small bonus so the
// blank is visually findable, but the bonus tapers off so longer answers
// don't get oversized.
function _resolveBlankWidth(blank, answerText) {
  const w = (blank && blank.width) || 'auto';
  if (w in _BLANK_WIDTH_PRESETS) return _BLANK_WIDTH_PRESETS[w];

  // Auto: smart curve.
  const len = (answerText || '').length;
  if (len <= 1) return 1;        // single char → tight (1 char-eq)
  if (len <= 2) return 2;        // 2 chars  → 2 char-eq
  if (len <= 3) return 3;        // 3 chars  → 3 char-eq
  // Beyond 3 chars, use the answer length verbatim. The CSS formula adds a
  // 1em bias so even at 4 chars it's plenty wide. The previous floor of 4
  // is now redundant since len>=4 here.
  return len;
}

function addProblem() {
  const p = _newProblem();
  // Seed with one fill-in blank so a new problem has one blank by default
  p.blanks.push(_newBlank('fill_in'));
  // Seed stem with the first blank token
  p.stem = '{{blank:1}}';
  builderState.problems.push(p);
  saveDraft();
  renderProblems();
  refreshPreview();
}

// v3: append a new graph_block and immediately open the graph editor for it.
// If the teacher cancels the editor, the empty block stays — the card UI
// shows a placeholder thumb and an "Edit graph" button. They can also delete
// the empty block via the standard card actions. Auto-opening the editor
// matches the natural workflow ("I added a graph block; now build the graph").
function addGraphBlock() {
  const b = _newGraphBlock();
  builderState.problems.push(b);
  saveDraft();
  renderProblems();
  refreshPreview();
  // Open the editor so the teacher can build the graph right away.
  _openGraphEditor({ kind: 'block', blockId: b.id });
}
window.addGraphBlock = addGraphBlock;

function removeProblem(id) {
  builderState.problems = builderState.problems.filter(p => p.id !== id);
  saveDraft();
  renderProblems();
  refreshPreview();
}

function updateProblem(id, key, value) {
  const p = builderState.problems.find(x => x.id === id);
  if (!p) return;
  p[key] = value;
  saveDraft();
  refreshPreview();
}

function moveProblem(id, dir) {
  const i = builderState.problems.findIndex(p => p.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= builderState.problems.length) return;
  const tmp = builderState.problems[i];
  builderState.problems[i] = builderState.problems[j];
  builderState.problems[j] = tmp;
  saveDraft();
  renderProblems();
  refreshPreview();
}

// =============================================================================
// COLLAPSE / EXPAND — per-problem and bulk
// =============================================================================
// editorUI.collapsed holds the IDs of currently-collapsed problem/figure
// blocks. Membership is the source of truth; the renderer reads it on each
// pass. Toggling triggers a re-render so the chevron glyph and the
// .collapsed class on the card stay in sync. State is in-memory only —
// see editorUI declaration for the rationale.

function toggleCollapseProblem(id) {
  if (editorUI.collapsed.has(id)) editorUI.collapsed.delete(id);
  else                            editorUI.collapsed.add(id);
  renderProblems();
}

function collapseAllProblems() {
  builderState.problems.forEach(p => editorUI.collapsed.add(p.id));
  renderProblems();
}

function expandAllProblems() {
  editorUI.collapsed.clear();
  renderProblems();
}

// =============================================================================
// DRAG-AND-DROP REORDERING — native HTML5 DnD
// =============================================================================
// Only the .block-header is draggable, not the whole card. This keeps
// textareas/inputs in the body usable for normal text selection and makes
// the drag ghost compact (the browser uses the dragged element's bounding
// box for the ghost — using the whole card would produce a tall, awkward
// ghost on expanded cards).
//
// Drop targeting: during dragover we look at every block-card EXCEPT the
// one being dragged, find which card the cursor is above the midline of,
// and treat that as the insertion point. Filtering out the dragging card
// means the computed index maps directly to the post-removal array index,
// which simplifies the reorder math.

function _ensureDropIndicator() {
  if (!editorUI.dropIndicator) {
    const ind = document.createElement('div');
    ind.className = 'drop-indicator';
    editorUI.dropIndicator = ind;
  }
  return editorUI.dropIndicator;
}

function _removeDropIndicator() {
  const ind = editorUI.dropIndicator;
  if (ind && ind.parentNode) ind.parentNode.removeChild(ind);
}

// Compute the insertion index (in the post-removal array) given the cursor's
// Y position. Returns an integer in [0, otherCards.length].
function _computeDropIndex(otherCards, clientY) {
  for (let i = 0; i < otherCards.length; i++) {
    const r = otherCards[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return otherCards.length;
}

function _onCardDragStart(e, id, card) {
  // If the drag was initiated from a click on a header button (chevron,
  // move-up, move-down, remove), bail. The user wanted to click the
  // button, not drag the card. Some browsers fire dragstart on the parent
  // even when the child has draggable=false, so this guard is necessary.
  if (e.target && e.target.closest && e.target.closest('button')) {
    e.preventDefault();
    return;
  }
  editorUI.dragSrcId = id;
  card.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers refuse to start a drag without dataTransfer data set.
    try { e.dataTransfer.setData('text/plain', id); } catch (_) {}
  }
}

function _onCardDragEnd(e, card) {
  editorUI.dragSrcId = null;
  card.classList.remove('dragging');
  _removeDropIndicator();
}

function _onProblemsContainerDragOver(e) {
  if (!editorUI.dragSrcId) return;
  // Must preventDefault to allow drop and to get dragover events flowing.
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const container = e.currentTarget;
  const draggingCard = container.querySelector('.block-card.dragging');
  if (!draggingCard) return;
  const otherCards = Array.from(container.querySelectorAll('.block-card'))
    .filter(c => c !== draggingCard);
  const insertBefore = _computeDropIndex(otherCards, e.clientY);
  // Don't display an indicator at the no-op position (where the dragged
  // card already lives in the array) — distracting and slightly misleading.
  const srcIdx = builderState.problems.findIndex(p => p.id === editorUI.dragSrcId);
  if (insertBefore === srcIdx) { _removeDropIndicator(); return; }
  const ind = _ensureDropIndicator();
  if (insertBefore < otherCards.length) {
    container.insertBefore(ind, otherCards[insertBefore]);
  } else {
    container.appendChild(ind);
  }
}

function _onProblemsContainerDragLeave(e) {
  // Only clear if the cursor genuinely left the container — dragleave fires
  // every time we move between children, which would cause flicker.
  const container = e.currentTarget;
  if (!container.contains(e.relatedTarget)) _removeDropIndicator();
}

function _onProblemsContainerDrop(e) {
  if (!editorUI.dragSrcId) return;
  e.preventDefault();
  const container = e.currentTarget;
  const draggingCard = container.querySelector('.block-card.dragging');
  if (!draggingCard) { _removeDropIndicator(); return; }
  const otherCards = Array.from(container.querySelectorAll('.block-card'))
    .filter(c => c !== draggingCard);
  const insertBefore = _computeDropIndex(otherCards, e.clientY);
  _reorderProblemById(editorUI.dragSrcId, insertBefore);
}

function _reorderProblemById(srcId, insertBefore) {
  const srcIdx = builderState.problems.findIndex(p => p.id === srcId);
  if (srcIdx < 0) return;
  // Insert at the same spot is a no-op; bail without a wasted re-render.
  if (insertBefore === srcIdx) return;
  const [item] = builderState.problems.splice(srcIdx, 1);
  // insertBefore was computed against the array WITHOUT the source already
  // accounted for (otherCards filtered out the dragging card), so it can be
  // used directly on the post-removal array.
  builderState.problems.splice(insertBefore, 0, item);
  saveDraft();
  renderProblems();
  refreshPreview();
}

// =============================================================================
// PROBLEM RENDERING — unified model with inline blanks
// =============================================================================
// v3 dispatcher: walks builderState.problems[] and renders each entry into
// the editor list, dispatching to _renderProblemCard or _renderGraphBlockCard
// based on type. Maintains two counters (problemNum, figureNum) so display
// labels stay consistent with how the worksheet will compile.
function renderProblems() {
  const container = document.getElementById('problemsContainer');
  if (!container) return;
  // One-time wiring: the dragover/drop listeners live on the container itself
  // so they survive innerHTML replacement below. Cards re-bind their dragstart
  // handlers on every render (fine — they're freshly created elements).
  if (!container._dragWired) {
    container.addEventListener('dragover', _onProblemsContainerDragOver);
    container.addEventListener('drop', _onProblemsContainerDrop);
    container.addEventListener('dragleave', _onProblemsContainerDragLeave);
    container._dragWired = true;
  }
  container.innerHTML = '';
  if (builderState.problems.length === 0) {
    container.innerHTML = '<div class="empty-hint">No problems yet. Click "Add problem" below.</div>';
    return;
  }
  let problemNum = 0;
  let figureNum  = 0;
  builderState.problems.forEach((b, idx) => {
    if (b && b.type === 'graph_block') {
      figureNum++;
      container.appendChild(_renderGraphBlockCard(b, idx, figureNum));
    } else {
      problemNum++;
      container.appendChild(_renderProblemCard(b, idx, problemNum));
    }
  });
}

// Renders one problem editor card. Extracted from the original renderProblems
// body during the v3 dispatcher refactor — behavior is unchanged from v2 except
// the displayed problem number now comes from a caller-supplied counter
// (rather than idx+1) so figures don't consume problem numbers.
function _renderProblemCard(p, idx, displayNum) {
  const card = document.createElement('div');
  card.className = 'block-card';
  card.setAttribute('data-id', p.id);
  const isCollapsed = editorUI.collapsed.has(p.id);
  if (isCollapsed) card.classList.add('collapsed');

  // ----- Header: chevron + number + feedback toggles + action buttons.
  // Header is the drag handle — making the entire card draggable would
  // hijack text-selection inside the textareas below, so the header
  // gets draggable=true and child buttons get draggable=false to keep
  // them clickable without initiating a card drag.
  const header = document.createElement('div');
  header.className = 'block-header';
  header.draggable = true;
  header.innerHTML =
    '<div class="block-header-left">' +
      '<button class="bb-btn collapse-toggle" title="' + (isCollapsed ? 'Expand' : 'Collapse') + '" onclick="toggleCollapseProblem(\'' + p.id + '\')">' + (isCollapsed ? '▸' : '▾') + '</button>' +
      '<span class="block-num">Problem ' + displayNum + '</span>' +
    '</div>' +
    '<div class="block-actions">' +
      '<button class="bb-btn" title="Move up" onclick="moveProblem(\'' + p.id + '\', -1)">↑</button>' +
      '<button class="bb-btn" title="Move down" onclick="moveProblem(\'' + p.id + '\', 1)">↓</button>' +
      '<button class="bb-btn danger" title="Remove" onclick="removeProblem(\'' + p.id + '\')">✕</button>' +
    '</div>';
  // Buttons inside the header must NOT initiate a drag — otherwise clicking
  // ↑/↓/✕/chevron would start dragging the parent card in some browsers.
  header.querySelectorAll('button').forEach(b => { b.draggable = false; });
  header.addEventListener('dragstart', e => _onCardDragStart(e, p.id, card));
  header.addEventListener('dragend',   e => _onCardDragEnd(e, card));
  card.appendChild(header);

    // ----- Per-problem feedback toggles
    const fbRow = document.createElement('div');
    fbRow.className = 'feedback-toggles';
    fbRow.innerHTML =
      '<label><input type="checkbox" ' + (p.liveFeedback ? 'checked' : '') + ' data-flag="liveFeedback"> Live feedback</label>' +
      '<label><input type="checkbox" ' + (p.scoreOnly ? 'checked' : '') + ' data-flag="scoreOnly"> Score-only (lockdown)</label>';
    fbRow.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.onchange = (e) => updateProblem(p.id, e.target.getAttribute('data-flag'), e.target.checked);
    });
    card.appendChild(fbRow);

    // ----- Per-problem workspace (phase 4)
    // Two compact dropdowns: size (None / 1in / 2in / 3in / Half / Full),
    // format (Use default / Blank / Lines / Dots / Squares / Coord). Size
    // labels track the active units toggle in builderState.print.
    const ws = p.workspace || { size: 'none', format: 'default' };
    const units = (builderState.print && builderState.print.units) || 'in';
    const wsRow = document.createElement('div');
    wsRow.className = 'workspace-row';
    const sizeKeys = ['none', '1in', '2in', '3in', 'half', 'full'];
    const fmtKeys  = ['default', 'blank', 'lines', 'dots', 'squares', 'coord'];
    const defaultFmtName = _wsFormatLabel(
      (builderState.print && builderState.print.defaultWorkspaceFormat) || 'dots'
    );
    const sizeOpts = sizeKeys.map(k =>
      '<option value="' + k + '"' + (ws.size === k ? ' selected' : '') + '>' +
      _wsSizeLabel(k, units) + '</option>'
    ).join('');
    const fmtOpts = fmtKeys.map(k => {
      const label = (k === 'default')
        ? 'Use default (' + defaultFmtName + ')'
        : _wsFormatLabel(k);
      return '<option value="' + k + '"' + (ws.format === k ? ' selected' : '') + '>' + label + '</option>';
    }).join('');
    wsRow.innerHTML =
      '<label class="ws-lbl">Work space ' +
        '<select data-ws-field="size">' + sizeOpts + '</select>' +
      '</label>' +
      '<label class="ws-lbl">Format ' +
        '<select data-ws-field="format">' + fmtOpts + '</select>' +
      '</label>';

    // Per-problem column span (phase 5). Options dynamically depend on the
    // active column count: in 1-col mode the dropdown is hidden entirely
    // (only 'auto' makes sense); in 2-col mode auto/1/2/full; in 3-col mode
    // auto/1/2/3/full.
    const activeCols = (builderState.print && builderState.print.columns) || 1;
    if (activeCols > 1) {
      const curSpan = (p.print && p.print.span) || 'auto';
      const spanKeys = activeCols === 2
        ? ['auto', '2', 'full']
        : ['auto', '2', '3', 'full'];
      const spanLabels = {
        'auto': '1 col',
        '2':    '2 cols',
        '3':    '3 cols',
        'full': 'Full width'
      };
      const spanOpts = spanKeys.map(k =>
        '<option value="' + k + '"' + (curSpan === k ? ' selected' : '') + '>' +
        spanLabels[k] + '</option>'
      ).join('');
      const spanLabel = document.createElement('label');
      spanLabel.className = 'ws-lbl';
      spanLabel.innerHTML = 'Span <select data-ws-field="span">' + spanOpts + '</select>';
      wsRow.innerHTML += spanLabel.outerHTML;
    }

    // Force page break before this problem (phase 6). Checkbox lives in the
    // same row as workspace controls — appears for all problems regardless
    // of column count, since paging is independent of layout. The very first
    // problem always omits it (a page break before problem 1 is a no-op).
    if (idx > 0) {
      const pbCheck = document.createElement('label');
      pbCheck.className = 'ws-lbl ws-pb-check';
      const checked = (p.print && p.print.pageBreakBefore) ? 'checked' : '';
      pbCheck.innerHTML =
        '<input type="checkbox" data-ws-field="pageBreakBefore" ' + checked + '>' +
        ' <span title="Force a new page before this problem when printing">' +
        '\u21B5 Page break before</span>';
      wsRow.appendChild(pbCheck);
    }

    wsRow.querySelectorAll('select, input[type=checkbox]').forEach(el => {
      const handler = (e) => {
        const field = e.target.getAttribute('data-ws-field');
        const value = (e.target.type === 'checkbox') ? e.target.checked : e.target.value;
        if (field === 'span' || field === 'pageBreakBefore') {
          updateProblemPrint(p.id, field, value);
        } else {
          updateProblemWorkspace(p.id, field, value);
        }
      };
      if (el.tagName === 'SELECT') el.onchange = handler;
      else el.onchange = handler;
    });
    card.appendChild(wsRow);

    // ----- Stem editor (plain textarea — supports {{blank:N}} tokens)
    const stemLabel = document.createElement('label');
    stemLabel.className = 'field-label';
    stemLabel.innerHTML = 'Problem stem';
    card.appendChild(stemLabel);

    const help = document.createElement('div');
    help.className = 'field-hint stem-help';
    help.innerHTML =
      'Insert <code>{{blank:1}}</code>, <code>{{blank:2}}</code>, etc. for input fields. ' +
      'Wrap math in <code>$...$</code> (inline) or <code>$$...$$</code> (display). ' +
      'You can also use <code>**bold**</code>, <code>_italic_</code>, ' +
      '<code>==highlight==</code>, GFM tables, and callouts like <code>&gt; [!TIP]</code>. ' +
      'Stems support full extended-markdown formatting.';
    card.appendChild(help);

    const stemArea = document.createElement('textarea');
    stemArea.className = 'text-input stem-area';
    stemArea.rows = 3;
    stemArea.value = p.stem || '';
    stemArea.placeholder = 'Type the problem text. Insert {{blank:N}} where students should answer.';
    stemArea.oninput = () => {
      updateProblem(p.id, 'stem', stemArea.value);
    };
    stemArea.onblur = () => {
      _syncBlanksToStem(p.id);
    };
    card.appendChild(stemArea);

    // ----- Insert-blank shortcut buttons
    const insertRow = document.createElement('div');
    insertRow.className = 'insert-blank-row';
    const fillBtn = document.createElement('button');
    fillBtn.className = 'add-btn';
    fillBtn.innerHTML = '<span class="plus">+</span> Insert fill-in blank';
    fillBtn.onclick = () => _insertBlankAtCursor(p.id, stemArea, 'fill_in');
    const dropBtn = document.createElement('button');
    dropBtn.className = 'add-btn';
    dropBtn.innerHTML = '<span class="plus">+</span> Insert dropdown blank';
    dropBtn.onclick = () => _insertBlankAtCursor(p.id, stemArea, 'dropdown');
    const graphBtn = document.createElement('button');
    graphBtn.className = 'add-btn';
    graphBtn.innerHTML = '<span class="plus">+</span> Insert graph';
    graphBtn.onclick = () => _openGraphEditor({ kind: 'inline', problemId: p.id, graphId: null, insertTarget: stemArea });
    insertRow.appendChild(fillBtn);
    insertRow.appendChild(dropBtn);
    insertRow.appendChild(graphBtn);
    card.appendChild(insertRow);

    // ----- Stem analysis: warn about duplicate / orphan blanks
    const analysis = _analyzeStem(p.stem || '', p.blanks || []);
    if (analysis.duplicates.length || analysis.orphans.length) {
      const warn = document.createElement('div');
      warn.className = 'stem-warn';
      const parts = [];
      if (analysis.duplicates.length) {
        parts.push('Blank ' + analysis.duplicates.join(', ') + ' appears multiple times — all instances share one input.');
      }
      if (analysis.orphans.length) {
        parts.push('Blank ' + analysis.orphans.join(', ') + ' has config but is not in the stem.');
      }
      warn.textContent = '⚠ ' + parts.join(' ');
      card.appendChild(warn);
    }

    // ----- Blank configuration cards
    const blanksLabel = document.createElement('div');
    blanksLabel.className = 'field-label';
    blanksLabel.style.marginTop = '12px';
    blanksLabel.textContent = 'Blanks';
    card.appendChild(blanksLabel);

    if (!p.blanks || p.blanks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-hint';
      empty.style.padding = '10px';
      empty.style.fontSize = '11px';
      empty.textContent = 'No blanks yet — insert one above.';
      card.appendChild(empty);
    } else {
      p.blanks.forEach((blank, bIdx) => {
        card.appendChild(_renderBlankCard(p, blank, bIdx));
      });
    }

    // ----- Graphs section (parallel to blanks)
    const graphs = p.graphs || [];
    if (graphs.length > 0) {
      const graphsLabel = document.createElement('div');
      graphsLabel.className = 'field-label';
      graphsLabel.style.marginTop = '12px';
      graphsLabel.textContent = 'Graphs';
      card.appendChild(graphsLabel);

      const stemTokens = _findGraphTokensInStem(p.stem || '');
      graphs.forEach((g) => {
        const isOrphan = !stemTokens.has(g.id);
        card.appendChild(_renderGraphCard(p, g, isOrphan));
      });
    }

    return card;
}

// v3: render the editor card for a graph_block. Header is "Figure N" (the
// figure counter, supplied by the dispatcher in renderProblems). Body shows
// a thumbnail of the captured graph (or a placeholder if none yet), an
// "Edit graph" button that opens the existing modal targeted at this block,
// a caption textarea, a caption-position dropdown, and the same span /
// page-break-before controls problems use.
function _renderGraphBlockCard(b, idx, figureNum) {
  const card = document.createElement('div');
  card.className = 'block-card figure-block-card';
  card.setAttribute('data-id', b.id);
  const isCollapsed = editorUI.collapsed.has(b.id);
  if (isCollapsed) card.classList.add('collapsed');

  // ----- Header (chevron + figure label + actions). Same drag-handle
  // pattern as _renderProblemCard — see comments there for the rationale.
  const header = document.createElement('div');
  header.className = 'block-header';
  header.draggable = true;
  header.innerHTML =
    '<div class="block-header-left">' +
      '<button class="bb-btn collapse-toggle" title="' + (isCollapsed ? 'Expand' : 'Collapse') + '" onclick="toggleCollapseProblem(\'' + b.id + '\')">' + (isCollapsed ? '▸' : '▾') + '</button>' +
      '<span class="block-num">Figure ' + figureNum + '</span>' +
    '</div>' +
    '<div class="block-actions">' +
      '<button class="bb-btn" title="Move up" onclick="moveProblem(\'' + b.id + '\', -1)">↑</button>' +
      '<button class="bb-btn" title="Move down" onclick="moveProblem(\'' + b.id + '\', 1)">↓</button>' +
      '<button class="bb-btn danger" title="Remove" onclick="removeProblem(\'' + b.id + '\')">✕</button>' +
    '</div>';
  header.querySelectorAll('button').forEach(btn => { btn.draggable = false; });
  header.addEventListener('dragstart', e => _onCardDragStart(e, b.id, card));
  header.addEventListener('dragend',   e => _onCardDragEnd(e, card));
  card.appendChild(header);

  // ----- Span / page-break controls (mirror problem card row, sans workspace)
  const wsRow = document.createElement('div');
  wsRow.className = 'workspace-row';
  const activeCols = (builderState.print && builderState.print.columns) || 1;
  if (activeCols > 1) {
    const curSpan = (b.print && b.print.span) || 'auto';
    const spanKeys = activeCols === 2 ? ['auto', '2', 'full'] : ['auto', '2', '3', 'full'];
    const spanLabels = { 'auto': '1 col', '2': '2 cols', '3': '3 cols', 'full': 'Full width' };
    const spanOpts = spanKeys.map(k =>
      '<option value="' + k + '"' + (curSpan === k ? ' selected' : '') + '>' + spanLabels[k] + '</option>'
    ).join('');
    const spanLabel = document.createElement('label');
    spanLabel.className = 'ws-lbl';
    spanLabel.innerHTML = 'Span <select data-ws-field="span">' + spanOpts + '</select>';
    wsRow.appendChild(spanLabel);
  }
  if (idx > 0) {
    const pbCheck = document.createElement('label');
    pbCheck.className = 'ws-lbl ws-pb-check';
    const checked = (b.print && b.print.pageBreakBefore) ? 'checked' : '';
    pbCheck.innerHTML =
      '<input type="checkbox" data-ws-field="pageBreakBefore" ' + checked + '>' +
      ' <span title="Force a new page before this figure when printing">↵ Page break before</span>';
    wsRow.appendChild(pbCheck);
  }
  // Empty-state filler when 1-col mode + idx==0 leaves no controls.
  if (!wsRow.firstChild) {
    const hint = document.createElement('span');
    hint.style.color = 'var(--ink-light)';
    hint.style.fontStyle = 'italic';
    hint.textContent = 'Switch to 2- or 3-column print mode to set this figure to span columns.';
    wsRow.appendChild(hint);
  }
  wsRow.querySelectorAll('select, input[type=checkbox]').forEach(el => {
    el.onchange = (e) => {
      const field = e.target.getAttribute('data-ws-field');
      const value = (e.target.type === 'checkbox') ? e.target.checked : e.target.value;
      updateProblemPrint(b.id, field, value);
    };
  });
  card.appendChild(wsRow);

  // ----- Graph thumb + edit button
  const figRow = document.createElement('div');
  figRow.className = 'figure-block-row';
  if (b.graph && b.graph.imageDataUri) {
    const img = document.createElement('img');
    img.className = 'graph-thumb';
    img.src = b.graph.imageDataUri;
    img.alt = '';
    figRow.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'graph-thumb-empty';
    ph.textContent = '⦿';
    ph.title = 'No graph yet — click Edit graph to build one.';
    figRow.appendChild(ph);
  }
  const figBody = document.createElement('div');
  figBody.className = 'graph-card-body';
  if (b.graph && b.graph.alt) {
    const altEl = document.createElement('div');
    altEl.className = 'graph-card-alt';
    altEl.textContent = b.graph.alt;
    figBody.appendChild(altEl);
  } else {
    const altEl = document.createElement('div');
    altEl.className = 'graph-card-alt empty';
    altEl.textContent = b.graph ? 'No alt text — edit to add.' : 'No graph yet — click Edit graph below.';
    figBody.appendChild(altEl);
  }
  figRow.appendChild(figBody);
  const editBtn = document.createElement('button');
  editBtn.className = 'bb-btn';
  editBtn.style.marginLeft = 'auto';
  editBtn.title = 'Edit graph';
  editBtn.innerHTML = '✎ Edit graph';
  editBtn.style.width = 'auto';
  editBtn.style.padding = '4px 10px';
  editBtn.onclick = () => _openGraphEditor({ kind: 'block', blockId: b.id });
  figRow.appendChild(editBtn);
  card.appendChild(figRow);

  // ----- Caption + caption position
  const capLabel = document.createElement('div');
  capLabel.className = 'field-label';
  capLabel.style.marginTop = '10px';
  capLabel.textContent = 'Caption (optional)';
  card.appendChild(capLabel);

  const capArea = document.createElement('textarea');
  capArea.className = 'text-input';
  capArea.rows = 2;
  capArea.placeholder = 'e.g. Graph of f(x) = x² + 3x − 4. Math is supported with $...$.';
  capArea.value = b.caption || '';
  capArea.oninput = () => {
    b.caption = capArea.value;
    saveDraft();
    refreshPreview();
  };
  card.appendChild(capArea);

  const capPosRow = document.createElement('div');
  capPosRow.className = 'workspace-row';
  capPosRow.style.marginTop = '6px';
  const positions = ['below', 'above'];
  const posOpts = positions.map(k =>
    '<option value="' + k + '"' + ((b.captionPosition || 'below') === k ? ' selected' : '') +
    '>' + (k === 'below' ? 'Below the graph' : 'Above the graph') + '</option>'
  ).join('');
  capPosRow.innerHTML =
    '<label class="ws-lbl">Caption position ' +
      '<select data-cap-pos>' + posOpts + '</select>' +
    '</label>';
  capPosRow.querySelector('select').onchange = (e) => {
    b.captionPosition = e.target.value;
    saveDraft();
    refreshPreview();
  };
  card.appendChild(capPosRow);

  return card;
}

// Analyze a stem string, returning issues for the editor warning banner.
function _analyzeStem(stem, blanks) {
  const re = /\{\{blank:(\d+)\}\}/g;
  const counts = {};
  let m;
  while ((m = re.exec(stem)) !== null) {
    const n = parseInt(m[1], 10);
    counts[n] = (counts[n] || 0) + 1;
  }
  const duplicates = Object.keys(counts).filter(n => counts[n] > 1).map(n => parseInt(n, 10)).sort((a, b) => a - b);
  const inStem = new Set(Object.keys(counts).map(n => parseInt(n, 10)));
  const orphans = [];
  for (let i = 1; i <= blanks.length; i++) {
    if (!inStem.has(i)) orphans.push(i);
  }
  return { duplicates: duplicates, orphans: orphans, inStem: inStem };
}

// =============================================================================
// GRAPH BLOCKS
// -----------------------------------------------------------------------------
// A graph block lives on a problem as { id, state, alt, width, height,
// imageDataUri }. The stem references it via {{graph:<id>}}. At compile time
// the token is replaced with an <img> tag using the cached imageDataUri.
//
// Capture happens at SAVE time (not compile time) to keep compileActivity()
// synchronous — preview-on-keystroke must stay fast.
// =============================================================================

const GRAPH_DEFAULT_W = 480;
const GRAPH_DEFAULT_H = 320;
const GRAPH_TOKEN_RE = /\{\{graph:(graph_[a-z0-9]+)\}\}/g;

function _newGraphId() {
  return 'graph_' + Math.random().toString(36).slice(2, 10);
}

function _findGraphTokensInStem(stem) {
  const ids = new Set();
  let m;
  GRAPH_TOKEN_RE.lastIndex = 0;
  while ((m = GRAPH_TOKEN_RE.exec(stem || '')) !== null) ids.add(m[1]);
  return ids;
}

// Render the per-graph chip in the problem editor (under "Graphs").
function _renderGraphCard(p, g, isOrphan) {
  const card = document.createElement('div');
  card.className = 'graph-card' + (isOrphan ? ' orphan' : '');

  // Thumb
  if (g.imageDataUri) {
    const img = document.createElement('img');
    img.className = 'graph-thumb';
    img.src = g.imageDataUri;
    img.alt = '';
    card.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'graph-thumb-empty';
    ph.textContent = '\u29BF';
    card.appendChild(ph);
  }

  // Body
  const body = document.createElement('div');
  body.className = 'graph-card-body';
  const idEl = document.createElement('div');
  idEl.className = 'graph-card-id';
  idEl.textContent = g.id;
  body.appendChild(idEl);
  const altEl = document.createElement('div');
  altEl.className = 'graph-card-alt' + (g.alt ? '' : ' empty');
  altEl.textContent = g.alt ? g.alt : 'No alt text — edit to add.';
  body.appendChild(altEl);
  if (isOrphan) {
    const w = document.createElement('div');
    w.className = 'graph-orphan-warn';
    w.textContent = '\u26A0 Not referenced in stem';
    body.appendChild(w);
  }
  card.appendChild(body);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'graph-card-actions';
  const editBtn = document.createElement('button');
  editBtn.className = 'bb-btn';
  editBtn.title = 'Edit graph';
  editBtn.textContent = '\u270E';
  editBtn.onclick = () => _openGraphEditor({ kind: 'inline', problemId: p.id, graphId: g.id, insertTarget: null });
  const insertBtn = document.createElement('button');
  insertBtn.className = 'bb-btn';
  insertBtn.title = 'Insert reference into stem at end';
  insertBtn.textContent = '\u21B5';
  insertBtn.onclick = () => _insertGraphTokenAtEnd(p.id, g.id);
  const delBtn = document.createElement('button');
  delBtn.className = 'bb-btn danger';
  delBtn.title = 'Delete graph';
  delBtn.textContent = '\u00D7';
  delBtn.onclick = () => {
    if (!confirm('Delete this graph? Any {{graph:' + g.id + '}} reference in the stem will become broken text.')) return;
    p.graphs = (p.graphs || []).filter(x => x.id !== g.id);
    saveDraft();
    renderProblems();
    refreshPreview();
  };
  actions.appendChild(editBtn);
  actions.appendChild(insertBtn);
  actions.appendChild(delBtn);
  card.appendChild(actions);

  return card;
}

// Insert a {{graph:id}} token at the end of the stem (used when a graph exists
// in p.graphs but the teacher has lost the reference).
function _insertGraphTokenAtEnd(problemId, graphId) {
  const p = builderState.problems.find(x => x.id === problemId);
  if (!p) return;
  const token = '{{graph:' + graphId + '}}';
  p.stem = (p.stem || '').replace(/\s*$/, '') + '\n\n' + token + '\n';
  saveDraft();
  renderProblems();
  refreshPreview();
}

// ---------- Graph editor modal ----------------------------------------------
// Module-level state for the editor modal. v3 changed the target shape: instead
// of (problemId, graphId, insertTarget), the editor now takes a single
// target object that's either:
//   { kind: 'inline', problemId, graphId, insertTarget }  — graph embedded in
//     a problem's stem via {{graph:id}} token (existing behavior)
//   { kind: 'block', blockId }                            — top-level
//     graph_block (v3+); the entire block IS this one graph
// Reset on close so we don't leak calculators.
let _graphEditor = {
  target: null,
  calc: null
};

function _openGraphEditor(target) {
  if (typeof Desmos === 'undefined') {
    alert('Desmos API has not loaded yet. Wait a moment and try again.');
    return;
  }

  // Resolve "existing" graph object based on target kind.
  let existing = null;
  if (target && target.kind === 'block') {
    const block = builderState.problems.find(x => x.id === target.blockId);
    if (!block) return;
    existing = block.graph || null;
  } else if (target && target.kind === 'inline') {
    const p = builderState.problems.find(x => x.id === target.problemId);
    if (!p) return;
    if (target.graphId) {
      existing = (p.graphs || []).find(x => x.id === target.graphId) || null;
    }
  } else {
    return;
  }

  _graphEditor.target = target;

  const backdrop = document.getElementById('graphEditorBackdrop');
  const titleEl  = document.getElementById('graphEditorTitle');
  const altEl    = document.getElementById('graphEditorAlt');
  const wEl      = document.getElementById('graphEditorWidth');
  const hEl      = document.getElementById('graphEditorHeight');
  const reqEl    = document.getElementById('graphEditorAltRequired');
  const status   = document.getElementById('graphEditorStatus');
  const host     = document.getElementById('graphEditorHost');

  // Reset UI
  reqEl.classList.remove('visible');
  status.classList.remove('error');
  status.textContent = '';
  host.innerHTML = '';

  if (existing) {
    titleEl.textContent = (target.kind === 'block') ? 'Edit figure' : 'Edit graph';
    altEl.value = existing.alt || '';
    wEl.value = existing.width || GRAPH_DEFAULT_W;
    hEl.value = existing.height || GRAPH_DEFAULT_H;
  } else {
    titleEl.textContent = (target.kind === 'block') ? 'Build figure' : 'Insert graph';
    altEl.value = '';
    wEl.value = GRAPH_DEFAULT_W;
    hEl.value = GRAPH_DEFAULT_H;
  }

  // Spin up Desmos in the host. We use a permissive set of options here so the
  // teacher can author freely; the captured screenshot is just an image.
  // Modal must be visible (.open) before we instantiate, otherwise the host
  // has zero size and the calculator mounts with a 0x0 viewport.
  backdrop.classList.add('open');
  _graphEditor.calc = Desmos.GraphingCalculator(host, {
    expressions: true,
    settingsMenu: true,
    zoomButtons: true,
    keypad: true,
    border: false
  });
  if (existing && existing.state) {
    try {
      _graphEditor.calc.setState(existing.state);
    } catch (e) {
      console.warn('[graph editor] setState failed; starting blank:', e);
    }
  }

  // Resize after layout settles
  setTimeout(() => { if (_graphEditor.calc && _graphEditor.calc.resize) _graphEditor.calc.resize(); }, 60);
}

function closeGraphEditor() {
  const backdrop = document.getElementById('graphEditorBackdrop');
  if (backdrop) backdrop.classList.remove('open');
  if (_graphEditor.calc && _graphEditor.calc.destroy) {
    try { _graphEditor.calc.destroy(); } catch (e) { /* ignore */ }
  }
  _graphEditor.calc = null;
  _graphEditor.target = null;
}
// expose for inline onclick
window.closeGraphEditor = closeGraphEditor;

function saveGraphEditor() {
  const altEl  = document.getElementById('graphEditorAlt');
  const wEl    = document.getElementById('graphEditorWidth');
  const hEl    = document.getElementById('graphEditorHeight');
  const reqEl  = document.getElementById('graphEditorAltRequired');
  const status = document.getElementById('graphEditorStatus');
  const saveBtn = document.getElementById('graphEditorSaveBtn');

  const alt = (altEl.value || '').trim();
  if (!alt) {
    reqEl.classList.add('visible');
    altEl.focus();
    return;
  }
  reqEl.classList.remove('visible');

  const w = Math.max(200, Math.min(900, parseInt(wEl.value, 10) || GRAPH_DEFAULT_W));
  const h = Math.max(160, Math.min(600, parseInt(hEl.value, 10) || GRAPH_DEFAULT_H));

  const target = _graphEditor.target;
  if (!target || !_graphEditor.calc) { closeGraphEditor(); return; }

  status.classList.remove('error');
  status.textContent = 'Capturing graph…';
  saveBtn.disabled = true;

  const calc = _graphEditor.calc;
  const state = calc.getState();

  // Capture at 2x for retina/print sharpness. asyncScreenshot waits for the
  // calculator to finish rendering before producing the PNG.
  _captureGraphPNG(calc, w, h, function(err, dataUri) {
    saveBtn.disabled = false;
    if (err) {
      status.classList.add('error');
      status.textContent = 'Capture failed: ' + (err.message || err);
      return;
    }

    if (target.kind === 'block') {
      // v3: top-level graph_block. The block IS the graph, so we replace
      // block.graph wholesale. No id needed (the block's id is the identity).
      const block = builderState.problems.find(x => x.id === target.blockId);
      if (!block) { closeGraphEditor(); return; }
      block.graph = {
        state: state,
        alt: alt,
        width: w,
        height: h,
        imageDataUri: dataUri
      };
      saveDraft();
      closeGraphEditor();
      renderProblems();
      refreshPreview();
      return;
    }

    // Inline path (existing behavior): graph lives in p.graphs[] and is
    // referenced from the stem via {{graph:id}} token.
    const p = builderState.problems.find(x => x.id === target.problemId);
    if (!p) { closeGraphEditor(); return; }

    const isNew = !target.graphId;
    const id = target.graphId || _newGraphId();
    if (!Array.isArray(p.graphs)) p.graphs = [];

    const record = {
      id: id,
      state: state,
      alt: alt,
      width: w,
      height: h,
      imageDataUri: dataUri
    };

    if (isNew) {
      p.graphs.push(record);
    } else {
      const idx = p.graphs.findIndex(g => g.id === id);
      if (idx >= 0) p.graphs[idx] = record; else p.graphs.push(record);
    }

    // Insert token at cursor in the stem textarea (new graph only)
    if (isNew && target.insertTarget) {
      const ta = target.insertTarget;
      const start = ta.selectionStart || ta.value.length;
      const end   = ta.selectionEnd   || ta.value.length;
      const token = '{{graph:' + id + '}}';
      ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
      p.stem = ta.value;
    }

    saveDraft();
    closeGraphEditor();
    renderProblems();
    refreshPreview();
  });
}
window.saveGraphEditor = saveGraphEditor;

// Capture a Desmos calculator to a PNG data URI. We use asyncScreenshot which
// renders at the target size and waits for the calculator to settle. The 2x
// multiplier is for crisp display and print; CSS width/height attributes on
// the <img> keep it laid out at the authored size.
function _captureGraphPNG(calc, cssW, cssH, callback) {
  try {
    calc.asyncScreenshot(
      {
        width: cssW * 2,
        height: cssH * 2,
        targetPixelRatio: 1,    // we already pre-multiplied to 2x
        showLabels: true,
        mode: 'preserveX'
      },
      function(dataUri) {
        if (!dataUri || typeof dataUri !== 'string') {
          callback(new Error('Empty screenshot'));
          return;
        }
        callback(null, dataUri);
      }
    );
  } catch (e) {
    callback(e);
  }
}

// Insert a {{blank:N}} token at the textarea's cursor position, then add a
// matching blank config to the problem and re-render.
function _insertBlankAtCursor(problemId, textarea, kind) {
  const p = builderState.problems.find(x => x.id === problemId);
  if (!p) return;
  // Find the next available blank number based on stem (not config length —
  // teacher might have deleted a token mid-stem; we use the smallest unused).
  const used = new Set();
  const re = /\{\{blank:(\d+)\}\}/g;
  let m;
  while ((m = re.exec(p.stem || '')) !== null) used.add(parseInt(m[1], 10));
  let nextN = 1;
  while (used.has(nextN)) nextN += 1;

  const token = '{{blank:' + nextN + '}}';
  const start = textarea.selectionStart || 0;
  const end   = textarea.selectionEnd || 0;
  const newStem = (p.stem || '').slice(0, start) + token + (p.stem || '').slice(end);
  p.stem = newStem;

  // Add a blank config; renumber later in _syncBlanksToStem
  if (!p.blanks) p.blanks = [];
  p.blanks.push(_newBlank(kind));

  saveDraft();
  _syncBlanksToStem(problemId);
}

// Reconcile p.blanks with the {{blank:N}} tokens in p.stem:
//   1. Auto-renumber tokens to be 1..K in order of first appearance
//   2. Trim p.blanks to match the count of distinct tokens
//   3. Re-render and refresh preview
function _syncBlanksToStem(problemId) {
  const p = builderState.problems.find(x => x.id === problemId);
  if (!p) return;

  // Find all tokens with their positions, in order
  const re = /\{\{blank:(\d+)\}\}/g;
  const matches = [];
  let m;
  while ((m = re.exec(p.stem || '')) !== null) {
    matches.push({ raw: m[0], n: parseInt(m[1], 10), index: m.index });
  }

  // Build mapping: original N -> new N (in order of first appearance)
  const seen = new Map();
  let newCounter = 0;
  matches.forEach(match => {
    if (!seen.has(match.n)) {
      newCounter += 1;
      seen.set(match.n, newCounter);
    }
  });

  // Apply renumbering to the stem
  p.stem = (p.stem || '').replace(/\{\{blank:(\d+)\}\}/g, (full, n) => {
    const newN = seen.get(parseInt(n, 10));
    return newN ? '{{blank:' + newN + '}}' : full;
  });

  // Distinct count of unique blanks now in stem
  const distinct = newCounter;

  // Adjust p.blanks to match distinct count
  if (!p.blanks) p.blanks = [];
  if (p.blanks.length > distinct) p.blanks = p.blanks.slice(0, distinct);
  while (p.blanks.length < distinct) p.blanks.push(_newBlank('fill_in'));

  saveDraft();
  renderProblems();
  refreshPreview();
}

// Render the configuration card for a single blank (fill-in or dropdown).
function _renderBlankCard(p, blank, bIdx) {
  const card = document.createElement('div');
  card.className = 'blank-card kind-' + blank.kind;

  const head = document.createElement('div');
  head.className = 'blank-head';
  head.innerHTML =
    '<span class="blank-num">{{blank:' + (bIdx + 1) + '}}</span>' +
    '<div class="blank-kind-toggle">' +
      '<button class="kind-pill ' + (blank.kind === 'fill_in' ? 'active' : '') + '" data-kind="fill_in">Fill-in</button>' +
      '<button class="kind-pill ' + (blank.kind === 'dropdown' ? 'active' : '') + '" data-kind="dropdown">Dropdown</button>' +
    '</div>';
  card.appendChild(head);

  head.querySelectorAll('.kind-pill').forEach(btn => {
    btn.onclick = () => {
      const newKind = btn.getAttribute('data-kind');
      if (newKind === blank.kind) return;
      const fresh = _newBlank(newKind);
      // Preserve id so the input keeps its DOM position
      fresh.id = blank.id;
      const updated = (p.blanks || []).slice();
      updated[bIdx] = fresh;
      updateProblem(p.id, 'blanks', updated);
      renderProblems();
    };
  });

  if (blank.kind === 'fill_in') {
    _renderFillInBlank(card, p, blank, bIdx);
  } else {
    _renderDropdownBlank(card, p, blank, bIdx);
  }

  return card;
}

function _renderFillInBlank(card, p, blank, bIdx) {
  const ansLabel = document.createElement('label');
  ansLabel.className = 'field-label';
  ansLabel.textContent = 'Correct answer';
  card.appendChild(ansLabel);

  const ans = document.createElement('input');
  ans.type = 'text';
  ans.className = 'text-input';
  ans.value = blank.answer || '';
  ans.placeholder = 'e.g. 12 or x+3';
  ans.oninput = () => _updateBlank(p.id, bIdx, { answer: ans.value });
  card.appendChild(ans);

  const tolWrap = document.createElement('div');
  tolWrap.style.marginTop = '6px';
  const tolLabel = document.createElement('label');
  tolLabel.className = 'field-label';
  tolLabel.textContent = 'Numeric tolerance (± value, leave 0 for exact match)';
  tolWrap.appendChild(tolLabel);
  const tol = document.createElement('input');
  tol.type = 'number';
  tol.step = '0.01';
  tol.className = 'text-input';
  tol.value = blank.tol || 0;
  tol.oninput = () => _updateBlank(p.id, bIdx, { tol: parseFloat(tol.value) || 0 });
  tolWrap.appendChild(tol);
  card.appendChild(tolWrap);

  // Phase 8+: blank-width override
  card.appendChild(_buildBlankWidthRow(p, blank, bIdx));
}

function _renderDropdownBlank(card, p, blank, bIdx) {
  // Randomize toggle
  const randRow = document.createElement('div');
  randRow.className = 'check-row';
  randRow.style.marginBottom = '8px';
  randRow.innerHTML = '<label><input type="checkbox" ' + (blank.randomize !== false ? 'checked' : '') + '> Randomize choice order at runtime</label>';
  randRow.querySelector('input').onchange = (e) => _updateBlank(p.id, bIdx, { randomize: e.target.checked });
  card.appendChild(randRow);

  const choicesLabel = document.createElement('label');
  choicesLabel.className = 'field-label';
  choicesLabel.textContent = 'Choices (select the correct one)';
  card.appendChild(choicesLabel);

  const choices = _normalizeChoices(blank.choices || []);

  // Helper: read fresh choices from the live blank, mutate the i-th, write back.
  // Avoids the stale-closure bug where multiple choice edits stomp on each other
  // because each handler captured the render-time `choices` snapshot.
  function patchChoice(i, patch) {
    const liveBlank = (builderState.problems.find(x => x.id === p.id) || {}).blanks[bIdx];
    const fresh = _normalizeChoices(liveBlank.choices || []);
    fresh[i] = Object.assign({}, fresh[i], patch);
    _updateBlank(p.id, bIdx, { choices: fresh });
  }

  choices.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'choice-row';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'correct_' + p.id + '_' + blank.id;
    radio.checked = (blank.correctChoice === i);
    radio.onchange = () => _updateBlank(p.id, bIdx, { correctChoice: i });
    row.appendChild(radio);

    const modePill = document.createElement('button');
    modePill.type = 'button';
    modePill.className = 'mode-pill mode-' + c.mode;
    modePill.textContent = c.mode;
    modePill.title = 'Click to toggle math/text';
    modePill.onclick = () => {
      const liveBlank = builderState.problems.find(x => x.id === p.id).blanks[bIdx];
      const fresh = _normalizeChoices(liveBlank.choices || []);
      fresh[i] = { mode: fresh[i].mode === 'math' ? 'text' : 'math', value: fresh[i].value };
      _updateBlank(p.id, bIdx, { choices: fresh });
      renderProblems();
    };
    row.appendChild(modePill);

    let inp;
    if (c.mode === 'math') {
      inp = document.createElement('math-field');
      inp.className = 'mf-choice';
      inp.setAttribute('virtual-keyboard-mode', 'manual');
      inp.value = c.value || '';
      inp.addEventListener('input', () => patchChoice(i, { mode: 'math', value: inp.getValue('latex-expanded') }));
    } else {
      inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'text-input';
      inp.value = c.value || '';
      inp.placeholder = 'Choice ' + String.fromCharCode(65 + i);
      inp.oninput = () => patchChoice(i, { mode: 'text', value: inp.value });
    }
    row.appendChild(inp);

    card.appendChild(row);
  });

  // Phase 8+: blank-width override
  card.appendChild(_buildBlankWidthRow(p, blank, bIdx));
}

// Phase 8+: shared "blank width" dropdown row used by both fill-in and
// dropdown blank cards. Sets blank.width to a preset key or 'auto'.
function _buildBlankWidthRow(p, blank, bIdx) {
  const wrap = document.createElement('div');
  wrap.style.marginTop = '6px';
  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = 'Blank width';
  wrap.appendChild(label);

  const sel = document.createElement('select');
  sel.className = 'text-input';
  ['auto', 'tiny', 'small', 'medium', 'large', 'xlarge'].forEach(k => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = _BLANK_WIDTH_LABELS[k];
    if ((blank.width || 'auto') === k) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => _updateBlank(p.id, bIdx, { width: sel.value });
  wrap.appendChild(sel);

  return wrap;
}

function _updateBlank(problemId, bIdx, patch) {
  const p = builderState.problems.find(x => x.id === problemId);
  if (!p || !p.blanks || !p.blanks[bIdx]) return;
  Object.assign(p.blanks[bIdx], patch);
  saveDraft();
  refreshPreview();
}

// =============================================================================
// SIDEBAR TOOLS MANAGEMENT
// =============================================================================
const TOOL_DEFAULTS = {
  video:             { label: 'Video',      embedUrl: '' },
  desmos_graphing:   { label: 'Graphing',   expressions: [], advanced: false, viewport: { xmin: -10, xmax: 10, ymin: -10, ymax: 10, locked: false }, hideExpressionList: false, hideSettings: false, polar: false, projectorMode: false, allowImages: false, allowFolders: false, allowNotes: false, allowSliders: false, allowInequalities: false, allowImplicits: false, allowSingleVarImplicits: false },
  desmos_scientific: { label: 'Scientific Calc' },
  desmos_geometry:   { label: 'Geometry',   advanced: false },
  reference_sheet:   { label: 'Formulas',   title: '', content: '' }
};

function addSidebarTool(type) {
  const defaults = TOOL_DEFAULTS[type] || {};
  const tool = Object.assign({ id: _newId(), type: type }, JSON.parse(JSON.stringify(defaults)));
  builderState.sidebarTools.push(tool);
  saveDraft();
  renderSidebarTools();
  refreshPreview();
}

function removeSidebarTool(id) {
  builderState.sidebarTools = builderState.sidebarTools.filter(t => t.id !== id);
  saveDraft();
  renderSidebarTools();
  refreshPreview();
}

function updateSidebarTool(id, key, value) {
  const t = builderState.sidebarTools.find(x => x.id === id);
  if (!t) return;
  // Support dotted keys like "viewport.xmin"
  if (key.includes('.')) {
    const parts = key.split('.');
    let target = t;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!target[parts[i]]) target[parts[i]] = {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
  } else {
    t[key] = value;
  }
  saveDraft();
  refreshPreview();
}

function moveSidebarTool(id, dir) {
  const i = builderState.sidebarTools.findIndex(t => t.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= builderState.sidebarTools.length) return;
  const tmp = builderState.sidebarTools[i];
  builderState.sidebarTools[i] = builderState.sidebarTools[j];
  builderState.sidebarTools[j] = tmp;
  saveDraft();
  renderSidebarTools();
  refreshPreview();
}

function renderSidebarTools() {
  const container = document.getElementById('sidebarToolsContainer');
  if (!container) return;
  container.innerHTML = '';
  builderState.sidebarTools.forEach((t, idx) => {
    const card = document.createElement('div');
    card.className = 'block-card tool-card';
    card.setAttribute('data-id', t.id);

    const header = document.createElement('div');
    header.className = 'block-header';
    const isLocked = (t.type === 'save' || t.type === 'load');
    header.innerHTML =
      '<span class="block-num">' + _toolTypeLabel(t.type) + (isLocked ? ' <em>(baseline)</em>' : '') + '</span>' +
      '<div class="block-actions">' +
        (isLocked ? '' :
          '<button class="bb-btn" title="Move up" onclick="moveSidebarTool(\'' + t.id + '\', -1)">↑</button>' +
          '<button class="bb-btn" title="Move down" onclick="moveSidebarTool(\'' + t.id + '\', 1)">↓</button>' +
          '<button class="bb-btn danger" title="Remove" onclick="removeSidebarTool(\'' + t.id + '\')">✕</button>'
        ) +
      '</div>';
    card.appendChild(header);

    if (t.type === 'video') _renderVideoToolFields(card, t);
    else if (t.type === 'desmos_graphing') _renderDesmosGraphingFields(card, t);
    else if (t.type === 'desmos_scientific') _renderSimpleLabelField(card, t);
    else if (t.type === 'desmos_geometry') _renderDesmosGeometryFields(card, t);
    else if (t.type === 'reference_sheet') _renderReferenceSheetFields(card, t);
    // save / load: no config UI

    container.appendChild(card);
  });
}

function _toolTypeLabel(type) {
  return ({
    video: 'Video',
    save: 'Save',
    load: 'Load',
    desmos_graphing: 'Desmos — Graphing Calculator',
    desmos_scientific: 'Desmos — Scientific Calculator',
    desmos_geometry: 'Desmos — Geometry',
    reference_sheet: 'Reference Sheet'
  })[type] || type;
}

function _renderSimpleLabelField(card, t) {
  const lab = document.createElement('label');
  lab.className = 'field-label';
  lab.textContent = 'Sidebar label';
  card.appendChild(lab);
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'text-input';
  inp.value = t.label || '';
  inp.oninput = () => updateSidebarTool(t.id, 'label', inp.value);
  card.appendChild(inp);
}

function _renderVideoToolFields(card, t) {
  _renderSimpleLabelField(card, t);

  const lab = document.createElement('label');
  lab.className = 'field-label';
  lab.style.marginTop = '8px';
  lab.textContent = 'Video embed URL (YouTube embed format, e.g. https://www.youtube.com/embed/VIDEO_ID)';
  card.appendChild(lab);

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'text-input';
  inp.value = t.embedUrl || '';
  inp.placeholder = 'https://www.youtube.com/embed/Jj2vpPnt_Is';
  inp.oninput = () => updateSidebarTool(t.id, 'embedUrl', inp.value);
  card.appendChild(inp);

  // Helper: convert pasted youtu.be / watch URLs
  const helper = document.createElement('div');
  helper.className = 'field-hint';
  helper.textContent = 'Tip: youtu.be/ABC or watch?v=ABC links won\u2019t work — use the embed URL.';
  card.appendChild(helper);
}

function _renderDesmosGraphingFields(card, t) {
  _renderSimpleLabelField(card, t);

  const lab = document.createElement('label');
  lab.className = 'field-label';
  lab.style.marginTop = '8px';
  lab.textContent = 'Expressions (one per line — LaTeX or plain math)';
  card.appendChild(lab);

  const ta = document.createElement('textarea');
  ta.className = 'text-input';
  ta.rows = 4;
  ta.value = (t.expressions || []).join('\n');
  ta.placeholder = 'y=x^2\ny=2x+1\nx^2+y^2=4';
  ta.oninput = () => {
    const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
    updateSidebarTool(t.id, 'expressions', lines);
  };
  card.appendChild(ta);

  // Advanced toggle
  const adv = document.createElement('details');
  adv.className = 'advanced';
  if (t.advanced) adv.open = true;
  adv.innerHTML = '<summary>Advanced settings</summary>';

  const advCheckRow = document.createElement('div');
  advCheckRow.className = 'check-row';
  advCheckRow.innerHTML =
    '<label><input type="checkbox" ' + (t.advanced ? 'checked' : '') + ' id="advCheck_' + t.id + '"> Enable advanced settings (overrides defaults)</label>';
  adv.appendChild(advCheckRow);
  advCheckRow.querySelector('input').onchange = (e) => {
    updateSidebarTool(t.id, 'advanced', e.target.checked);
    renderSidebarTools(); // re-render to enable/disable subsequent fields
  };

  if (t.advanced) {
    // Viewport
    const vpLabel = document.createElement('div');
    vpLabel.className = 'field-label';
    vpLabel.style.marginTop = '12px';
    vpLabel.textContent = 'Viewport bounds';
    adv.appendChild(vpLabel);

    const vpGrid = document.createElement('div');
    vpGrid.className = 'vp-grid';
    ['xmin', 'xmax', 'ymin', 'ymax'].forEach(k => {
      const wrap = document.createElement('div');
      wrap.innerHTML = '<label class="field-label">' + k + '</label>';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      inp.className = 'text-input';
      inp.value = (t.viewport && t.viewport[k] !== undefined) ? t.viewport[k] : 0;
      inp.oninput = () => updateSidebarTool(t.id, 'viewport.' + k, parseFloat(inp.value) || 0);
      wrap.appendChild(inp);
      vpGrid.appendChild(wrap);
    });
    adv.appendChild(vpGrid);

    // Toggles — chrome / mode
    const toggles = [
      { key: 'viewport.locked', label: 'Lock viewport (students can\u2019t pan/zoom)' },
      { key: 'hideExpressionList', label: 'Hide expression list' },
      { key: 'hideSettings', label: 'Hide settings menu' },
      { key: 'polar', label: 'Polar mode' },
      { key: 'projectorMode', label: 'Projector mode (thicker lines, larger labels)' }
    ];
    toggles.forEach(tog => {
      const row = document.createElement('div');
      row.className = 'check-row';
      const cur = tog.key.includes('.') ? (t.viewport && t.viewport.locked) : t[tog.key.split('.').pop()];
      row.innerHTML = '<label><input type="checkbox" ' + (cur ? 'checked' : '') + '> ' + tog.label + '</label>';
      row.querySelector('input').onchange = (e) => updateSidebarTool(t.id, tog.key, e.target.checked);
      adv.appendChild(row);
    });

    // Heading: feature permissions
    const permLabel = document.createElement('div');
    permLabel.className = 'field-label';
    permLabel.style.marginTop = '12px';
    permLabel.textContent = 'Calculator features (off by default)';
    adv.appendChild(permLabel);

    // Toggles — feature permissions (default off = STAAR-aligned restrictions)
    const permToggles = [
      { key: 'allowImages', label: 'Allow image uploads' },
      { key: 'allowFolders', label: 'Allow folders' },
      { key: 'allowNotes', label: 'Allow notes' },
      { key: 'allowSliders', label: 'Allow sliders' },
      { key: 'allowInequalities', label: 'Allow inequalities (y > x)' },
      { key: 'allowImplicits', label: 'Allow implicit equations (x\u00B2 + y\u00B2 = 25)' },
      { key: 'allowSingleVarImplicits', label: 'Allow single-variable implicits (x = 3)' }
    ];
    permToggles.forEach(tog => {
      const row = document.createElement('div');
      row.className = 'check-row';
      const cur = t[tog.key];
      row.innerHTML = '<label><input type="checkbox" ' + (cur ? 'checked' : '') + '> ' + tog.label + '</label>';
      row.querySelector('input').onchange = (e) => updateSidebarTool(t.id, tog.key, e.target.checked);
      adv.appendChild(row);
    });
  }

  card.appendChild(adv);
}

function _renderDesmosGeometryFields(card, t) {
  _renderSimpleLabelField(card, t);
  const hint = document.createElement('div');
  hint.className = 'field-hint';
  hint.textContent = 'Geometry tool opens with a blank construction surface.';
  card.appendChild(hint);
}

// =============================================================================
// REFERENCE SHEET — formula sheets, exemplars, and other static reference
// material rendered into a floating window for student use.
//
// Authoring format (markdown-ish, KaTeX-aware):
//   ## Section heading
//   ### Subsection heading
//   Label :: \(formula or text\)        ← two-column row, separator is " :: "
//   - bullet item
//   ---                                  ← horizontal rule
//   Plain paragraph                      ← any line that doesn't match above
//
// Math passes through verbatim — the runtime calls KaTeX auto-render after
// inserting the parsed HTML, so \( \) and \[ \] delimiters work as elsewhere.
// =============================================================================
function _renderReferenceSheetFields(card, t) {
  _renderSimpleLabelField(card, t);

  // Optional in-window title (separate from the sidebar button label)
  const titleLab = document.createElement('label');
  titleLab.className = 'field-label';
  titleLab.style.marginTop = '10px';
  titleLab.textContent = 'Window title (shown at top of the floating window — optional)';
  card.appendChild(titleLab);

  const titleInp = document.createElement('input');
  titleInp.type = 'text';
  titleInp.className = 'text-input';
  titleInp.value = t.title || '';
  titleInp.placeholder = 'e.g. ACP Formulas — Algebra II';
  titleInp.oninput = () => updateSidebarTool(t.id, 'title', titleInp.value);
  card.appendChild(titleInp);

  // Content textarea
  const contentLab = document.createElement('label');
  contentLab.className = 'field-label';
  contentLab.style.marginTop = '10px';
  contentLab.textContent = 'Content';
  card.appendChild(contentLab);

  const contentHint = document.createElement('div');
  contentHint.className = 'field-hint';
  contentHint.innerHTML =
    'Extended markdown: <code>##</code> sections (with <code>{color=blue}</code> for tinting), ' +
    '<code>###</code> subsections, <code>Label :: content</code> rows, ' +
    'GFM tables, <code>&gt; [!NOTE]</code> callouts, <code>::: columns</code> blocks. ' +
    'Math: <code>$...$</code> inline, <code>$$...$$</code> display. ' +
    'For bulk import from a PDF, expand the agent prompt below.';
  card.appendChild(contentHint);

  const ta = document.createElement('textarea');
  ta.className = 'text-input';
  ta.rows = 12;
  ta.style.fontFamily = 'var(--mono, monospace)';
  ta.style.fontSize = '12px';
  ta.value = t.content || '';
  ta.placeholder =
    '## Coordinate Geometry {color=blue}\n' +
    'Midpoint :: $M = \\left(\\dfrac{x_1+x_2}{2},\\ \\dfrac{y_1+y_2}{2}\\right)$\n' +
    'Slope :: $m = \\dfrac{y_2 - y_1}{x_2 - x_1}$\n' +
    '\n' +
    '> [!TIP]\n' +
    '> When the slope is undefined, the line is vertical.\n';
  ta.oninput = () => updateSidebarTool(t.id, 'content', ta.value);
  card.appendChild(ta);

  // Agent prompt panel — the format spec lives next to the tool itself
  // so it can't drift out of sync with the runtime parser.
  const promptDetails = document.createElement('details');
  promptDetails.className = 'advanced';
  promptDetails.style.marginTop = '10px';

  const summary = document.createElement('summary');
  summary.textContent = 'Agent prompt for bulk import from a PDF';
  promptDetails.appendChild(summary);

  const promptHint = document.createElement('div');
  promptHint.className = 'field-hint';
  promptHint.style.marginTop = '8px';
  promptHint.innerHTML =
    'Copy the prompt below, paste it into Claude (or another agent) along with ' +
    'a PDF of the source material, and paste the agent\u2019s output into the ' +
    'Content box above.';
  promptDetails.appendChild(promptHint);

  const promptBox = document.createElement('textarea');
  promptBox.className = 'text-input';
  promptBox.rows = 14;
  promptBox.style.fontFamily = 'var(--mono, monospace)';
  promptBox.style.fontSize = '11px';
  promptBox.readOnly = true;
  promptBox.value = REFERENCE_SHEET_AGENT_PROMPT;
  promptBox.onclick = () => promptBox.select();
  promptDetails.appendChild(promptBox);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'add-btn';
  copyBtn.style.marginTop = '6px';
  copyBtn.textContent = 'Copy prompt to clipboard';
  copyBtn.onclick = (e) => {
    e.preventDefault();
    try {
      navigator.clipboard.writeText(REFERENCE_SHEET_AGENT_PROMPT);
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy prompt to clipboard'; }, 1500);
    } catch (err) {
      promptBox.select();
      document.execCommand('copy');
      copyBtn.textContent = '✓ Copied (fallback)';
      setTimeout(() => { copyBtn.textContent = 'Copy prompt to clipboard'; }, 1500);
    }
  };
  promptDetails.appendChild(copyBtn);

  card.appendChild(promptDetails);
}

// Authoring guide for an LLM agent given a source PDF/document. Kept as a
// constant so the same text powers the in-builder copy button AND can be
// exported (e.g. printed from the console) if needed.
const REFERENCE_SHEET_AGENT_PROMPT =
'You are converting reference material (a formula sheet, study guide, worked\n' +
'examples, or other exemplar document) into the format used by an Algebra II\n' +
'activity builder. Read the source document I provide and output ONLY the\n' +
'formatted content \u2014 no preamble, no commentary, no code fences.\n' +
'\n' +
'================================================================\n' +
'CORE FORMAT (extended markdown)\n' +
'================================================================\n' +
'\n' +
'  # / ## / ### / ####     Headings (use ## for major sections, ### for nested)\n' +
'  ## Title {color=blue}    Optional color tinting on a heading; everything\n' +
'                           under it (until the next ## or higher) is wrapped\n' +
'                           in a tinted section background. Allowed colors:\n' +
'                           blue, green, amber, red, purple, gray, teal.\n' +
'\n' +
'  Label :: content         Two-column row. The separator is exactly " :: "\n' +
'                           (space, colon, colon, space). Ideal for named\n' +
'                           formulas (Midpoint, Slope, Quadratic Formula).\n' +
'\n' +
'  Plain paragraph          Any line that doesn\u2019t match a block syntax.\n' +
'  - bullet item            Unordered list (also `*` works).\n' +
'  1. numbered item         Ordered list.\n' +
'  ---                      Horizontal rule.\n' +
'\n' +
'  $...$                    Inline math (LaTeX inside).\n' +
'  $$...$$                  Display math.\n' +
'  Use \\$ for a literal dollar sign in prose (e.g. "\\$5 each").\n' +
'\n' +
'  **bold**     _italic_     ==highlight==     `inline code`\n' +
'\n' +
'================================================================\n' +
'TABLES (GFM pipe syntax)\n' +
'================================================================\n' +
'\n' +
'  | Form     | Equation                | Vertex      |\n' +
'  |----------|-------------------------|-------------|\n' +
'  | Standard | $f(x) = ax^2 + bx + c$  | calculate   |\n' +
'  | Vertex   | $f(x) = a(x-h)^2 + k$   | $(h, k)$    |\n' +
'\n' +
'  Optional alignment via the separator row:\n' +
'    |:---|     left\n' +
'    |:--:|    center\n' +
'    |---:|    right\n' +
'\n' +
'================================================================\n' +
'CALLOUTS (boxed annotations) \u2014 fixed set, do not invent new types\n' +
'================================================================\n' +
'\n' +
'  > [!NOTE]         General information\n' +
'  > [!TIP]          Strategy or hint\n' +
'  > [!WARNING]      Common mistake; watch out for X\n' +
'  > [!EXAMPLE]      Worked example\n' +
'  > [!DEFINITION]   Vocabulary / formal definition\n' +
'  > [!THEOREM]      Formal statement of a result\n' +
'\n' +
'  Multi-line callouts continue with `>` on each line:\n' +
'    > [!TIP]\n' +
'    > When the discriminant $b^2 - 4ac < 0$, there are no real roots.\n' +
'    > Use the quadratic formula and watch for the negative under the radical.\n' +
'\n' +
'================================================================\n' +
'MULTI-COLUMN LAYOUTS (for side-by-side content)\n' +
'================================================================\n' +
'\n' +
'  ::: columns\n' +
'  ::: column\n' +
'  ### Adding\n' +
'  Rule :: $A + B$ adds element-wise.\n' +
'  :::\n' +
'  ::: column\n' +
'  ### Subtracting\n' +
'  Rule :: $A - B$ subtracts element-wise.\n' +
'  :::\n' +
'  :::\n' +
'\n' +
'  Use 2 or 3 columns. The outer ::: closer must match.\n' +
'\n' +
'================================================================\n' +
'COMPLETE EXAMPLE (mimicking a typical formula sheet section)\n' +
'================================================================\n' +
'\n' +
'  ## Quadratic Equations {color=green}\n' +
'\n' +
'  ### Forms\n' +
'  Standard :: $f(x) = ax^2 + bx + c$\n' +
'  Vertex :: $f(x) = a(x-h)^2 + k$\n' +
'\n' +
'  ### Solving\n' +
'  Quadratic Formula :: $x = \\dfrac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$\n' +
'  Axis of Symmetry :: $x = -\\dfrac{b}{2a}$\n' +
'\n' +
'  > [!TIP]\n' +
'  > Check the discriminant $b^2 - 4ac$ first: positive means two real roots,\n' +
'  > zero means one repeated root, negative means two complex roots.\n' +
'\n' +
'  ### Properties at a glance\n' +
'\n' +
'  | Discriminant | Roots                  |\n' +
'  |--------------|------------------------|\n' +
'  | $b^2 - 4ac > 0$ | Two distinct real roots |\n' +
'  | $b^2 - 4ac = 0$ | One repeated real root  |\n' +
'  | $b^2 - 4ac < 0$ | Two complex conjugate roots |\n' +
'\n' +
'================================================================\n' +
'GUIDELINES\n' +
'================================================================\n' +
'\n' +
'- Preserve the source\u2019s organization. Major sections \u2192 ##; nested groupings\n' +
'  \u2192 ###. Reach for {color=...} tinting when the source visibly groups topics\n' +
'  (e.g. a colored sidebar or a labeled section).\n' +
'- For named formulas (Midpoint, Slope, Quadratic Formula, Distance, etc.),\n' +
'  use the "Label :: $formula$" pattern \u2014 it renders as a clean two-column row.\n' +
'- For prose explanations or definitions without a clear left-hand label, use\n' +
'  a plain paragraph or a > [!DEFINITION] callout.\n' +
'- Use $...$ for inline math and $$...$$ for display math. DO NOT use \\(...\\)\n' +
'  or \\[...\\] (they still work for back-compat but $ is the canonical form).\n' +
'- Inside math, use standard LaTeX: \\dfrac for stacked fractions, \\sqrt for\n' +
'  roots, \\cdot for explicit multiplication, ^ and _ for exponents/subscripts,\n' +
'  \\pm for \u00b1, \\le \\ge \\ne for \u2264 \u2265 \u2260, \\left( \\right) for auto-sized parens,\n' +
'  \\begin{bmatrix} ... \\end{bmatrix} for matrices.\n' +
'- If the source has a side-by-side layout (e.g. matrices "Adding | Subtracting"),\n' +
'  reach for ::: columns rather than trying to fake it with a table.\n' +
'- For comparison tables (rules, properties, cases), GFM pipe tables are the\n' +
'  right tool.\n' +
'- Don\u2019t HTML-escape anything. The renderer escapes safely; just write text\n' +
'  and LaTeX as a human would.\n' +
'- Output ONLY the formatted content, ready to paste into the Content box.\n' +
'\n' +
'Source:\n' +
'[attach the PDF or paste the source content here]\n';

// =============================================================================
// COMPILE ACTIVITY
// =============================================================================
function compileActivity() {
  if (!window.WORKSHEET_TEMPLATE) {
    console.error('WORKSHEET_TEMPLATE missing — builder-template.js not loaded?');
    return '<html><body>Template not loaded.</body></html>';
  }

  // Sync title-derived fields
  builderState.slug = slugify(builderState.title);
  if (!builderState.filename || builderState.filename === 'activities/new_activity.html') {
    builderState.filename = 'activities/' + builderState.slug + '.html';
  }

  // Compile blocks. v3 dispatches on type — problems get a problem number,
  // graph blocks get a figure number, and the two counters advance
  // independently so figures don't consume problem numbers and vice versa.
  let _problemNum = 0;
  let _figureNum  = 0;
  const problemsHTML = builderState.problems.map((b, idx) => {
    if (b && b.type === 'graph_block') {
      _figureNum++;
      return _compileGraphBlock(b, _figureNum, idx);
    }
    _problemNum++;
    return _compileProblem(b, _problemNum, idx);
  }).join('\n');

  // Decide if Desmos API is needed
  const needsDesmos = builderState.sidebarTools.some(t =>
    t.type === 'desmos_graphing' || t.type === 'desmos_scientific' || t.type === 'desmos_geometry'
  );
  const desmosScript = needsDesmos
    ? '<script src="https://www.desmos.com/api/v1.10/calculator.js?apiKey=661a84788761487abdb6ddff0878ce17"><\/script>'
    : '';

  // Inline the markdown parser source so reference sheets can render at
  // student-runtime without an extra script fetch. The parser exports its
  // own source as window.MARKDOWN_PARSER_SOURCE; if it's not loaded, we
  // emit no script and the runtime will fall back to the legacy mini-parser.
  const markdownParserScript = (typeof window.MARKDOWN_PARSER_SOURCE === 'string')
    ? '<script>' + window.MARKDOWN_PARSER_SOURCE + '<\/script>'
    : '';

  // Webhook: bake in builder value if set, otherwise fall back to the
  // appsScriptURL stored by index.html's settings panel
  const webhookForBake = (builderState.webhook && builderState.webhook.trim())
    ? builderState.webhook
    : (localStorage.getItem('appsScriptURL') || '');

  // Sidebar tools JSON (runtime config — strip nothing, all fields used downstream)
  const sidebarToolsJSON = JSON.stringify(builderState.sidebarTools);

  // Full builder state JSON (round-trip seed)
  const stateJSON = JSON.stringify({ ...builderState, savedAt: new Date().toISOString() });

  // Activity-wide settings JSON (read at runtime by the worksheet)
  const settingsJSON = JSON.stringify({
    defaults: builderState.defaults || { liveFeedback: true, scoreOnly: false }
  });

  // Phase 5: body classes for print column layout. Baked at compile time;
  // students don't need a runtime-mutable layout. Class string drops cleanly
  // into <body class="..."> in the template.
  const bodyClasses = _columnsBodyClass();

  // Phase 7: @page rule baked at compile time. CSS @page can't be scoped to
  // a body class, so the rule itself must change per print mode. Booklet
  // uses landscape + 0 margin (sheets supply their own); letter uses
  // portrait + 0.75in.
  const isBooklet = builderState && builderState.print && builderState.print.mode === 'booklet';
  const pagePrintRule = isBooklet
    ? '@page{size:letter landscape;margin:0}'
    : '@page{size:letter portrait;margin:0.75in}';

  // Phase 7+: print-header HTML. Renders Name/Period (always) plus Date/
  // Score/Custom1/Custom2 if their flags/labels are configured. The whole
  // strip lives inside the .page-header so it inherits "first page only"
  // visibility in booklet mode (handled via CSS hiding original page-
  // header on subsequent sheets, plus runtime cloning of the header into
  // the booklet cover).
  const printHeaderHTML = _buildPrintHeaderHTML();

  // Slot replacement — use function replacements so that $ signs in JSON/HTML
  // (e.g. $15 in a student answer, $1 in a tool label) are never interpreted
  // as backreference patterns by String.replace, which would silently corrupt
  // the output and break the sidebar JSON parse and/or the runtime script block.
  const _slot = (v) => () => v;
  let html = window.WORKSHEET_TEMPLATE;
  html = html.replace(/\{\{TITLE\}\}/g,                   _slot(_esc(builderState.title)));
  html = html.replace(/\{\{ACTIVITY_SLUG\}\}/g,           _slot(builderState.slug));
  html = html.replace(/\{\{WEBHOOK_URL\}\}/g,             _slot(_esc(webhookForBake)));
  html = html.replace(/\{\{GOOGLE_CLIENT_ID\}\}/g,        _slot(GOOGLE_CLIENT_ID));
  html = html.replace(/\{\{DESMOS_API_SCRIPT\}\}/g,       _slot(desmosScript));
  html = html.replace(/\{\{MARKDOWN_PARSER_SCRIPT\}\}/g,  _slot(markdownParserScript));
  html = html.replace(/\{\{PROBLEMS_HTML\}\}/g,           _slot(problemsHTML));
  html = html.replace(/\{\{SIDEBAR_TOOLS_JSON\}\}/g,      _slot(sidebarToolsJSON));
  html = html.replace(/\{\{ACTIVITY_SETTINGS_JSON\}\}/g,  _slot(settingsJSON));
  html = html.replace(/\{\{BUILDER_STATE_JSON\}\}/g,      _slot(stateJSON));
  html = html.replace(/\{\{BODY_CLASSES\}\}/g,            _slot(bodyClasses));
  html = html.replace(/\{\{PRINT_PAGE_RULE\}\}/g,         _slot(pagePrintRule));
  html = html.replace(/\{\{PRINT_HEADER_HTML\}\}/g,       _slot(printHeaderHTML));

  return html;
}

// Phase 7+: assemble the print-only header strip (Name/Period and any
// configured optional fields). Returns a fragment of HTML that drops into
// the {{PRINT_HEADER_HTML}} slot in the template.
//
// Each "field" is a label + horizontal underline on which the student
// writes. The strip is wrapped in .print-student-header which CSS hides
// in screen mode (it duplicates info from the existing student-bar) and
// shows only in print/print-preview.
function _buildPrintHeaderHTML() {
  const opts = (builderState && builderState.print && builderState.print.headerOptions)
    || { showDate: false, showScore: false, custom1Label: '', custom2Label: '' };

  // Each entry becomes one inline field. Order: Name, Period, Date,
  // Custom1, Custom2, Score (Score is always last so it pins to the right
  // visually). Labels and width hints handled by CSS.
  const fields = [
    { cls: 'pf-name',   label: 'Name',   widthClass: 'pf-w-wide' },
    { cls: 'pf-period', label: 'Period', widthClass: 'pf-w-narrow' }
  ];
  if (opts.showDate) {
    fields.push({ cls: 'pf-date', label: 'Date', widthClass: 'pf-w-medium' });
  }
  // Custom fields gated on label being non-empty regardless of any
  // separate "show" flag — empty label = no field, by design (see
  // setPrintHeaderOption + UI).
  if (opts.custom1Label && opts.custom1Label.trim()) {
    fields.push({ cls: 'pf-custom1', label: opts.custom1Label.trim(), widthClass: 'pf-w-medium' });
  }
  if (opts.custom2Label && opts.custom2Label.trim()) {
    fields.push({ cls: 'pf-custom2', label: opts.custom2Label.trim(), widthClass: 'pf-w-medium' });
  }

  const fieldHTML = fields.map(f =>
    '<span class="pf-field ' + f.cls + ' ' + f.widthClass + '">' +
      '<span class="pf-label">' + _esc(f.label) + '</span>' +
      '<span class="pf-line"></span>' +
    '</span>'
  ).join('');

  // Score box renders separately so it can be pinned right via flex.
  // Format is "Score: ___ / ___" with both blanks empty (per spec — some
  // teachers grade with totals, some with percentages, and pre-filling
  // either side prejudices that choice).
  const scoreHTML = opts.showScore
    ? '<span class="pf-score-box">' +
        '<span class="pf-label">Score:</span>' +
        '<span class="pf-line pf-score-numerator"></span>' +
        '<span class="pf-divider">/</span>' +
        '<span class="pf-line pf-score-denominator"></span>' +
      '</span>'
    : '';

  return '<div class="print-student-header">' + fieldHTML + scoreHTML + '</div>';
}

function _compileProblem(p, num, idx) {

  // Per-problem feedback flags become data-attrs on the cell
  const liveAttr  = (p.liveFeedback === false) ? ' data-live="0"' : ' data-live="1"';
  const scoreAttr = (p.scoreOnly === true)     ? ' data-score-only="1"' : '';

  // Phase 5: per-problem span attribute. Resolved against the active column
  // count so the markup carries a final, clamped value rather than 'auto'.
  // CSS uses [data-span="full"] / [data-span="2"] / etc. to set grid-column.
  const activeCols = (builderState.print && builderState.print.columns) || 1;
  const resolvedSpan = _resolveSpan(p, activeCols);
  const spanAttr = ' data-span="' + resolvedSpan + '"';

  // Phase 6: forced page break before this problem. Skip on the first
  // problem (idx 0) — a page break before the very first item is a no-op
  // and would generate a blank leading page in some browsers' print engines.
  const pbBefore = !!(p.print && p.print.pageBreakBefore) && idx > 0;
  const pbAttr = pbBefore ? ' data-page-break-before="1"' : '';

  const blanks = p.blanks || [];
  const stem = p.stem || '';

  // Parse the stem as extended markdown. In stemMode, {{blank:N}} tokens are
  // protected from any markdown processing and survive into the output HTML
  // as literal text, which we then post-process into actual <input> elements.
  // This means blanks now work correctly inside tables, callouts, columns,
  // and any other block construct — not just flat prose.
  let stemHTML;
  if (typeof window.parseMarkdown === 'function') {
    stemHTML = window.parseMarkdown(stem, { stemMode: true });
    // Replace each surviving {{blank:N}} token with the matching input HTML.
    stemHTML = stemHTML.replace(/\{\{blank:(\d+)\}\}/g, (_, n) => {
      const idxN = parseInt(n, 10);
      const blank = blanks[idxN - 1];
      if (!blank) {
        return '<span class="missing-blank">[unconfigured blank ' + idxN + ']</span>';
      }
      const inputId = 'p' + num + '_b' + idxN;
      return _compileBlankInput(blank, inputId);
    });
  } else {
    // Defensive fallback (parser script missing in dev) — replicate the old
    // split-and-rejoin behavior so existing simple stems still render.
    stemHTML = _legacyCompileStem(stem, blanks, num);
  }

  // Replace each {{graph:id}} token with the cached pre-rendered image.
  // Capture happened at save-time in the editor modal, so this is just lookup +
  // string substitution — compileActivity stays synchronous.
  const graphs = p.graphs || [];
  const graphsById = {};
  graphs.forEach(g => { if (g && g.id) graphsById[g.id] = g; });
  stemHTML = stemHTML.replace(/\{\{graph:(graph_[a-z0-9]+)\}\}/g, (_, id) => {
    const g = graphsById[id];
    if (!g || !g.imageDataUri) {
      return '<span class="missing-blank">[missing graph ' + _esc(id) + ']</span>';
    }
    const altSafe = _esc(g.alt || 'Graph');
    const w = g.width || 480;
    const h = g.height || 320;
    return [
      '<span class="prob-graph-wrap">',
      '<img class="prob-graph" src="' + g.imageDataUri + '"',
      ' alt="' + altSafe + '"',
      ' width="' + w + '" height="' + h + '">',
      '</span>'
    ].join('');
  });

  // Workspace (phase 4) — only emitted if size != 'none'. Format defaults to
  // the activity-wide setting when the problem's format is 'default'.
  const ws = p.workspace || {};
  let workspaceHtml = '';
  if (ws.size && ws.size !== 'none') {
    const fmt = _wsResolveFormat(p);
    const heightInches = _WS_INCHES[ws.size];
    if (heightInches) {
      workspaceHtml =
        '\n  <div class="prob-workspace" data-format="' + fmt +
        '" data-size="' + ws.size + '"' +
        ' style="--ws-h:' + heightInches + 'in"></div>';
    }
  }

  return [
    '<div class="problem-cell grid-block"' + liveAttr + scoreAttr + spanAttr + pbAttr + ' data-problem-num="' + num + '">',
    '  <div class="prob-num">PROBLEM ' + num + '</div>',
    '  <div class="prob-stem">' + stemHTML + '</div>',
    '  <span class="feedback prob-feedback" id="fb_p' + num + '"></span>' + workspaceHtml,
    '</div>'
  ].join('\n');
}

// v3: compile a graph_block to a .figure-cell that participates in the same
// .problems-grid as problems. Shares the .grid-block class so [data-span] and
// [data-page-break-before] CSS rules apply uniformly. The figure label
// (FIGURE N) sits above the image; caption (if present) sits above or below
// the image based on b.captionPosition. If no graph has been saved yet, emits
// a placeholder "[graph not configured]" span instead of a broken <img>.
function _compileGraphBlock(b, figNum, idx) {
  const activeCols = (builderState.print && builderState.print.columns) || 1;
  const resolvedSpan = _resolveSpan(b, activeCols);
  const spanAttr = ' data-span="' + resolvedSpan + '"';

  const pbBefore = !!(b.print && b.print.pageBreakBefore) && idx > 0;
  const pbAttr = pbBefore ? ' data-page-break-before="1"' : '';

  // Image (or placeholder for an unconfigured block)
  let imgHTML;
  if (b.graph && b.graph.imageDataUri) {
    const altSafe = _esc(b.graph.alt || ('Figure ' + figNum));
    const w = b.graph.width || GRAPH_DEFAULT_W;
    const h = b.graph.height || GRAPH_DEFAULT_H;
    imgHTML = '<img class="figure-img" src="' + b.graph.imageDataUri + '"' +
              ' alt="' + altSafe + '"' +
              ' width="' + w + '" height="' + h + '">';
  } else {
    imgHTML = '<span class="missing-blank">[Figure ' + figNum + ' — not configured]</span>';
  }

  // Caption (optional). Routed through parseMarkdown in stemMode for the same
  // markdown/math handling problem stems get; falls back to escaped text if
  // the parser isn't loaded.
  let capHTML = '';
  const capText = (b.caption || '').trim();
  if (capText) {
    let inner;
    if (typeof window.parseMarkdown === 'function') {
      inner = window.parseMarkdown(capText, { stemMode: true });
    } else {
      inner = _esc(capText);
    }
    capHTML = '<figcaption class="fig-caption">' + inner + '</figcaption>';
  }

  // Figure body order depends on captionPosition.
  const pos = (b.captionPosition === 'above') ? 'above' : 'below';
  const figInner = (pos === 'above')
    ? capHTML + imgHTML
    : imgHTML + capHTML;

  return [
    '<div class="figure-cell grid-block"' + spanAttr + pbAttr + ' data-figure-num="' + figNum + '">',
    '  <div class="fig-num">FIGURE ' + figNum + '</div>',
    '  <figure class="figure-body" data-cap-pos="' + pos + '">',
    '    ' + figInner,
    '  </figure>',
    '</div>'
  ].join('\n');
}

// Legacy fallback only — used when parseMarkdown is unavailable. Mirrors the
// original split-on-{{blank:N}} behavior so simple stems still render.
function _legacyCompileStem(stem, blanks, num) {
  const re = /\{\{blank:(\d+)\}\}/g;
  let lastIndex = 0;
  const parts = [];
  let m;
  while ((m = re.exec(stem)) !== null) {
    if (m.index > lastIndex) parts.push({ kind: 'text', value: stem.slice(lastIndex, m.index) });
    parts.push({ kind: 'blank', n: parseInt(m[1], 10) });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < stem.length) parts.push({ kind: 'text', value: stem.slice(lastIndex) });
  if (parts.length === 0 && stem) parts.push({ kind: 'text', value: stem });

  return parts.map(part => {
    if (part.kind === 'text') return _compileStemText(part.value);
    const blank = blanks[part.n - 1];
    if (!blank) return '<span class="missing-blank">[unconfigured blank ' + part.n + ']</span>';
    return _compileBlankInput(blank, 'p' + num + '_b' + part.n);
  }).join('');
}

// Compile a text segment of the stem (legacy / fallback path only). HTML-escape
// first so that < > & in the teacher's text cannot inject script tags or break
// HTML structure. KaTeX auto-render reads .textContent, which decodes entities,
// so \( \) delimiters and any LaTeX inside them are unaffected by the escaping.
function _compileStemText(s) {
  return '<span class="stem-text">' + _esc(s) + '</span>';
}

// Compile a blank config into the appropriate inline input HTML.
// Each blank carries a --ans-len CSS variable equal to its correct-answer
// character count (with a minimum floor). The print-mode stylesheet uses
// this to scale the underline width when rendering for paper. Variable is
// inert in screen mode — input width comes from .ans-num/.inline-blank.
function _compileBlankInput(blank, inputId) {
  // Phase 8: in answer-key mode, emit a gray-text span containing the
  // correct answer instead of an interactive input/dropdown. The span keeps
  // the inline-blank-wrap class so surrounding stem layout is unchanged
  // (no extra wrapping, no shifted alignment). Math values get KaTeX
  // markers so they render. The compiled key is structurally simpler than
  // a regular blank — no event wiring, no hidden input — so the runtime's
  // _wireValidation/_initDropdowns simply skip it (no .ans-num present).
  if (_answerKeyMode) {
    // Resolve the same width that the non-key version would use, so the
    // answer-key layout has byte-for-byte the same visual footprint as the
    // student version. This makes side-by-side checking against student
    // copies easy — answers occupy exactly the same horizontal space.
    let answerDisplay;
    let answerText;
    if (blank.kind === 'fill_in') {
      answerText = blank.answer || '';
      answerDisplay = _esc(answerText);
    } else {
      // Dropdown: show the correct choice's value, rendered as math if its
      // mode is 'math'. Per spec (1a, locked): show the choice value as
      // configured — not labeled with verbal-and-numerical, not translated.
      const norm = _normalizeChoices(blank.choices || []);
      const correctChoice = norm[blank.correctChoice];
      if (correctChoice) {
        answerText = correctChoice.value || '';
        answerDisplay = (correctChoice.mode === 'math')
          ? '\\(' + correctChoice.value + '\\)'
          : _esc(correctChoice.value);
      } else {
        answerText = '';
        answerDisplay = '<span class="ans-key-missing">[no answer]</span>';
      }
    }
    const ansLen = _resolveBlankWidth(blank, answerText);
    return '<span class="inline-blank-wrap ans-key-wrap" style="--ans-len:' + ansLen + '">' +
             '<span class="ans-key">' + answerDisplay + '</span>' +
           '</span>';
  }

  if (blank.kind === 'fill_in') {
    const ans = blank.answer || '';
    const ansLen = _resolveBlankWidth(blank, ans);
    return '<input type="text" class="ans-num inline-blank" style="--ans-len:' + ansLen + '" id="' + inputId + '" data-correct="' + _escAttr(ans) + '" data-tol="' + (blank.tol || 0) + '" autocomplete="off">';
  }

  // Dropdown blank
  const norm = _normalizeChoices(blank.choices || []);
  const correctChoice = norm[blank.correctChoice];
  const correctValue = correctChoice ? correctChoice.value : '';
  const ansLen = _resolveBlankWidth(blank, correctValue);

  const options = norm
    .filter(c => c.value && String(c.value).trim())
    .map(c => {
      const display = (c.mode === 'math') ? '\\(' + c.value + '\\)' : _esc(c.value);
      return '<span class="md-option" role="option" data-value="' + _escAttr(c.value) + '" tabindex="0">' + display + '</span>';
    })
    .join('');

  const randomizeAttr = (blank.randomize === false) ? '' : ' data-randomize="1"';

  return [
    '<span class="inline-blank-wrap" style="--ans-len:' + ansLen + '">',
      // Phase 7+: span-based dropdown (was <details>/<summary>). The HTML
      // spec disallows <details> inside <p>, which forced browsers to hoist
      // the dropdown out of paragraph wrappers and broke inline flow in
      // multi-blank stems. Spans nest cleanly inside <p>. Open/closed
      // state is managed by JS via data-open attribute (see _initDropdowns
      // in the runtime). Trigger is a span that mimics the prior summary
      // button. Options box absolutely positions below the trigger.
      '<span class="md-dropdown" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0"' + randomizeAttr + '>',
        '<span class="md-trigger"><span class="md-trigger-label md-placeholder">&#8230;</span></span>',
        '<span class="md-options" role="listbox">' + options + '</span>',
      '</span>',
      '<input type="hidden" class="ans-num" id="' + inputId + '" data-correct="' + _escAttr(correctValue) + '">',
    '</span>'
  ].join('');
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function _escAttr(s) {
  return _esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// =============================================================================
// PREVIEW
// =============================================================================
let _previewDebounce = null;
function refreshPreview() {
  if (_previewDebounce) clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(() => {
    const iframe = document.getElementById('previewFrame');
    if (!iframe) return;
    // Re-apply the print-preview body class on every reload — srcdoc rebuilds
    // the iframe document from scratch, so the class would otherwise be lost.
    iframe.onload = applyPrintPreviewToIframe;
    iframe.srcdoc = compileActivity();
  }, 250);
}

// =============================================================================
// PRINT PREVIEW (phase 2)
// =============================================================================
// Toggle that flips the iframe body's `.print-preview` class so the teacher
// sees a simulated letter-portrait sheet (white page on gray void) before
// committing to a print run. The class is purely a builder-side concern —
// compileActivity() never bakes it into the published HTML.
//
// printFromBuilder() opens the print dialog for the iframe contents directly,
// independent of the toggle state. Either path produces clean print output
// because @media print rules in the worksheet template hide non-printables
// regardless of the class.
let _printPreviewActive = false;
let _pageGuidesActive = false;
// Phase 7: reading-order vs imposed-layout toggle for booklet preview.
// Default false = show imposed (print) layout. Toggling true displays
// logical pages 1..N in reading order, useful for proofreading content.
let _bookletReadingOrder = false;
// Phase 8: answer-key compile mode. Ephemeral (never saved to state). When
// true, _compileBlankInput emits each blank as a gray-text answer instead
// of an interactive input/dropdown. Set briefly during the print-answer-
// key flow, then reset so the preview returns to normal.
let _answerKeyMode = false;

function applyPrintPreviewToIframe() {
  const iframe = document.getElementById('previewFrame');
  if (!iframe || !iframe.contentDocument) return;
  const body = iframe.contentDocument.body;
  if (!body) return;
  body.classList.toggle('print-preview', _printPreviewActive);
  body.classList.toggle('pm-show-page-guides', _pageGuidesActive && _printPreviewActive);
  // Phase 7: reading-order class only applies in booklet mode.
  body.classList.toggle('pm-booklet-reading-order',
    _bookletReadingOrder &&
    _printPreviewActive &&
    builderState && builderState.print && builderState.print.mode === 'booklet');
  // Ask the runtime to (re)compute guide positions whenever state changes.
  // The runtime has an idempotent renderer that's safe to call repeatedly.
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage({ type: 'render-page-guides' }, '*');
  }
}

function togglePrintPreview() {
  _printPreviewActive = !_printPreviewActive;
  const btn = document.getElementById('printPreviewToggle');
  if (btn) {
    btn.classList.toggle('active', _printPreviewActive);
    btn.setAttribute('aria-pressed', _printPreviewActive ? 'true' : 'false');
  }
  // Page guides only meaningful when preview is on; auto-hide their button
  // to make the dependency obvious.
  const guideBtn = document.getElementById('pageGuidesToggle');
  if (guideBtn) guideBtn.style.display = _printPreviewActive ? '' : 'none';
  // Reading-order toggle only meaningful when preview is on AND mode is
  // booklet. Same auto-hide pattern.
  const robtn = document.getElementById('readingOrderToggle');
  if (robtn) {
    const isBooklet = builderState && builderState.print && builderState.print.mode === 'booklet';
    robtn.style.display = (_printPreviewActive && isBooklet) ? '' : 'none';
  }
  applyPrintPreviewToIframe();
}

function togglePageGuides() {
  _pageGuidesActive = !_pageGuidesActive;
  const btn = document.getElementById('pageGuidesToggle');
  if (btn) {
    btn.classList.toggle('active', _pageGuidesActive);
    btn.setAttribute('aria-pressed', _pageGuidesActive ? 'true' : 'false');
  }
  applyPrintPreviewToIframe();
}

function toggleBookletReadingOrder() {
  _bookletReadingOrder = !_bookletReadingOrder;
  const btn = document.getElementById('readingOrderToggle');
  if (btn) {
    btn.classList.toggle('active', _bookletReadingOrder);
    btn.setAttribute('aria-pressed', _bookletReadingOrder ? 'true' : 'false');
  }
  applyPrintPreviewToIframe();
}

function printFromBuilder() {
  const iframe = document.getElementById('previewFrame');
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.focus();
  // Trigger print from inside the iframe's own context via postMessage rather
  // than calling iframe.contentWindow.print() directly. Two reasons:
  //   1. The iframe sandbox blocks modal APIs unless allow-modals is set; even
  //      with allow-modals, Firefox sometimes drops user-activation on
  //      cross-frame .print() calls. A message handler inside the iframe
  //      preserves the activation chain.
  //   2. Architecturally cleaner — the parent expresses intent ("print this"),
  //      the iframe decides how to fulfill it.
  // The receiving listener lives in builder-template.js worksheet runtime.
  iframe.contentWindow.postMessage({ type: 'request-print' }, '*');
}

// Phase 8: print the answer key. Temporarily flips _answerKeyMode on, forces
// an iframe recompile, waits for rendering to settle (KaTeX async, booklet
// imposition pass), triggers print, then reverts on afterprint.
//
// The flow is necessarily asynchronous: compile is sync but the iframe
// reload is not, and KaTeX/booklet measurement need ~600ms to settle. We
// use a single-shot iframe.onload handler that triggers print once the
// recompile lands, then a one-time message listener for the iframe's
// 'print-completed' signal to revert the flag. If the user cancels the
// print dialog, afterprint still fires, so we're safe.
function printAnswerKey() {
  const iframe = document.getElementById('previewFrame');
  if (!iframe) return;

  // Guard against double-invocation while a key print is already in flight.
  if (_answerKeyMode) return;

  _answerKeyMode = true;

  // Recompile with the flag on. Use direct srcdoc replacement (no debounce)
  // since this is a deliberate user action.
  const recompileForPrint = function() {
    iframe.onload = function() {
      // Restore the standard onload behavior so future content edits don't
      // get the print-then-revert wrapping.
      iframe.onload = applyPrintPreviewToIframe;
      applyPrintPreviewToIframe();
      // Wait for KaTeX + booklet rendering to settle. 800ms is conservative
      // (longer than the 600ms second pass in _renderBooklet).
      setTimeout(function() {
        if (!iframe.contentWindow) return;
        iframe.contentWindow.focus();
        iframe.contentWindow.postMessage({ type: 'request-print' }, '*');
      }, 800);
    };
    iframe.srcdoc = compileActivity();
  };

  // Listen for print completion to flip the flag back. The iframe runtime
  // posts 'print-completed' on its own afterprint event.
  const onPrintComplete = function(e) {
    if (!e || !e.data || e.data.type !== 'print-completed') return;
    window.removeEventListener('message', onPrintComplete);
    _answerKeyMode = false;
    // Recompile with flag off so the preview reverts to normal interactive
    // mode. User edits land on a fresh, blank-bearing document.
    iframe.onload = applyPrintPreviewToIframe;
    iframe.srcdoc = compileActivity();
  };
  window.addEventListener('message', onPrintComplete);

  recompileForPrint();
}

// =============================================================================
// TITLE / WEBHOOK FIELD HANDLERS
// =============================================================================
function setTitle(value) {
  builderState.title = value;
  builderState.slug = slugify(value);
  builderState.filename = 'activities/' + builderState.slug + '.html';
  document.getElementById('filenamePreview').textContent = builderState.filename;
  saveDraft();
  refreshPreview();
}
function setWebhook(value) {
  builderState.webhook = value;
  saveDraft();
  refreshPreview();
}
function setDefault(flag, value) {
  if (!builderState.defaults) builderState.defaults = { liveFeedback: true, scoreOnly: false };
  builderState.defaults[flag] = !!value;
  saveDraft();
  // Note: changing the global default does NOT retroactively update existing
  // problems. New problems created after this point will inherit the new default.
}

// =============================================================================
// PRINT / WORKSPACE (phase 4)
// =============================================================================
// Activity-wide print defaults (default workspace format, units toggle) and
// per-problem workspace settings. Two-tier model: global defaults set in the
// activity-config section, per-problem overrides on each problem card.

const _WS_INCHES = { '1in': 1, '2in': 2, '3in': 3, 'half': 5, 'full': 8.5 };

const _WS_FORMAT_LABELS = {
  'default':  'Use default',
  'blank':    'Blank',
  'lines':    'Ruled lines',
  'dots':     'Dot grid',
  'squares':  'Square grid',
  'coord':    'Coordinate plane'
};

// Display label for a size key, formatted in the active unit system.
// Spacing is canonical inches — toggling units only changes the displayed
// number (per design choice (i) — actual paper space is preserved).
function _wsSizeLabel(sizeKey, units) {
  if (sizeKey === 'none') return 'No work space';
  if (sizeKey === 'half') return 'Half page';
  if (sizeKey === 'full') return 'Full page';
  const inches = _WS_INCHES[sizeKey];
  if (inches == null) return sizeKey;
  if (units === 'cm') {
    // Round to 1 decimal, drop trailing .0
    const cm = Math.round(inches * 2.54 * 10) / 10;
    return (cm % 1 === 0 ? cm.toFixed(0) : cm.toFixed(1)) + ' cm';
  }
  return inches + ' in';
}

function _wsFormatLabel(fmtKey) {
  return _WS_FORMAT_LABELS[fmtKey] || fmtKey;
}

// Resolve the effective format for a problem. 'default' on a problem points
// to the activity-wide default; explicit format wins.
function _wsResolveFormat(p) {
  const ws = (p && p.workspace) || {};
  if (ws.format && ws.format !== 'default') return ws.format;
  return (builderState && builderState.print && builderState.print.defaultWorkspaceFormat) || 'dots';
}

// Activity-level print defaults (called from activity-builder.html UI).
function setPrintDefault(field, value) {
  if (!builderState.print) builderState.print = { defaultWorkspaceFormat: 'dots', units: 'in' };
  builderState.print[field] = value;
  saveDraft();
  // Re-render so per-problem dropdown labels (which include the resolved
  // default name and unit conversions) update immediately.
  renderProblems();
  refreshPreview();
}

// Per-problem workspace updater (size and format are nested under p.workspace,
// so the generic updateProblem can't reach them).
function updateProblemWorkspace(id, field, value) {
  const p = builderState.problems.find(x => x.id === id);
  if (!p) return;
  if (!p.workspace) p.workspace = { size: 'none', format: 'default' };
  p.workspace[field] = value;
  saveDraft();
  refreshPreview();
}

// =============================================================================
// COLUMN LAYOUT (phase 5)
// =============================================================================
// Activity-wide column count + width preset, plus per-problem span overrides.
// Implementation uses CSS Grid (not multi-column flow) so problems can span
// arbitrary numbers of columns regardless of source order. Body classes drive
// the grid-template-columns rule; per-problem data-span attributes drive the
// grid-column placement of each cell.

// Preset catalog. Each entry knows which column counts it applies to and
// which body class it produces. The 'equal' preset is the implicit default
// for every count. Adding a new preset = one entry here + matching CSS rule.
const _COLUMN_PRESETS = {
  // 1-col: only 'equal' (single full-width column).
  '1': [
    { key: 'equal', label: '1 column', cssClass: 'pm-cols-1-equal' }
  ],
  // 2-col: equal, wide-left (60/40), wide-right (40/60).
  '2': [
    { key: 'equal',  label: '50 / 50',           cssClass: 'pm-cols-2-equal' },
    { key: '60-40',  label: '60 / 40',           cssClass: 'pm-cols-2-60-40' },
    { key: '40-60',  label: '40 / 60',           cssClass: 'pm-cols-2-40-60' }
  ],
  // 3-col: equal thirds, or 25/37.5/37.5 ("section sidebar + 2 cols").
  '3': [
    { key: 'equal',     label: '33 / 33 / 33',           cssClass: 'pm-cols-3-equal' },
    { key: '25-37-37',  label: '25 / 37.5 / 37.5',       cssClass: 'pm-cols-3-25-37-37' }
  ]
};

function _columnsBodyClass() {
  const pr = (builderState && builderState.print) || {};
  const count = [1, 2, 3].includes(pr.columns) ? pr.columns : 1;
  const presets = _COLUMN_PRESETS[String(count)];
  // Find requested preset; fall back to 'equal' for that count.
  const match = presets.find(p => p.key === pr.columnPreset) || presets[0];
  let cls = 'pm-cols-' + count + ' ' + match.cssClass;
  // Phase 7: booklet mode body class. Triggers landscape @page, half-page
  // logical-page rendering, and density tweaks. The runtime DOES NOT
  // automatically add pm-print-letter for the alternative — letter is the
  // implicit default and needs no class.
  if (pr.mode === 'booklet') cls += ' pm-booklet';
  // Phase 7+: density and font-size scales. 'standard' is the implicit
  // default (no class emitted) so existing styles apply unchanged.
  if (pr.density === 'compact')   cls += ' pm-density-compact';
  if (pr.density === 'tight')     cls += ' pm-density-tight';
  if (pr.density === 'flush')     cls += ' pm-density-flush';
  if (pr.fontSize === 'compact')  cls += ' pm-fontsize-compact';
  if (pr.fontSize === 'tight')    cls += ' pm-fontsize-tight';
  return cls;
}

// Resolve a problem's effective column span given the active column count.
// 'auto' = 1 column. Numeric spans ('2', '3') are clamped to the active count
// — a 'span 3' problem in a 2-col layout becomes a span-2. 'full' is always
// honored regardless of count (treated as full-row span).
function _resolveSpan(p, activeColumns) {
  const requested = (p && p.print && p.print.span) || 'auto';
  if (requested === 'full') return 'full';
  if (requested === 'auto' || requested === '1') return 1;
  const n = parseInt(requested, 10);
  if (isNaN(n) || n < 1) return 1;
  return Math.min(n, activeColumns);
}

function setPrintColumns(value) {
  const n = parseInt(value, 10);
  if (![1, 2, 3].includes(n)) return;
  if (!builderState.print) builderState.print = { defaultWorkspaceFormat: 'dots', units: 'in', columns: 1, columnPreset: 'equal', mode: 'letter' };
  builderState.print.columns = n;
  // Reset preset to 'equal' when changing count, since presets aren't shared
  // across counts. The preset dropdown in the UI will repopulate.
  builderState.print.columnPreset = 'equal';
  saveDraft();
  // Re-render so the preset dropdown options reflect the new count, and the
  // per-problem span dropdown options reflect the new max.
  renderProblems();
  // Activity-config preset dropdown also needs re-population — handled by
  // a small helper rather than full renderAll, to preserve focus elsewhere.
  _repopulateColumnPresetSelect();
  refreshPreview();
}

function setPrintColumnPreset(key) {
  if (!builderState.print) return;
  builderState.print.columnPreset = key || 'equal';
  saveDraft();
  refreshPreview();
}

// Phase 7: print mode (letter | booklet). Switching to booklet activates the
// imposition pipeline at compile time. Visibility of the booklet-specific
// preview toggle is also tied to this flag.
function setPrintMode(mode) {
  if (mode !== 'letter' && mode !== 'booklet') return;
  if (!builderState.print) builderState.print = { defaultWorkspaceFormat: 'dots', units: 'in', columns: 1, columnPreset: 'equal', mode: 'letter' };
  builderState.print.mode = mode;
  saveDraft();
  // Toggle visibility of booklet-only UI (reading-order button) in the
  // preview header. The button itself lives in the parent (builder) page,
  // not in the iframe runtime, so we tweak it directly here.
  const robtn = document.getElementById('readingOrderToggle');
  if (robtn) robtn.style.display = (mode === 'booklet' && _printPreviewActive) ? '' : 'none';
  refreshPreview();
}

// Phase 7+: density and font-size scales. Both accept 'standard'|'compact'
// |'tight'. They map directly to body classes baked at compile time, so
// changes take effect on the next preview rebuild.
function setPrintDensity(value) {
  if (!['standard','compact','tight','flush'].includes(value)) return;
  if (!builderState.print) return;
  builderState.print.density = value;
  saveDraft();
  refreshPreview();
}

function setPrintFontSize(value) {
  if (!['standard','compact','tight'].includes(value)) return;
  if (!builderState.print) return;
  builderState.print.fontSize = value;
  saveDraft();
  refreshPreview();
}

// Phase 7+: print header options (Name/Period always-on; Date/Score/Custom
// are opt-in). One generic setter handles all four boolean+string fields.
function setPrintHeaderOption(field, value) {
  if (!builderState.print) return;
  if (!builderState.print.headerOptions) {
    builderState.print.headerOptions = { showDate: false, showScore: false, custom1Label: '', custom2Label: '' };
  }
  // Sanity-check field name to avoid corrupting state via DOM-attr typos
  if (!['showDate','showScore','custom1Label','custom2Label'].includes(field)) return;
  builderState.print.headerOptions[field] = value;
  saveDraft();
  refreshPreview();
}

function updateProblemPrint(id, field, value) {
  const p = builderState.problems.find(x => x.id === id);
  if (!p) return;
  if (!p.print) p.print = { span: 'auto' };
  p.print[field] = value;
  saveDraft();
  refreshPreview();
}

// Repopulate the column-preset <select> in activity-config when the column
// count changes. Called from setPrintColumns (avoids a full re-render).
function _repopulateColumnPresetSelect() {
  const sel = document.getElementById('columnPreset');
  if (!sel) return;
  const count = (builderState.print && builderState.print.columns) || 1;
  const presets = _COLUMN_PRESETS[String(count)] || _COLUMN_PRESETS['1'];
  sel.innerHTML = presets.map(p =>
    '<option value="' + p.key + '">' + p.label + '</option>'
  ).join('');
  sel.value = (builderState.print && builderState.print.columnPreset) || 'equal';
  // Hide the preset selector for 1-column (only one option).
  const row = sel.closest('.preset-row');
  if (row) row.style.display = (count === 1) ? 'none' : '';
}

// =============================================================================
// AUTH / PIN UNLOCK
// =============================================================================
// _pendingAfterPin: optional callback queued by another flow (e.g. the load
// modal) when it requires the teacher to enter their PIN before continuing.
// Set by the caller before opening the PIN modal; flushed exactly once on
// successful unlock. Cleared on cancel/close to avoid surprise re-firing on
// the next unrelated unlock.
let _pendingAfterPin = null;

function openPinModal() {
  document.getElementById('pinInput').value = '';
  document.getElementById('pinError').style.display = 'none';
  document.getElementById('pinBackdrop').classList.add('open');
  setTimeout(() => document.getElementById('pinInput').focus(), 80);
}
function closePinModal() {
  document.getElementById('pinBackdrop').classList.remove('open');
  // Cancel/close clears the queued callback. Only a successful checkPin()
  // should fire it; otherwise it would silently fire on the next unlock.
  _pendingAfterPin = null;
}
async function checkPin() {
  const pin = document.getElementById('pinInput').value.trim();
  if (!pin) return;
  const h = await hashPin(pin);
  if (h !== PIN_HASH) {
    document.getElementById('pinError').style.display = 'block';
    return;
  }
  const tok = await getDecryptedToken(pin);
  if (!tok) {
    document.getElementById('pinError').textContent = 'PIN correct, but no token found. Set one up in index.html first; if you\'ve already done that on another device, sign in with Google to sync.';
    document.getElementById('pinError').style.display = 'block';
    return;
  }
  _decryptedToken = tok;
  // Suppress closePinModal's pending-clear by snapshotting the callback
  // first, clearing the slot ourselves, then closing. Order matters: we
  // never want closePinModal to wipe a callback we're about to fire.
  const cb = _pendingAfterPin;
  _pendingAfterPin = null;
  document.getElementById('pinBackdrop').classList.remove('open');
  _updateAuthUI(true);
  if (typeof cb === 'function') {
    setTimeout(cb, 0);
  }
}
function lockBuilder() {
  _decryptedToken = null;
  _updateAuthUI(false);
}
function _updateAuthUI(unlocked) {
  document.getElementById('authLocked').style.display   = unlocked ? 'none' : 'flex';
  document.getElementById('authUnlocked').style.display = unlocked ? 'flex' : 'none';
  document.getElementById('publishBtn').disabled = !unlocked;
  if (unlocked) {
    const src = document.getElementById('unlockSource');
    if (src) {
      const driveOn = (typeof secureStore !== 'undefined' && secureStore._isDriveAvailable && secureStore._isDriveAvailable());
      src.textContent = driveOn ? 'synced via Drive · ready to publish' : 'local only · ready to publish';
    }
  }
}

// =============================================================================
// PUBLISH
// =============================================================================
function openPublishModal() {
  if (!_decryptedToken) { openPinModal(); return; }
  document.getElementById('publishFilename').textContent = builderState.filename;
  document.getElementById('publishTitle').textContent = builderState.title;
  document.getElementById('publishStatus').textContent = '';
  document.getElementById('publishStatus').style.display = 'none';

  // Pre-fill the four index-card fields from builderState.indexMeta. This is
  // the round-trip pre-fill the load-activity feature asked for: a teacher
  // who loaded an activity from the picker and clicks Publish should see the
  // existing unit/desc/tags/type rather than four blank inputs. New activities
  // (never published) have empty defaults from _freshState() so this just
  // shows blanks, matching the previous behavior.
  const im = (builderState && builderState.indexMeta) || { unit: '', desc: '', tags: [], type: 'activity' };
  const unitEl = document.getElementById('publishUnit');
  const descEl = document.getElementById('publishDesc');
  const tagsEl = document.getElementById('publishTags');
  const typeEl = document.getElementById('publishType');
  if (unitEl) unitEl.value = im.unit || '';
  if (descEl) descEl.value = im.desc || '';
  if (tagsEl) tagsEl.value = (Array.isArray(im.tags) ? im.tags.join(', ') : '');
  if (typeEl) typeEl.value = im.type || 'activity';

  // Hide the save-as inline panel if it was left open from a prior session.
  const saveAsPanel = document.getElementById('saveAsPanel');
  if (saveAsPanel) saveAsPanel.style.display = 'none';

  document.getElementById('publishBackdrop').classList.add('open');
}
function closePublishModal() {
  document.getElementById('publishBackdrop').classList.remove('open');
}

async function confirmPublish() {
  const alsoIndex = document.getElementById('alsoIndexCheckbox').checked;
  const unit = document.getElementById('publishUnit').value.trim();
  const desc = document.getElementById('publishDesc').value.trim();
  const tagsRaw = document.getElementById('publishTags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const type = document.getElementById('publishType').value;

  const btn = document.getElementById('confirmPublishBtn');
  btn.disabled = true;
  btn.textContent = 'Publishing…';

  try {
    if (!builderState.createdAt) builderState.createdAt = new Date().toISOString();
    builderState.updatedAt = new Date().toISOString();

    const html = compileActivity();
    const ok = await publishToGitHub(builderState.filename, html, 'publishStatus');
    if (!ok) { btn.disabled = false; btn.textContent = 'Publish'; return; }

    // Persist whatever the teacher just typed into the publish modal so the
    // next openPublishModal() pre-fills with the same values rather than the
    // ones from when the activity was originally loaded. This also captures
    // metadata for activities that were authored from scratch (never had an
    // indexMeta from a load round-trip).
    builderState.indexMeta = {
      unit: unit || '',
      desc: desc || '',
      tags: Array.isArray(tags) ? tags : [],
      type: type || 'activity'
    };

    if (alsoIndex) {
      btn.textContent = 'Updating index…';
      const indexOK = await _addToIndex({
        title: builderState.title,
        desc: desc,
        file: builderState.filename,
        unit: unit || 'Untitled Unit',
        type: type,
        tags: tags
      });
      if (!indexOK) {
        const st = document.getElementById('publishStatus');
        st.style.color = 'var(--amber)';
        st.textContent = 'Activity published, but index update failed. Use index.html to add the card manually.';
      }
    }

    saveDraft();
    // Stamp the last-saved snapshot AFTER saveDraft so the comparison in
    // _isDraftDirty() reads as clean immediately. Without this, every
    // post-publish state would still register as "dirty" against the
    // pre-publish baseline.
    _stampLastSaved();
    btn.disabled = false;
    btn.textContent = 'Publish';
  } catch (e) {
    const st = document.getElementById('publishStatus');
    st.style.display = 'block';
    st.style.color = 'var(--red)';
    st.textContent = '✗ ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Publish';
  }
}

async function _addToIndex(resource) {
  try {
    // Fetch raw index.html
    const r = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/index.html?t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${_decryptedToken}`, Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (!r.ok) return false;
    const meta = await r.json();
    const indexHTML = fromBase64(meta.content.replace(/\n/g, ''));

    // Find INDEX_DATA block
    const re = /<script id="INDEX_DATA" type="application\/json">([\s\S]*?)<\/script>/;
    const match = indexHTML.match(re);
    if (!match) return false;

    let data;
    try { data = JSON.parse(match[1]); }
    catch (e) { return false; }

    if (!Array.isArray(data.resources)) data.resources = [];
    if (!Array.isArray(data.unitOrder))  data.unitOrder = [];

    // Add resource (idempotent on file path)
    const newRes = Object.assign({ id: 'r' + Date.now() }, resource);
    const existingIdx = data.resources.findIndex(x => x.file === resource.file);
    if (existingIdx >= 0) data.resources[existingIdx] = Object.assign(data.resources[existingIdx], newRes);
    else data.resources.push(newRes);

    if (resource.unit && !data.unitOrder.includes(resource.unit)) {
      data.unitOrder.push(resource.unit);
    }

    // Splice modified data back into HTML
    const newDataBlock = '<script id="INDEX_DATA" type="application/json">' + JSON.stringify(data, null, 2) + '<\/script>';
    const newIndexHTML = indexHTML.replace(re, newDataBlock);

    return await publishToGitHub('index.html', newIndexHTML, 'publishStatus');
  } catch (e) {
    console.error('_addToIndex failed:', e);
    return false;
  }
}

// =============================================================================
// RENDER ALL
// =============================================================================
function renderAll() {
  document.getElementById('titleInput').value = builderState.title;
  document.getElementById('webhookInput').value = builderState.webhook;
  document.getElementById('filenamePreview').textContent = builderState.filename;
  // Global defaults
  const d = builderState.defaults || { liveFeedback: true, scoreOnly: false };
  const liveCB  = document.getElementById('defaultLiveFeedback');
  const scoreCB = document.getElementById('defaultScoreOnly');
  if (liveCB)  liveCB.checked  = !!d.liveFeedback;
  if (scoreCB) scoreCB.checked = !!d.scoreOnly;
  // Print defaults (phase 4)
  const pr = builderState.print || { defaultWorkspaceFormat: 'dots', units: 'in' };
  const fmtSel = document.getElementById('defaultWorkspaceFormat');
  if (fmtSel) fmtSel.value = pr.defaultWorkspaceFormat || 'dots';
  const unitInputs = document.querySelectorAll('input[name="printUnits"]');
  unitInputs.forEach(r => { r.checked = (r.value === (pr.units || 'in')); });
  // Phase 7: print mode radio
  const modeInputs = document.querySelectorAll('input[name="printMode"]');
  modeInputs.forEach(r => { r.checked = (r.value === (pr.mode || 'letter')); });
  // Phase 7+: density and font-size dropdowns
  const densitySel  = document.getElementById('printDensity');
  if (densitySel)  densitySel.value  = pr.density  || 'standard';
  const fontSel = document.getElementById('printFontSize');
  if (fontSel) fontSel.value = pr.fontSize || 'standard';
  // Phase 7+: print header field options
  const ho = pr.headerOptions || { showDate: false, showScore: false, custom1Label: '', custom2Label: '' };
  const dateCB     = document.getElementById('printShowDate');
  const scoreBoxCB = document.getElementById('printShowScore');
  if (dateCB)     dateCB.checked     = !!ho.showDate;
  if (scoreBoxCB) scoreBoxCB.checked = !!ho.showScore;
  const c1 = document.getElementById('printCustom1Label');
  const c2 = document.getElementById('printCustom2Label');
  if (c1) c1.value = ho.custom1Label || '';
  if (c2) c2.value = ho.custom2Label || '';
  // Column layout (phase 5) — count first, then populate preset dropdown
  // (which depends on count) and select the saved preset.
  const colCountSel = document.getElementById('columnCount');
  if (colCountSel) colCountSel.value = String(pr.columns || 1);
  _repopulateColumnPresetSelect();
  renderProblems();
  renderSidebarTools();
  refreshPreview();
}

// =============================================================================
// BULK IMPORT — modal flow
// -----------------------------------------------------------------------------
// Wires window.BulkImporter (loaded from bulk-importer.js) into the builder UI.
//
// UI flow:
//   1. Teacher clicks "Import problems" -> openBulkImportModal()
//   2. Pastes text, clicks "Parse preview" -> parseBulkImportPreview()
//      Preview pane shows N count, warnings, and stem snippets.
//      Action row swaps to [Back to edit] + [Append problems]. If 0 problems
//      parsed, Append is hidden (only Back to edit is shown).
//   3. Clicks "Append problems" -> appendBulkProblems()
//      Runs _appendBulkProblems(), closes modal, shows status pill.
//   4. Cancel / Escape / clicking the backdrop closes and discards everything.
//
// The status pill is manual-dismiss (per teacher preference) — it persists
// until the X is clicked or another import replaces it.
// =============================================================================
let _bulkImportLastParse = null;   // cached parse result between Preview and Append
let _bulkImportEscHandler = null;  // bound on open, removed on close so listeners don't leak

function openBulkImportModal() {
  // Reset in case the modal was closed mid-flow last time.
  _bulkImportLastParse = null;
  document.getElementById('bulkImportText').value = '';
  const previewEl = document.getElementById('bulkImportPreview');
  previewEl.style.display = 'none';
  previewEl.innerHTML = '';
  _renderBulkImportInitialActions();

  document.getElementById('bulkImportBackdrop').classList.add('open');
  // Focus the textarea so the teacher can paste immediately.
  setTimeout(() => {
    const ta = document.getElementById('bulkImportText');
    if (ta) ta.focus();
  }, 0);

  // Bind Escape to close. Stored so closeBulkImportModal can detach it.
  _bulkImportEscHandler = function (e) {
    if (e.key === 'Escape') closeBulkImportModal();
  };
  document.addEventListener('keydown', _bulkImportEscHandler);
}
window.openBulkImportModal = openBulkImportModal;

function closeBulkImportModal() {
  document.getElementById('bulkImportBackdrop').classList.remove('open');
  // Reset so reopening starts fresh (per spec).
  document.getElementById('bulkImportText').value = '';
  const previewEl = document.getElementById('bulkImportPreview');
  previewEl.style.display = 'none';
  previewEl.innerHTML = '';
  _bulkImportLastParse = null;
  if (_bulkImportEscHandler) {
    document.removeEventListener('keydown', _bulkImportEscHandler);
    _bulkImportEscHandler = null;
  }
}
window.closeBulkImportModal = closeBulkImportModal;

// Reset the modal's action row to its "edit" state (Cancel + Parse preview).
function _renderBulkImportInitialActions() {
  document.getElementById('bulkImportActions').innerHTML =
    '<button class="mb" onclick="closeBulkImportModal()">Cancel</button>' +
    '<button class="mb save" onclick="parseBulkImportPreview()">Parse preview</button>';
}

function parseBulkImportPreview() {
  if (!window.BulkImporter || typeof window.BulkImporter.parse !== 'function') {
    console.error('[bulk-import] BulkImporter not loaded. Check that bulk-importer.js is included before builder.js in activity-builder.html.');
    return;
  }
  const text = document.getElementById('bulkImportText').value;
  const result = window.BulkImporter.parse(text);
  _bulkImportLastParse = result;
  _renderBulkImportPreview(result);
}
window.parseBulkImportPreview = parseBulkImportPreview;

// Render the preview pane with header, warnings (if any), and a numbered list
// of stem snippets. Plain text only — no math rendering in v1 (per spec).
function _renderBulkImportPreview(result) {
  const previewEl = document.getElementById('bulkImportPreview');
  const n = result.problems.length;
  const m = builderState.problems.length;

  let html = '';

  // Header. DECISION: when the activity is empty (m===0), drop the
  // "(after Problem 0)" parenthetical — reads weird otherwise.
  const headerText = (m === 0)
    ? n + ' problem' + (n === 1 ? '' : 's') + ' will be appended'
    : n + ' problem' + (n === 1 ? '' : 's') + ' will be appended (after Problem ' + m + ')';
  html += '<div style="font-weight:600;font-size:14px;margin-bottom:10px;color:var(--ink)">' +
          _esc(headerText) + '</div>';

  // Warnings, if any. Amber pill, ul of messages.
  if (result.warnings.length > 0) {
    html += '<div style="background:#fbf3e6;border:1px solid #d4a85a;border-radius:3px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:#5a4520">';
    html += '<div style="font-weight:600;margin-bottom:4px">Warning' +
            (result.warnings.length === 1 ? '' : 's') + ' (' + result.warnings.length + '):</div>';
    html += '<ul style="margin:0;padding-left:18px">';
    result.warnings.forEach(w => {
      html += '<li>' + _esc(w.message) + '</li>';
    });
    html += '</ul></div>';
  }

  // Numbered list of stem snippets. Numbering starts at M+1 so the teacher
  // sees what number each new problem will become in the activity.
  if (n > 0) {
    html += '<ol start="' + (m + 1) + '" style="margin:0;padding-left:24px;font-size:12px;color:var(--ink-mid);line-height:1.6">';
    result.problems.forEach(p => {
      // Collapse internal whitespace so each snippet stays on one row, then
      // truncate at ~80 chars. Math/markdown remain literal — no rendering.
      const oneLine = p.stem.replace(/\s+/g, ' ').trim();
      const snippet = oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine;
      html += '<li style="margin-bottom:2px">' + _esc(snippet) + '</li>';
    });
    html += '</ol>';
  }

  previewEl.innerHTML = html;
  previewEl.style.display = 'block';

  // Swap action buttons. DECISION: when 0 problems parsed, hide Append
  // entirely — the only useful next action is Back to edit. A disabled
  // Append button would be visual noise.
  const actions = document.getElementById('bulkImportActions');
  if (n === 0) {
    actions.innerHTML =
      '<button class="mb save" onclick="_bulkImportBackToEdit()">Back to edit</button>';
  } else {
    actions.innerHTML =
      '<button class="mb" onclick="_bulkImportBackToEdit()">Back to edit</button>' +
      '<button class="mb save" onclick="appendBulkProblems()">Append problems</button>';
  }
}

function _bulkImportBackToEdit() {
  const previewEl = document.getElementById('bulkImportPreview');
  previewEl.style.display = 'none';
  previewEl.innerHTML = '';
  _bulkImportLastParse = null;
  _renderBulkImportInitialActions();
  setTimeout(() => {
    const ta = document.getElementById('bulkImportText');
    if (ta) ta.focus();
  }, 0);
}
window._bulkImportBackToEdit = _bulkImportBackToEdit;

function appendBulkProblems() {
  // Defensive: button shouldn't be reachable with 0 problems, but guard anyway.
  if (!_bulkImportLastParse || _bulkImportLastParse.problems.length === 0) return;
  const n = _bulkImportLastParse.problems.length;
  _appendBulkProblems(_bulkImportLastParse.problems);
  closeBulkImportModal();
  _showBulkImportStatus('Appended ' + n + ' problem' + (n === 1 ? '' : 's') + '.');
}
window.appendBulkProblems = appendBulkProblems;

// Internal append helper. Matches the spec snippet: one _newProblem() per
// parsed stem, then saveDraft → renderProblems → refreshPreview in that order
// (same lifecycle as addProblem). Imported problems start expanded.
function _appendBulkProblems(parsedProblems) {
  parsedProblems.forEach(parsed => {
    const p = _newProblem();
    p.stem = parsed.stem;
    // No blanks pushed — teacher adds them via GUI after import.
    builderState.problems.push(p);
  });
  saveDraft();
  renderProblems();
  refreshPreview();
}

// Manual-dismiss status pill above the problems list. Replaces any prior
// message (so back-to-back imports don't stack).
function _showBulkImportStatus(msg) {
  const host = document.getElementById('bulkImportStatus');
  if (!host) return;
  host.innerHTML =
    '<span style="flex:1">' + _esc(msg) + '</span>' +
    '<button onclick="_dismissBulkImportStatus()" aria-label="Dismiss" ' +
    'style="background:transparent;border:0;font-size:18px;line-height:1;cursor:pointer;color:var(--accent);padding:0 4px">&times;</button>';
  host.style.display = 'flex';
}

function _dismissBulkImportStatus() {
  const host = document.getElementById('bulkImportStatus');
  if (!host) return;
  host.innerHTML = '';
  host.style.display = 'none';
}
window._dismissBulkImportStatus = _dismissBulkImportStatus;

// =============================================================================
// LOAD ACTIVITY — modal flow
// -----------------------------------------------------------------------------
// Reload an already-published activity into the builder for editing. Every
// published activity contains its full editable state at:
//
//   <script id="builder-state" type="application/json">...stringified state...</script>
//
// (See compileActivity()'s {{BUILDER_STATE_JSON}} substitution.) Loading is a
// fetch + extract + assign + render flow with one defensive _migrateState
// call so older published activities pick up any newly-added schema fields.
//
// UI flow:
//   1. Teacher clicks "Load activity" -> openLoadActivityModal()
//   2. _fetchActivityIndex() fetches index.html, regexes out INDEX_DATA,
//      filters out any resource missing a `file` field (pre-builder entries).
//   3. _renderActivityPicker() draws a sorted, filterable list. Each row
//      has a Load button that calls _handleLoadClick(resourceId).
//   4. _handleLoadClick checks _isDraftDirty(). If dirty, an inline
//      confirmation panel appears in-modal; if clean, load proceeds.
//   5. _loadActivity() fetches the activity HTML, extracts the
//      builder-state block, parses + migrates, replaces builderState,
//      renders, stamps last-saved, closes modal, and shows a status pill.
//
// Failure modes (rendered inline in the modal, not as alert()):
//   - PIN locked         -> "Enter your PIN first" + button to open PIN modal
//   - index.html 404     -> "Could not read the activity index..."
//   - INDEX_DATA missing -> same as above
//   - empty index        -> empty-state message
//   - activity 404       -> "Activity file not found in repo"
//   - 401 on either      -> "Authentication failed — re-enter your PIN"
//   - builder-state miss -> "Published before the current builder schema"
//   - JSON parse fail    -> "Saved state is corrupted"
//
// "Save as…" lives in the publish modal. It writes a new filename/slug to
// builderState, leaves indexMeta intact (so the new activity inherits the
// loaded one's metadata), and falls through to the normal publish flow.
// =============================================================================

// ---- Module state (kept local to this section; resets on modal close) ----
let _loadActivityResources    = null;  // cached fetched resources (filtered)
let _loadActivityFilter       = '';    // current substring filter
let _loadActivityFetchInFlight = false; // prevents double-fetch on rapid clicks
let _loadActivityEscHandler   = null;  // bound on open, removed on close
let _loadActivityPendingResource = null; // resource awaiting dirty-confirm

// ---- Dirty detection -------------------------------------------------------
// _isDraftDirty: returns true iff the current builderState differs from the
// snapshot stored at the last successful publish or load. The comparison
// strips `updatedAt` because saveDraft() bumps it on every edit; if we kept
// it in the comparison, the very first keystroke after publish would flag
// the draft dirty even when no semantic change had happened (this is the
// failure mode that broke a naive "compare to DRAFT_STORAGE_KEY" approach
// in the spec discussion).
//
// If no last-saved snapshot exists yet (first-ever session, or storage was
// cleared), we treat the comparison baseline as a fresh state. That makes
// brand-new builds with no problems read as clean (no dialog needed) but
// builds with real content read as dirty (correctly preventing data loss).

function _stateForCompare(s) {
  if (!s || typeof s !== 'object') return '';
  // Shallow clone, drop the volatile timestamp. updatedAt is the only known
  // top-level field that mutates without a content change; if more get added
  // later, list them here.
  const clone = Object.assign({}, s);
  delete clone.updatedAt;
  return JSON.stringify(clone);
}

function _isDraftDirty() {
  const current = _stateForCompare(builderState);
  let baseline = localStorage.getItem(LAST_SAVED_STATE_KEY);
  if (baseline == null) {
    // No baseline stored yet. Compare against a fresh state so a teacher
    // who has typed real content sees the dirty warning, but a brand-new
    // empty builder skips it.
    baseline = _stateForCompare(_freshState());
  }
  return current !== baseline;
}

function _stampLastSaved() {
  try {
    localStorage.setItem(LAST_SAVED_STATE_KEY, _stateForCompare(builderState));
  } catch (e) {
    console.warn('[load-activity] last-saved snapshot failed:', e);
  }
}

// ---- Public entry points ---------------------------------------------------

function openLoadActivityModal() {
  // Reset modal state so reopening starts fresh.
  _loadActivityResources = null;
  _loadActivityFilter = '';
  _loadActivityPendingResource = null;
  _loadActivityFetchInFlight = false;

  document.getElementById('loadActivityBackdrop').classList.add('open');

  // Bind Escape close (mirrors bulk-import's pattern).
  _loadActivityEscHandler = function (e) {
    if (e.key === 'Escape') closeLoadActivityModal();
  };
  document.addEventListener('keydown', _loadActivityEscHandler);

  // Token gate. If PIN isn't entered, render the gated state and queue a
  // re-open after unlock instead of attempting the fetch.
  if (!_decryptedToken) {
    _renderLoadGatedState();
    return;
  }

  // Show a loading state, then kick off the fetch.
  _renderLoadLoadingState();
  _fetchActivityIndex().then(result => {
    if (result.error) {
      _renderLoadErrorState(result.error);
      return;
    }
    if (!result.resources || result.resources.length === 0) {
      _renderLoadEmptyState();
      return;
    }
    _loadActivityResources = result.resources;
    _renderActivityPicker(_loadActivityResources, _loadActivityFilter);
  });
}
window.openLoadActivityModal = openLoadActivityModal;

function closeLoadActivityModal() {
  document.getElementById('loadActivityBackdrop').classList.remove('open');
  _loadActivityResources = null;
  _loadActivityFilter = '';
  _loadActivityPendingResource = null;
  if (_loadActivityEscHandler) {
    document.removeEventListener('keydown', _loadActivityEscHandler);
    _loadActivityEscHandler = null;
  }
}
window.closeLoadActivityModal = closeLoadActivityModal;

// ---- Index fetch -----------------------------------------------------------
// Returns: Promise<{ resources: [...], error: string|null }>. Errors are
// surfaced as strings so the caller can route them into the modal's error
// state without try/catch noise at every call site.

async function _fetchActivityIndex() {
  try {
    const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/index.html?t=' + Date.now();
    const r = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + _decryptedToken,
        Accept: 'application/vnd.github+json'
      },
      cache: 'no-store'
    });
    if (r.status === 401) {
      return { resources: null, error: 'Authentication failed — re-enter your PIN.' };
    }
    if (r.status === 404) {
      return { resources: null, error: 'index.html not found in the repo. Publish your index page first.' };
    }
    if (!r.ok) {
      return { resources: null, error: 'Could not read the activity index (HTTP ' + r.status + ').' };
    }
    const meta = await r.json();
    const indexHTML = fromBase64(meta.content.replace(/\n/g, ''));

    // Same regex shape as _addToIndex uses; INDEX_DATA is the canonical block.
    const re = /<script id="INDEX_DATA" type="application\/json">([\s\S]*?)<\/script>/;
    const match = indexHTML.match(re);
    if (!match) {
      return { resources: null, error: 'Could not read the activity index. Try reloading or re-publishing your index page.' };
    }
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch (e) {
      console.error('[load-activity] INDEX_DATA parse error:', e);
      return { resources: null, error: 'The activity index appears corrupted. Open index.html and check the INDEX_DATA block.' };
    }
    if (!Array.isArray(data.resources)) {
      return { resources: [], error: null };
    }
    // Filter pre-builder entries: anything without a `file` field can't be
    // fetched, so it can't be loaded back into the builder regardless.
    // (Some older entries also lack a builder-state block in their HTML;
    // those are caught at extraction time with a friendlier error.)
    const filtered = data.resources.filter(r => r && typeof r.file === 'string' && r.file.length > 0);
    return { resources: filtered, error: null };
  } catch (e) {
    console.error('[load-activity] index fetch failed:', e);
    return { resources: null, error: 'Network error while fetching the activity index. Check your connection and try again.' };
  }
}

// ---- Picker rendering ------------------------------------------------------

// Natural sort: handles "Unit 7" / "Unit 10" correctly, unlike pure lexical.
function _naturalCompare(a, b) {
  return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), undefined, { numeric: true, sensitivity: 'base' });
}

function _renderActivityPicker(resources, filterText) {
  const body = document.getElementById('loadActivityBody');
  if (!body) return;

  // Filter: substring match on title, unit, and tags (joined). Case-insensitive.
  const ft = (filterText || '').trim().toLowerCase();
  const filtered = ft
    ? resources.filter(r => {
        const hay = [
          r.title || '',
          r.unit || '',
          (Array.isArray(r.tags) ? r.tags.join(' ') : '')
        ].join(' ').toLowerCase();
        return hay.indexOf(ft) >= 0;
      })
    : resources.slice();

  // Sort: unit (natural) then title (natural).
  filtered.sort((a, b) =>
    _naturalCompare(a.unit, b.unit) || _naturalCompare(a.title, b.title)
  );

  // Build the search input + list. Search input value preserved across renders.
  let html = '';
  html += '<div style="margin-bottom:12px">';
  html += '<input type="text" class="text-input" id="loadActivityFilter" placeholder="Filter by title, unit, or tag…" ' +
          'value="' + _escAttr(filterText || '') + '" oninput="_onLoadFilterInput(this.value)" autocomplete="off">';
  html += '</div>';

  if (filtered.length === 0) {
    if (ft) {
      html += '<div style="padding:12px;text-align:center;color:var(--ink-mid);font-size:13px">No activities match "' + _esc(ft) + '".</div>';
    } else {
      html += '<div style="padding:12px;text-align:center;color:var(--ink-mid);font-size:13px">No activities published yet.</div>';
    }
  } else {
    html += '<div style="max-height:50vh;overflow-y:auto;border:1px solid var(--rule);border-radius:3px">';
    filtered.forEach((r, idx) => {
      const isLast = (idx === filtered.length - 1);
      const borderRule = isLast ? '' : 'border-bottom:1px solid var(--rule);';
      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;' + borderRule + '">';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-weight:600;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(r.title || '(untitled)') + '</div>';
      html += '<div style="font-size:11px;color:var(--ink-mid);margin-top:2px">';
      html += _esc(r.unit || 'No unit') + ' · ';
      html += '<span style="font-family:monospace;color:var(--ink-light)">' + _esc(r.file) + '</span>';
      html += '</div>';
      html += '</div>';
      // Resource id is the lookup key passed back into _handleLoadClick. We
      // _escAttr it because some legacy resources may have characters that
      // would otherwise break the inline onclick.
      html += '<button class="mb save" onclick="_handleLoadClick(\'' + _escAttr(r.id || '') + '\')" ' +
              'style="flex-shrink:0">Load</button>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Footer actions row: just Cancel (Load buttons are per-row).
  html += '<div class="modal-actions" style="margin-top:14px">';
  html += '<button class="mb" onclick="closeLoadActivityModal()">Cancel</button>';
  html += '</div>';

  body.innerHTML = html;
}

function _onLoadFilterInput(value) {
  _loadActivityFilter = value || '';
  if (_loadActivityResources) {
    // Re-render. Note: this rebuilds the input element too, but since we
    // pass the current value back into it and the user is mid-typing in
    // that very element, the focus is briefly lost. Mitigation: restore
    // focus + caret position after re-render.
    const beforeStart = (() => {
      const el = document.getElementById('loadActivityFilter');
      return el ? el.selectionStart : null;
    })();
    _renderActivityPicker(_loadActivityResources, _loadActivityFilter);
    const after = document.getElementById('loadActivityFilter');
    if (after) {
      after.focus();
      if (beforeStart != null) {
        try { after.setSelectionRange(beforeStart, beforeStart); } catch (e) {}
      }
    }
  }
}
window._onLoadFilterInput = _onLoadFilterInput;

// ---- Specialized modal-body states (loading / error / empty / gated) ------

function _renderLoadLoadingState() {
  const body = document.getElementById('loadActivityBody');
  if (!body) return;
  body.innerHTML =
    '<div style="padding:24px;text-align:center;color:var(--ink-mid);font-size:13px">Loading activity index…</div>' +
    '<div class="modal-actions">' +
    '<button class="mb" onclick="closeLoadActivityModal()">Cancel</button>' +
    '</div>';
}

function _renderLoadErrorState(message) {
  const body = document.getElementById('loadActivityBody');
  if (!body) return;
  body.innerHTML =
    '<div style="padding:12px;background:#fce8e6;border:1px solid var(--red);border-radius:3px;color:#5a1a1a;font-size:13px;margin-bottom:12px">' +
    _esc(message) +
    '</div>' +
    '<div class="modal-actions">' +
    '<button class="mb" onclick="closeLoadActivityModal()">Close</button>' +
    '<button class="mb save" onclick="openLoadActivityModal()">Retry</button>' +
    '</div>';
}

function _renderLoadEmptyState() {
  const body = document.getElementById('loadActivityBody');
  if (!body) return;
  body.innerHTML =
    '<div style="padding:24px;text-align:center;color:var(--ink-mid);font-size:13px">No activities published yet.</div>' +
    '<div class="modal-actions">' +
    '<button class="mb" onclick="closeLoadActivityModal()">Close</button>' +
    '</div>';
}

function _renderLoadGatedState() {
  const body = document.getElementById('loadActivityBody');
  if (!body) return;
  body.innerHTML =
    '<div style="padding:12px;background:var(--cream);border:1px solid var(--rule);border-radius:3px;color:var(--ink);font-size:13px;margin-bottom:12px">' +
    'Enter your PIN first to load activities. The picker will reopen automatically after unlock.' +
    '</div>' +
    '<div class="modal-actions">' +
    '<button class="mb" onclick="closeLoadActivityModal()">Cancel</button>' +
    '<button class="mb save" onclick="_loadActivityRequestPin()">Enter PIN</button>' +
    '</div>';
}

function _loadActivityRequestPin() {
  // Queue the load modal to reopen after the PIN modal succeeds. The PIN
  // modal lives at a higher layer than the load modal in z-order, so we
  // close the load modal first to keep the visual stack tidy. The pending
  // callback fires only on successful unlock (cancel clears it).
  closeLoadActivityModal();
  _pendingAfterPin = function () { openLoadActivityModal(); };
  openPinModal();
}
window._loadActivityRequestPin = _loadActivityRequestPin;

// ---- Load click handling (with dirty-draft confirmation) ------------------

function _handleLoadClick(resourceId) {
  if (_loadActivityFetchInFlight) return;  // ignore double-click during fetch
  if (!Array.isArray(_loadActivityResources)) return;
  const resource = _loadActivityResources.find(r => r && r.id === resourceId);
  if (!resource) {
    _renderLoadErrorState('Activity not found in the index. Try reopening the loader.');
    return;
  }

  if (_isDraftDirty()) {
    // Show inline confirmation panel; the user must explicitly choose to
    // replace their unsaved work.
    _loadActivityPendingResource = resource;
    _renderDirtyConfirmPanel(resource);
    return;
  }

  // Clean draft — proceed straight to load.
  _loadActivity(resource);
}
window._handleLoadClick = _handleLoadClick;

function _renderDirtyConfirmPanel(resource) {
  const body = document.getElementById('loadActivityBody');
  if (!body) return;
  body.innerHTML =
    '<div style="padding:14px;background:#fbf3e6;border:1px solid #d4a85a;border-radius:3px;color:#5a4520;font-size:13px;margin-bottom:14px;line-height:1.5">' +
    'Loading <strong>' + _esc(resource.title || '(untitled)') + '</strong> will replace your current unsaved draft. Continue?' +
    '</div>' +
    '<div class="modal-actions">' +
    '<button class="mb" onclick="_cancelReplaceAndLoad()">Cancel</button>' +
    '<button class="mb save" onclick="_confirmReplaceAndLoad()">Replace and load</button>' +
    '</div>';
}

function _confirmReplaceAndLoad() {
  const r = _loadActivityPendingResource;
  _loadActivityPendingResource = null;
  if (!r) return;
  _loadActivity(r);
}
window._confirmReplaceAndLoad = _confirmReplaceAndLoad;

function _cancelReplaceAndLoad() {
  _loadActivityPendingResource = null;
  // Return to the picker view.
  if (_loadActivityResources) {
    _renderActivityPicker(_loadActivityResources, _loadActivityFilter);
  } else {
    closeLoadActivityModal();
  }
}
window._cancelReplaceAndLoad = _cancelReplaceAndLoad;

// ---- The actual load --------------------------------------------------------

async function _loadActivity(resource) {
  if (_loadActivityFetchInFlight) return;
  _loadActivityFetchInFlight = true;

  _renderLoadFetchingState(resource);

  try {
    const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO +
                '/contents/' + _encodePath(resource.file) + '?t=' + Date.now();
    const r = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + _decryptedToken,
        Accept: 'application/vnd.github+json'
      },
      cache: 'no-store'
    });

    if (r.status === 401) {
      _renderLoadErrorState('Authentication failed — re-enter your PIN.');
      return;
    }
    if (r.status === 404) {
      _renderLoadErrorState('Activity file not found in repo. It may have been deleted.');
      return;
    }
    if (!r.ok) {
      _renderLoadErrorState('Failed to fetch activity (HTTP ' + r.status + ').');
      return;
    }

    const meta = await r.json();
    const html = fromBase64(meta.content.replace(/\n/g, ''));
    const extracted = _extractBuilderState(html);
    if (extracted.error) {
      _renderLoadErrorState(extracted.error);
      return;
    }

    // Run through migration. Even though the spec says no schema migration
    // is needed (only one activity exists under the current schema), we
    // still call _migrateState defensively because: (a) any future field
    // added without a migration entry would silently break loaded
    // activities, and (b) the cost is one extra function call. The forward-
    // compat note in _migrateState reinforces this.
    const migrated = _migrateState(extracted.state);

    // Replace the live state. Mirror loadDraft()'s collapsed-on-restore
    // behavior so the editor opens to a TOC view rather than a wall of
    // expanded cards. Newly added problems start expanded by default.
    builderState = migrated;
    editorUI.collapsed.clear();
    builderState.problems.forEach(p => editorUI.collapsed.add(p.id));

    // Persist immediately. saveDraft() bumps updatedAt; _stampLastSaved()
    // captures the post-save state (sans updatedAt) as the new clean
    // baseline so subsequent dirty checks compare against the loaded
    // activity, not the prior draft.
    saveDraft();
    _stampLastSaved();

    renderAll();
    closeLoadActivityModal();
    _showLoadActivityStatus('Loaded "' + (resource.title || '(untitled)') + '".');
  } catch (e) {
    console.error('[load-activity] load failed:', e);
    _renderLoadErrorState('Network error while loading the activity: ' + e.message);
  } finally {
    _loadActivityFetchInFlight = false;
  }
}

function _renderLoadFetchingState(resource) {
  const body = document.getElementById('loadActivityBody');
  if (!body) return;
  body.innerHTML =
    '<div style="padding:24px;text-align:center;color:var(--ink-mid);font-size:13px">' +
    'Loading <strong>' + _esc(resource.title || '(untitled)') + '</strong>…' +
    '</div>' +
    '<div class="modal-actions">' +
    '<button class="mb" disabled>Cancel</button>' +
    '</div>';
}

// ---- builder-state extraction ---------------------------------------------
// Inverse of compileActivity()'s {{BUILDER_STATE_JSON}} substitution. Returns
// { state: object, error: null } on success or { state: null, error: string }
// on any failure. The two distinct error messages map to the two failure
// modes spelled out in the spec's edge-case list.

function _extractBuilderState(html) {
  if (typeof html !== 'string' || html.length === 0) {
    return { state: null, error: 'This activity\'s HTML appears empty.' };
  }
  // Same shape as the template emits. The template uses <\/script> in the
  // source string which renders to </script> in the output HTML — that's
  // what we match here.
  const re = /<script id="builder-state" type="application\/json">([\s\S]*?)<\/script>/;
  const match = html.match(re);
  if (!match) {
    return {
      state: null,
      error: 'This activity was published before the current builder schema and cannot be loaded for editing.'
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (e) {
    console.error('[load-activity] builder-state parse error:', e);
    return {
      state: null,
      error: 'This activity\'s saved state is corrupted and cannot be loaded.'
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      state: null,
      error: 'This activity\'s saved state is not in the expected format.'
    };
  }
  return { state: parsed, error: null };
}

// ---- Save as… (lives in the publish modal, but the logic belongs here) ----

function openSaveAsPanel() {
  const panel = document.getElementById('saveAsPanel');
  if (!panel) return;
  panel.style.display = 'block';
  // Pre-fill with the current filename and select-all so the teacher can
  // immediately type a replacement. Use the slug-derived form (matches the
  // existing default in compileActivity) rather than the raw filename so
  // small typos in the path component don't propagate.
  const input = document.getElementById('saveAsFilename');
  if (input) {
    input.value = builderState.filename || ('activities/' + (builderState.slug || 'untitled') + '.html');
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  // Hide any prior collision warning.
  const warn = document.getElementById('saveAsCollisionWarn');
  if (warn) warn.style.display = 'none';
}
window.openSaveAsPanel = openSaveAsPanel;

function closeSaveAsPanel() {
  const panel = document.getElementById('saveAsPanel');
  if (panel) panel.style.display = 'none';
  const warn = document.getElementById('saveAsCollisionWarn');
  if (warn) { warn.style.display = 'none'; warn.dataset.acknowledged = ''; }
}
window.closeSaveAsPanel = closeSaveAsPanel;

async function confirmSaveAs() {
  const input = document.getElementById('saveAsFilename');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) {
    _saveAsShowError('Please enter a filename.');
    return;
  }

  // Normalize: must end in .html, default to activities/ folder if no slash.
  let filename = raw;
  if (filename.indexOf('/') < 0) filename = 'activities/' + filename;
  if (!/\.html?$/i.test(filename)) filename += '.html';
  // Whitespace and quote characters in paths break the GitHub contents API
  // and are universally hostile in URLs; reject up front rather than letting
  // publishToGitHub return a baffling error later.
  if (/[\s"']/.test(filename)) {
    _saveAsShowError('Filename can\'t contain spaces or quote characters.');
    return;
  }

  // Same-as-current is a no-op (just re-publish via the regular Publish flow).
  if (filename === builderState.filename) {
    _saveAsShowError('That\'s the current filename. Use Publish to overwrite, or pick a new name.');
    return;
  }

  // Collision check against INDEX_DATA. Warn-and-allow per the agreed model:
  // first click warns, second click on the same filename proceeds.
  const warn = document.getElementById('saveAsCollisionWarn');
  if (warn && warn.dataset.acknowledged !== filename) {
    const collision = await _checkFilenameCollision(filename);
    if (collision) {
      warn.style.display = 'block';
      warn.textContent = 'An activity already exists at "' + filename + '" (' + collision + '). Click Save as again to overwrite it.';
      warn.dataset.acknowledged = filename;
      return;
    }
  }

  // Update state. Per the agreed model: keep indexMeta intact (the new
  // activity inherits the current unit/desc/tags/type so the teacher
  // doesn't have to retype). The publish flow will write any modal-modified
  // values back to indexMeta after a successful publish.
  const slug = filename.replace(/^.*\//, '').replace(/\.html?$/i, '');
  builderState.filename = filename;
  builderState.slug = slug;
  saveDraft();

  // Close save-as panel, refresh the publish modal's filename display, and
  // proceed to the normal publish flow.
  closeSaveAsPanel();
  document.getElementById('publishFilename').textContent = builderState.filename;
  // Stamp last-saved snapshot to prevent a "you have unsaved changes"
  // dialog from firing later just because we changed filename/slug.
  // (The publish flow's own saveDraft + _stampLastSaved will cover the
  // post-publish state too.)
  _stampLastSaved();
  // Fall through to the regular publish.
  confirmPublish();
}
window.confirmSaveAs = confirmSaveAs;

function _saveAsShowError(msg) {
  const warn = document.getElementById('saveAsCollisionWarn');
  if (!warn) return;
  warn.style.display = 'block';
  warn.textContent = msg;
  // Don't set acknowledged — this isn't a "click again to override" case,
  // it's a hard validation error. The user must edit the input first.
  warn.dataset.acknowledged = '';
}

async function _checkFilenameCollision(filename) {
  // Fast path: check the in-memory cache from the load modal if it's still
  // fresh. Otherwise re-fetch the index.
  let resources = _loadActivityResources;
  if (!Array.isArray(resources)) {
    const result = await _fetchActivityIndex();
    if (result.error) {
      // If we can't reach the index, fall back to "no collision detected"
      // rather than blocking the publish. The user can always check
      // index.html manually if worried.
      console.warn('[save-as] collision check skipped:', result.error);
      return null;
    }
    resources = result.resources || [];
  }
  const hit = resources.find(r => r && r.file === filename);
  return hit ? (hit.title || filename) : null;
}

// ---- Status pill -----------------------------------------------------------
// Mirrors the bulk-import status pill. Manual dismiss; replaces any prior
// message rather than stacking.

function _showLoadActivityStatus(msg) {
  const host = document.getElementById('loadActivityStatus');
  if (!host) return;
  host.innerHTML =
    '<span style="flex:1">' + _esc(msg) + '</span>' +
    '<button onclick="_dismissLoadActivityStatus()" aria-label="Dismiss" ' +
    'style="background:transparent;border:0;font-size:18px;line-height:1;cursor:pointer;color:var(--accent);padding:0 4px">&times;</button>';
  host.style.display = 'flex';
}

function _dismissLoadActivityStatus() {
  const host = document.getElementById('loadActivityStatus');
  if (!host) return;
  host.innerHTML = '';
  host.style.display = 'none';
}
window._dismissLoadActivityStatus = _dismissLoadActivityStatus;

// =============================================================================
// INIT
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadDraft();
  if (!builderState) builderState = _freshState();
  renderAll();
  console.log('[builder] ready. Draft loaded:', !!localStorage.getItem(DRAFT_STORAGE_KEY));
});
