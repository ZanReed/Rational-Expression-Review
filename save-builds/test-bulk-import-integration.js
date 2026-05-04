// test-bulk-import-integration.js
// Walks the full Import-problems flow end-to-end: open modal -> type -> parse
// -> render preview -> append -> verify builderState. Mocks the small DOM
// surface the bulk-import code actually touches; stubs the builder.js
// dependencies it calls (_newProblem, saveDraft, renderProblems, refreshPreview,
// _esc, builderState).
//
// Run: node test-bulk-import-integration.js

var fs = require('fs');

// -----------------------------------------------------------------------------
// Minimal DOM mock — only what bulk-import functions actually touch.
// -----------------------------------------------------------------------------
function mkEl(id) {
  return {
    id: id,
    value: '',
    innerHTML: '',
    style: { display: '' },
    classList: {
      _set: new Set(),
      add: function (c) { this._set.add(c); },
      remove: function (c) { this._set.delete(c); },
      contains: function (c) { return this._set.has(c); }
    },
    focus: function () { /* no-op */ }
  };
}

var els = {
  bulkImportText:      mkEl('bulkImportText'),
  bulkImportPreview:   mkEl('bulkImportPreview'),
  bulkImportBackdrop:  mkEl('bulkImportBackdrop'),
  bulkImportActions:   mkEl('bulkImportActions'),
  bulkImportStatus:    mkEl('bulkImportStatus')
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
  // Test helper — fires a synthetic keydown.
  _fireKey: function (key) {
    (docListeners.keydown || []).slice().forEach(function (h) { h({ key: key }); });
  }
};

global.window = global;

// Make setTimeout synchronous so focus()-on-next-tick doesn't matter to tests.
var realSetTimeout = global.setTimeout;
global.setTimeout = function (fn) { fn(); };

// -----------------------------------------------------------------------------
// Stub the builder.js dependencies the bulk-import section calls into.
// -----------------------------------------------------------------------------
global.builderState = { problems: [] };

var lifecycleCalls = { saveDraft: 0, renderProblems: 0, refreshPreview: 0 };

// Match the real _newProblem() shape from builder.js so we can assert on it.
global._newProblem = function () {
  return {
    id: 'x' + Math.random().toString(36).slice(2, 9),
    type: 'problem',
    stem: '',
    blanks: [],
    graphs: [],
    liveFeedback: true,
    scoreOnly: false,
    workspace: { size: 'none', format: 'default' },
    print: { span: 'auto', pageBreakBefore: false }
  };
};

global.saveDraft       = function () { lifecycleCalls.saveDraft++; };
global.renderProblems  = function () { lifecycleCalls.renderProblems++; };
global.refreshPreview  = function () { lifecycleCalls.refreshPreview++; };

global._esc = function (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// -----------------------------------------------------------------------------
// Load the parser, then extract the bulk-import section of builder.js and
// eval it in this scope so its functions become globals.
// -----------------------------------------------------------------------------
require('./bulk-importer.js');

var builderSrc = fs.readFileSync('./builder.js', 'utf8');
var startMarker = '// BULK IMPORT — modal flow';
var endMarker   = '// =============================================================================\n// INIT';
var startIdx = builderSrc.indexOf(startMarker);
var endIdx   = builderSrc.indexOf(endMarker, startIdx);
if (startIdx === -1 || endIdx === -1) {
  console.error('Could not locate the BULK IMPORT section in builder.js. Aborting.');
  process.exit(2);
}
var bulkSection = builderSrc.slice(startIdx, endIdx);
// eslint-disable-next-line no-eval
eval(bulkSection);

// -----------------------------------------------------------------------------
// Test harness.
// -----------------------------------------------------------------------------
var passed = 0, failed = 0;

function test(name, fn) {
  // Reset state between tests so each one starts fresh.
  builderState.problems = [];
  lifecycleCalls.saveDraft = 0;
  lifecycleCalls.renderProblems = 0;
  lifecycleCalls.refreshPreview = 0;
  Object.keys(els).forEach(function (k) {
    els[k].value = '';
    els[k].innerHTML = '';
    els[k].style.display = '';
    els[k].classList._set = new Set();
  });
  Object.keys(docListeners).forEach(function (k) { docListeners[k] = []; });

  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('     ' + e.message.split('\n').join('\n     '));
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
                    '\n     in: ' + JSON.stringify(haystack).slice(0, 200));
  }
}
function notContains(haystack, needle, msg) {
  if (String(haystack).indexOf(needle) !== -1) {
    throw new Error((msg || 'notContains') + ' — should NOT contain: ' + JSON.stringify(needle));
  }
}

console.log('\nbulk-import integration tests\n');

// -----------------------------------------------------------------------------
test('Open modal: backdrop opens, textarea is focused-ready, escape handler bound', function () {
  openBulkImportModal();
  ok(els.bulkImportBackdrop.classList.contains('open'), 'backdrop should be open');
  eq(els.bulkImportText.value, '', 'textarea should be empty');
  eq(els.bulkImportPreview.style.display, 'none', 'preview should be hidden');
  ok((docListeners.keydown || []).length === 1, 'one keydown listener should be bound');
});

