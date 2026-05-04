// test-bulk-importer.js — runs the 10 spec test cases against bulk-importer.js
// Run: node test-bulk-importer.js

require('./bulk-importer.js');  // installs global.BulkImporter via the IIFE
var parse = global.BulkImporter.parse;

var passed = 0;
var failed = 0;

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('     ' + e.message.split('\n').join('\n     '));
  }
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || 'assertEq') +
      '\nexpected: ' + JSON.stringify(expected) +
      '\nactual:   ' + JSON.stringify(actual));
  }
}
function assertDeep(actual, expected, label) {
  if (!deepEq(actual, expected)) {
    throw new Error((label || 'assertDeep') +
      '\nexpected: ' + JSON.stringify(expected) +
      '\nactual:   ' + JSON.stringify(actual));
  }
}

console.log('\nbulk-importer.js parser tests\n');

// -----------------------------------------------------------------------------
test('Test 1: Two simple problems — verbatim stems, no warnings', function () {
  var input =
    '## Problem\n' +
    'Solve for $x$: $2x + 5 = 13$.\n' +
    '\n' +
    '## Problem\n' +
    'Find the slope of the line through $(1, 2)$ and $(4, 8)$.\n';
  var r = parse(input);
  assertEq(r.problems.length, 2, 'problems count');
  assertEq(r.warnings.length, 0, 'warnings count');
  assertEq(r.problems[0].stem, 'Solve for $x$: $2x + 5 = 13$.', 'stem 0');
  assertEq(r.problems[1].stem, 'Find the slope of the line through $(1, 2)$ and $(4, 8)$.', 'stem 1');
});

// -----------------------------------------------------------------------------
test('Test 2: Heading variations — trailing numbers, extra spaces ignored', function () {
  var input =
    '## Problem 1\n' +
    'First problem.\n' +
    '\n' +
    '## Problem 17\n' +
    'Second problem.\n' +
    '\n' +
    '##  Problem\n' +
    'Third problem (extra space after ##).\n';
  var r = parse(input);
  assertEq(r.problems.length, 3, 'problems count');
  assertEq(r.warnings.length, 0, 'warnings count');
  assertEq(r.problems[0].stem, 'First problem.');
  assertEq(r.problems[1].stem, 'Second problem.');
  assertEq(r.problems[2].stem, 'Third problem (extra space after ##).');
});

// -----------------------------------------------------------------------------
test('Test 3: Empty input — 0 problems, 0 warnings (no-op, not an error)', function () {
  var r = parse('');
  assertEq(r.problems.length, 0);
  assertEq(r.warnings.length, 0);

  // Also: whitespace-only input should be a no-op (decision flagged in code).
  var r2 = parse('   \n\n  \t\n');
  assertEq(r2.problems.length, 0, 'whitespace-only problems');
  assertEq(r2.warnings.length, 0, 'whitespace-only warnings');
});

// -----------------------------------------------------------------------------
test('Test 4: No headings — 0 problems, 1 warning', function () {
  var input = "This is just some text. There's no problem heading anywhere.";
  var r = parse(input);
  assertEq(r.problems.length, 0);
  assertEq(r.warnings.length, 1);
  assertEq(
    r.warnings[0].message,
    "No '## Problem' headings found. Each problem must start with a line beginning with '## Problem'."
  );
  assertEq(r.warnings[0].line, 1);
});

// -----------------------------------------------------------------------------
test('Test 5: Text before first heading — discarded, 1 warning', function () {
  var input =
    "Some preamble that shouldn't be there.\n" +
    'Another preamble line.\n' +
    '\n' +
    '## Problem\n' +
    'The actual problem.\n';
  var r = parse(input);
  assertEq(r.problems.length, 1);
  assertEq(r.problems[0].stem, 'The actual problem.');
  assertEq(r.warnings.length, 1);
  if (r.warnings[0].message.indexOf('discarded') === -1) {
    throw new Error('expected warning to mention discarded preamble; got: ' + r.warnings[0].message);
  }
  assertEq(r.warnings[0].line, 1);
});

// -----------------------------------------------------------------------------
test('Test 6: Empty stem — skipped with positional warning', function () {
  var input =
    '## Problem\n' +
    'First problem.\n' +
    '\n' +
    '## Problem\n' +
    '\n' +
    '## Problem\n' +
    'Third problem.\n';
  var r = parse(input);
  assertEq(r.problems.length, 2, 'problems count');
  assertEq(r.problems[0].stem, 'First problem.');
  assertEq(r.problems[1].stem, 'Third problem.');
  assertEq(r.warnings.length, 1, 'warnings count');
  if (r.warnings[0].message.indexOf('Problem 2') === -1) {
    throw new Error('expected warning to name Problem 2; got: ' + r.warnings[0].message);
  }
});

