// =============================================================================
// auth.js — Shared crypto, token storage, and GitHub publish helpers
// -----------------------------------------------------------------------------
// Loaded by both index.html (catalog) and activity-builder.html (authoring tool).
// Functions and `var` declarations here are global, so consumers can reference
// them by bare name. Loaded as a regular <script>, NOT a module — so do NOT
// use export / import / let / const for anything that needs to be shared.
// =============================================================================

// ---------- Constants -----------------------------------------------------
var PIN_HASH         = 'a00551e4974f122b8c15fb31765e0d87447b117def7f68331ba600924586af0f';
var GITHUB_OWNER     = 'ZanReed';
var GITHUB_REPO      = 'Rational-Expression-Review';
var GOOGLE_CLIENT_ID = '438116037519-f0tk55p4h6s5pgh16m4dllkmqb4ah8i6.apps.googleusercontent.com';
var TOKEN_STORAGE_KEY = 'ghTokenBlob';

// ---------- Shared state --------------------------------------------------
// _decryptedToken holds the in-memory plaintext GitHub token after PIN unlock.
// Reset to null on lock / page reload.
var _decryptedToken = null;

// ---------- Crypto helpers ------------------------------------------------
async function hashPin(p) {
  var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p));
  return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,'0')}).join('');
}
function bytesToHex(b) {
  return Array.from(new Uint8Array(b)).map(function(x){return x.toString(16).padStart(2,'0')}).join('');
}
function hexToBytes(h) {
  var a = new Uint8Array(h.length / 2);
  for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i*2, 2), 16);
  return a;
}
async function deriveKey(pin, sh) {
  var km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt:hexToBytes(sh), iterations:310000, hash:'SHA-256' },
    km,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}
async function encryptToken(pin, tok) {
  var s = crypto.getRandomValues(new Uint8Array(16));
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var k = await deriveKey(pin, bytesToHex(s));
  var e = await crypto.subtle.encrypt({ name:'AES-GCM', iv:iv }, k, new TextEncoder().encode(tok));
  return bytesToHex(s) + ':' + bytesToHex(iv) + ':' + bytesToHex(e);
}
async function decryptToken(pin, blob) {
  try {
    var p = blob.split(':');
    if (p.length < 3) return null;
    var k = await deriveKey(pin, p[0]);
    var pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:hexToBytes(p[1]) }, k, hexToBytes(p[2]));
    return new TextDecoder().decode(pt);
  } catch (e) {
    return null;
  }
}
async function getDecryptedToken(pin) {
  var b = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!b) return null;
  return decryptToken(pin, b);
}

// ---------- Path / Base64 helpers ----------------------------------------
// Path-aware encoder — fixes the bug where filename='activities/foo.html'
// would get mangled to 'activities%2Ffoo.html' (which GitHub rejects).
function _encodePath(filename) {
  return filename.split('/').map(encodeURIComponent).join('/');
}

// UTF-8 safe base64 (handles unicode in HTML content).
function toBase64(str) {
  var bytes = new TextEncoder().encode(str);
  var bin = '';
  bytes.forEach(function(b){ bin += String.fromCharCode(b); });
  return btoa(bin);
}
function fromBase64(b64) {
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------- GitHub publish ------------------------------------------------
async function publishToGitHub(filename, html, sid) {
  console.log('[publishToGitHub] ▶ filename=' + filename + ' html.length=' + html.length + ' sid=' + sid);
  var el = sid ? document.getElementById(sid) : null;
  function st(msg, ok) {
    console.log('[publishToGitHub] status:', msg, '(ok=' + ok + ')');
    if (!el) return;
    el.style.display = 'block';
    el.style.color = ok ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--amber)';
    el.textContent = msg;
  }
  if (!_decryptedToken) {
    console.warn('[publishToGitHub] ✗ no token at entry');
    st('⚠ No token — unlock with PIN first.', false);
    return false;
  }
  st('⟳ Checking file on GitHub…', null);

  var base = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + _encodePath(filename);
  var hdrs = {
    Authorization: 'Bearer ' + _decryptedToken,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
  var sha = null;

  try {
    var gr = await fetch(base + '?t=' + Date.now(), { headers: hdrs, cache: 'no-store' });
    if (gr.ok) { var gd = await gr.json(); sha = gd.sha; }
    else if (gr.status !== 404) {
      var ge = await gr.json();
      st('✗ GitHub ' + gr.status + ': ' + ge.message, false);
      return false;
    }
  } catch (e) {
    st('✗ Network error: ' + e.message, false);
    return false;
  }

  st('⟳ Publishing to GitHub…', null);
  var b64;
  try { b64 = toBase64(html); }
  catch (e) {
    st('✗ Encoding error: ' + e.message, false);
    return false;
  }
  try {
    var body = { message: 'Update ' + filename + ' via builder', content: b64 };
    if (sha) body.sha = sha;
    var pr = await fetch(base, { method: 'PUT', headers: hdrs, body: JSON.stringify(body) });
    if (pr.ok) {
      st('✓ Published! GitHub Pages updates in ~30s.', true);
      return true;
    }
    var pe = await pr.json();
    st('✗ GitHub ' + pr.status + ': ' + pe.message, false);
    return false;
  } catch (e) {
    st('✗ Network error publishing: ' + e.message, false);
    return false;
  }
}
