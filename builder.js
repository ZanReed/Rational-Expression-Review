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
let builderState = {
  version: 1,
  title: 'New Activity',
  slug: 'new_activity',
  webhook: localStorage.getItem('appsScriptURL') || '',
  problems: [],
  sidebarTools: [
    { id: 'save', type: 'save' },
    { id: 'load', type: 'load' }
  ],
  filename: 'activities/new_activity.html',
  createdAt: null,
  updatedAt: null
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

function saveDraft() {
  builderState.updatedAt = new Date().toISOString();
  try { localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(builderState)); }
  catch (e) { console.warn('Draft save failed:', e); }
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw) builderState = JSON.parse(raw);
  } catch (e) { console.warn('Draft load failed:', e); }
}
function clearDraft() {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  builderState = {
    version: 1,
    title: 'New Activity',
    slug: 'new_activity',
    webhook: localStorage.getItem('appsScriptURL') || '',
    problems: [],
    sidebarTools: [{ id: 'save', type: 'save' }, { id: 'load', type: 'load' }],
    filename: 'activities/new_activity.html',
    createdAt: null,
    updatedAt: null
  };
  renderAll();
}

// =============================================================================
// PROBLEM MANAGEMENT
// =============================================================================
function addProblem(type) {
  const isDropdown = (type === 'dropdown');
  const p = {
    id: _newId(),
    type: type || 'fill_in',
    stem: '',
    answer: '',
    tol: 0,
    choices: isDropdown ? [
      { mode: 'text', value: '' },
      { mode: 'text', value: '' },
      { mode: 'text', value: '' },
      { mode: 'text', value: '' }
    ] : null,
    correctChoice: isDropdown ? 0 : null,
    randomize: isDropdown ? true : null
  };
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

function renderProblems() {
  const container = document.getElementById('problemsContainer');
  if (!container) return;
  container.innerHTML = '';
  if (builderState.problems.length === 0) {
    container.innerHTML = '<div class="empty-hint">No problems yet. Click an "Add problem" button below.</div>';
    return;
  }
  builderState.problems.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'block-card';
    card.setAttribute('data-id', p.id);

    const header = document.createElement('div');
    header.className = 'block-header';
    header.innerHTML =
      '<span class="block-num">Problem ' + (idx + 1) + ' &middot; <em>' + _problemTypeLabel(p.type) + '</em></span>' +
      '<div class="block-actions">' +
        '<button class="bb-btn" title="Move up" onclick="moveProblem(\'' + p.id + '\', -1)">↑</button>' +
        '<button class="bb-btn" title="Move down" onclick="moveProblem(\'' + p.id + '\', 1)">↓</button>' +
        '<button class="bb-btn danger" title="Remove" onclick="removeProblem(\'' + p.id + '\')">✕</button>' +
      '</div>';
    card.appendChild(header);

    // Stem (MathLive)
    const stemLabel = document.createElement('label');
    stemLabel.className = 'field-label';
    stemLabel.textContent = 'Problem stem (math input)';
    card.appendChild(stemLabel);

    const mf = document.createElement('math-field');
    mf.className = 'mf-input';
    mf.setAttribute('virtual-keyboard-mode', 'manual');
    mf.id = 'mf_' + p.id;
    mf.value = p.stem || '';
    mf.addEventListener('input', () => updateProblem(p.id, 'stem', mf.getValue('latex-expanded')));
    card.appendChild(mf);

    // Type-specific fields
    if (p.type === 'fill_in') {
      _renderFillInFields(card, p);
    } else if (p.type === 'dropdown') {
      _renderDropdownFields(card, p);
    }

    container.appendChild(card);
  });
}

function _problemTypeLabel(t) {
  if (t === 'fill_in') return 'Fill in';
  if (t === 'dropdown') return 'Dropdown';
  return t;
}