// -----------------------------------------------------------------------------
test('Test 7: Triple-blank collapsed to double newline', function () {
  var input =
    '## Problem\n' +
    'First paragraph.\n' +
    '\n' +
    '\n' +
    '\n' +
    'Second paragraph (after triple-blank in source).\n';
  var r = parse(input);
  assertEq(r.problems.length, 1);
  assertEq(r.warnings.length, 0);
  assertEq(
    r.problems[0].stem,
    'First paragraph.\n\nSecond paragraph (after triple-blank in source).'
  );
});

// -----------------------------------------------------------------------------
test('Test 8: Indented `## Problem` is part of stem, not a delimiter', function () {
  var input =
    '## Problem\n' +
    'The setup says the following:\n' +
    '  ## Problem 2 will be solved later  (this is indented, NOT a delimiter)\n' +
    'Continue with this stem.\n';
  var r = parse(input);
  assertEq(r.problems.length, 1, 'problems count');
  assertEq(r.warnings.length, 0);
  // The indented line should appear verbatim in the stem.
  if (r.problems[0].stem.indexOf('  ## Problem 2 will be solved later') === -1) {
    throw new Error('expected indented `## Problem 2` line preserved in stem; got:\n' + r.problems[0].stem);
  }
});

// -----------------------------------------------------------------------------
test('Test 9: Math and markdown pass through byte-for-byte', function () {
  var input =
    '## Problem\n' +
    'Evaluate $\\dfrac{x^2 - 9}{x + 3}$ for $x = 5$. Show that the answer is **8**.\n';
  var r = parse(input);
  assertEq(r.problems.length, 1);
  assertEq(r.warnings.length, 0);
  assertEq(
    r.problems[0].stem,
    'Evaluate $\\dfrac{x^2 - 9}{x + 3}$ for $x = 5$. Show that the answer is **8**.'
  );
});

// -----------------------------------------------------------------------------
test('Test 10: Multiple choice list preserved verbatim', function () {
  var input =
    '## Problem\n' +
    'Solve for $x$: $2x + 3 = 11$.\n' +
    '- A) $x = 3$\n' +
    '- B) $x = 4$\n' +
    '- C) $x = 5$\n' +
    '- D) $x = 6$\n';
  var r = parse(input);
  assertEq(r.problems.length, 1);
  assertEq(r.warnings.length, 0);
  var expected =
    'Solve for $x$: $2x + 3 = 11$.\n' +
    '- A) $x = 3$\n' +
    '- B) $x = 4$\n' +
    '- C) $x = 5$\n' +
    '- D) $x = 6$';
  assertEq(r.problems[0].stem, expected);
});

// -----------------------------------------------------------------------------
// Bonus sanity checks — not in the spec's 10, but worth covering since they
// prevent the most likely real-world breakage.
// -----------------------------------------------------------------------------
test('Bonus: parser does not throw on null/undefined', function () {
  var a = parse(null);
  assertDeep(a, { problems: [], warnings: [] });
  var b = parse(undefined);
  assertDeep(b, { problems: [], warnings: [] });
});

test('Bonus: CRLF line endings normalized', function () {
  var input = '## Problem\r\nFirst.\r\n\r\n## Problem\r\nSecond.\r\n';
  var r = parse(input);
  assertEq(r.problems.length, 2);
  assertEq(r.problems[0].stem, 'First.');
  assertEq(r.problems[1].stem, 'Second.');
});

test('Bonus: case-insensitive heading match', function () {
  var input = '## problem\nlowercase.\n\n## PROBLEM\nuppercase.\n';
  var r = parse(input);
  assertEq(r.problems.length, 2);
});

test('Bonus: `### Problem` (three hashes) is NOT a delimiter', function () {
  var input = '## Problem\nReal stem.\n### Problem looks like a heading but isn\'t\nMore stem.\n';
  var r = parse(input);
  assertEq(r.problems.length, 1, 'should be one problem');
  if (r.problems[0].stem.indexOf('### Problem') === -1) {
    throw new Error('expected `### Problem` line preserved in stem');
  }
});

test('Bonus: `##Problem` (no space) is NOT a delimiter', function () {
  var input = '## Problem\nReal stem.\n##Problem (no space) keeps going\nMore stem.\n';
  var r = parse(input);
  assertEq(r.problems.length, 1);
});

test('Bonus: blank-only preamble does not warn', function () {
  var input = '\n\n   \n## Problem\nStem.\n';
  var r = parse(input);
  assertEq(r.problems.length, 1);
  assertEq(r.warnings.length, 0, 'blank preamble should not warn');
});

// -----------------------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
