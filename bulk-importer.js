// =============================================================================
// bulk-importer.js — Bulk problem import parser for activity builder
// -----------------------------------------------------------------------------
// USED BY:
//   - builder.js (modal "Parse preview" and "Append problems" handlers)
//
// EXPORTS:
//   window.BulkImporter.parse(text) -> { problems, warnings }
//     problems: Array<{ stem: string }>
//     warnings: Array<{ message: string, line: number }>
//
// The parser splits input on lines matching /^##\s+Problem\b/i at column 0.
// Everything between one heading and the next, with leading/trailing whitespace
// trimmed and runs of 3+ consecutive newlines collapsed to 2, becomes one stem.
//
// The parser does not interpret math, markdown, callouts, or [figure: ...]
// placeholders — stem text passes through opaquely. The existing markdown-
// parser.js handles rendering at preview/compile time.
//
// The parser does not throw. Empty/malformed input returns
// { problems: [], warnings: [...] } with informative warnings.
// =============================================================================
(function (root) {
  'use strict';

  // Heading regex. Requires:
  //   - Line starts at column 0 (no leading whitespace)
  //   - Exactly two `#` characters at the start (regex anchored with ^##)
  //   - At least one whitespace character after `##`
  //   - The literal word `Problem` (case-insensitive) on a word boundary
  //   - Trailing text on the heading line is allowed and ignored
  //
  // Anything that doesn't match the above is stem content, including indented
  // `## Problem` lines, `### Problem`, `##Problem` (no space between ## and
  // Problem), `## Problems` (the trailing `s` defeats \b after Problem), etc.
  var HEADING_RE = /^##\s+Problem\b/i;

  function parse(text) {
    var problems = [];
    var warnings = [];

    if (text == null) {
      return { problems: problems, warnings: warnings };
    }

    var raw = String(text);

    // DECISION: Whitespace-only input is treated as a no-op (Test 3 specifies
    // 0 warnings for empty input; extending that to whitespace-only since the
    // intent is identical — nothing was pasted). Flagged for review.
    if (raw.trim() === '') {
      return { problems: problems, warnings: warnings };
    }

    // Normalize line endings so line-based logic is consistent across
    // platforms (Windows pastes routinely include \r\n).
    var normalized = raw.replace(/\r\n?/g, '\n');
    var lines = normalized.split('\n');

    // First pass: find every heading line index.
    var headingIdxs = [];
    for (var i = 0; i < lines.length; i++) {
      if (HEADING_RE.test(lines[i])) {
        headingIdxs.push(i);
      }
    }

    // Test 4: input has content but no headings.
    if (headingIdxs.length === 0) {
      warnings.push({
        message: "No '## Problem' headings found. Each problem must start with a line beginning with '## Problem'.",
        line: 1
      });
      return { problems: problems, warnings: warnings };
    }

    // Test 5: discard text before the first heading.
    //
    // DECISION: Only emit the warning if the preamble contains non-whitespace
    // content. A few blank lines at the top of a paste are not worth warning
    // about. Flagged for review.
    var firstHeadingIdx = headingIdxs[0];
    if (firstHeadingIdx > 0) {
      var preamble = lines.slice(0, firstHeadingIdx);
      var hasContent = false;
      for (var p = 0; p < preamble.length; p++) {
        if (preamble[p].trim() !== '') { hasContent = true; break; }
      }
      if (hasContent) {
        warnings.push({
          message: "Text before first '## Problem' heading was discarded (" +
                   firstHeadingIdx + " line" + (firstHeadingIdx === 1 ? '' : 's') + ").",
          line: 1
        });
      }
    }

    // Second pass: extract each stem.
    for (var h = 0; h < headingIdxs.length; h++) {
      var startIdx = headingIdxs[h] + 1;
      var endIdx = (h + 1 < headingIdxs.length) ? headingIdxs[h + 1] : lines.length;
      var stemLines = lines.slice(startIdx, endIdx);
      var stem = stemLines.join('\n');

      // Trim leading/trailing whitespace per spec.
      stem = stem.replace(/^\s+|\s+$/g, '');

      if (stem === '') {
        // DECISION: Position in the warning is 1-indexed by source order,
        // counting empty stems. Test 6 has three headings with the middle
        // one empty; the warning should refer to "Problem 2". The `line`
        // field points to the 1-indexed source line of the heading itself,
        // so the user can find it quickly. Flagged for review.
        warnings.push({
          message: "Problem " + (h + 1) + " has an empty stem and was skipped.",
          line: headingIdxs[h] + 1
        });
        continue;
      }

      // Collapse runs of 3+ consecutive newlines (with optional whitespace on
      // the intervening blank lines, since whitespace-only lines count as
      // blank per the user's confirmation) down to exactly two newlines.
      //
      // Per Test 7's expected output, input "\n\n\n\n" (three blank lines)
      // collapses to "\n\n" (one blank line). The spec phrasing "collapse
      // 3+ blank lines to two" reads as if the result should be two blank
      // lines, but the test's expected stem makes it clear the intent is
      // "collapse 3+ newlines in a row down to 2 newlines." Going with the
      // test.
      stem = stem.replace(/(\n[ \t]*){3,}/g, '\n\n');

      problems.push({ stem: stem });
    }

    return { problems: problems, warnings: warnings };
  }

  // Install on the global. Matches markdown-parser.js's footer so the file
  // works in both browser (window) and Node (global) without changes — useful
  // for unit testing in isolation.
  root.BulkImporter = { parse: parse };
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
