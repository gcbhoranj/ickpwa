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
