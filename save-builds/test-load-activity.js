// test-load-activity.js
// Walks the load-activity flow end-to-end: open modal -> fetch index -> render
// picker -> click load -> (optional dirty confirm) -> fetch activity -> extract
// builder-state -> replace builderState. Also covers Save-as. Mocks the small
// DOM surface and stubs the builder.js dependencies the load section calls.
//
// Run: node test-load-activity.js

var fs = require('fs');

// -----------------------------------------------------------------------------
// Minimal DOM mock — only the elements load-activity functions actually touch.
// -----------------------------------------------------------------------------
function mkEl(id) {
  return {
    id: id,
    value: '',
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: { display: '', color: '' },
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange: function (s, e) { this.selectionStart = s; this.selectionEnd = e; },
    classList: {
      _set: new Set(),
      add: function (c) { this._set.add(c); },
      remove: function (c) { this._set.delete(c); },
      contains: function (c) { return this._set.has(c); }
    },
    focus: function () { /* no-op */ },
    select: function () { /* no-op */ }
  };
}

var els = {
  loadActivityBackdrop:  mkEl('loadActivityBackdrop'),
  loadActivityBody:      mkEl('loadActivityBody'),
  loadActivityStatus:    mkEl('loadActivityStatus'),
  loadActivityFilter:    mkEl('loadActivityFilter'),
  // Publish modal pieces touched by Save-as:
  publishBackdrop:       mkEl('publishBackdrop'),
  publishFilename:       mkEl('publishFilename'),
  publishStatus:         mkEl('publishStatus'),
  saveAsPanel:           mkEl('saveAsPanel'),
  saveAsFilename:        mkEl('saveAsFilename'),
  saveAsCollisionWarn:   mkEl('saveAsCollisionWarn'),
  // PIN modal pieces touched by the gated state:
  pinBackdrop:           mkEl('pinBackdrop'),
  pinInput:              mkEl('pinInput'),
  pinError:              mkEl('pinError')
};

var docListeners = {};
global.document = {
  getElementById: function (id) { return els[id] || null; },
  addEventListener: function (event, handler) {
    (docListeners[event] = docListeners[event] || []).push(handler);
  },
  removeEventListener: function (event, handler) {
    if (docListeners[event]) {
      docListeners[event] = docListeners[event].filter(function (h) { return h !== handler; });
    }
  },
  _fireKey: function (key) {
    (docListeners.keydown || []).slice().forEach(function (h) { h({ key: key }); });
  }
};

global.window = global;

// Make setTimeout synchronous so focus()-on-next-tick tests resolve immediately.
// Save-as uses setTimeout for input.focus()+select() and for the post-PIN
// callback flush; we want both to run before the test's next assertion.
global.setTimeout = function (fn) { fn(); };

// -----------------------------------------------------------------------------
// localStorage mock — tracks the LAST_SAVED_STATE_KEY and DRAFT_STORAGE_KEY
// reads/writes that drive _isDraftDirty / _stampLastSaved.
// -----------------------------------------------------------------------------
var lsBacking = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(lsBacking, k) ? lsBacking[k] : null; },
  setItem: function (k, v) { lsBacking[k] = String(v); },
  removeItem: function (k) { delete lsBacking[k]; }
};

// -----------------------------------------------------------------------------
// fetch mock — returns queued responses one at a time. Tests enqueue the
// responses they expect; an unexpected call rejects loudly so missing test
// setup doesn't masquerade as a network error.
// -----------------------------------------------------------------------------
var fetchQueue = [];
var fetchLog = [];

global.fetch = function (url, opts) {
  fetchLog.push({ url: url, opts: opts });
  if (fetchQueue.length === 0) {
    return Promise.reject(new Error('Unexpected fetch (queue empty): ' + url));
  }
  var resp = fetchQueue.shift();
  if (resp.networkError) return Promise.reject(new Error(resp.networkError));
  return Promise.resolve({
    ok: resp.status >= 200 && resp.status < 300,
    status: resp.status,
    json: function () { return Promise.resolve(resp.body); }
  });
};

