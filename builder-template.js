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

/* ---------- PROBLEM CELLS ---------- */
.main-content{margin-top:12px}
.problem-cell{background:var(--page);border:1px solid var(--rule);border-radius:5px;padding:18px 22px;margin-bottom:14px}
.prob-num{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--ink-light);margin-bottom:8px}
.prob-stem{font-family:var(--serif);font-size:17px;line-height:1.45;margin-bottom:14px;color:var(--ink)}
.ans-num{font-family:var(--mono);font-size:14px;padding:7px 11px;border:1px solid var(--rule);border-radius:3px;background:white;color:var(--ink);min-width:200px;outline:none;transition:border-color .15s}
.ans-num:focus{border-color:var(--accent)}
.ans-num.correct{border-color:var(--green-rule);background:var(--green-bg)}
.ans-num.incorrect{border-color:var(--red-rule);background:var(--red-bg)}
.feedback{display:inline-block;margin-left:10px;font-size:13px;font-weight:500}
.feedback.correct{color:var(--green)}
.feedback.incorrect{color:var(--red)}

/* ---------- SUBMIT ---------- */
.submit-wrap{margin-top:24px;padding:18px 22px;background:var(--accent-lt);border:1px solid #8aaad4;border-radius:5px;display:flex;align-items:center;gap:14px}
#submitBtn{font-family:var(--sans);font-size:13px;font-weight:600;padding:9px 20px;border:none;border-radius:3px;cursor:pointer;background:var(--accent);color:white;transition:background .15s}
#submitBtn:hover{background:#143a6a}
#submitBtn:disabled{background:var(--ink-light);cursor:not-allowed}
#submitMsg{font-size:13px;color:var(--ink-mid)}
#submitMsg.success{color:var(--green);font-weight:500}
#submitMsg.error{color:var(--red);font-weight:500}

@media (max-width:720px){
  body{padding:16px 12px 60px 12px}
  .sticky-panel{position:static;width:auto;flex-direction:row;flex-wrap:wrap;border-radius:5px;border:1px solid var(--rule);margin-bottom:18px;max-height:none}
  .ribbon-divider{width:1px;height:auto;margin:0 4px}
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
      <span id="submitMsg"></span>
    </div>
  </main>

</div>

<aside class="sticky-panel" id="sidebarRibbon"></aside>
<div id="floatingWindowContainer"></div>

<script id="builder-state" type="application/json">{{BUILDER_STATE_JSON}}<\/script>
<script id="sidebar-tools-config" type="application/json">{{SIDEBAR_TOOLS_JSON}}<\/script>

<script>
// =============================================================================
// RUNTIME — student-facing activity logic
// CONSTRAINTS: no backticks, no \${} template literals (we live inside one).
// =============================================================================

var ACTIVITY_SLUG = '{{ACTIVITY_SLUG}}';
var GOOGLE_CLIENT_ID = '{{GOOGLE_CLIENT_ID}}';

// ---------- Window manager -------------------------------------------------
var WindowManager = (function(){
  var windows = {};       // toolId -> { el, instance, config, body }
  var zCounter = 100;
  var defaultPositions = { offsetX: 100, offsetY: 80, stagger: 28 };
  var openCount = 0;

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
    header.addEventListener('mousedown', function(e){
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = parseInt(win.style.left, 10) || 0;
      oy = parseInt(win.style.top, 10) || 0;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e){
      if (!dragging) return;
      win.style.left = (ox + e.clientX - sx) + 'px';
      win.style.top  = (oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', function(){ dragging = false; });
  }

  function attachResize(win, handle, config){
    var resizing = false, sx = 0, sy = 0, ow = 0, oh = 0;
    handle.addEventListener('mousedown', function(e){
      resizing = true;
      sx = e.clientX; sy = e.clientY;
      ow = win.offsetWidth; oh = win.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', function(e){
      if (!resizing) return;
      var nw = Math.max(300, ow + e.clientX - sx);
      var nh = Math.max(220, oh + e.clientY - sy);
      win.style.width = nw + 'px';
      win.style.height = nh + 'px';
      if (config && typeof config.onResize === 'function') {
        try { config.onResize(windows[win.getAttribute('data-tool-id')]); } catch (e) {}
      }
    });
    document.addEventListener('mouseup', function(){ resizing = false; });
  }

  return { open: open, close: close, toggle: toggle, bringToFront: bringToFront, _windows: windows };
})();

// ---------- Tool registry --------------------------------------------------
var ToolRegistry = {
  video: function(cfg){
    return {
      label: cfg.label || 'Video',
      icon: '\u25B6',
      render: function(body){
        var iframe = document.createElement('iframe');
        iframe.src = cfg.embedUrl;
        iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        iframe.allowFullscreen = true;
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
  }
};

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
  try { tools = JSON.parse(raw.textContent.trim() || '[]'); }
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
      if (el) { el.value = s.answers[k]; validateInput(el); }
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

// ---------- Validation ----------------------------------------------------
function validateInput(el){
  var correct = el.getAttribute('data-correct');
  if (correct === null) return;
  var tol = parseFloat(el.getAttribute('data-tol') || '0');
  var fb = document.getElementById('fb_' + el.id);
  if (!el.value.trim()) {
    el.classList.remove('correct', 'incorrect');
    if (fb) fb.textContent = '';
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
  if (fb) {
    fb.className = 'feedback ' + (ok ? 'correct' : 'incorrect');
    fb.textContent = ok ? '\u2713' : '\u2717';
  }
}

function _wireValidation(){
  document.querySelectorAll('.ans-num').forEach(function(el){
    el.addEventListener('input', function(){ validateInput(el); });
    el.addEventListener('blur', function(){ validateInput(el); });
  });
}

// ---------- Submit (Apps Script) ------------------------------------------
function submitActivity(){
  var btn = document.getElementById('submitBtn');
  var url = btn.getAttribute('data-webhook');
  if (!url) { _flashSubmitMsg('No webhook configured.', 'error'); return; }
  var name = document.getElementById('studentName').value.trim();
  var sid  = document.getElementById('studentId').value.trim();
  if (!name || !sid) { _flashSubmitMsg('Name and ID required.', 'error'); return; }

  var payload = Object.assign({ activity: ACTIVITY_SLUG }, _collectState());
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
  if (typeof renderMathInElement !== 'function') {
    setTimeout(_renderMath, 100);
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
  _initGSI();
});
<\/script>

</body>
</html>`;

// Export for builder.js (browser global)
if (typeof window !== 'undefined') {
  window.WORKSHEET_TEMPLATE = WORKSHEET_TEMPLATE;
}
