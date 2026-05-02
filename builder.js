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

// Builder-specific constant (auth constants come from auth.js)
const DRAFT_STORAGE_KEY = 'builder_draft_v1';

// =============================================================================
// BUILDER STATE
// =============================================================================
// Placeholder; replaced at init by either _freshState() or loadDraft().
// Declared as `let` so loadDraft and clearDraft can reassign.
let builderState = null;

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
const STATE_VERSION = 2;

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
    problems: [],
    sidebarTools: [{ id: 'save', type: 'save' }, { id: 'load', type: 'load' }],
    filename: 'activities/new_activity.html',
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
  } catch (e) {
    console.warn('Draft load failed:', e);
  }
}
function clearDraft() {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  builderState = _freshState();
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
  if (!Array.isArray(s.problems))     s.problems = [];
  if (!Array.isArray(s.sidebarTools)) s.sidebarTools = [{ id: 'save', type: 'save' }, { id: 'load', type: 'load' }];

  // Migrate each problem: old types fill_in/dropdown become unified problem
  // with one trailing blank carrying the prior config
  s.problems = s.problems.map(_migrateProblem);

  s.version = STATE_VERSION;
  return s;
}

function _migrateProblem(p) {
  if (!p || typeof p !== 'object') {
    return _newProblem();
  }

  // Already migrated (has blanks array and no legacy fields)
  if (Array.isArray(p.blanks) && (!p.type || p.type === 'problem')) {
    // Touch up missing flags
    if (typeof p.liveFeedback !== 'boolean') p.liveFeedback = true;
    if (typeof p.scoreOnly !== 'boolean')    p.scoreOnly = false;
    if (!p.id) p.id = _newId();
    if (typeof p.stem !== 'string') p.stem = '';
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
        randomize: p.randomize !== false
      }
    : {
        id: _newId(),
        kind: 'fill_in',
        answer: p.answer || '',
        tol: parseFloat(p.tol) || 0
      };

  return {
    id: p.id || _newId(),
    type: 'problem',
    stem: stem,
    blanks: [blank],
    liveFeedback: true,
    scoreOnly: false
  };
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
    // Inherit current global defaults at creation time
    liveFeedback: builderState && builderState.defaults ? builderState.defaults.liveFeedback : true,
    scoreOnly:    builderState && builderState.defaults ? builderState.defaults.scoreOnly    : false
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
      randomize: true
    };
  }
  return { id: _newId(), kind: 'fill_in', answer: '', tol: 0 };
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
// PROBLEM RENDERING — unified model with inline blanks
// =============================================================================
function renderProblems() {
  const container = document.getElementById('problemsContainer');
  if (!container) return;
  container.innerHTML = '';
  if (builderState.problems.length === 0) {
    container.innerHTML = '<div class="empty-hint">No problems yet. Click "Add problem" below.</div>';
    return;
  }
  builderState.problems.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'block-card';
    card.setAttribute('data-id', p.id);

    // ----- Header: number, feedback toggles, action buttons
    const header = document.createElement('div');
    header.className = 'block-header';
    header.innerHTML =
      '<span class="block-num">Problem ' + (idx + 1) + '</span>' +
      '<div class="block-actions">' +
        '<button class="bb-btn" title="Move up" onclick="moveProblem(\'' + p.id + '\', -1)">↑</button>' +
        '<button class="bb-btn" title="Move down" onclick="moveProblem(\'' + p.id + '\', 1)">↓</button>' +
        '<button class="bb-btn danger" title="Remove" onclick="removeProblem(\'' + p.id + '\')">✕</button>' +
      '</div>';
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

    // ----- Stem editor (plain textarea — supports {{blank:N}} tokens)
    const stemLabel = document.createElement('label');
    stemLabel.className = 'field-label';
    stemLabel.innerHTML = 'Problem stem';
    card.appendChild(stemLabel);

    const help = document.createElement('div');
    help.className = 'field-hint stem-help';
    help.innerHTML = 'Use <code>{{blank:1}}</code>, <code>{{blank:2}}</code>, etc. to place input fields inline. Wrap math in <code>\\(...\\)</code>. Example: <code>Vertical shift {{blank:1}}, horizontal shift {{blank:2}}.</code>';
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
    insertRow.appendChild(fillBtn);
    insertRow.appendChild(dropBtn);
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

    container.appendChild(card);
  });
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
  desmos_graphing:   { label: 'Graphing',   expressions: [], advanced: false, viewport: { xmin: -10, xmax: 10, ymin: -10, ymax: 10, locked: false }, hideExpressionList: false, hideSettings: false, polar: false, projectorMode: false },
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

    // Toggles
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
    'Use <code>## Section</code>, <code>### Subsection</code>, and ' +
    '<code>Label :: content</code> rows for two-column formula layouts. ' +
    'Wrap math in <code>\\(...\\)</code> (inline) or <code>\\[...\\]</code> (display). ' +
    'For bulk import from a PDF, expand the agent prompt below.';
  card.appendChild(contentHint);

  const ta = document.createElement('textarea');
  ta.className = 'text-input';
  ta.rows = 12;
  ta.style.fontFamily = 'var(--mono, monospace)';
  ta.style.fontSize = '12px';
  ta.value = t.content || '';
  ta.placeholder =
    '## Coordinate Geometry\n' +
    'Midpoint :: \\(M = \\left(\\dfrac{x_1+x_2}{2},\\ \\dfrac{y_1+y_2}{2}\\right)\\)\n' +
    'Slope :: \\(m = \\dfrac{y_2 - y_1}{x_2 - x_1}\\)\n' +
    'Distance :: \\(d = \\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}\\)\n';
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
'You are converting reference material (a formula sheet, study guide, or exemplar\n' +
'document) into the format used by an Algebra II activity builder\u2019s "Reference\n' +
'Sheet" sidebar tool. Read the source document I provide and output ONLY the\n' +
'formatted content \u2014 no preamble, no commentary, no code fences.\n' +
'\n' +
'FORMAT\n' +
'  ## Section Heading\n' +
'  ### Subsection Heading\n' +
'  Label :: content              \u2190 two-column row; separator is " :: " (space-colon-colon-space)\n' +
'  - bullet item\n' +
'  ---                            \u2190 horizontal rule\n' +
'  Plain paragraph                \u2190 any line that doesn\u2019t match the above\n' +
'\n' +
'  Math: wrap inline math in \\( ... \\) and display math in \\[ ... \\]. Use\n' +
'  standard LaTeX inside. Blank lines separate blocks.\n' +
'\n' +
'EXAMPLE\n' +
'  ## Coordinate Geometry\n' +
'  Midpoint :: \\(M = \\left(\\dfrac{x_1+x_2}{2},\\ \\dfrac{y_1+y_2}{2}\\right)\\)\n' +
'  Slope :: \\(m = \\dfrac{y_2 - y_1}{x_2 - x_1}\\)\n' +
'  Distance :: \\(d = \\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}\\)\n' +
'\n' +
'  ## Properties of Exponents\n' +
'  Product of Powers :: \\(a^m \\cdot a^n = a^{m+n}\\)\n' +
'  Power of a Power :: \\((a^m)^n = a^{mn}\\)\n' +
'  Quotient of Powers :: \\(\\dfrac{a^m}{a^n} = a^{m-n}\\)\n' +
'  Negative Exponent :: \\(a^{-n} = \\dfrac{1}{a^n}\\)\n' +
'  Rational Exponent :: \\(a^{m/n} = \\sqrt[n]{a^m}\\)\n' +
'\n' +
'GUIDELINES\n' +
'- Preserve the source\u2019s section structure. Use ## for major sections, ### only\n' +
'  for nested groupings within a section.\n' +
'- For named formulas (Midpoint, Slope, Quadratic Formula, etc.), use the\n' +
'  "Label :: \\(formula\\)" pattern \u2014 it renders as a clean two-column row.\n' +
'- For prose explanations or definitions without a clear label, write a plain\n' +
'  paragraph (no separator).\n' +
'- Use \\dfrac for stacked fractions, \\sqrt for roots, \\cdot for explicit\n' +
'  multiplication, ^ and _ for exponents and subscripts, \\pm for \u00b1, \\le \\ge\n' +
'  \\ne for \u2264 \u2265 \u2260, \\left( \\right) for auto-sized parens.\n' +
'- If the source has a side-by-side 2-column layout pairing different formula\n' +
'  groups (e.g. "Adding | Subtracting" matrices, "Standard Form | Vertex Form"),\n' +
'  put each group as its own ## or ### with rows underneath. Don\u2019t try to\n' +
'  reproduce the side-by-side visual.\n' +
'- Don\u2019t HTML-escape anything. The renderer handles escaping; just write the\n' +
'  text and LaTeX as a human would.\n' +
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

  // Compile problems
  const problemsHTML = builderState.problems.map((p, idx) => _compileProblem(p, idx)).join('\n');

  // Decide if Desmos API is needed
  const needsDesmos = builderState.sidebarTools.some(t =>
    t.type === 'desmos_graphing' || t.type === 'desmos_scientific' || t.type === 'desmos_geometry'
  );
  const desmosScript = needsDesmos
    ? '<script src="https://www.desmos.com/api/v1.10/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0faa6"><\/script>'
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
  html = html.replace(/\{\{PROBLEMS_HTML\}\}/g,           _slot(problemsHTML));
  html = html.replace(/\{\{SIDEBAR_TOOLS_JSON\}\}/g,      _slot(sidebarToolsJSON));
  html = html.replace(/\{\{ACTIVITY_SETTINGS_JSON\}\}/g,  _slot(settingsJSON));
  html = html.replace(/\{\{BUILDER_STATE_JSON\}\}/g,      _slot(stateJSON));

  return html;
}