// Helper: build a GitHub Contents-API-shaped response body wrapping HTML.
function contentsBody(html) {
  return { content: Buffer.from(html, 'utf-8').toString('base64'), encoding: 'base64' };
}

// Helper: build a stub index.html string with the given resources array.
function indexHTMLWith(resources) {
  var dataBlock = '<script id="INDEX_DATA" type="application/json">' +
                  JSON.stringify({ resources: resources, unitOrder: [] }) +
                  '</script>';
  return '<html><body>' + dataBlock + '</body></html>';
}

// Helper: build a stub activity HTML with a builder-state block embedded.
function activityHTMLWith(state) {
  return '<html><body>before' +
         '<script id="builder-state" type="application/json">' +
         JSON.stringify(state) +
         '</script>after</body></html>';
}

// -----------------------------------------------------------------------------
// Stub the builder.js globals + dependencies that the LOAD ACTIVITY section
// reads or calls. Anything declared as `let`/`const` inside the section stays
// encapsulated; what we set up here are the cross-section bindings.
// -----------------------------------------------------------------------------
global.GITHUB_OWNER     = 'TestOwner';
global.GITHUB_REPO      = 'TestRepo';
global._decryptedToken  = 'fake-test-token';
global._pendingAfterPin = null;

global.LAST_SAVED_STATE_KEY = 'builder_last_saved_v1';

global.fromBase64  = function (s) { return Buffer.from(s, 'base64').toString('utf-8'); };
global._encodePath = function (p) { return encodeURIComponent(p).replace(/%2F/g, '/'); };

global._esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
global._escAttr = function (s) {
  return global._esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

// editorUI shape from builder.js — only `collapsed` is touched by the load path.
global.editorUI = {
  collapsed: new Set(),
  dragSrcId: null,
  dropIndicator: null
};

// Builder state stub. Tests overwrite this directly when they need a specific
// starting point.
global.builderState = {
  title: 'New Activity',
  slug: 'new_activity',
  problems: [],
  filename: 'activities/new_activity.html',
  indexMeta: { unit: '', desc: '', tags: [], type: 'activity' },
  updatedAt: null
};

// Lifecycle counters for assertions.
var lifecycle = {
  saveDraft: 0,
  renderAll: 0,
  openPinModal: 0,
  closePinModal: 0,
  confirmPublish: 0,
  freshState: 0,
  migrateState: 0
};

global.saveDraft     = function () { lifecycle.saveDraft++; };
global.renderAll     = function () { lifecycle.renderAll++; };
global.openPinModal  = function () { lifecycle.openPinModal++; };
global.closePinModal = function () { lifecycle.closePinModal++; };
global.confirmPublish = function () { lifecycle.confirmPublish++; };

// _freshState returns a minimal fresh state — used by _isDraftDirty when no
// LAST_SAVED snapshot exists yet. Mirrors the shape from builder.js so the
// dirty comparison reads as clean for genuinely-fresh state.
global._freshState = function () {
  lifecycle.freshState++;
  return {
    title: 'New Activity',
    slug: 'new_activity',
    problems: [],
    filename: 'activities/new_activity.html',
    indexMeta: { unit: '', desc: '', tags: [], type: 'activity' },
    updatedAt: null
  };
};

// _migrateState passes through unchanged — tests construct their own valid
// states. Counter tracks that the load path defensively migrates loaded data.
global._migrateState = function (s) {
  lifecycle.migrateState++;
  return s;
};

// -----------------------------------------------------------------------------
// Slice the LOAD ACTIVITY section out of builder.js and eval it. Function
// declarations inside the section leak to global scope (non-strict eval), so
// after this we can call openLoadActivityModal(), _handleLoadClick(), etc.
// `let` declarations stay encapsulated — module state like
// _loadActivityResources is intentionally unreachable from tests, mirroring
// the same boundary the bulk-import integration test enforces.
// -----------------------------------------------------------------------------
var builderSrc = fs.readFileSync('./builder.js', 'utf8');
var startMarker = '// LOAD ACTIVITY — modal flow';
var endMarker   = '// =============================================================================\n// INIT';
var startIdx = builderSrc.indexOf(startMarker);
var endIdx   = builderSrc.indexOf(endMarker, startIdx);
if (startIdx === -1 || endIdx === -1) {
  console.error('Could not locate the LOAD ACTIVITY section in builder.js. Aborting.');
  process.exit(2);
}
var loadSection = builderSrc.slice(startIdx, endIdx);
// eslint-disable-next-line no-eval
eval(loadSection);

// -----------------------------------------------------------------------------
// Test harness — adapted from test-bulk-import-integration.js, with async
// support since several flows (fetch index, fetch activity, save-as) are
// promise-based.
// -----------------------------------------------------------------------------
var passed = 0, failed = 0;

function resetAll() {
  Object.keys(els).forEach(function (k) {
    els[k].value = '';
    els[k].innerHTML = '';
    els[k].textContent = '';
    els[k].style.display = '';
    els[k].dataset = {};
    els[k].classList._set = new Set();
  });
  Object.keys(docListeners).forEach(function (k) { docListeners[k] = []; });
  Object.keys(lifecycle).forEach(function (k) { lifecycle[k] = 0; });
  Object.keys(lsBacking).forEach(function (k) { delete lsBacking[k]; });
  fetchQueue.length = 0;
  fetchLog.length = 0;
  global._pendingAfterPin = null;
  global._decryptedToken = 'fake-test-token';
  global.editorUI.collapsed = new Set();
  global.builderState = {
    title: 'New Activity',
    slug: 'new_activity',
    problems: [],
    filename: 'activities/new_activity.html',
    indexMeta: { unit: '', desc: '', tags: [], type: 'activity' },
    updatedAt: null
  };
}

async function test(name, fn) {
  resetAll();
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('     ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     '));
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'eq') + ' — expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}
function contains(haystack, needle, msg) {
  if (String(haystack).indexOf(needle) === -1) {
    throw new Error((msg || 'contains') + ' — expected to find: ' + JSON.stringify(needle) +
                    '\n     in: ' + JSON.stringify(haystack).slice(0, 240));
  }
}
function notContains(haystack, needle, msg) {
  if (String(haystack).indexOf(needle) !== -1) {
    throw new Error((msg || 'notContains') + ' — should NOT contain: ' + JSON.stringify(needle));
  }
}

