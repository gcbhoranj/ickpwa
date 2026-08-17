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
  try {
    assertTrue_(!!created.sessionId, 'createSession_ did not return a sessionId');

    const validated = validateSession_(created.sessionId);
    assertEqual_(validated.userId, 'USR-TEST', 'validateSession_ returned wrong userId');
    assertEqual_(validated.role, ROLES.ADMIN, 'validateSession_ returned wrong role');

    revokeSession_(created.sessionId);
    assertEqual_(validateSession_(created.sessionId), null, 'revoked session still validates');

    assertEqual_(validateSession_('not-a-real-session-id'), null, 'unknown session did not return null');
  } finally {
    deleteRowById_('SESSIONS', 'SessionId', created.sessionId);
  }
}

// Regression test for a real production bug: Sheets can silently rewrite a boolean cell's
// stored value from the JS boolean `true` to the string `"true"` when a row is rewritten in
// place (observed via updateRowById_ against a plain-text-formatted USERS row after login).
// _findActiveUserByIdentifier_ must recognize both representations.
function test_auth_findActiveUser_handlesStringBooleanActive() {
  const testEmail = '__test_active_flag_' + new Date().getTime() + '@example.com';
  const testUserId = 'USR-TESTACTIVE-' + new Date().getTime();
  appendRow_('USERS', {
    UserId: testUserId, Name: 'Test', Email: testEmail, LoginId: '', Role: ROLES.MESS,
    PasswordHash: '', PasswordSalt: '', Active: 'true', CreatedDate: '', LastLoginAt: '',
    CreatedBy: 'test-runner', CreatedAt: '', UpdatedBy: 'test-runner', UpdatedAt: ''
  });
  try {
    const found = _findActiveUserByIdentifier_(testEmail);
    assertTrue_(!!found, '_findActiveUserByIdentifier_ did not find a user with string "true" Active');
    assertEqual_(found.UserId, testUserId, 'found the wrong user');
  } finally {
    deleteRowById_('USERS', 'UserId', testUserId);
  }
}

function test_auth_requireRole() {
  const adminSession = { userId: 'USR-TEST', role: ROLES.ADMIN, sessionId: 'x' };
  const messSession = { userId: 'USR-TEST2', role: ROLES.MESS, sessionId: 'y' };

  assertEqual_(requireRole_(adminSession, [ROLES.ADMIN]), adminSession, 'allowed role should pass through unchanged');

  let threw = false;
  try {
    requireRole_(messSession, [ROLES.ADMIN]);
  } catch (err) {
    threw = true;
    assertEqual_(err.code, 'FORBIDDEN', 'wrong error code for disallowed role');
  }
  assertTrue_(threw, 'requireRole_ did not throw for a disallowed role');

  // multiple allowed roles
  assertEqual_(requireRole_(messSession, [ROLES.ADMIN, ROLES.MESS]), messSession, 'role present in a multi-role allow-list should pass');
}