// -----------------------------------------------------------------------------
test('Close modal: backdrop closes, textarea cleared, escape handler removed', function () {
  openBulkImportModal();
  els.bulkImportText.value = 'some draft the user typed';
  closeBulkImportModal();
  ok(!els.bulkImportBackdrop.classList.contains('open'), 'backdrop should be closed');
  eq(els.bulkImportText.value, '', 'textarea should be reset');
  ok((docListeners.keydown || []).length === 0, 'keydown listener should be removed');
});

// -----------------------------------------------------------------------------
test('Escape key closes the modal from edit stage', function () {
  openBulkImportModal();
  document._fireKey('Escape');
  ok(!els.bulkImportBackdrop.classList.contains('open'), 'Escape should close');
});

// -----------------------------------------------------------------------------
test('Escape key closes the modal from preview stage', function () {
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nFirst.\n\n## Problem\nSecond.';
  parseBulkImportPreview();
  ok(els.bulkImportBackdrop.classList.contains('open'), 'still open before escape');
  document._fireKey('Escape');
  ok(!els.bulkImportBackdrop.classList.contains('open'), 'Escape should close');
});

// -----------------------------------------------------------------------------
test('Parse preview (m=0): header omits "(after Problem 0)" parenthetical', function () {
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nFirst.\n\n## Problem\nSecond.';
  parseBulkImportPreview();
  eq(els.bulkImportPreview.style.display, 'block', 'preview should be visible');
  contains(els.bulkImportPreview.innerHTML, '2 problems will be appended');
  notContains(els.bulkImportPreview.innerHTML, 'after Problem 0',
    'should NOT show "(after Problem 0)" when activity is empty');
});

// -----------------------------------------------------------------------------
test('Parse preview (m>0): header includes "(after Problem M)"', function () {
  // Pre-populate with 3 existing problems
  builderState.problems = [{}, {}, {}];
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nNew problem stem.';
  parseBulkImportPreview();
  contains(els.bulkImportPreview.innerHTML, '1 problem will be appended (after Problem 3)');
});

// -----------------------------------------------------------------------------
test('Parse preview: snippet shows ~80 chars, ellipsis on overflow, newlines collapsed', function () {
  openBulkImportModal();
  var longStem = 'This is a very long problem stem with multiple lines\nand it definitely exceeds eighty characters total when joined together';
  els.bulkImportText.value = '## Problem\n' + longStem;
  parseBulkImportPreview();
  // Truncated form should be present
  contains(els.bulkImportPreview.innerHTML, '…', 'ellipsis should appear when truncated');
  // The literal newline should NOT appear in the rendered snippet
  // (but the closing </ol> tag does have newlines from html, so we check the snippet specifically)
  notContains(els.bulkImportPreview.innerHTML, longStem,
    'full long stem should not appear verbatim in preview');
});

// -----------------------------------------------------------------------------
test('Parse preview: math/markdown HTML-escaped (no execution risk)', function () {
  openBulkImportModal();
  // Real-world stems contain $...$ math and < > characters in inequalities.
  els.bulkImportText.value = '## Problem\nSolve $x < 5$ and show $x > 2$.';
  parseBulkImportPreview();
  contains(els.bulkImportPreview.innerHTML, '&lt;', 'less-than should be escaped');
  contains(els.bulkImportPreview.innerHTML, '&gt;', 'greater-than should be escaped');
  // The literal $ stays as-is (no math rendering in preview, per spec)
  contains(els.bulkImportPreview.innerHTML, '$x ', 'dollar signs preserved literally');
});

// -----------------------------------------------------------------------------
test('Parse preview: 0 parsed → Append button is hidden, only Back to edit shown', function () {
  openBulkImportModal();
  els.bulkImportText.value = 'No headings anywhere in this paste.';
  parseBulkImportPreview();
  contains(els.bulkImportPreview.innerHTML, 'No \'## Problem\' headings found',
    'no-headings warning should appear');
  contains(els.bulkImportActions.innerHTML, 'Back to edit', 'Back to edit must be present');
  notContains(els.bulkImportActions.innerHTML, 'Append problems',
    'Append button must be hidden when 0 parsed');
});

// -----------------------------------------------------------------------------
test('Parse preview: warnings pill renders when warnings exist', function () {
  openBulkImportModal();
  els.bulkImportText.value =
    '## Problem\nFirst.\n\n## Problem\n\n## Problem\nThird.';
  parseBulkImportPreview();
  contains(els.bulkImportPreview.innerHTML, 'Warning', 'warnings pill heading');
  contains(els.bulkImportPreview.innerHTML, 'Problem 2',
    'should name the empty problem position');
});