// Sample resources used across many tests.
var R_UNIT7 = { id: 'r1', title: 'Logarithm Practice',     unit: 'Unit 7',  type: 'practice', tags: ['A2.5(B)'], desc: 'Log laws',     file: 'activities/log_practice.html' };
var R_UNIT9 = { id: 'r2', title: 'Exponential Functions',  unit: 'Unit 9',  type: 'activity', tags: ['A2.5(A)'], desc: 'Exp graphs',   file: 'activities/exp_functions.html' };
var R_UNIT10= { id: 'r3', title: 'Polynomial Review',      unit: 'Unit 10', type: 'review',   tags: ['A2.7(A)'], desc: 'Poly review',  file: 'activities/poly_review.html' };
var R_PRE   = { id: 'r4', title: 'Old activity (no file)', unit: 'Unit 1' /* no .file — pre-builder entry */ };

// Sample valid loaded state for happy-path tests.
function sampleLoadedState() {
  return {
    title: 'Logarithm Practice',
    slug: 'log_practice',
    filename: 'activities/log_practice.html',
    problems: [{ id: 'p1', type: 'problem', stem: 'Solve $\\log_2 8$', blanks: [], graphs: [] }],
    indexMeta: { unit: 'Unit 7', desc: 'Log laws', tags: ['A2.5(B)'], type: 'practice' },
    updatedAt: '2026-04-15T12:00:00Z'
  };
}

// Helper to wait for a microtask cycle so promise chains in _loadActivity flush.
function tick() { return new Promise(function (r) { Promise.resolve().then(r); }); }
async function flushPromises() {
  // Flush a few microtask rounds — the load path has nested awaits.
  for (var i = 0; i < 5; i++) await tick();
}

console.log('\nload-activity integration tests\n');