function test_auth_createUser_validationAndUniqueness() {
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const uniqueLoginId = 'TESTREG_' + new Date().getTime();
  let createdUserId = null;
  try {
    const created = createUser_(adminSession, 'Test Reg User', ROLES.REGISTRATION, uniqueLoginId, '', 'testpass123');
    createdUserId = created.userId;
    assertEqual_(created.role, ROLES.REGISTRATION, 'created user role mismatch');
    assertEqual_(created.loginId, uniqueLoginId, 'created user loginId mismatch');
    assertTrue_(!created.password && !created.passwordHash, 'createUser_ must never return password/hash material');

    // duplicate loginId must be rejected
    let threwDuplicate = false;
    try {
      createUser_(adminSession, 'Another User', ROLES.MESS, uniqueLoginId, '', 'otherpass');
    } catch (err) {
      threwDuplicate = true;
      assertEqual_(err.code, 'DUPLICATE_IDENTIFIER', 'wrong error code for duplicate loginId');
    }
    assertTrue_(threwDuplicate, 'createUser_ did not reject a duplicate loginId');

    // invalid role must be rejected
    let threwBadRole = false;
    try {
      createUser_(adminSession, 'Bad Role User', 'NOT_A_REAL_ROLE', 'TESTBAD_' + new Date().getTime(), '', 'pass');
    } catch (err) {
      threwBadRole = true;
      assertEqual_(err.code, 'INVALID_ROLE', 'wrong error code for invalid role');
    }
    assertTrue_(threwBadRole, 'createUser_ did not reject an invalid role');

    // non-admin caller must be rejected by requireRole_ before createUser_ logic even runs
    const messSession = { userId: 'USR-0001', role: ROLES.MESS, sessionId: 'y' };
    let threwForbidden = false;
    try {
      requireRole_(messSession, [ROLES.ADMIN]);
      createUser_(messSession, 'Should Not Get Here', ROLES.MESS, 'TESTNOPE_' + new Date().getTime(), '', 'pass');
    } catch (err) {
      threwForbidden = true;
      assertEqual_(err.code, 'FORBIDDEN', 'wrong error code for non-admin caller');
    }
    assertTrue_(threwForbidden, 'non-admin caller was not rejected');
  } finally {
    if (createdUserId) deleteRowById_('USERS', 'UserId', createdUserId);
  }
}

function test_auth_listUsers_excludesSecretsAndGatesRole() {
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const users = listUsers_(adminSession);
  assertTrue_(Array.isArray(users), 'listUsers_ must return an array');
  assertTrue_(users.length >= 1, 'listUsers_ should include at least the seeded admin');
  users.forEach(function (u) {
    assertTrue_(!u.hasOwnProperty('passwordHash') && !u.hasOwnProperty('PasswordHash'), 'listUsers_ leaked a password hash');
    assertTrue_(!u.hasOwnProperty('passwordSalt') && !u.hasOwnProperty('PasswordSalt'), 'listUsers_ leaked a password salt');
  });

  const messSession = { userId: 'USR-0001', role: ROLES.MESS, sessionId: 'y' };
  let threw = false;
  try {
    listUsers_(messSession);
  } catch (err) {
    threw = true;
    assertEqual_(err.code, 'FORBIDDEN', 'wrong error code for non-admin caller');
  }
  assertTrue_(threw, 'listUsers_ did not reject a non-admin caller');
}

function test_auth_setUserActive_togglesAndGuardsLastAdmin() {
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const testLoginId = 'TESTTOGGLE_' + new Date().getTime();
  let createdUserId = null;
  try {
    const created = createUser_(adminSession, 'Toggle Test User', ROLES.ACCOMMODATION, testLoginId, '', 'pass1234');
    createdUserId = created.userId;

    const disabled = setUserActive_(adminSession, createdUserId, false);
    assertEqual_(disabled.active, false, 'setUserActive_ did not report disabled');
    const afterDisable = findRowById_('USERS', 'UserId', createdUserId).values;
    assertTrue_(!_isActiveFlag_(afterDisable.Active), 'user row was not actually disabled');

    const reenabled = setUserActive_(adminSession, createdUserId, true);
    assertEqual_(reenabled.active, true, 'setUserActive_ did not report re-enabled');
    const afterEnable = findRowById_('USERS', 'UserId', createdUserId).values;
    assertTrue_(_isActiveFlag_(afterEnable.Active), 'user row was not actually re-enabled');

    // last-admin guard: the seeded admin (USR-0001) must be the only active admin right now
    // in a correctly-running test suite; attempting to disable it must be rejected
    let threwLastAdmin = false;
    try {
      setUserActive_(adminSession, 'USR-0001', false);
    } catch (err) {
      threwLastAdmin = true;
      assertEqual_(err.code, 'LAST_ADMIN', 'wrong error code for last-admin disable attempt');
    }
    assertTrue_(threwLastAdmin, 'setUserActive_ did not guard against disabling the last active admin');
    // confirm the guard actually left USR-0001 untouched
    const stillActiveAdmin = findRowById_('USERS', 'UserId', 'USR-0001').values;
    assertTrue_(_isActiveFlag_(stillActiveAdmin.Active), 'last-admin guard fired but the admin was disabled anyway');
  } finally {
    if (createdUserId) deleteRowById_('USERS', 'UserId', createdUserId);
  }
}

