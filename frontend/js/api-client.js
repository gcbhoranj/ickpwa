// api-client.js — every backend call goes through here. Credential travels in the JSON
// body, never a header (see docs/superpowers/specs/... §16 — Apps Script can't read
// headers and can't complete a CORS preflight).

const API_URL = 'https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec'; // https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
const SESSION_STORAGE_KEY = 'hpuick_session';

function getStoredSession() {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function storeSession(session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function _apiCallOnce(body) {
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    const err = new Error('Internet connection required for this operation. Please reconnect and try again.');
    err.code = 'NETWORK_ERROR';
    throw err;
  }
  // Apps Script's doGet/doPost response is itself a redirect to a one-time content URL
  // (script.googleusercontent.com/macros/echo?...); that URL occasionally isn't ready the
  // instant the script finishes, and Google Drive serves its own "Sorry, unable to open the
  // file at present" HTML error page instead — confirmed live, not guessed: a bare retry
  // succeeds immediately, no code-level cause. response.json() throws a SyntaxError
  // ("Unexpected token '<' ... is not valid JSON") on that HTML body; the caller below
  // catches exactly that and retries once before giving up.
  return response.json();
}

async function apiCall(action, payload) {
  const stored = getStoredSession();
  const body = {
    action: action,
    sessionId: stored ? stored.sessionId : null,
    requestId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    payload: payload || {}
  };
  let json;
  try {
    json = await _apiCallOnce(body);
  } catch (parseErr) {
    if (!(parseErr instanceof SyntaxError)) throw parseErr;
    // The retry re-invokes the action from scratch (a fresh script execution, not just a
    // re-fetch of the same result) — for a write action, this is only safe because every
    // write handler already guards against being called twice for the same thing
    // (ALREADY_CALCULATED / ALREADY_PAID / ALREADY_GENERATED / DUPLICATE, etc.). Worst case
    // if the original call actually did succeed server-side: the retry surfaces one of
    // those clear "already done" errors instead of silently duplicating data — a large
    // improvement over the unhandled "Unexpected token '<'" crash this replaces.
    json = await _apiCallOnce(body);
  }
  if (!json.ok) {
    const err = new Error((json.error && json.error.message) || 'Request failed.');
    err.code = json.error && json.error.code;
    throw err;
  }
  return json.data;
}