function _renderFillInFields(card, p) {
  const ansLabel = document.createElement('label');
  ansLabel.className = 'field-label';
  ansLabel.textContent = 'Correct answer';
  card.appendChild(ansLabel);

  const ans = document.createElement('input');
  ans.type = 'text';
  ans.className = 'text-input';
  ans.value = p.answer || '';
  ans.placeholder = 'e.g. 12 or x+3';
  ans.oninput = () => updateProblem(p.id, 'answer', ans.value);
  card.appendChild(ans);

  const adv = document.createElement('details');
  adv.className = 'advanced';
  adv.innerHTML = '<summary>Advanced</summary>';
  const tolLabel = document.createElement('label');
  tolLabel.className = 'field-label';
  tolLabel.style.marginTop = '8px';
  tolLabel.textContent = 'Numeric tolerance (± value, leave 0 for exact match)';
  adv.appendChild(tolLabel);
  const tol = document.createElement('input');
  tol.type = 'number';
  tol.step = '0.01';
  tol.className = 'text-input';
  tol.value = p.tol || 0;
  tol.oninput = () => updateProblem(p.id, 'tol', parseFloat(tol.value) || 0);
  adv.appendChild(tol);
  card.appendChild(adv);
}

function _renderDropdownFields(card, p) {
  // --- Randomize toggle (above choices) ---
  const randRow = document.createElement('div');
  randRow.className = 'check-row';
  randRow.style.marginBottom = '10px';
  randRow.innerHTML = '<label><input type="checkbox" ' + (p.randomize !== false ? 'checked' : '') + '> Randomize choice order at runtime</label>';
  randRow.querySelector('input').onchange = (e) => updateProblem(p.id, 'randomize', e.target.checked);
  card.appendChild(randRow);

  // --- Choices label ---
  const choicesLabel = document.createElement('label');
  choicesLabel.className = 'field-label';
  choicesLabel.textContent = 'Choices (select the correct one)';
  card.appendChild(choicesLabel);

  // --- Normalize choices: tolerate old string-array format from prior drafts ---
  const choices = (p.choices || []).map(c => {
    if (typeof c === 'string') return { mode: 'text', value: c };
    return c || { mode: 'text', value: '' };
  });

  // --- Render each choice row ---
  choices.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'choice-row';

    // Correct-answer radio
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'correct_' + p.id;
    radio.checked = (p.correctChoice === i);
    radio.onchange = () => updateProblem(p.id, 'correctChoice', i);
    row.appendChild(radio);

    // Mode toggle pill (math|text)
    const modePill = document.createElement('button');
    modePill.type = 'button';
    modePill.className = 'mode-pill mode-' + c.mode;
    modePill.textContent = c.mode;
    modePill.title = 'Click to toggle math/text';
    modePill.onclick = () => {
      const newChoices = choices.map((cc, j) => j === i ? { mode: cc.mode === 'math' ? 'text' : 'math', value: cc.value } : cc);
      updateProblem(p.id, 'choices', newChoices);
      renderProblems(); // re-render to swap input type
    };
    row.appendChild(modePill);

    // Choice input — math-field for math mode, text input for text mode
    let inp;
    if (c.mode === 'math') {
      inp = document.createElement('math-field');
      inp.className = 'mf-choice';
      inp.setAttribute('virtual-keyboard-mode', 'manual');
      inp.value = c.value || '';
      inp.addEventListener('input', () => {
        const newChoices = choices.map((cc, j) => j === i ? { mode: 'math', value: inp.getValue('latex-expanded') } : cc);
        updateProblem(p.id, 'choices', newChoices);
      });
    } else {
      inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'text-input';
      inp.value = c.value || '';
      inp.placeholder = 'Choice ' + String.fromCharCode(65 + i);
      inp.oninput = () => {
        const newChoices = choices.map((cc, j) => j === i ? { mode: 'text', value: inp.value } : cc);
        updateProblem(p.id, 'choices', newChoices);
      };
    }
    row.appendChild(inp);

    card.appendChild(row);
  });
}