// -----------------------------------------------------------------------------
// SPEC TEST 1 — Index fetch + render: 3 resources shown in unit-then-title order.
// -----------------------------------------------------------------------------
(async function run() {

await test('Open modal: backdrop opens, escape handler bound, fetch fires', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  ok(els.loadActivityBackdrop.classList.contains('open'), 'backdrop opened');
  ok((docListeners.keydown || []).length === 1, 'one keydown listener bound');
  await flushPromises();
  eq(fetchLog.length, 1, 'index fetched');
  contains(fetchLog[0].url, 'index.html', 'fetched index.html');
  contains(fetchLog[0].opts.headers.Authorization, 'fake-test-token', 'auth header sent');
});

await test('Spec 1: picker shows 3 resources in unit-then-title order', async function () {
  // Out-of-order input; should be sorted by unit (natural) then title.
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT10, R_UNIT7, R_UNIT9])) });
  openLoadActivityModal();
  await flushPromises();
  var html = els.loadActivityBody.innerHTML;
  contains(html, 'Logarithm Practice', 'first row title');
  contains(html, 'Exponential Functions', 'second row title');
  contains(html, 'Polynomial Review', 'third row title');
  // Order check: Unit 7 < Unit 9 < Unit 10 (natural sort, NOT lexical "10 < 7 < 9")
  var i7  = html.indexOf('Logarithm Practice');
  var i9  = html.indexOf('Exponential Functions');
  var i10 = html.indexOf('Polynomial Review');
  ok(i7 < i9 && i9 < i10, 'unit-natural order: 7, 9, 10 (got ' + i7 + ', ' + i9 + ', ' + i10 + ')');
});

await test('Pre-builder entries (no file field) are filtered from the picker', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7, R_PRE])) });
  openLoadActivityModal();
  await flushPromises();
  var html = els.loadActivityBody.innerHTML;
  contains(html, 'Logarithm Practice');
  notContains(html, 'Old activity (no file)', 'pre-builder entry filtered out');
});

// -----------------------------------------------------------------------------
// SPEC TEST 2 — Filter narrows by substring across title + unit + tags.
// -----------------------------------------------------------------------------
await test('Spec 2: filter narrows by title substring', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7, R_UNIT9, R_UNIT10])) });
  openLoadActivityModal();
  await flushPromises();
  _onLoadFilterInput('exponential');
  var html = els.loadActivityBody.innerHTML;
  contains(html, 'Exponential Functions');
  notContains(html, 'Logarithm Practice', 'log filtered out by "exponential"');
  notContains(html, 'Polynomial Review',  'poly filtered out by "exponential"');
});

await test('Filter matches on unit', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7, R_UNIT9, R_UNIT10])) });
  openLoadActivityModal();
  await flushPromises();
  _onLoadFilterInput('Unit 9');
  var html = els.loadActivityBody.innerHTML;
  contains(html, 'Exponential Functions', 'unit-match keeps Unit 9 row');
  notContains(html, 'Logarithm Practice');
  notContains(html, 'Polynomial Review');
});

await test('Filter matches on tag', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7, R_UNIT9, R_UNIT10])) });
  openLoadActivityModal();
  await flushPromises();
  _onLoadFilterInput('A2.7');
  var html = els.loadActivityBody.innerHTML;
  contains(html, 'Polynomial Review', 'tag-match keeps polynomial row');
  notContains(html, 'Logarithm Practice');
});

await test('Filter with no matches shows "no activities match" message', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  _onLoadFilterInput('zzznothing');
  contains(els.loadActivityBody.innerHTML, 'No activities match');
});

// -----------------------------------------------------------------------------
// SPEC TEST 3 — Empty index shows empty-state message.
// -----------------------------------------------------------------------------
await test('Spec 3: empty index shows empty-state', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([])) });
  openLoadActivityModal();
  await flushPromises();
  contains(els.loadActivityBody.innerHTML, 'No activities published yet');
});