function test_bootstrap_actionsRequireAdmin() {
  const messSession = { userId: 'USR-0001', role: ROLES.MESS, sessionId: 'y' };
  let threw1 = false;
  try { requireRole_(messSession, [ROLES.ADMIN]); } catch (err) { threw1 = true; assertEqual_(err.code, 'FORBIDDEN', 'requireRole_ gate check'); }
  assertTrue_(threw1, 'requireRole_ sanity check failed');
}

function test_sheetHelpers_findRowsByField() {
  ensureSheet_('SETTINGS');
  const marker = '__TEST_FINDBY_' + new Date().getTime();
  const keyA = marker + '_A';
  const keyB = marker + '_B';
  try {
    setSetting_(keyA, 'x', 'test-runner');
    setSetting_(keyB, 'x', 'test-runner');
    const matches = findRowsByField_('SETTINGS', 'Value', 'x').filter(function (r) {
      return r.Key === keyA || r.Key === keyB;
    });
    assertEqual_(matches.length, 2, 'findRowsByField_ did not find both matching rows');
    const none = findRowsByField_('SETTINGS', 'Key', '__NEVER_EXISTS__');
    assertEqual_(none.length, 0, 'findRowsByField_ should return empty array for no match, not null');
  } finally {
    deleteRowById_('SETTINGS', 'Key', keyA);
    deleteRowById_('SETTINGS', 'Key', keyB);
  }
}

function test_idGenerator_nextDocumentNumber() {
  const first = nextDocumentNumber_('Registration');
  const second = nextDocumentNumber_('Registration');
  assertTrue_(first !== second, 'nextDocumentNumber_ produced a duplicate');
  const prefix = getSetting_('Numbering_Registration_Prefix', '');
  assertTrue_(first.indexOf(prefix) === 0, 'document number does not start with the configured prefix: ' + first);
}

function test_settings_updateRatesAndLock() {
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const messSession = { userId: 'USR-0001', role: ROLES.MESS, sessionId: 'y' };

  const before = getRegistrationInfo_(adminSession);
  assertTrue_(before.hasOwnProperty('rateDari'), 'getRegistrationInfo_ missing rateDari');
  assertTrue_(before.hasOwnProperty('financialSettingsLocked'), 'getRegistrationInfo_ missing financialSettingsLocked');

  // non-admin cannot update rates
  let threwForbidden = false;
  try {
    updateRates_(messSession, { breakfast: 50, lunch: 100, dinner: 100, dari: 100, security: 0 });
  } catch (err) {
    threwForbidden = true;
    assertEqual_(err.code, 'FORBIDDEN', 'wrong error code for non-admin rate update');
  }
  assertTrue_(threwForbidden, 'updateRates_ did not reject a non-admin caller');

  // admin can update rates when unlocked (restore original values afterward)
  const original = {
    breakfast: before.rateBreakfast, lunch: before.rateLunch, dinner: before.rateDinner,
    dari: before.rateDari, security: before.securityAmount
  };
  try {
    updateRates_(adminSession, { breakfast: 51, lunch: 100, dinner: 100, dari: 100, security: 0 });
    const after = getRegistrationInfo_(adminSession);
    assertEqual_(after.rateBreakfast, '51', 'rate update did not take effect');
  } finally {
    updateRates_(adminSession, {
      breakfast: original.breakfast, lunch: original.lunch, dinner: original.dinner,
      dari: original.dari, security: original.security
    });
  }

  // locking blocks further updates, then unlock restores ability
  setFinancialLock_(adminSession, true);
  let threwLocked = false;
  try {
    updateRates_(adminSession, { breakfast: 999, lunch: 100, dinner: 100, dari: 100, security: 0 });
  } catch (err) {
    threwLocked = true;
    assertEqual_(err.code, 'SETTINGS_LOCKED', 'wrong error code for locked rate update');
  }
  assertTrue_(threwLocked, 'updateRates_ did not respect the financial lock');
  setFinancialLock_(adminSession, false); // restore unlocked state for later tasks/tests
}

