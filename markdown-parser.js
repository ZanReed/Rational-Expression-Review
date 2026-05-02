// =============================================================================
// markdown-parser.js — Extended-markdown parser for activity content
// -----------------------------------------------------------------------------
// USED BY:
//   - builder.js   (live preview + publish-time stem compilation)
//   - activity HTML templates (runtime reference-sheet rendering)
//
// EXPORTS:
//   window.parseMarkdown(text, options)
//     options.stemMode     — preserve {{blank:N}} tokens as literal text in
//                            output HTML (for later post-processing into input
//                            elements)
//     options._verbatim    — internal; shared across recursive parseMarkdown
//                            calls so verbatim placeholders survive nesting
//   window.MARKDOWN_PARSER_SOURCE — the parser code as a string, used by
//     builder.js to inline the same parser into compiled activity HTML so
//     reference sheets can render at student-runtime without an extra fetch.
//
// SUPPORTED SYNTAX (subset of GFM + light extensions):
//
//   # / ## / ### / #### Headings, with optional {color=blue} attribute
//   $...$    inline math  (canonical; converted to \(...\) for KaTeX)
//   $$...$$  display math (canonical; converted to \[...\] for KaTeX)
//   \(...\)  \[...\]      back-compat — still rendered, just not advertised
//   **bold**     _italic_     ==highlight==     `inline code`
//   - / *  unordered list      1. 2. 3.  ordered list
//   ---  horizontal rule
//   | col1 | col2 |       GFM tables (with :---: alignment row)
//   | ---  | ---  |
//   > [!NOTE]   > [!TIP]   > [!WARNING]
//   > [!EXAMPLE]   > [!DEFINITION]   > [!THEOREM]
//   ::: columns       ::: column ... :::    ::: column ... :::    :::
//   Label :: content       (existing two-column row syntax)
//   {{blank:N}}            (only in stemMode — preserved through the parser)
// =============================================================================