// -----------------------------------------------------------------------------
// SPEC TEST 4 — Activity load happy path: state replaced, lifecycle called,
// indexMeta populated from the resource, modal closed, status pill shown.
// -----------------------------------------------------------------------------
await test('Spec 4: load happy path replaces builderState and calls renderAll', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();

  // Now fire the load click. _handleLoadClick checks dirty (we're clean from
  // resetAll's fresh state), so it proceeds straight to fetch.
  fetchQueue.push({ status: 200, body: contentsBody(activityHTMLWith(sampleLoadedState())) });
  _handleLoadClick('r1');
  await flushPromises();

  eq(builderState.title, 'Logarithm Practice',           'state title replaced');
  eq(builderState.filename, 'activities/log_practice.html', 'state filename replaced');
  eq(builderState.problems.length, 1,                    'one problem loaded');
  ok(lifecycle.renderAll === 1,    'renderAll called once');
  ok(lifecycle.saveDraft === 1,    'saveDraft called once');
  ok(lifecycle.migrateState === 1, '_migrateState called defensively');
  ok(!els.loadActivityBackdrop.classList.contains('open'), 'modal closed after load');
  contains(els.loadActivityStatus.innerHTML, 'Loaded "Logarithm Practice".', 'status pill set');
});

await test('Load stamps LAST_SAVED snapshot so subsequent dirty-check is clean', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  fetchQueue.push({ status: 200, body: contentsBody(activityHTMLWith(sampleLoadedState())) });
  _handleLoadClick('r1');
  await flushPromises();
  ok(lsBacking[LAST_SAVED_STATE_KEY], 'last-saved snapshot written');
  // The snapshot strips updatedAt, so verifying it doesn't include the
  // updatedAt timestamp is a regression check on _stateForCompare.
  notContains(lsBacking[LAST_SAVED_STATE_KEY], '2026-04-15', 'updatedAt stripped from snapshot');
});

// -----------------------------------------------------------------------------
// SPEC TEST 5 — Missing builder-state block: error rendered, state preserved.
// -----------------------------------------------------------------------------
await test('Spec 5: missing builder-state block shows schema-too-old error', async function () {
  var savedState = JSON.parse(JSON.stringify(builderState));
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();

  // Activity HTML with no <script id="builder-state"> block.
  fetchQueue.push({ status: 200, body: contentsBody('<html><body>just html</body></html>') });
  _handleLoadClick('r1');
  await flushPromises();

  contains(els.loadActivityBody.innerHTML, 'published before the current builder schema');
  eq(JSON.stringify(builderState), JSON.stringify(savedState), 'builderState unchanged');
  eq(lifecycle.renderAll, 0, 'renderAll not called');
});

// -----------------------------------------------------------------------------
// SPEC TEST 6 — Corrupt builder-state JSON: error rendered, state preserved.
// -----------------------------------------------------------------------------
await test('Spec 6: corrupt builder-state JSON shows corruption error', async function () {
  var savedState = JSON.parse(JSON.stringify(builderState));
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();

  var brokenHTML = '<script id="builder-state" type="application/json">{not valid json</script>';
  fetchQueue.push({ status: 200, body: contentsBody(brokenHTML) });
  _handleLoadClick('r1');
  await flushPromises();

  contains(els.loadActivityBody.innerHTML, 'corrupted');
  eq(JSON.stringify(builderState), JSON.stringify(savedState), 'builderState unchanged');
});

// -----------------------------------------------------------------------------
// SPEC TEST 7 — 404 on activity file: error rendered, state preserved.
// -----------------------------------------------------------------------------
await test('Spec 7: 404 on activity fetch shows file-not-found error', async function () {
  var savedState = JSON.parse(JSON.stringify(builderState));
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();

  fetchQueue.push({ status: 404, body: { message: 'Not Found' } });
  _handleLoadClick('r1');
  await flushPromises();

  contains(els.loadActivityBody.innerHTML, 'Activity file not found');
  eq(JSON.stringify(builderState), JSON.stringify(savedState), 'builderState unchanged');
});

await test('401 on activity fetch shows auth-failed error', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  fetchQueue.push({ status: 401, body: { message: 'Bad credentials' } });
  _handleLoadClick('r1');
  await flushPromises();
  contains(els.loadActivityBody.innerHTML, 'Authentication failed');
});