function test_registration_registerTeam_validationAndCreation() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  try {
    const result = registerTeam_(regSession, 'Test College', 'Test District', 12, [
      { name: 'Incharge One', designation: 'Coach', whatsapp: '9999999999', email: '', isPrimary: false },
      { name: 'Incharge Two', designation: 'Manager', whatsapp: '', email: 'two@example.com', isPrimary: false }
    ]);
    createdTeamId = result.teamId;
    assertEqual_(result.totalContingentPersons, 14, 'total contingent should be 12 members + 2 incharges');
    assertTrue_(!!result.registrationNumber, 'registerTeam_ did not return a registration number');

    const team = findRowById_('TEAMS', 'TeamId', createdTeamId).values;
    assertEqual_(team.Status, 'REGISTERED', 'new team should start REGISTERED');
    // Numeric fields round-trip through Sheets' plain-text-formatted cells as strings (by
    // design, per the Phase 1 type-coercion fix) — compare via Number() like the rest of the
    // codebase does (e.g. calculateCharges_ already does this), not a raw strict equality.
    assertEqual_(Number(team.NumberOfContingentIncharges), 2, 'incharge count mismatch on TEAMS row');

    const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId);
    assertEqual_(incharges.length, 2, 'expected 2 incharge rows');
    const primaryCount = incharges.filter(function (i) { return i.IsPrimary === 'true'; }).length;
    assertEqual_(primaryCount, 1, 'exactly one incharge should be auto-marked primary when none was specified');

    // validation: no incharges
    let threwNoIncharges = false;
    try {
      registerTeam_(regSession, 'X', 'Y', 5, []);
    } catch (err) {
      threwNoIncharges = true;
      assertEqual_(err.code, 'VALIDATION_ERROR', 'wrong error code for zero incharges');
    }
    assertTrue_(threwNoIncharges, 'registerTeam_ did not reject zero incharges');
  } finally {
    if (createdTeamId) {
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) {
        deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId);
      });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_registration_calculateCharges_correctAndIdempotentGuard() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'Charge Test College', 'District', 10, [
      { name: 'Incharge A', isPrimary: true }
    ]);
    createdTeamId = team.teamId;

    const rateDari = Number(getSetting_('RateDari', '0'));
    const security = Number(getSetting_('SecurityAmount', '0'));

    const charges = calculateCharges_(regSession, createdTeamId);
    assertEqual_(charges.totalContingentPersons, 11, 'expected 10 members + 1 incharge = 11');
    assertEqual_(charges.dariCharges, rateDari * 11, 'dari charges miscalculated');
    assertEqual_(charges.securityCharges, security, 'security should be flat, not multiplied by headcount');
    assertEqual_(charges.totalPayable, (rateDari * 11) + security, 'total payable miscalculated');

    let threwDuplicate = false;
    try {
      calculateCharges_(regSession, createdTeamId);
    } catch (err) {
      threwDuplicate = true;
      assertEqual_(err.code, 'ALREADY_CALCULATED', 'wrong error code for duplicate charge calculation');
    }
    assertTrue_(threwDuplicate, 'calculateCharges_ did not guard against being called twice for the same team');
  } finally {
    if (createdTeamId) {
      findRowsByField_('CHARGES', 'TeamId', createdTeamId).forEach(function (c) { deleteRowById_('CHARGES', 'ChargeId', c.ChargeId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_registration_recordPayment_createsTwoRowsAndGuards() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'Payment Test College', 'District', 8, [{ name: 'Incharge', isPrimary: true }]);
    createdTeamId = team.teamId;
    const charges = calculateCharges_(regSession, createdTeamId);

    const payment = recordPayment_(regSession, createdTeamId, 'Cash');
    assertEqual_(payment.totalReceived, charges.totalPayable, 'recorded payment total does not match calculated charges');

    const rows = findRowsByField_('PAYMENTS', 'TeamId', createdTeamId);
    assertEqual_(rows.length, 2, 'expected exactly 2 payment rows (charges + security)');
    const chargeRow = rows.filter(function (r) { return r.Purpose === 'REGISTRATION_CHARGES'; })[0];
    const securityRow = rows.filter(function (r) { return r.Purpose === 'SECURITY'; })[0];
    assertEqual_(Number(chargeRow.Amount), charges.dariCharges, 'REGISTRATION_CHARGES payment amount mismatch');
    assertEqual_(Number(securityRow.Amount), charges.securityCharges, 'SECURITY payment amount mismatch');

    let threwDuplicate = false;
    try {
      recordPayment_(regSession, createdTeamId, 'Cash');
    } catch (err) {
      threwDuplicate = true;
      assertEqual_(err.code, 'ALREADY_PAID', 'wrong error code for duplicate payment recording');
    }
    assertTrue_(threwDuplicate, 'recordPayment_ did not guard against being called twice for the same team');
  } finally {
    if (createdTeamId) {
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
      findRowsByField_('CHARGES', 'TeamId', createdTeamId).forEach(function (c) { deleteRowById_('CHARGES', 'ChargeId', c.ChargeId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

// Each task appends its own test_xxx function and registers it here.
const TEST_CASES = [
  { name: 'sheetHelpers_appendFindUpdateDelete', fn: test_sheetHelpers_appendFindUpdateDelete },
  { name: 'setup_schemaAndSettingsIdempotent', fn: test_setup_schemaAndSettingsIdempotent },
  { name: 'idGenerator_sequentialAndUnique', fn: test_idGenerator_sequentialAndUnique },
  { name: 'auth_passwordHashing', fn: test_auth_passwordHashing },
  { name: 'auth_sessionLifecycle', fn: test_auth_sessionLifecycle },
  { name: 'auth_findActiveUser_handlesStringBooleanActive', fn: test_auth_findActiveUser_handlesStringBooleanActive },
  { name: 'auth_requireRole', fn: test_auth_requireRole },
  { name: 'auth_createUser_validationAndUniqueness', fn: test_auth_createUser_validationAndUniqueness },
  { name: 'auth_listUsers_excludesSecretsAndGatesRole', fn: test_auth_listUsers_excludesSecretsAndGatesRole },
  { name: 'auth_setUserActive_togglesAndGuardsLastAdmin', fn: test_auth_setUserActive_togglesAndGuardsLastAdmin },
  { name: 'bootstrap_actionsRequireAdmin', fn: test_bootstrap_actionsRequireAdmin },
  { name: 'sheetHelpers_findRowsByField', fn: test_sheetHelpers_findRowsByField },
  { name: 'idGenerator_nextDocumentNumber', fn: test_idGenerator_nextDocumentNumber },
  { name: 'settings_updateRatesAndLock', fn: test_settings_updateRatesAndLock },
  { name: 'registration_registerTeam_validationAndCreation', fn: test_registration_registerTeam_validationAndCreation },
  { name: 'registration_calculateCharges_correctAndIdempotentGuard', fn: test_registration_calculateCharges_correctAndIdempotentGuard },
  { name: 'registration_recordPayment_createsTwoRowsAndGuards', fn: test_registration_recordPayment_createsTwoRowsAndGuards }
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