function _compileProblem(p, idx) {
  const num = idx + 1;

  // Per-problem feedback flags become data-attrs on the cell
  const liveAttr  = (p.liveFeedback === false) ? ' data-live="0"' : ' data-live="1"';
  const scoreAttr = (p.scoreOnly === true)     ? ' data-score-only="1"' : '';

  // Build map of blank index (1-based as appears in stem) -> blank config
  const blanks = p.blanks || [];

  // Walk the stem, splitting on {{blank:N}} tokens. Render the prose around
  // them as KaTeX-aware text. Each token becomes the appropriate input.
  const stem = p.stem || '';
  const re = /\{\{blank:(\d+)\}\}/g;
  let lastIndex = 0;
  let parts = [];
  let m;
  while ((m = re.exec(stem)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ kind: 'text', value: stem.slice(lastIndex, m.index) });
    }
    parts.push({ kind: 'blank', n: parseInt(m[1], 10) });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < stem.length) {
    parts.push({ kind: 'text', value: stem.slice(lastIndex) });
  }

  // If there were no tokens at all, still render the stem prose
  if (parts.length === 0 && stem) {
    parts.push({ kind: 'text', value: stem });
  }

  // Compile each part. Text parts pass through (KaTeX delimiters are honored
  // by the renderer at runtime). Blank parts emit the matching input.
  const stemHTML = parts.map((part, i) => {
    if (part.kind === 'text') {
      return _compileStemText(part.value);
    }
    // Blank part — find the matching blank config (1-based index from token)
    const blank = blanks[part.n - 1];
    if (!blank) {
      return '<span class="missing-blank">[unconfigured blank ' + part.n + ']</span>';
    }
    const inputId = 'p' + num + '_b' + part.n;
    return _compileBlankInput(blank, inputId);
  }).join('');

  return [
    '<div class="problem-cell"' + liveAttr + scoreAttr + ' data-problem-num="' + num + '">',
    '  <div class="prob-num">PROBLEM ' + num + '</div>',
    '  <div class="prob-stem">' + stemHTML + '</div>',
    '  <span class="feedback prob-feedback" id="fb_p' + num + '"></span>',
    '</div>'
  ].join('\n');
}