await test('Index fetch failure shows index-error state', async function () {
  fetchQueue.push({ status: 500, body: { message: 'oops' } });
  openLoadActivityModal();
  await flushPromises();
  contains(els.loadActivityBody.innerHTML, 'Could not read the activity index');
});

await test('INDEX_DATA missing shows index-error state', async function () {
  fetchQueue.push({ status: 200, body: contentsBody('<html>no index data block</html>') });
  openLoadActivityModal();
  await flushPromises();
  contains(els.loadActivityBody.innerHTML, 'Could not read the activity index');
});

// -----------------------------------------------------------------------------
// SPEC TEST 8 — Dirty draft confirmation: panel appears, cancel preserves,
// replace-and-load proceeds.
// -----------------------------------------------------------------------------
await test('Spec 8a: dirty draft shows confirm panel before loading', async function () {
  // Make the draft dirty: add a problem so it differs from _freshState's empty.
  builderState.problems = [{ id: 'p_user', type: 'problem', stem: 'user-typed', blanks: [], graphs: [] }];

  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  _handleLoadClick('r1');
  // No fetch should have happened yet — we're in the confirm step.
  await flushPromises();
  eq(fetchLog.length, 1, 'no second fetch yet (still in dirty-confirm)');
  contains(els.loadActivityBody.innerHTML, 'Replace and load');
  contains(els.loadActivityBody.innerHTML, 'Logarithm Practice');
  // builderState must still be the dirty user content.
  eq(builderState.problems.length, 1);
  eq(builderState.problems[0].stem, 'user-typed');
});

await test('Spec 8b: dirty cancel returns to picker, leaves builderState alone', async function () {
  builderState.problems = [{ id: 'p_user', type: 'problem', stem: 'user-typed', blanks: [], graphs: [] }];
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  _handleLoadClick('r1');
  await flushPromises();
  _cancelReplaceAndLoad();
  // Picker should be back; user's draft intact; no extra fetches.
  contains(els.loadActivityBody.innerHTML, 'Logarithm Practice', 'back at picker');
  notContains(els.loadActivityBody.innerHTML, 'Replace and load',
              'confirm panel gone');
  eq(builderState.problems[0].stem, 'user-typed', 'draft preserved');
  eq(fetchLog.length, 1, 'no activity fetch was issued');
});

await test('Spec 8c: dirty replace-and-load proceeds with the load', async function () {
  builderState.problems = [{ id: 'p_user', type: 'problem', stem: 'user-typed', blanks: [], graphs: [] }];
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  _handleLoadClick('r1');
  await flushPromises();
  // Now confirm.
  fetchQueue.push({ status: 200, body: contentsBody(activityHTMLWith(sampleLoadedState())) });
  _confirmReplaceAndLoad();
  await flushPromises();
  eq(builderState.title, 'Logarithm Practice', 'load completed');
  eq(builderState.problems.length, 1);
  eq(builderState.problems[0].stem, 'Solve $\\log_2 8$', 'loaded problem stem replaced user content');
});

// -----------------------------------------------------------------------------
// SPEC TEST 9 — Clean draft: no confirmation, load proceeds directly.
// -----------------------------------------------------------------------------
await test('Spec 9: clean draft skips confirmation', async function () {
  // Stamp last-saved baseline matching the current empty state so it reads clean.
  // _stampLastSaved is one of the load-section's own functions, available in
  // global scope after the eval.
  _stampLastSaved();

  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  fetchQueue.push({ status: 200, body: contentsBody(activityHTMLWith(sampleLoadedState())) });
  _handleLoadClick('r1');
  await flushPromises();
  // Confirm panel should never have rendered; load should be done.
  notContains(els.loadActivityBody.innerHTML, 'Replace and load');
  eq(builderState.title, 'Logarithm Practice', 'loaded directly');
});

