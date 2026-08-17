// auth.js — login/logout/session-restore.

async function login(identifier, password) {
  const data = await apiCall('auth.login', { identifier: identifier, password: password });
  storeSession({ sessionId: data.sessionId, expiresAt: data.expiresAt, user: data.user });
  return data.user;
}

async function logout() {
  try { await apiCall('auth.logout', {}); } finally { clearStoredSession(); }
}

async function restoreSession() {
  const stored = getStoredSession();
  if (!stored) return null;
  try {
    const who = await apiCall('auth.whoami', {});
    return who;
  } catch (err) {
    clearStoredSession();
    return null;
  }
}
