// Tests.gs — hand-rolled assertion helpers + test registry + runner.
// Apps Script has no local test runner, so tests execute for real, inside the deployed
// script, via the system.selfTest action (see Global Constraints in the Phase 1 plan).

function assertEqual_(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((message || 'assertEqual failed') + ' — expected ' + b + ' got ' + a);
  }
}

function assertTrue_(condition, message) {
  if (!condition) {
    throw new Error(message || 'assertTrue failed');
  }
}

function test_sheetHelpers_appendFindUpdateDelete() {
  ensureSheet_('SETTINGS'); // SETTINGS is always safe to touch; used as the scratch sheet
  const testKey = '__TEST_KEY_' + new Date().getTime();
  try {
    setSetting_(testKey, 'v1', 'test-runner');
    assertEqual_(getSetting_(testKey, null), 'v1', 'initial set failed');
    setSetting_(testKey, 'v2', 'test-runner');
    assertEqual_(getSetting_(testKey, null), 'v2', 'upsert (update) failed');
    assertEqual_(getSetting_('__NEVER_SET__', 'fallback'), 'fallback', 'default value failed');
  } finally {
    // cleanup: remove the scratch row so SETTINGS stays clean, even if an assertion fails
    deleteRowById_('SETTINGS', 'Key', testKey);
  }
  assertEqual_(getSetting_(testKey, null), null, 'cleanup delete failed');
}

function test_setup_schemaAndSettingsIdempotent() {
  const firstRun = setupSchema_();
  assertEqual_(firstRun.length, Object.keys(SHEET_SCHEMAS).length, 'setupSchema_ did not ensure every sheet');
  const secondRun = setupSchema_(); // idempotency check
  assertEqual_(secondRun.length, firstRun.length, 'setupSchema_ not idempotent');

  seedSettings_();
  assertEqual_(getSetting_('FinancialSettingsLocked', null), 'false', 'default lock state missing');
  assertEqual_(getSetting_('Numbering_Receipt_Prefix', null), 'GCB/HPUICK/Receipt-', 'receipt prefix not seeded');
  assertEqual_(getSetting_('AllowSelfTest', null), 'true', 'AllowSelfTest not seeded');

  // Test that ISO-date-shaped values round-trip correctly without Google Sheets type coercion.
  // The plain-text formatting in appendRow_/updateRowById_ prevents Sheets from auto-converting
  // strings like '2026-09-21' to Date objects. Use a dedicated scratch key to verify this, then clean up.
  ensureSheet_('SETTINGS');
  const dateTestKey = '__TEST_DATE_KEY_' + new Date().getTime();
  try {
    setSetting_(dateTestKey, '2026-09-21', 'test-runner');
    assertEqual_(getSetting_(dateTestKey, null), '2026-09-21', 'date-shaped value corrupted by Sheets auto-conversion');
  } finally {
    // Cleanup: remove the scratch row so SETTINGS stays clean, even if an assertion fails
    deleteRowById_('SETTINGS', 'Key', dateTestKey);
  }
  assertEqual_(getSetting_(dateTestKey, null), null, 'cleanup delete failed');
}

function test_idGenerator_sequentialAndUnique() {
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(nextId_('TESTID', 4));
  const unique = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
  assertEqual_(unique.length, 5, 'nextId_ produced duplicates: ' + ids.join(','));
  assertTrue_(/^TESTID-\d{4}$/.test(ids[0]), 'unexpected ID format: ' + ids[0]);
  // sequential: each numeric suffix is exactly one more than the previous
  for (let i = 1; i < ids.length; i++) {
    const prev = parseInt(ids[i - 1].split('-')[1], 10);
    const curr = parseInt(ids[i].split('-')[1], 10);
    assertEqual_(curr, prev + 1, 'IDs not sequential: ' + ids[i - 1] + ' -> ' + ids[i]);
  }
}

function test_auth_passwordHashing() {
  const salt = generateSalt_();
  const hash1 = hashPassword_('correct horse battery staple', salt);
  const hash2 = hashPassword_('correct horse battery staple', salt);
  assertEqual_(hash1, hash2, 'hashing is not deterministic for same password+salt');
  const hash3 = hashPassword_('different password', salt);
  assertTrue_(hash1 !== hash3, 'different passwords produced the same hash');
  const otherSalt = generateSalt_();
  assertTrue_(salt !== otherSalt, 'generateSalt_ produced a duplicate');
}

function test_auth_sessionLifecycle() {
  const created = createSession_('USR-TEST', ROLES.ADMIN);
  assertTrue_(!!created.sessionId, 'createSession_ did not return a sessionId');

  const validated = validateSession_(created.sessionId);
  assertEqual_(validated.userId, 'USR-TEST', 'validateSession_ returned wrong userId');
  assertEqual_(validated.role, ROLES.ADMIN, 'validateSession_ returned wrong role');

  revokeSession_(created.sessionId);
  assertEqual_(validateSession_(created.sessionId), null, 'revoked session still validates');

  assertEqual_(validateSession_('not-a-real-session-id'), null, 'unknown session did not return null');

  // cleanup
  deleteRowById_('SESSIONS', 'SessionId', created.sessionId);
}

// Regression test for a real production bug: Sheets can silently rewrite a boolean cell's
// stored value from the JS boolean `true` to the string `"true"` when a row is rewritten in
// place (observed via updateRowById_ against a plain-text-formatted USERS row after login).
// _findActiveUserByIdentifier_ must recognize both representations.
function test_auth_findActiveUser_handlesStringBooleanActive() {
  const testEmail = '__test_active_flag_' + new Date().getTime() + '@example.com';
  appendRow_('USERS', {
    UserId: 'USR-TESTACTIVE', Name: 'Test', Email: testEmail, LoginId: '', Role: ROLES.ADMIN,
    PasswordHash: '', PasswordSalt: '', Active: 'true', CreatedDate: '', LastLoginAt: '',
    CreatedBy: 'test-runner', CreatedAt: '', UpdatedBy: 'test-runner', UpdatedAt: ''
  });
  try {
    const found = _findActiveUserByIdentifier_(testEmail);
    assertTrue_(!!found, '_findActiveUserByIdentifier_ did not find a user with string "true" Active');
    assertEqual_(found.UserId, 'USR-TESTACTIVE', 'found the wrong user');
  } finally {
    deleteRowById_('USERS', 'UserId', 'USR-TESTACTIVE');
  }
}

// Each task appends its own test_xxx function and registers it here.
const TEST_CASES = [
  { name: 'sheetHelpers_appendFindUpdateDelete', fn: test_sheetHelpers_appendFindUpdateDelete },
  { name: 'setup_schemaAndSettingsIdempotent', fn: test_setup_schemaAndSettingsIdempotent },
  { name: 'idGenerator_sequentialAndUnique', fn: test_idGenerator_sequentialAndUnique },
  { name: 'auth_passwordHashing', fn: test_auth_passwordHashing },
  { name: 'auth_sessionLifecycle', fn: test_auth_sessionLifecycle },
  { name: 'auth_findActiveUser_handlesStringBooleanActive', fn: test_auth_findActiveUser_handlesStringBooleanActive }
];

function runAllTests_() {
  const results = TEST_CASES.map(function (testCase) {
    try {
      testCase.fn();
      return { name: testCase.name, status: 'PASS' };
    } catch (err) {
      return { name: testCase.name, status: 'FAIL', error: err.message };
    }
  });
  const passCount = results.filter(function (r) { return r.status === 'PASS'; }).length;
  return {
    summary: passCount + '/' + results.length + ' passed',
    results: results
  };
}