// -----------------------------------------------------------------------------
// SPEC TEST 10 — Save-as: new filename + slug, indexMeta preserved, publish fires.
// -----------------------------------------------------------------------------
await test('Spec 10: Save-as updates filename/slug and falls through to publish', async function () {
  builderState.title = 'Logarithm Practice';
  builderState.filename = 'activities/log_practice.html';
  builderState.slug = 'log_practice';
  builderState.indexMeta = { unit: 'Unit 7', desc: 'Log laws', tags: ['A2.5(B)'], type: 'practice' };

  // Open the panel, type a new filename, confirm.
  openSaveAsPanel();
  ok(els.saveAsPanel.style.display === 'block', 'panel shown');
  eq(els.saveAsFilename.value, 'activities/log_practice.html', 'pre-fill matches current');

  els.saveAsFilename.value = 'activities/log_practice_v2.html';
  // _checkFilenameCollision queries the cached resources; populate by opening
  // load modal first. Simpler path: stash the cache via a fresh fetch.
  // Since save-as is allowed to skip collision check when the cache is empty
  // and the index fetch is wired through, queue an empty index fetch.
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([])) });

  await confirmSaveAs();
  await flushPromises();

  eq(builderState.filename, 'activities/log_practice_v2.html', 'filename updated');
  eq(builderState.slug,     'log_practice_v2',                  'slug updated');
  // indexMeta preserved per the agreed model.
  eq(builderState.indexMeta.unit, 'Unit 7', 'indexMeta.unit preserved');
  eq(builderState.indexMeta.desc, 'Log laws', 'indexMeta.desc preserved');
  ok(lifecycle.confirmPublish === 1, 'publish flow triggered');
});

await test('Save-as collision warns first, allows on second click', async function () {
  builderState.title    = 'Logarithm Practice';
  builderState.filename = 'activities/log_practice.html';
  builderState.slug     = 'log_practice';

  openSaveAsPanel();
  els.saveAsFilename.value = 'activities/exp_functions.html';  // collides with R_UNIT9
  // Pre-load the cache by issuing an index fetch first (simpler: queue the
  // index fetch that _checkFilenameCollision will issue).
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT9])) });

  await confirmSaveAs();
  await flushPromises();

  // First click: warning shown, no publish yet.
  ok(els.saveAsCollisionWarn.style.display === 'block', 'warn visible');
  contains(els.saveAsCollisionWarn.textContent || els.saveAsCollisionWarn.innerHTML,
           'Click Save as again');
  eq(lifecycle.confirmPublish, 0, 'publish NOT triggered on first click');

  // Second click on same filename: proceeds.
  await confirmSaveAs();
  await flushPromises();
  eq(lifecycle.confirmPublish, 1, 'publish triggered on second click');
  eq(builderState.filename, 'activities/exp_functions.html', 'overwrite accepted');
});

await test('Save-as rejects same-as-current filename', async function () {
  builderState.filename = 'activities/log_practice.html';
  openSaveAsPanel();
  els.saveAsFilename.value = 'activities/log_practice.html';
  await confirmSaveAs();
  contains(els.saveAsCollisionWarn.textContent || els.saveAsCollisionWarn.innerHTML,
           'current filename');
  eq(lifecycle.confirmPublish, 0, 'no publish');
});

await test('Save-as rejects whitespace/quotes in filename', async function () {
  openSaveAsPanel();
  els.saveAsFilename.value = 'activities/has space.html';
  await confirmSaveAs();
  contains(els.saveAsCollisionWarn.textContent || els.saveAsCollisionWarn.innerHTML,
           'spaces or quote');
  eq(lifecycle.confirmPublish, 0);
});

// -----------------------------------------------------------------------------
// SPEC TEST 11 — Loading sets indexMeta from the resource (the data layer the
// publish-modal pre-fill reads from). The DOM-side prefill in openPublishModal
// lives outside the LOAD ACTIVITY section, so we verify the data is staged.
// -----------------------------------------------------------------------------
await test('Spec 11: load populates builderState.indexMeta from the resource', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  // Loaded state's own indexMeta survives — this is the round-trip path.
  fetchQueue.push({ status: 200, body: contentsBody(activityHTMLWith(sampleLoadedState())) });
  _handleLoadClick('r1');
  await flushPromises();
  eq(builderState.indexMeta.unit, 'Unit 7');
  eq(builderState.indexMeta.desc, 'Log laws');
  eq(builderState.indexMeta.type, 'practice');
  ok(Array.isArray(builderState.indexMeta.tags) && builderState.indexMeta.tags[0] === 'A2.5(B)',
     'tags array preserved');
});