(function (root) {
  'use strict';

  // ---------- HTML escape ----------------------------------------------------
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Sentinels: characters that won't appear in legitimate user input.
  // \u0001 = SOH, \u0002 = STX, both control characters with no display.
  var SENT_OPEN = '\u0001\u0002';
  var SENT_CLOSE = '\u0002\u0001';
  var SENT_RE = /\u0001\u0002(\d+)\u0002\u0001/g;

  // ---------- Verbatim protection -------------------------------------------
  // Replace regions whose contents must not be touched by markdown processing
  // (math, code spans, blank tokens) with a numbered sentinel; the original
  // content is restored after all rendering is complete.
  function protectVerbatim(text, opts, verbatim) {
    function stash(content) {
      var idx = verbatim.length;
      verbatim.push(content);
      return SENT_OPEN + idx + SENT_CLOSE;
    }

    // 1. Escaped dollar signs first — let teachers write "$5" by typing "\$5"
    text = text.replace(/\\\$/g, function () {
      return stash('$');
    });

    // 2. Code spans — `code` (single-line). HTML-escape contents now.
    text = text.replace(/`([^`\n]+)`/g, function (m, code) {
      return stash('<code class="md-code">' + escapeHTML(code) + '</code>');
    });

    // 3. Display math: $$...$$ (multi-line OK)
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (m, math) {
      return stash('\\[' + escapeHTML(math) + '\\]');
    });

    // 4. Inline math: $...$ — heuristic check to avoid matching prose dollars
    text = text.replace(/\$([^\$\n]+?)\$/g, function (m, math) {
      // Reject if surrounded by whitespace internally (probably "cost is $5")
      if (/^\s|\s$/.test(math)) return m;
      // Reject if the candidate is just digits/punctuation (probably money)
      if (/^[\d.,]+$/.test(math)) return m;
      return stash('\\(' + escapeHTML(math) + '\\)');
    });

    // 5. Back-compat \(...\) and \[...\] — escape math contents the same way
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, function (m, math) {
      return stash('\\(' + escapeHTML(math) + '\\)');
    });
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, function (m, math) {
      return stash('\\[' + escapeHTML(math) + '\\]');
    });

    // 6. Blank tokens (stem mode only) — preserve literal {{blank:N}} text
    if (opts.stemMode) {
      text = text.replace(/\{\{blank:\d+\}\}/g, function (m) {
        return stash(m);
      });
    }

    return text;
  }

  function restoreVerbatim(text, verbatim) {
    return text.replace(SENT_RE, function (_, n) {
      return verbatim[parseInt(n, 10)];
    });
  }

  // ---------- Inline formatting ---------------------------------------------
  // Apply to text that has already been verbatim-protected. Order matters:
  // bold before italic (so ** isn't consumed by single-* italic), highlights
  // before everything else (== is unambiguous).
  function processInline(text) {
    text = escapeHTML(text);

    // Highlights: ==text==
    text = text.replace(/==([^=\n]+)==/g, '<mark class="md-highlight">$1</mark>');

    // Bold: **text**
    text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

    // Italic: _text_ (word-boundary aware so snake_case isn't italicized)
    // Match only when preceded and followed by non-word characters or string ends.
    text = text.replace(
      /(^|[^\w])_([^_\n]+?)_(?=[^\w]|$)/g,
      '$1<em>$2</em>'
    );

    return text;
  }

  // ---------- Block tokenizer -----------------------------------------------
  function parseTableRow(line) {
    // Strip surrounding pipes, split on pipes (but not escaped \|).
    var s = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
    // Simple split — escaped pipes inside cells aren't supported in v1.
    return s.split('|').map(function (cell) {
      return cell.replace(/^\s+|\s+$/g, '');
    });
  }

  function parseTableAlignment(sepLine) {
    var cells = parseTableRow(sepLine);
    return cells.map(function (cell) {
      var left = cell.charAt(0) === ':';
      var right = cell.charAt(cell.length - 1) === ':';
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });
  }

  function isTableSeparator(line) {
    var t = line.replace(/^\s+|\s+$/g, '');
    if (t.indexOf('|') < 0 && t.indexOf('-') < 0) return false;
    // Each cell must be of the form :?-+:?
    var cells = parseTableRow(t);
    if (cells.length === 0) return false;
    for (var i = 0; i < cells.length; i++) {
      if (!/^:?-{2,}:?$/.test(cells[i])) return false;
    }
    return true;
  }

  var BLOCK_OPENERS = /^(#{1,6}\s|>\s*\[!|::: |[-*]\s|\d+\.\s|---+\s*$|\|)/;

  function tokenizeBlocks(lines) {
    var blocks = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.replace(/^\s+|\s+$/g, '');

      if (!trimmed) {
        i++;
        continue;
      }

      // Heading (with optional attribute block)
      var headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        var headingText = headingMatch[2];
        var attrs = {};
        var attrMatch = headingText.match(/^(.+?)\s+\{([^}]+)\}\s*$/);
        if (attrMatch) {
          headingText = attrMatch[1];
          var pairs = attrMatch[2].split(/\s+/);
          for (var ap = 0; ap < pairs.length; ap++) {
            var kv = pairs[ap].split('=');
            if (kv.length === 2) attrs[kv[0]] = kv[1];
          }
        }
        blocks.push({
          type: 'heading',
          level: level,
          text: headingText,
          attrs: attrs
        });
        i++;
        continue;
      }

      // Horizontal rule
      if (/^-{3,}\s*$/.test(trimmed)) {
        blocks.push({ type: 'hr' });
        i++;
        continue;
      }

      // Callout
      var calloutMatch = trimmed.match(
        /^>\s*\[!(NOTE|TIP|WARNING|EXAMPLE|DEFINITION|THEOREM)\]\s*(.*)$/i
      );
      if (calloutMatch) {
        var kind = calloutMatch[1].toLowerCase();
        var bodyLines = [];
        if (calloutMatch[2]) bodyLines.push(calloutMatch[2]);
        i++;
        while (i < lines.length) {
          var ln = lines[i];
          var lt = ln.replace(/^\s+/, '');
          // New callout? Stop and let the outer loop pick it up.
          if (/^>\s*\[!(NOTE|TIP|WARNING|EXAMPLE|DEFINITION|THEOREM)\]/i.test(lt)) {
            break;
          }
          if (lt.charAt(0) !== '>') {
            // Allow blank line within callout if the line after still has '>'
            // AND isn't the start of a new callout.
            if (lt === '' && i + 1 < lines.length) {
              var nxt = lines[i + 1].replace(/^\s+/, '');
              if (nxt.charAt(0) === '>' &&
                  !/^>\s*\[!(NOTE|TIP|WARNING|EXAMPLE|DEFINITION|THEOREM)\]/i.test(nxt)) {
                bodyLines.push('');
                i++;
                continue;
              }
            }
            break;
          }
          bodyLines.push(lt.replace(/^>\s?/, ''));
          i++;
        }
        blocks.push({
          type: 'callout',
          kind: kind,
          content: bodyLines.join('\n')
        });
        continue;
      }

      // Columns — fenced div, nesting aware. Treat every line of the form
      // "::: name" as opening a fence (depth++) and every standalone ":::"
      // as closing one (depth--). The outer "::: columns" is depth 1; we
      // collect lines until depth returns to 0.
      if (trimmed === '::: columns') {
        i++;
        var depth = 1;
        var inner = [];
        while (i < lines.length && depth > 0) {
          var l = lines[i].replace(/^\s+|\s+$/g, '');
          if (l === ':::') {
            depth--;
            if (depth === 0) { i++; break; }
            inner.push(lines[i]);
            i++;
            continue;
          }
          if (/^:::\s+\S/.test(l)) {
            depth++;
          }
          inner.push(lines[i]);
          i++;
        }

        // Split inner lines by "::: column" markers at depth 0. As we walk,
        // we track depth the same way: "::: column" (and any other named
        // fence) opens, plain ":::" closes.
        var cols = [];
        var current = null;
        var d = 0;
        for (var ix = 0; ix < inner.length; ix++) {
          var il = inner[ix].replace(/^\s+|\s+$/g, '');
          if (d === 0 && il === '::: column') {
            if (current !== null) cols.push(current.join('\n'));
            current = [];
            d = 1;
            continue;
          }
          if (/^:::\s+\S/.test(il)) {
            d++;
            if (current !== null) current.push(inner[ix]);
            continue;
          }
          if (il === ':::') {
            d--;
            // The closer of an outer "::: column" finishes that column.
            if (d === 0 && current !== null) {
              cols.push(current.join('\n'));
              current = null;
              continue;
            }
            if (current !== null) current.push(inner[ix]);
            continue;
          }
          if (current !== null) current.push(inner[ix]);
        }
        if (current !== null) cols.push(current.join('\n'));
        blocks.push({ type: 'columns', columns: cols });
        continue;
      }

      // Table
      if (line.indexOf('|') >= 0 && i + 1 < lines.length) {
        if (isTableSeparator(lines[i + 1])) {
          var headerCells = parseTableRow(line);
          var alignSpec = parseTableAlignment(lines[i + 1]);
          i += 2;
          var rows = [];
          while (i < lines.length) {
            var rowLine = lines[i];
            var rowTrim = rowLine.replace(/^\s+|\s+$/g, '');
            if (!rowTrim || rowLine.indexOf('|') < 0) break;
            rows.push(parseTableRow(rowLine));
            i++;
          }
          blocks.push({
            type: 'table',
            header: headerCells,
            align: alignSpec,
            rows: rows
          });
          continue;
        }
      }

      // List (unordered or ordered)
      var ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
      var olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (ulMatch || olMatch) {
        var ordered = !!olMatch;
        var items = [];
        while (i < lines.length) {
          var t = lines[i].replace(/^\s+|\s+$/g, '');
          var lm = ordered
            ? t.match(/^\d+\.\s+(.+)$/)
            : t.match(/^[-*]\s+(.+)$/);
          if (!lm) break;
          items.push(ordered ? lm[2] : lm[1]);
          i++;
        }
        blocks.push({ type: 'list', ordered: ordered, items: items });
        continue;
      }

      // Label :: content row
      var labelSep = trimmed.indexOf(' :: ');
      if (labelSep > 0) {
        blocks.push({
          type: 'labelrow',
          label: trimmed.slice(0, labelSep),
          content: trimmed.slice(labelSep + 4)
        });
        i++;
        continue;
      }

      // Paragraph: gather consecutive non-block lines.
      var paraLines = [trimmed];
      i++;
      while (i < lines.length) {
        var pt = lines[i].replace(/^\s+|\s+$/g, '');
        if (!pt) break;
        if (BLOCK_OPENERS.test(pt)) break;
        if (pt.indexOf(' :: ') > 0) break;
        paraLines.push(pt);
        i++;
      }
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
    }

    return blocks;
  }

  // ---------- Section grouping (color tinting) ------------------------------
  // Walk the block list; when a heading carries {color=X}, wrap that heading
  // and all subsequent blocks (until another heading of equal or higher level)
  // in a 'section' block.
  function groupColoredSections(blocks) {
    var output = [];
    var i = 0;
    while (i < blocks.length) {
      var b = blocks[i];
      if (b.type === 'heading' && b.attrs && b.attrs.color) {
        var color = b.attrs.color;
        var level = b.level;
        var inner = [b];
        i++;
        while (i < blocks.length) {
          var n = blocks[i];
          if (n.type === 'heading' && n.level <= level) break;
          inner.push(n);
          i++;
        }
        output.push({ type: 'section', color: color, blocks: inner });
        continue;
      }
      output.push(b);
      i++;
    }
    return output;
  }

  // ---------- Block rendering -----------------------------------------------
  var CALLOUT_ICONS = {
    note: '\u2139',        // ℹ
    tip: '\u2728',         // ✨
    warning: '\u26A0',     // ⚠
    example: '\u25B6',     // ▶
    definition: '\u00A7',  // §
    theorem: '\u2234'      // ∴
  };

  function renderBlocks(blocks, opts, verbatim) {
    var out = '';
    for (var i = 0; i < blocks.length; i++) {
      out += renderBlock(blocks[i], opts, verbatim);
    }
    return out;
  }

  function renderBlock(block, opts, verbatim) {
    switch (block.type) {
      case 'heading': {
        var hLevel = Math.min(Math.max(block.level + 1, 2), 6);
        // # → h2 (top), ## → h3 (matches existing ref-section), etc.
        var classes = ['md-heading', 'md-heading-' + block.level];
        if (block.level === 2) classes.push('ref-section');
        if (block.level === 3) classes.push('ref-subsection');
        if (block.attrs && block.attrs.color) {
          classes.push('md-color-' + block.attrs.color);
        }
        return '<h' + hLevel + ' class="' + classes.join(' ') + '">' +
               processInline(block.text) +
               '</h' + hLevel + '>';
      }
      case 'hr':
        return '<hr class="md-hr">';
      case 'paragraph':
        return '<p class="md-para">' + processInline(block.text) + '</p>';
      case 'labelrow':
        return '<div class="ref-row">' +
                 '<div class="ref-label">' + processInline(block.label) + '</div>' +
                 '<div class="ref-body">' + processInline(block.content) + '</div>' +
               '</div>';
      case 'list': {
        var tag = block.ordered ? 'ol' : 'ul';
        var items = '';
        for (var li = 0; li < block.items.length; li++) {
          items += '<li>' + processInline(block.items[li]) + '</li>';
        }
        return '<' + tag + ' class="md-list">' + items + '</' + tag + '>';
      }
      case 'table': {
        var alignAttr = function (idx) {
          var a = block.align[idx];
          return a ? ' style="text-align:' + a + '"' : '';
        };
        var thead = '<thead><tr>';
        for (var hh = 0; hh < block.header.length; hh++) {
          thead += '<th' + alignAttr(hh) + '>' + processInline(block.header[hh]) + '</th>';
        }
        thead += '</tr></thead>';
        var tbody = '<tbody>';
        for (var ri = 0; ri < block.rows.length; ri++) {
          tbody += '<tr>';
          var row = block.rows[ri];
          for (var ci = 0; ci < row.length; ci++) {
            tbody += '<td' + alignAttr(ci) + '>' + processInline(row[ci]) + '</td>';
          }
          tbody += '</tr>';
        }
        tbody += '</tbody>';
        return '<div class="md-table-wrap"><table class="md-table">' +
               thead + tbody + '</table></div>';
      }
      case 'callout': {
        var icon = CALLOUT_ICONS[block.kind] || '\u2139';
        var inner = parseInternal(block.content, opts, verbatim);
        return '<div class="md-callout md-callout-' + block.kind + '">' +
                 '<div class="md-callout-icon">' + icon + '</div>' +
                 '<div class="md-callout-body">' + inner + '</div>' +
               '</div>';
      }
      case 'columns': {
        var cols = '';
        for (var co = 0; co < block.columns.length; co++) {
          cols += '<div class="md-column">' +
                  parseInternal(block.columns[co], opts, verbatim) +
                  '</div>';
        }
        var n = block.columns.length;
        return '<div class="md-columns md-columns-' + n + '">' + cols + '</div>';
      }
      case 'section': {
        var sInner = renderBlocks(block.blocks, opts, verbatim);
        return '<section class="md-section md-section-' + block.color + '">' +
               sInner + '</section>';
      }
    }
    return '';
  }

  // Internal entry point shared between the public parseMarkdown and recursive
  // calls from inside callouts/columns. Operates on text whose verbatim
  // regions have already been stashed into the shared `verbatim` array.
  function parseInternal(text, opts, verbatim) {
    // Recursive callers pass already-protected text. But block content
    // extracted from the *original* protected text doesn't need re-protection
    // (the sentinels survive line splits since they're single-line tokens).
    // However, if the recursive content was sliced from raw user input
    // (which it isn't in our flow), we'd need to re-protect. We don't.
    var lines = text.split(/\r?\n/);
    var blocks = tokenizeBlocks(lines);
    blocks = groupColoredSections(blocks);
    return renderBlocks(blocks, opts, verbatim);
  }

  // ---------- Public entry --------------------------------------------------
  function parseMarkdown(text, options) {
    options = options || {};
    var verbatim = options._verbatim || [];
    var isOuter = !options._verbatim;

    // Protect verbatim regions. Recursive calls inherit the already-protected
    // text and the shared verbatim array, so this only fires on the outer call.
    if (isOuter) {
      text = protectVerbatim(text || '', options, verbatim);
    }

    var html = parseInternal(text, options, verbatim);

    if (isOuter) {
      html = restoreVerbatim(html, verbatim);
    }
    return html;
  }

  // ---------- Source for embedding into compiled activity HTML --------------
  // The published activity HTML needs the same parser at runtime to render
  // reference sheets. Rather than fetch markdown-parser.js separately, the
  // builder inlines this source into each compiled activity. Keeping the
  // source as a Function.toString concatenation avoids a duplicate copy and
  // any drift between the two.
  var _PARSER_FUNCTIONS = [
    escapeHTML,
    protectVerbatim,
    restoreVerbatim,
    processInline,
    parseTableRow,
    parseTableAlignment,
    isTableSeparator,
    tokenizeBlocks,
    groupColoredSections,
    renderBlocks,
    renderBlock,
    parseInternal,
    parseMarkdown
  ];
  var _PARSER_CONSTS =
    'var SENT_OPEN = "\\u0001\\u0002";\n' +
    'var SENT_CLOSE = "\\u0002\\u0001";\n' +
    'var SENT_RE = /\\u0001\\u0002(\\d+)\\u0002\\u0001/g;\n' +
    'var BLOCK_OPENERS = ' + BLOCK_OPENERS.toString() + ';\n' +
    'var CALLOUT_ICONS = ' + JSON.stringify(CALLOUT_ICONS) + ';\n';
  var MARKDOWN_PARSER_SOURCE =
    '(function(root){\n"use strict";\n' +
    _PARSER_CONSTS +
    _PARSER_FUNCTIONS.map(function (f) { return f.toString(); }).join('\n\n') +
    '\nroot.parseMarkdown = parseMarkdown;\n' +
    '})(typeof window !== "undefined" ? window : this);';

  // Install on the global
  root.parseMarkdown = parseMarkdown;
  root.MARKDOWN_PARSER_SOURCE = MARKDOWN_PARSER_SOURCE;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
