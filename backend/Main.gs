// Main.gs — single HTTP entry point, response envelope, action table.

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseBody_(e) {
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (parseErr) {
      throw apiError_('BAD_REQUEST', 'Request body is not valid JSON.');
    }
  }
  return { action: (e.parameter && e.parameter.action) || 'system.ping', payload: {} };
}

// action -> handler(payload, session). session is null for public actions.
const ACTIONS = {
  'system.ping': function () {
    return { pong: true, serverTime: new Date().toISOString() };
  },
  'system.selfTest': function () {
    return runAllTests_();
  },
  'admin.bootstrap.setupSchema': function () {
    return { sheetsEnsured: setupSchema_() };
  },
  'admin.bootstrap.seedSettings': function () {
    return { keysSeeded: seedSettings_() };
  },
  'admin.bootstrap.setupDriveFolders': function () {
    return setupDriveFolders_();
  },
  'admin.bootstrap.seedFirstAdmin': function (payload) {
    return seedFirstAdmin_(payload.name, payload.email, payload.password);
  },
  'auth.login': function (payload) {
    return handleLogin_(payload.identifier, payload.password);
  },
  'auth.logout': function (payload, sessionId) {
    requireSession_(sessionId);
    revokeSession_(sessionId);
    return { loggedOut: true };
  },
  'auth.whoami': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    const user = findRowById_('USERS', 'UserId', session.userId).values;
    return { userId: user.UserId, name: user.Name, role: user.Role, email: user.Email, loginId: user.LoginId };
  }
};

function handleRequest_(e) {
  try {
    const body = parseBody_(e);
    const action = body.action;
    const handler = ACTIONS[action];
    if (!handler) {
      throw apiError_('UNKNOWN_ACTION', 'No such action: ' + action);
    }
    const data = handler(body.payload || {}, body.sessionId || null);
    return jsonOutput_({ ok: true, data: data });
  } catch (err) {
    return jsonOutput_({
      ok: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message }
    });
  }
}