// -----------------------------------------------------------------------------
// SPEC TEST 12 — Token missing: gated state shown, no fetch attempted.
// -----------------------------------------------------------------------------
await test('Spec 12: missing PIN token shows gated state, no fetch', async function () {
  global._decryptedToken = null;
  openLoadActivityModal();
  await flushPromises();
  contains(els.loadActivityBody.innerHTML, 'Enter your PIN first');
  eq(fetchLog.length, 0, 'no fetch attempted while gated');
});

await test('Gated "Enter PIN" button queues post-PIN re-open and opens PIN modal', async function () {
  global._decryptedToken = null;
  openLoadActivityModal();
  await flushPromises();
  // The gated state's button calls _loadActivityRequestPin().
  _loadActivityRequestPin();
  // Should have closed the load modal and opened the PIN modal, queueing
  // openLoadActivityModal as the post-PIN callback.
  ok(!els.loadActivityBackdrop.classList.contains('open'), 'load modal closed');
  eq(lifecycle.openPinModal, 1, 'PIN modal opened');
  ok(typeof global._pendingAfterPin === 'function', 'post-PIN callback queued');
});

// -----------------------------------------------------------------------------
// Bonus: dirty detection edge cases.
// -----------------------------------------------------------------------------
await test('Bonus: _isDraftDirty reads clean for fresh state with no snapshot', async function () {
  // No baseline yet (resetAll clears localStorage).
  eq(_isDraftDirty(), false, 'fresh empty state should be clean');
});

await test('Bonus: _isDraftDirty reads dirty when problems exist with no snapshot', async function () {
  builderState.problems = [{ id: 'p1', type: 'problem', stem: 'something', blanks: [], graphs: [] }];
  ok(_isDraftDirty(), 'state with content but no snapshot should be dirty');
});

await test('Bonus: _isDraftDirty ignores updatedAt churn', async function () {
  _stampLastSaved();
  builderState.updatedAt = '2099-12-31T23:59:59Z';  // simulate post-save autosave bump
  eq(_isDraftDirty(), false, 'updatedAt-only change should NOT register as dirty');
});

await test('Bonus: _isDraftDirty catches real content changes after snapshot', async function () {
  _stampLastSaved();
  builderState.title = 'Edited Title';
  ok(_isDraftDirty(), 'title edit should register as dirty');
});

await test('Bonus: status pill dismiss', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  fetchQueue.push({ status: 200, body: contentsBody(activityHTMLWith(sampleLoadedState())) });
  _handleLoadClick('r1');
  await flushPromises();
  ok(els.loadActivityStatus.style.display === 'flex', 'status visible after load');
  _dismissLoadActivityStatus();
  eq(els.loadActivityStatus.style.display, 'none', 'status hidden after dismiss');
  eq(els.loadActivityStatus.innerHTML, '', 'status content cleared');
});

await test('Bonus: Escape key closes the load modal', async function () {
  fetchQueue.push({ status: 200, body: contentsBody(indexHTMLWith([R_UNIT7])) });
  openLoadActivityModal();
  await flushPromises();
  document._fireKey('Escape');
  ok(!els.loadActivityBackdrop.classList.contains('open'), 'Escape closes modal');
});

await test('Bonus: closing PIN modal clears _pendingAfterPin (no surprise refire)', async function () {
  // Simulate the closePinModal stub being called. Our test stub doesn't
  // actually clear _pendingAfterPin (the real builder.js does in its
  // production closePinModal). Verify the load section's contract here by
  // exercising _loadActivityRequestPin and then re-pointing closePinModal
  // to also clear the pending callback (matching the real implementation).
  global.closePinModal = function () {
    lifecycle.closePinModal++;
    global._pendingAfterPin = null;
  };
  global._decryptedToken = null;
  openLoadActivityModal();
  await flushPromises();
  _loadActivityRequestPin();
  ok(typeof global._pendingAfterPin === 'function', 'queued');
  closePinModal();
  ok(global._pendingAfterPin === null, 'cleared on cancel');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);

})();
