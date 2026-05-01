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
var TOKEN_STORAGE_KEY  = 'ghTokenBlob';
var DRIVE_TOKEN_FILE   = 'teacher_token.json';   // appdata-folder filename

// PBKDF2 iteration counts. Old blobs were encrypted at 310k. New blobs at 600k.
// We encode the count INSIDE the blob (4th component) so old blobs still decrypt.
var PBKDF2_ITERATIONS_LEGACY = 310000;
var PBKDF2_ITERATIONS_NEW    = 600000;

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
async function deriveKey(pin, sh, iterations) {
  // iterations is optional — defaults to legacy count for backward compatibility
  var iters = iterations || PBKDF2_ITERATIONS_LEGACY;
  var km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt:hexToBytes(sh), iterations:iters, hash:'SHA-256' },
    km,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}
// Encrypt with the new format (4-part: salt:iv:ciphertext:iterations).
// Always uses PBKDF2_ITERATIONS_NEW for newly-created blobs.
async function encryptToken(pin, tok) {
  var s = crypto.getRandomValues(new Uint8Array(16));
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var iters = PBKDF2_ITERATIONS_NEW;
  var k = await deriveKey(pin, bytesToHex(s), iters);
  var e = await crypto.subtle.encrypt({ name:'AES-GCM', iv:iv }, k, new TextEncoder().encode(tok));
  return bytesToHex(s) + ':' + bytesToHex(iv) + ':' + bytesToHex(e) + ':' + iters;
}
// Decrypt — handles both old 3-part blobs (legacy 310k) and new 4-part blobs
// (with iterations encoded). Returns null on any failure.
async function decryptToken(pin, blob) {
  try {
    var p = blob.split(':');
    if (p.length < 3) return null;
    // 4th part = iteration count; if missing, use legacy default
    var iters = (p.length >= 4) ? parseInt(p[3], 10) : PBKDF2_ITERATIONS_LEGACY;
    if (!iters || iters < 100000) iters = PBKDF2_ITERATIONS_LEGACY; // sanity floor
    var k = await deriveKey(pin, p[0], iters);
    var pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv:hexToBytes(p[1]) }, k, hexToBytes(p[2]));
    return new TextDecoder().decode(pt);
  } catch (e) {
    return null;
  }
}
// Decrypts the blob currently in secureStore (Drive first, localStorage fallback).
// If the decrypted token came from a legacy-format blob, opportunistically
// re-encrypts and re-saves it in the new format on the same backend.
async function getDecryptedToken(pin) {
  var b = await secureStore.getBlob();
  if (!b) return null;
  var tok = await decryptToken(pin, b);
  if (!tok) return null;
  // Opportunistic upgrade: if the loaded blob was legacy-format, re-encrypt
  // and save back to whichever backend it came from. Never blocks the unlock.
  try {
    var parts = b.split(':');
    if (parts.length < 4) {
      var newBlob = await encryptToken(pin, tok);
      await secureStore.putBlob(newBlob);
      console.log('[auth] upgraded token blob to 600k iterations');
    }
  } catch (e) {
    console.warn('[auth] blob upgrade failed (non-fatal):', e);
  }
  return tok;
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

// =============================================================================
// secureStore — abstracts where the encrypted token blob lives.
// -----------------------------------------------------------------------------
// Backends, in priority order:
//   1. Google Drive appdata folder (cross-device, requires sign-in)
//   2. localStorage (single-device fallback, always available)
//
// The page (index.html or activity-builder.html) is responsible for setting up
// _tokenClient via google.accounts.oauth2.initTokenClient and providing reqToken().
// secureStore detects whether reqToken is callable; if not, falls back to local.
//
// First-use migration: if Drive is available but empty, and localStorage has a
// blob, secureStore.getBlob() copies it to Drive on read.
// =============================================================================
var secureStore = (function(){
  // Cache the appdata file ID so we don't re-search every call
  var _cachedFileId = null;

  // Returns true if the page has set up Drive auth (i.e., reqToken exists).
  function _driveAvailable() {
    return typeof reqToken === 'function' && typeof _tokenClient !== 'undefined' && _tokenClient !== null;
  }

  // Get a fresh access token via the page's existing token client.
  async function _getAccessToken() {
    if (!_driveAvailable()) return null;
    try {
      return await reqToken();
    } catch (e) {
      console.warn('[secureStore] reqToken failed:', e);
      return null;
    }
  }

  // Find the appdata file ID (cached). Returns null if not found.
  async function _findFileId(accessToken) {
    if (_cachedFileId) return _cachedFileId;
    var url = 'https://www.googleapis.com/drive/v3/files'
      + '?spaces=appDataFolder'
      + '&q=' + encodeURIComponent("name='" + DRIVE_TOKEN_FILE + "' and trashed=false")
      + '&fields=files(id,name)';
    var r = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) {
      console.warn('[secureStore] _findFileId search failed:', r.status);
      return null;
    }
    var data = await r.json();
    if (data.files && data.files.length > 0) {
      _cachedFileId = data.files[0].id;
      return _cachedFileId;
    }
    return null;
  }

  // Read the file's text content from Drive, given its ID.
  async function _readFile(fileId, accessToken) {
    var r = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
      { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!r.ok) {
      console.warn('[secureStore] _readFile failed:', r.status);
      return null;
    }
    return r.text();
  }

  // Create the file in appdata folder with the given content. Returns file ID.
  async function _createFile(content, accessToken) {
    var metadata = { name: DRIVE_TOKEN_FILE, parents: ['appDataFolder'] };
    var boundary = 'sec_store_' + Math.random().toString(36).slice(2);
    var body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      content + '\r\n' +
      '--' + boundary + '--';
    var r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body: body
    });
    if (!r.ok) {
      console.warn('[secureStore] _createFile failed:', r.status, await r.text());
      return null;
    }
    var data = await r.json();
    _cachedFileId = data.id;
    return data.id;
  }

  // Update an existing file's content.
  async function _updateFile(fileId, content, accessToken) {
    var r = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'text/plain'
      },
      body: content
    });
    if (!r.ok) {
      console.warn('[secureStore] _updateFile failed:', r.status);
      return false;
    }
    return true;
  }

  // ----- Public API -----

  // Read the encrypted blob. Tries Drive first, falls back to localStorage.
  // If Drive is reachable but empty AND localStorage has a blob, migrates it.
  async function getBlob() {
    // Try Drive
    if (_driveAvailable()) {
      try {
        var token = await _getAccessToken();
        if (token) {
          var fid = await _findFileId(token);
          if (fid) {
            var content = await _readFile(fid, token);
            if (content) {
              console.log('[secureStore] loaded blob from Drive');
              return content;
            }
          }
          // Drive available but no file — check for migration candidate
          var localBlob = localStorage.getItem(TOKEN_STORAGE_KEY);
          if (localBlob) {
            console.log('[secureStore] migrating localStorage blob to Drive');
            var newFid = await _createFile(localBlob, token);
            if (newFid) {
              return localBlob;
            }
          }
        }
      } catch (e) {
        console.warn('[secureStore] Drive read failed, falling back:', e);
      }
    }
    // Fallback: localStorage
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  // Write the encrypted blob. Writes to whichever backend(s) are available.
  // Drive is authoritative when reachable; localStorage gets a synced copy
  // for offline access.
  async function putBlob(blob) {
    var droveOk = false;
    if (_driveAvailable()) {
      try {
        var token = await _getAccessToken();
        if (token) {
          var fid = await _findFileId(token);
          if (fid) {
            droveOk = await _updateFile(fid, blob, token);
          } else {
            var newFid = await _createFile(blob, token);
            droveOk = !!newFid;
          }
        }
      } catch (e) {
        console.warn('[secureStore] Drive write failed:', e);
      }
    }
    // Always write a local copy as a safety net
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, blob);
    } catch (e) {
      console.warn('[secureStore] localStorage write failed:', e);
    }
    return droveOk || true; // localStorage write succeeded
  }

  // Wipe the blob from both backends. Used by "lock + clear" or PIN reset.
  async function clearBlob() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    if (_driveAvailable()) {
      try {
        var token = await _getAccessToken();
        if (token) {
          var fid = await _findFileId(token);
          if (fid) {
            await fetch('https://www.googleapis.com/drive/v3/files/' + fid, {
              method: 'DELETE',
              headers: { Authorization: 'Bearer ' + token }
            });
            _cachedFileId = null;
          }
        }
      } catch (e) {
        console.warn('[secureStore] Drive clear failed:', e);
      }
    }
  }

  return {
    getBlob: getBlob,
    putBlob: putBlob,
    clearBlob: clearBlob,
    _isDriveAvailable: _driveAvailable
  };
})();
