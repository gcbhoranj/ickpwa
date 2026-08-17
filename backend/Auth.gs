// Auth.gs — password hashing + session management (session functions added in Task 6).

function generateSalt_() {
  return Utilities.getUuid();
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function seedFirstAdmin_(name, email, password) {
  const existingAdmin = rowsToObjects_('USERS').some(function (u) { return u.Role === ROLES.ADMIN; });
  if (existingAdmin) {
    throw apiError_('ADMIN_EXISTS', 'An admin account already exists — seedFirstAdmin_ only runs once.');
  }
  const salt = generateSalt_();
  const userId = nextId_('USR', 4);
  const now = new Date().toISOString();
  appendRow_('USERS', {
    UserId: userId, Name: name, Email: email, LoginId: '', Role: ROLES.ADMIN,
    PasswordHash: hashPassword_(password, salt), PasswordSalt: salt, Active: true,
    CreatedDate: now, LastLoginAt: '', CreatedBy: 'setup', CreatedAt: now,
    UpdatedBy: 'setup', UpdatedAt: now
  });
  return { userId: userId, email: email };
}

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

function createSession_(userId, role) {
  const sessionId = Utilities.getUuid() + '-' + Utilities.getUuid();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();
  appendRow_('SESSIONS', {
    SessionId: sessionId, UserId: userId, Role: role, IssuedAt: now.toISOString(),
    ExpiresAt: expiresAt, Status: 'ACTIVE', LastSeenAt: now.toISOString()
  });
  return { sessionId: sessionId, expiresAt: expiresAt };
}

function validateSession_(sessionId) {
  if (!sessionId) return null;
  const found = findRowById_('SESSIONS', 'SessionId', sessionId);
  if (!found) return null;
  if (found.values.Status !== 'ACTIVE') return null;
  if (new Date(found.values.ExpiresAt).getTime() < Date.now()) return null;
  return { userId: found.values.UserId, role: found.values.Role, sessionId: sessionId };
}

function revokeSession_(sessionId) {
  const found = findRowById_('SESSIONS', 'SessionId', sessionId);
  if (found) updateRowById_('SESSIONS', 'SessionId', sessionId, { Status: 'REVOKED' });
}

function requireSession_(sessionId) {
  const session = validateSession_(sessionId);
  if (!session) throw apiError_('UNAUTHORIZED', 'Session is missing, expired, or revoked.');
  return session;
}

// Sheets can silently rewrite a boolean cell's stored value from the JS boolean `true`
// to the string `"true"` when the row is rewritten in place (e.g. by updateRowById_ against
// a plain-text-formatted cell). Compare loosely so both representations are recognized.
function _isActiveFlag_(value) {
  return value === true || value === 'true' || value === 'TRUE';
}

function _findActiveUserByIdentifier_(identifier) {
  const users = rowsToObjects_('USERS');
  return users.find(function (u) {
    return _isActiveFlag_(u.Active) && (u.Email === identifier || u.LoginId === identifier);
  }) || null;
}

function handleLogin_(identifier, password) {
  const user = _findActiveUserByIdentifier_(identifier);
  const now = new Date().toISOString();
  if (!user) {
    appendRow_('LOGIN_LOG', { LogId: nextId_('LOG', 6), Attempted: identifier, Result: 'FAIL_UNKNOWN', Timestamp: now });
    throw apiError_('INVALID_CREDENTIALS', 'Incorrect login ID/email or password.');
  }
  const expectedHash = hashPassword_(password, user.PasswordSalt);
  if (expectedHash !== user.PasswordHash) {
    appendRow_('LOGIN_LOG', { LogId: nextId_('LOG', 6), Attempted: identifier, Result: 'FAIL_PASSWORD', Timestamp: now });
    throw apiError_('INVALID_CREDENTIALS', 'Incorrect login ID/email or password.');
  }
  const session = createSession_(user.UserId, user.Role);
  updateRowById_('USERS', 'UserId', user.UserId, { LastLoginAt: now });
  appendRow_('LOGIN_LOG', { LogId: nextId_('LOG', 6), Attempted: identifier, Result: 'SUCCESS', Timestamp: now });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: user.UserId, Role: user.Role,
    Action: 'LOGIN', Entity: 'SESSION', EntityId: session.sessionId, PreviousState: '', NewState: ''
  });
  return {
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    user: { userId: user.UserId, name: user.Name, role: user.Role }
  };
}
