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

async function apiCall(action, payload) {
  const stored = getStoredSession();
  const body = {
    action: action,
    sessionId: stored ? stored.sessionId : null,
    requestId: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    payload: payload || {}
  };
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
  const json = await response.json();
  if (!json.ok) {
    const err = new Error((json.error && json.error.message) || 'Request failed.');
    err.code = json.error && json.error.code;
    throw err;
  }
  return json.data;
}