// Compile a text segment of the stem. HTML-escape first so that < > & in the
// teacher's text cannot inject script tags or break HTML structure.
// KaTeX auto-render reads the DOM .textContent, which decodes HTML entities,
// so \( \) delimiters and any LaTeX inside them are unaffected by the escaping.
function _compileStemText(s) {
  return '<span class="stem-text">' + _esc(s) + '</span>';
}

// Compile a blank config into the appropriate inline input HTML.
function _compileBlankInput(blank, inputId) {
  if (blank.kind === 'fill_in') {
    return '<input type="text" class="ans-num inline-blank" id="' + inputId + '" data-correct="' + _escAttr(blank.answer || '') + '" data-tol="' + (blank.tol || 0) + '" autocomplete="off">';
  }

  // Dropdown blank
  const norm = _normalizeChoices(blank.choices || []);
  const correctChoice = norm[blank.correctChoice];
  const correctValue = correctChoice ? correctChoice.value : '';

  const options = norm
    .filter(c => c.value && String(c.value).trim())
    .map(c => {
      const display = (c.mode === 'math') ? '\\(' + c.value + '\\)' : _esc(c.value);
      return '<div class="md-option" data-value="' + _escAttr(c.value) + '" tabindex="0">' + display + '</div>';
    })
    .join('');

  const randomizeAttr = (blank.randomize === false) ? '' : ' data-randomize="1"';

  return [
    '<span class="inline-blank-wrap">',
      '<details class="md-dropdown"' + randomizeAttr + '>',
        '<summary class="md-trigger"><span class="md-trigger-label md-placeholder">&mdash; Select &mdash;</span></summary>',
        '<div class="md-options">' + options + '</div>',
      '</details>',
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
    iframe.srcdoc = compileActivity();
  }, 250);
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
// AUTH / PIN UNLOCK
// =============================================================================
function openPinModal() {
  document.getElementById('pinInput').value = '';
  document.getElementById('pinError').style.display = 'none';
  document.getElementById('pinBackdrop').classList.add('open');
  setTimeout(() => document.getElementById('pinInput').focus(), 80);
}
function closePinModal() {
  document.getElementById('pinBackdrop').classList.remove('open');
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
  closePinModal();
  _updateAuthUI(true);
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
  renderProblems();
  renderSidebarTools();
  refreshPreview();
}

// =============================================================================
// INIT
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadDraft();
  if (!builderState) builderState = _freshState();
  renderAll();
  console.log('[builder] ready. Draft loaded:', !!localStorage.getItem(DRAFT_STORAGE_KEY));
});