// =============================================================================
// SIDEBAR TOOLS MANAGEMENT
// =============================================================================
const TOOL_DEFAULTS = {
  video:             { label: 'Video',      embedUrl: '' },
  desmos_graphing:   { label: 'Graphing',   expressions: [], advanced: false, viewport: { xmin: -10, xmax: 10, ymin: -10, ymax: 10, locked: false }, hideExpressionList: false, hideSettings: false, polar: false, projectorMode: false },
  desmos_scientific: { label: 'Scientific Calc' },
  desmos_geometry:   { label: 'Geometry',   advanced: false }
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
    desmos_geometry: 'Desmos — Geometry'
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

  // Sidebar tools JSON (runtime config — strip nothing, all fields used downstream)
  const sidebarToolsJSON = JSON.stringify(builderState.sidebarTools);

  // Full builder state JSON (round-trip seed)
  const stateJSON = JSON.stringify({ ...builderState, savedAt: new Date().toISOString() });

  // Slot replacement
  let html = window.WORKSHEET_TEMPLATE;
  html = html.replace(/\{\{TITLE\}\}/g,            _esc(builderState.title));
  html = html.replace(/\{\{ACTIVITY_SLUG\}\}/g,    builderState.slug);
  html = html.replace(/\{\{WEBHOOK_URL\}\}/g,      _esc(builderState.webhook));
  html = html.replace(/\{\{GOOGLE_CLIENT_ID\}\}/g, GOOGLE_CLIENT_ID);
  html = html.replace(/\{\{DESMOS_API_SCRIPT\}\}/g, desmosScript);
  html = html.replace(/\{\{PROBLEMS_HTML\}\}/g,    problemsHTML);
  html = html.replace(/\{\{SIDEBAR_TOOLS_JSON\}\}/g, sidebarToolsJSON);
  html = html.replace(/\{\{BUILDER_STATE_JSON\}\}/g, stateJSON);

  return html;
}

function _compileProblem(p, idx) {
  const num = idx + 1;
  const stemLatex = p.stem ? '\\(' + p.stem + '\\)' : '<em>(empty)</em>';
  const inputId = 'p' + num;

  if (p.type === 'fill_in') {
    return [
      '<div class="problem-cell">',
      '  <div class="prob-num">PROBLEM ' + num + '</div>',
      '  <div class="prob-stem">' + stemLatex + '</div>',
      '  <input type="text" class="ans-num" id="' + inputId + '" data-correct="' + _escAttr(p.answer || '') + '" data-tol="' + (p.tol || 0) + '" autocomplete="off">',
      '  <span class="feedback" id="fb_' + inputId + '"></span>',
      '</div>'
    ].join('\n');
  }

  if (p.type === 'dropdown') {
    // Normalize choices for tolerance with old drafts
    const norm = (p.choices || []).map(c => typeof c === 'string' ? { mode: 'text', value: c } : (c || { mode: 'text', value: '' }));

    // Determine the correct choice's value (used for data-correct on hidden input)
    const correctChoice = norm[p.correctChoice];
    const correctValue = correctChoice ? correctChoice.value : '';

    // Build options HTML — math wrapped in \( \) for KaTeX, text rendered as-is
    const options = norm
      .filter(c => c.value && String(c.value).trim())
      .map(c => {
        const display = (c.mode === 'math')
          ? '\\(' + c.value + '\\)'
          : _esc(c.value);
        return '<div class="md-option" data-value="' + _escAttr(c.value) + '" tabindex="0">' + display + '</div>';
      })
      .join('\n      ');

    const randomizeAttr = (p.randomize === false) ? '' : ' data-randomize="1"';

    return [
      '<div class="problem-cell">',
      '  <div class="prob-num">PROBLEM ' + num + '</div>',
      '  <div class="prob-stem">' + stemLatex + '</div>',
      '  <details class="md-dropdown"' + randomizeAttr + '>',
      '    <summary class="md-trigger"><span class="md-trigger-label md-placeholder">&mdash; Select &mdash;</span></summary>',
      '    <div class="md-options">',
      '      ' + options,
      '    </div>',
      '  </details>',
      '  <input type="hidden" class="ans-num" id="' + inputId + '" data-correct="' + _escAttr(correctValue) + '">',
      '  <span class="feedback" id="fb_' + inputId + '"></span>',
      '</div>'
    ].join('\n');
  }

  return '<div class="problem-cell"><div class="prob-stem">Unknown problem type</div></div>';
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
    document.getElementById('pinError').textContent = 'PIN correct, but no token blob in localStorage. Set up your token in index.html first.';
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
  renderProblems();
  renderSidebarTools();
  refreshPreview();
}

// =============================================================================
// INIT
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadDraft();
  renderAll();

  // Handlers wired via builder.html onclick — no global setup needed beyond render
  console.log('[builder] ready. Draft loaded:', !!localStorage.getItem(DRAFT_STORAGE_KEY));
});