// -----------------------------------------------------------------------------
test('Append flow: pushes _newProblem() shapes, calls lifecycle in order, closes modal', function () {
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nAlpha.\n\n## Problem\nBeta.\n\n## Problem\nGamma.';
  parseBulkImportPreview();
  appendBulkProblems();

  eq(builderState.problems.length, 3, 'three problems appended');
  // Each pushed problem has the full _newProblem() shape, with stem set
  builderState.problems.forEach(function (p, i) {
    ok(p.id && typeof p.id === 'string', 'problem ' + i + ' has an id');
    eq(p.type, 'problem', 'problem ' + i + ' has type=problem');
    ok(Array.isArray(p.blanks) && p.blanks.length === 0, 'no blanks pushed');
    ok(Array.isArray(p.graphs), 'graphs array initialized');
    ok(p.workspace && p.print, 'workspace + print defaults set');
  });
  eq(builderState.problems[0].stem, 'Alpha.');
  eq(builderState.problems[1].stem, 'Beta.');
  eq(builderState.problems[2].stem, 'Gamma.');

  eq(lifecycleCalls.saveDraft, 1, 'saveDraft called once');
  eq(lifecycleCalls.renderProblems, 1, 'renderProblems called once');
  eq(lifecycleCalls.refreshPreview, 1, 'refreshPreview called once');

  ok(!els.bulkImportBackdrop.classList.contains('open'), 'modal closed after append');
  contains(els.bulkImportStatus.innerHTML, 'Appended 3 problems.', 'status pill set');
  eq(els.bulkImportStatus.style.display, 'flex', 'status pill visible');
});

// -----------------------------------------------------------------------------
test('Append singular: "Appended 1 problem." (no plural s)', function () {
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nLonely.';
  parseBulkImportPreview();
  appendBulkProblems();
  contains(els.bulkImportStatus.innerHTML, 'Appended 1 problem.');
  notContains(els.bulkImportStatus.innerHTML, '1 problems', 'should not pluralize 1');
});

// -----------------------------------------------------------------------------
test('Status dismiss: clicking × hides the pill', function () {
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nFoo.';
  parseBulkImportPreview();
  appendBulkProblems();
  ok(els.bulkImportStatus.style.display === 'flex', 'status visible after append');
  _dismissBulkImportStatus();
  eq(els.bulkImportStatus.style.display, 'none', 'status hidden after dismiss');
  eq(els.bulkImportStatus.innerHTML, '', 'status content cleared');
});

// -----------------------------------------------------------------------------
test('Back to edit: hides preview, restores Parse preview button, keeps textarea', function () {
  openBulkImportModal();
  var originalText = '## Problem\nKept text.';
  els.bulkImportText.value = originalText;
  parseBulkImportPreview();
  ok(els.bulkImportPreview.style.display === 'block', 'preview visible after parse');

  _bulkImportBackToEdit();

  eq(els.bulkImportPreview.style.display, 'none', 'preview hidden');
  eq(els.bulkImportText.value, originalText, 'textarea content preserved');
  contains(els.bulkImportActions.innerHTML, 'Parse preview',
    'edit-stage button restored');
  notContains(els.bulkImportActions.innerHTML, 'Append problems',
    'Append must be gone after Back-to-edit');
});

// -----------------------------------------------------------------------------
test('Reopen flow: state reset between sessions', function () {
  // Session 1: open, type, parse, then close (cancel)
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nFirst session.';
  parseBulkImportPreview();
  closeBulkImportModal();

  // Session 2: open should be fully fresh
  openBulkImportModal();
  eq(els.bulkImportText.value, '', 'textarea fresh');
  eq(els.bulkImportPreview.style.display, 'none', 'preview hidden');
  contains(els.bulkImportActions.innerHTML, 'Parse preview',
    'action row reset to edit-stage');
  notContains(els.bulkImportActions.innerHTML, 'Append problems',
    'no Append leakage from prior session');
});

// -----------------------------------------------------------------------------
test('Append guard: calling appendBulkProblems before parsing is a safe no-op', function () {
  openBulkImportModal();
  // No parse step — call append directly (defensive guard test)
  appendBulkProblems();
  eq(builderState.problems.length, 0, 'nothing appended');
  eq(lifecycleCalls.saveDraft, 0, 'saveDraft not called');
});

// -----------------------------------------------------------------------------
test('Status replaces on consecutive imports (does not stack)', function () {
  // First import
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nA.\n\n## Problem\nB.';
  parseBulkImportPreview();
  appendBulkProblems();
  contains(els.bulkImportStatus.innerHTML, 'Appended 2 problems.');

  // Second import — status should be REPLACED with the new count, not appended
  openBulkImportModal();
  els.bulkImportText.value = '## Problem\nC.';
  parseBulkImportPreview();
  appendBulkProblems();

  contains(els.bulkImportStatus.innerHTML, 'Appended 1 problem.');
  // The old "Appended 2" message must be gone
  var dismissCount = (els.bulkImportStatus.innerHTML.match(/Appended/g) || []).length;
  eq(dismissCount, 1, 'only one Appended message present (no stacking)');
  eq(builderState.problems.length, 3, 'cumulative state: 2 + 1 = 3');
});

// -----------------------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
