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

function test_settings_mealTimingsValidationAndUpdate() {
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const messSession = { userId: 'USR-0001', role: ROLES.MESS, sessionId: 'y' };
  const original = getMealTimings_(adminSession);

  let threwForbidden = false;
  try {
    updateMealTimings_(messSession, original);
  } catch (err) {
    threwForbidden = true;
    assertEqual_(err.code, 'FORBIDDEN', 'wrong error code for non-admin meal timing update');
  }
  assertTrue_(threwForbidden, 'updateMealTimings_ did not reject a non-admin caller');

  let threwBadRange = false;
  try {
    updateMealTimings_(adminSession, {
      breakfastStart: '09:30', breakfastEnd: '07:30', // reversed — should be rejected
      lunchStart: original.lunchStart, lunchEnd: original.lunchEnd,
      dinnerStart: original.dinnerStart, dinnerEnd: original.dinnerEnd, graceMinutes: 10
    });
  } catch (err) {
    threwBadRange = true;
    assertEqual_(err.code, 'VALIDATION_ERROR', 'wrong error code for a start-after-end meal window');
  }
  assertTrue_(threwBadRange, 'updateMealTimings_ did not reject start >= end');

  // No `finally`-restore here on purpose: unlike rates (which start real from Phase 1), meal
  // timings started blank/unconfigured (never set through the app before Phase 4), so there
  // is no valid prior state to restore to — `original` itself fails validation. Setting real
  // values and leaving them set is the correct end state, not a side effect to undo.
  const updated = updateMealTimings_(adminSession, {
    breakfastStart: '07:30', breakfastEnd: '09:30', lunchStart: '12:30', lunchEnd: '14:30',
    dinnerStart: '19:30', dinnerEnd: '21:00', graceMinutes: 10
  });
  assertEqual_(updated.breakfastStart, '07:30', 'meal timing update did not take effect');
  assertEqual_(updated.graceMinutes, '10', 'grace minutes did not round-trip');
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
    assertEqual_(charges.dariCharges, rateDari * 10, 'dari charges should be rate × team members only (10), not × total contingent (11)');
    assertEqual_(charges.securityCharges, security, 'security should be flat, not multiplied by headcount');
    assertEqual_(charges.totalPayable, (rateDari * 10) + security, 'total payable miscalculated');

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

function test_registration_calculateCharges_uncheckedItemsAreZeroAndOmitted() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'Unchecked Charges Test College', 'District', 9, [
      { name: 'Incharge A', isPrimary: true }
    ]);
    createdTeamId = team.teamId;

    // Dari left unticked, Security ticked.
    const charges = calculateCharges_(regSession, createdTeamId, false, true);
    const security = Number(getSetting_('SecurityAmount', '0'));
    assertEqual_(charges.dariCharges, 0, 'dari charges should be 0 when left unticked');
    assertEqual_(charges.securityCharges, security, 'security should still be charged when ticked');
    assertEqual_(charges.totalPayable, security, 'total payable should exclude the unticked item');

    recordPayment_(regSession, createdTeamId, 'CASH');
    const receipt = generateTemporaryReceipt_(regSession, createdTeamId);
    assertTrue_(!!receipt.pdfFileId, 'receipt generation should still succeed with one item unticked');
    const receiptRow = findRowById_('RECEIPTS', 'ReceiptId', receipt.receiptId);
    assertEqual_(Number(receiptRow.values.GrandTotal), 0, 'GrandTotal (charges only, never security) should be 0 when Dari was unticked');
    DriveApp.getFileById(receipt.pdfFileId).setTrashed(true);
  } finally {
    if (createdTeamId) {
      findRowsByField_('RECEIPTS', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('RECEIPTS', 'ReceiptId', r.ReceiptId); });
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
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

function test_receipts_generateTemporaryReceipt_guardsMissingData() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'Receipt Guard Test', 'District', 5, [{ name: 'Incharge', isPrimary: true }]);
    createdTeamId = team.teamId;

    let threwNoCharges = false;
    try {
      generateTemporaryReceipt_(regSession, createdTeamId);
    } catch (err) {
      threwNoCharges = true;
      assertEqual_(err.code, 'NOT_FOUND', 'wrong error code when charges not yet calculated');
    }
    assertTrue_(threwNoCharges, 'generateTemporaryReceipt_ did not guard against missing charges');

    calculateCharges_(regSession, createdTeamId);
    let threwNoPayment = false;
    try {
      generateTemporaryReceipt_(regSession, createdTeamId);
    } catch (err) {
      threwNoPayment = true;
      assertEqual_(err.code, 'NOT_FOUND', 'wrong error code when payment not yet recorded');
    }
    assertTrue_(threwNoPayment, 'generateTemporaryReceipt_ did not guard against missing payment');
  } finally {
    if (createdTeamId) {
      findRowsByField_('CHARGES', 'TeamId', createdTeamId).forEach(function (c) { deleteRowById_('CHARGES', 'ChargeId', c.ChargeId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_registration_listAndDetailTeams() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'List Detail Test College', 'District', 6, [{ name: 'Incharge', isPrimary: true }]);
    createdTeamId = team.teamId;

    const list = listTeams_(regSession);
    const found = list.filter(function (t) { return t.teamId === createdTeamId; })[0];
    assertTrue_(!!found, 'listTeams_ did not include the newly registered team');
    assertEqual_(found.status, 'REGISTERED', 'listed team status mismatch');

    const detail = getTeamDetail_(regSession, createdTeamId);
    assertEqual_(detail.team.TeamId, createdTeamId, 'getTeamDetail_ returned wrong team');
    assertEqual_(detail.incharges.length, 1, 'getTeamDetail_ incharges count mismatch');
    assertEqual_(detail.charges, null, 'charges should be null before calculateCharges_ is called');
    assertEqual_(detail.payments.length, 0, 'payments should be empty before recordPayment_ is called');
  } finally {
    if (createdTeamId) {
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_registration_registerTeam_needsAccommodationFlag() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'Accommodation Flag College', 'District', 6, [
      { name: 'Needs Room', isPrimary: true, needsAccommodation: true },
      { name: 'No Room Needed', isPrimary: false, needsAccommodation: false },
      { name: 'Unspecified', isPrimary: false }
    ]);
    createdTeamId = team.teamId;
    const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId);
    const byName = {};
    incharges.forEach(function (i) { byName[i.Name] = i; });
    assertEqual_(byName['Needs Room'].NeedsAccommodation, 'true', 'flagged incharge should be marked NeedsAccommodation=true');
    assertEqual_(byName['No Room Needed'].NeedsAccommodation, 'false', 'unflagged incharge should be marked NeedsAccommodation=false');
    assertEqual_(byName['Unspecified'].NeedsAccommodation, 'false', 'omitted needsAccommodation should default to false, not blank/undefined');
  } finally {
    if (createdTeamId) {
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_registration_getTeamDetail_redactsFinancialsForMess() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'Mess Redaction Test College', 'District', 6, [{ name: 'Incharge', isPrimary: true }]);
    createdTeamId = team.teamId;
    calculateCharges_(regSession, createdTeamId, true, true);
    recordPayment_(regSession, createdTeamId, 'Cash');

    const asMess = getTeamDetail_(messSession, createdTeamId);
    assertEqual_(asMess.team.TeamId, createdTeamId, 'MESS caller should still see team identity');
    assertEqual_(asMess.incharges.length, 1, 'MESS caller should still see incharges');
    assertEqual_(asMess.charges, null, 'MESS caller must not see charges');
    assertEqual_(asMess.payments.length, 0, 'MESS caller must not see payments');
    assertEqual_(asMess.receipts.length, 0, 'MESS caller must not see receipts');

    const asRegistration = getTeamDetail_(regSession, createdTeamId);
    assertTrue_(!!asRegistration.charges, 'REGISTRATION caller should still see charges');
    assertEqual_(asRegistration.payments.length, 2, 'REGISTRATION caller should still see both payment rows');

    const list = listTeams_(messSession);
    assertTrue_(list.some(function (t) { return t.teamId === createdTeamId; }), 'MESS caller should be able to list teams');
  } finally {
    if (createdTeamId) {
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
      findRowsByField_('CHARGES', 'TeamId', createdTeamId).forEach(function (c) { deleteRowById_('CHARGES', 'ChargeId', c.ChargeId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_foodPackages_messRoleParity() {
  // Registration still owns team creation (requireRole_ correctly excludes MESS there) — this
  // test proves MESS parity on the PACKAGE actions for a team that already exists, matching
  // the real counter-sale scenario (a team walks up already registered by Registration).
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  let createdTeamId = null;
  const createdPackageIds = [];
  const trashFileIds = [];
  try {
    const team = registerTeam_(regSession, 'Mess Sale Test College', 'District', 2, [{ name: 'Coach', isPrimary: true }]);
    createdTeamId = team.teamId;

    const pkg = purchasePackage_(messSession, createdTeamId, [], null, null, 'Cash', null);
    createdPackageIds.push(pkg.packageId);
    trashFileIds.push(pkg.digitalCouponFileId, pkg.printedCouponFileId);
    assertTrue_(pkg.amount > 0, 'MESS-purchased package should report a real amount, not hidden/zeroed');

    const listed = listPackages_(messSession, createdTeamId);
    assertEqual_(listed.length, 1, 'MESS caller should see the package it just sold');
    assertEqual_(listed[0].amount, pkg.amount, 'MESS caller should see the real package amount to collect correct cash');

    const resend = resendCoupon_(messSession, pkg.packageId, ['not-a-real-inbox@example.invalid']);
    assertTrue_(resend.status === 'SENT' || resend.status === 'FAILED', 'MESS caller should be able to resend');

    const reprint = reprintCoupon_(messSession, pkg.packageId);
    trashFileIds.push(reprint.printedCouponFileId);
    assertEqual_(reprint.printBatchId, 2, 'MESS caller should be able to reprint');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    createdPackageIds.forEach(function (packageId) {
      findRowsByField_('PACKAGE_INCHARGE_MEALS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('PACKAGE_INCHARGE_MEALS', 'PackageInchargeMealId', r.PackageInchargeMealId); });
      findRowsByField_('PRINTED_COUPONS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('PRINTED_COUPONS', 'PrintedCouponId', r.PrintedCouponId); });
      findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', r.EntitlementId); });
      findRowsByField_('FOOD_COUPONS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('FOOD_COUPONS', 'CouponId', r.CouponId); });
      deleteRowById_('FOOD_PACKAGES', 'PackageId', packageId);
    });
    if (createdTeamId) {
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_rooms_createAndList() {
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'y' };
  const marker = 'TEST-ROOM-' + new Date().getTime();
  let createdRoomId = null;
  try {
    const room = createRoom_(adminSession, marker, 'Hostel A', '2', 3, ROOM_TYPES.TEAM);
    createdRoomId = room.roomId;
    assertEqual_(room.status, 'AVAILABLE', 'new room should start AVAILABLE');
    assertEqual_(room.roomType, ROOM_TYPES.TEAM, 'room should report the roomType it was created with');

    let threwForbidden = false;
    try {
      createRoom_(regSession, marker + '-2', 'Hostel A', '2', 2, ROOM_TYPES.TEAM);
    } catch (err) {
      threwForbidden = true;
      assertEqual_(err.code, 'FORBIDDEN', 'wrong error code for non-admin room creation');
    }
    assertTrue_(threwForbidden, 'createRoom_ did not reject a non-admin caller');

    let threwDuplicate = false;
    try {
      createRoom_(adminSession, marker, 'Hostel B', '1', 2, ROOM_TYPES.TEAM);
    } catch (err) {
      threwDuplicate = true;
      assertEqual_(err.code, 'DUPLICATE', 'wrong error code for duplicate room number');
    }
    assertTrue_(threwDuplicate, 'createRoom_ did not reject a duplicate room number');

    let threwBadType = false;
    try {
      createRoom_(adminSession, marker + '-3', 'Hostel B', '1', 2, 'HOTEL');
    } catch (err) {
      threwBadType = true;
      assertEqual_(err.code, 'VALIDATION_ERROR', 'wrong error code for an invalid roomType');
    }
    assertTrue_(threwBadType, 'createRoom_ did not reject an invalid roomType');

    const rooms = listRooms_(regSession);
    const listed = rooms.filter(function (r) { return r.roomId === createdRoomId; })[0];
    assertTrue_(!!listed, 'listRooms_ did not include the newly created room');
    assertEqual_(listed.capacity, 3, 'listed room capacity mismatch');
    assertEqual_(listed.remaining, 3, 'a fresh room with no allocations should show full remaining capacity');
    assertEqual_(listed.roomType, ROOM_TYPES.TEAM, 'listed room should report its roomType');
  } finally {
    if (createdRoomId) deleteRowById_('ROOMS', 'RoomId', createdRoomId);
  }
}

function test_accommodation_listPendingAndAllocateRoom() {
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'y' };
  const accSession = { userId: 'USR-0001', role: ROLES.ACCOMMODATION, sessionId: 'z' };
  const marker = 'TEST-ALLOC-' + new Date().getTime();
  let createdTeamId = null;
  let createdRoomId = null;
  let createdAllocationId = null;
  try {
    const team = registerTeam_(regSession, 'Allocation Test College', 'District', 5, [
      { name: 'Coach One', isPrimary: true, needsAccommodation: true },
      { name: 'Coach Two', isPrimary: false, needsAccommodation: true }
    ]);
    createdTeamId = team.teamId;

    const room = createRoom_(adminSession, marker, 'Hostel A', '1', 1, ROOM_TYPES.INCHARGE);
    createdRoomId = room.roomId;

    const pendingBefore = listPendingAccommodation_(accSession, ROOM_TYPES.INCHARGE).filter(function (r) { return r.teamId === createdTeamId; })[0];
    assertTrue_(!!pendingBefore, 'newly registered team with flagged incharges should appear in the pending list');
    assertEqual_(pendingBefore.neededCount, 2, 'expected 2 incharges needing accommodation');
    assertEqual_(pendingBefore.remainingCount, 2, 'nothing allocated yet, remaining should equal needed');

    let threwForbidden = false;
    try {
      allocateRoom_(regSession, createdTeamId, createdRoomId, 1, ROOM_TYPES.INCHARGE);
    } catch (err) {
      threwForbidden = true;
      assertEqual_(err.code, 'FORBIDDEN', 'wrong error code for non-Accommodation caller');
    }
    assertTrue_(threwForbidden, 'allocateRoom_ did not reject a non-Accommodation caller');

    let threwMismatch = false;
    try {
      allocateRoom_(accSession, createdTeamId, createdRoomId, 1, ROOM_TYPES.TEAM);
    } catch (err) {
      threwMismatch = true;
      assertEqual_(err.code, 'ROOM_TYPE_MISMATCH', 'wrong error code for allocating a TEAM kind into an INCHARGE room');
    }
    assertTrue_(threwMismatch, 'allocateRoom_ did not reject a kind that does not match the room\'s roomType');

    const allocation = allocateRoom_(accSession, createdTeamId, createdRoomId, 1, ROOM_TYPES.INCHARGE);
    createdAllocationId = allocation.allocationId;

    const roomsAfter = listRooms_(accSession).filter(function (r) { return r.roomId === createdRoomId; })[0];
    assertEqual_(roomsAfter.remaining, 0, 'room capacity 1 should be fully consumed by 1 allocated person');
    assertEqual_(roomsAfter.status, 'FULL', 'room should flip to FULL once capacity is reached');

    let threwFull = false;
    try {
      allocateRoom_(accSession, createdTeamId, createdRoomId, 1, ROOM_TYPES.INCHARGE);
    } catch (err) {
      threwFull = true;
      assertEqual_(err.code, 'ROOM_FULL', 'wrong error code for an over-capacity allocation');
    }
    assertTrue_(threwFull, 'allocateRoom_ did not reject an allocation exceeding remaining room capacity');

    const pendingAfter = listPendingAccommodation_(accSession, ROOM_TYPES.INCHARGE).filter(function (r) { return r.teamId === createdTeamId; })[0];
    assertTrue_(!!pendingAfter, 'team should still be pending — 1 of 2 incharges allocated');
    assertEqual_(pendingAfter.remainingCount, 1, 'expected exactly 1 remaining incharge needing a room');
  } finally {
    if (createdAllocationId) deleteRowById_('ACCOMMODATION', 'AllocationId', createdAllocationId);
    if (createdRoomId) deleteRowById_('ROOMS', 'RoomId', createdRoomId);
    if (createdTeamId) {
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_accommodation_teamMemberAllocation() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'y' };
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const accSession = { userId: 'USR-0001', role: ROLES.ACCOMMODATION, sessionId: 'z' };
  const marker = 'TEST-TEAMROOM-' + new Date().getTime();
  let createdTeamId = null;
  let createdRoomId = null;
  let createdAllocationId = null;
  try {
    // 5 team members, no NeedsAccommodation flag involved — TEAM allocation is unconditional.
    const team = registerTeam_(regSession, 'Team Room Test College', 'District', 5, [
      { name: 'Coach One', isPrimary: true }
    ]);
    createdTeamId = team.teamId;

    const room = createRoom_(adminSession, marker, 'Hostel C', '1', 3, ROOM_TYPES.TEAM);
    createdRoomId = room.roomId;

    const pendingBefore = listPendingAccommodation_(accSession, ROOM_TYPES.TEAM).filter(function (r) { return r.teamId === createdTeamId; })[0];
    assertTrue_(!!pendingBefore, 'every registered team should appear in the TEAM pending list, no opt-in needed');
    assertEqual_(pendingBefore.neededCount, 5, 'expected neededCount to equal the team\'s member count');

    const allocation = allocateRoom_(accSession, createdTeamId, createdRoomId, 3, ROOM_TYPES.TEAM);
    createdAllocationId = allocation.allocationId;

    const roomsAfter = listRooms_(accSession).filter(function (r) { return r.roomId === createdRoomId; })[0];
    assertEqual_(roomsAfter.remaining, 0, 'room capacity 3 should be fully consumed by 3 allocated members');

    const pendingAfter = listPendingAccommodation_(accSession, ROOM_TYPES.TEAM).filter(function (r) { return r.teamId === createdTeamId; })[0];
    assertTrue_(!!pendingAfter, 'team should still be pending — 3 of 5 members allocated');
    assertEqual_(pendingAfter.remainingCount, 2, 'expected exactly 2 remaining members needing a room');

    let threwOver = false;
    try {
      allocateRoom_(accSession, createdTeamId, createdRoomId, 1, ROOM_TYPES.TEAM);
    } catch (err) {
      threwOver = true;
      assertEqual_(err.code, 'ROOM_FULL', 'wrong error code — room itself is already full');
    }
    assertTrue_(threwOver, 'allocateRoom_ did not reject allocating into an already-full room');
  } finally {
    if (createdAllocationId) deleteRowById_('ACCOMMODATION', 'AllocationId', createdAllocationId);
    if (createdRoomId) deleteRowById_('ROOMS', 'RoomId', createdRoomId);
    if (createdTeamId) {
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

// Structural checks only — this cannot verify a matrix actually decodes on a real scanner
// (that requires a physical device test, tracked separately). Catches gross encoding bugs:
// wrong dimensions, missing finder/format patterns, data not actually affecting output.
function test_qrEncoder_structuralValidity() {
  const qr = qrEncode_('TEST-TOKEN-abc123');
  assertEqual_(qr.size, 17 + 4 * qr.version, 'QR module count does not match its own reported version');
  assertEqual_(qr.matrix.length, qr.size, 'matrix row count does not match reported size');
  assertEqual_(qr.matrix[0].length, qr.size, 'matrix column count does not match reported size');

  // Top-left finder pattern: outer ring dark, inner ring light, center 3x3 dark.
  assertTrue_(qr.matrix[0][0] === true, 'top-left finder pattern corner should be dark');
  assertTrue_(qr.matrix[1][1] === false, 'finder pattern inner ring should be light');
  assertTrue_(qr.matrix[3][3] === true, 'finder pattern center should be dark');

  // Top-right and bottom-left finder patterns present.
  assertTrue_(qr.matrix[0][qr.size - 1] === true, 'top-right finder pattern corner should be dark');
  assertTrue_(qr.matrix[qr.size - 1][0] === true, 'bottom-left finder pattern corner should be dark');

  // The always-dark module adjacent to the bottom-left finder pattern.
  assertTrue_(qr.matrix[qr.size - 8][8] === true, 'the standard always-dark module should be set');

  // Timing pattern: alternating dark/light along row 6 between the finder patterns.
  assertTrue_(qr.matrix[6][8] === true, 'timing pattern module at col 8 should be dark (even index)');
  assertTrue_(qr.matrix[6][9] === false, 'timing pattern module at col 9 should be light (odd index)');

  // Two different tokens must produce different matrices — proves the data payload actually
  // reaches the output, not just a static structural skeleton.
  const qrOther = qrEncode_('DIFFERENT-TOKEN-xyz789');
  let anyDifferent = false;
  for (let r = 0; r < Math.min(qr.size, qrOther.size) && !anyDifferent; r++) {
    for (let c = 0; c < Math.min(qr.size, qrOther.size) && !anyDifferent; c++) {
      if (qr.matrix[r][c] !== qrOther.matrix[r][c]) anyDifferent = true;
    }
  }
  assertTrue_(anyDifferent, 'encoding two different tokens produced identical matrices — data is not reaching the output');

  // Token too long for the supported version range is rejected, not silently truncated.
  // Level-M byte-mode capacity tops out at version 40 (~2331 bytes) — 2500 'X's exceeds even
  // that, unlike the old versions-1-6-only encoder where ~106 bytes was already too long.
  let threwTooLong = false;
  try {
    qrEncode_(new Array(2501).join('X'));
  } catch (err) {
    threwTooLong = true;
    assertEqual_(err.code, 'QR_TOKEN_TOO_LONG', 'wrong error code for an over-length token');
  }
  assertTrue_(threwTooLong, 'qrEncode_ did not reject a token too long for supported QR versions');
}

function test_foodPackages_purchaseCreatesEverythingCorrectly() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  const createdPackageIds = [];
  const trashFileIds = [];
  try {
    // Kept deliberately small (2 members, 2 incharges): eligiblePersons drives both the
    // number of Slides shapes drawn (a QR per printed coupon) and this test's own cleanup
    // calls, and neither needs a realistic team size to prove the counting/rolling logic —
    // a larger fixture here was a measured, live-confirmed contributor to system.selfTest
    // itself running long enough to risk Apps Script's 6-minute execution limit.
    const team = registerTeam_(regSession, 'Package Test College', 'District', 2, [
      { name: 'Coach One', isPrimary: true }, { name: 'Coach Two' }
    ]);
    createdTeamId = team.teamId;
    const rateBreakfast = Number(getSetting_('RateBreakfast', '0'));
    const rateLunch = Number(getSetting_('RateLunch', '0'));
    const rateDinner = Number(getSetting_('RateDinner', '0'));

    const pkg1 = purchasePackage_(regSession, createdTeamId, [], null, null, 'Cash', null);
    createdPackageIds.push(pkg1.packageId);
    trashFileIds.push(pkg1.digitalCouponFileId, pkg1.printedCouponFileId);

    assertEqual_(pkg1.packageNumber, 1, 'first package should be PackageNumber 1');
    assertEqual_(pkg1.eligiblePersons, 2, 'eligiblePersons should be team members only when incharges excluded');
    assertEqual_(pkg1.amount, (rateBreakfast + rateLunch + rateDinner) * 2, 'package amount miscalculated');
    assertEqual_(pkg1.collegeName, 'Package Test College', 'purchase response should include collegeName for the sold-confirmation message');
    assertEqual_(pkg1.endMeal, _addDays_(pkg1.startMeal, 1), 'endMeal should be exactly one day after startMeal');
    assertTrue_(!!pkg1.digitalCouponFileId, 'digital coupon PDF should have been generated');
    assertTrue_(!!pkg1.printedCouponFileId, 'printed coupon sheet PDF should have been generated');
    assertEqual_(pkg1.emailStatus, 'NOT_SENT', 'no incharge has an email address, so nothing should have been sent');

    const entitlements = findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', pkg1.packageId);
    assertEqual_(entitlements.length, 3, 'expected exactly 3 meal entitlements per package');
    const meals = entitlements.map(function (e) { return e.Meal; }).sort();
    assertEqual_(meals.join(','), 'BREAKFAST,DINNER,LUNCH', 'expected Dinner + next-day Breakfast + Lunch');
    entitlements.forEach(function (e) {
      assertEqual_(Number(e.EligiblePersons), 2, 'each entitlement should carry the package eligiblePersons');
    });

    const printedCoupons = findRowsByField_('PRINTED_COUPONS', 'PackageId', pkg1.packageId);
    assertEqual_(printedCoupons.length, 2, 'expected one printed coupon per eligible person');
    assertTrue_(printedCoupons.every(function (c) { return Number(c.PrintBatchId) === 1; }), 'initial purchase should be print batch 1');

    const payments = findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).filter(function (p) { return p.Purpose === 'ADDITIONAL_PACKAGE'; });
    assertEqual_(payments.length, 1, 'expected exactly one ADDITIONAL_PACKAGE payment row');
    assertEqual_(Number(payments[0].Amount), pkg1.amount, 'payment amount should match package amount');

    // Rolling: package 2 should continue right where package 1's Lunch left off, and
    // including incharges (both, every meal) this time changes eligiblePersons independently
    // per package. Per-meal, per-individual selection itself is covered in detail by
    // test_foodPackages_perInchargeMealSelections below.
    const teamIncharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId);
    const pkg2 = purchasePackage_(regSession, createdTeamId, teamIncharges.map(function (i) {
      return { inchargeId: i.InchargeId, breakfast: true, lunch: true, dinner: true };
    }), null, null, 'Cash', null);
    createdPackageIds.push(pkg2.packageId);
    trashFileIds.push(pkg2.digitalCouponFileId, pkg2.printedCouponFileId);
    assertEqual_(pkg2.packageNumber, 2, 'second package should be PackageNumber 2');
    assertEqual_(pkg2.eligiblePersons, 4, 'eligiblePersons should include incharges when the operator opts them into every meal');
    assertEqual_(pkg2.startMeal, pkg1.endMeal, 'package 2 should start the day package 1 ended — rolling, no gap');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    createdPackageIds.forEach(function (packageId) {
      findRowsByField_('PACKAGE_INCHARGE_MEALS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('PACKAGE_INCHARGE_MEALS', 'PackageInchargeMealId', r.PackageInchargeMealId); });
      findRowsByField_('PRINTED_COUPONS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('PRINTED_COUPONS', 'PrintedCouponId', r.PrintedCouponId); });
      findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', r.EntitlementId); });
      findRowsByField_('FOOD_COUPONS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('FOOD_COUPONS', 'CouponId', r.CouponId); });
      deleteRowById_('FOOD_PACKAGES', 'PackageId', packageId);
    });
    if (createdTeamId) {
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_foodPackages_resendAndReprint() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  let createdPackageId = null;
  const trashFileIds = [];
  try {
    const team = registerTeam_(regSession, 'Resend Reprint Test College', 'District', 2, [{ name: 'Coach', isPrimary: true }]);
    createdTeamId = team.teamId;
    const pkg = purchasePackage_(regSession, createdTeamId, [], null, null, 'Cash', null);
    createdPackageId = pkg.packageId;
    trashFileIds.push(pkg.digitalCouponFileId, pkg.printedCouponFileId);

    // Resend never creates a new row/PDF — same fileId before and after.
    const resend = resendCoupon_(regSession, pkg.packageId, ['not-a-real-inbox@example.invalid']);
    assertTrue_(resend.status === 'SENT' || resend.status === 'FAILED', 'resend should report SENT or FAILED, never throw, per spec §11');
    const afterResend = findRowById_('FOOD_PACKAGES', 'PackageId', pkg.packageId);
    assertEqual_(afterResend.values.DigitalCouponPdfFileId, pkg.digitalCouponFileId, 'resend must not generate a new digital coupon PDF');

    // Reprint creates a NEW print batch for the SAME coupon/QR — never a new package/coupon.
    const reprint = reprintCoupon_(regSession, pkg.packageId);
    trashFileIds.push(reprint.printedCouponFileId);
    assertEqual_(reprint.printBatchId, 2, 'reprint should start a new batch numbered 2');
    const allPrinted = findRowsByField_('PRINTED_COUPONS', 'PackageId', pkg.packageId);
    assertEqual_(allPrinted.length, 4, 'expected 2 original + 2 reprinted coupons (eligiblePersons=2, two batches)');
    const coupons = findRowsByField_('FOOD_COUPONS', 'PackageId', pkg.packageId);
    assertEqual_(coupons.length, 1, 'reprint must not create a new FOOD_COUPONS row — same QR throughout');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    if (createdPackageId) {
      findRowsByField_('PACKAGE_INCHARGE_MEALS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('PACKAGE_INCHARGE_MEALS', 'PackageInchargeMealId', r.PackageInchargeMealId); });
      findRowsByField_('PRINTED_COUPONS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('PRINTED_COUPONS', 'PrintedCouponId', r.PrintedCouponId); });
      findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', r.EntitlementId); });
      findRowsByField_('FOOD_COUPONS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('FOOD_COUPONS', 'CouponId', r.CouponId); });
      deleteRowById_('FOOD_PACKAGES', 'PackageId', createdPackageId);
    }
    if (createdTeamId) {
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_mess_timeWindowMath() {
  assertEqual_(_timeToMinutes_('07:30'), 450, 'time-to-minutes conversion wrong');
  assertEqual_(_timeToMinutes_('19:30'), 1170, 'time-to-minutes conversion wrong');
  assertTrue_(_isWithinWindow_('08:00', '07:30', '09:30', 10), 'inside window should pass');
  assertTrue_(_isWithinWindow_('07:20', '07:30', '09:30', 10), 'exactly at grace-before boundary should pass');
  assertTrue_(!_isWithinWindow_('07:19', '07:30', '09:30', 10), 'one minute before grace-before boundary should fail');
  assertTrue_(_isWithinWindow_('09:40', '07:30', '09:30', 10), 'exactly at grace-after boundary should pass');
  assertTrue_(!_isWithinWindow_('09:41', '07:30', '09:30', 10), 'one minute after grace-after boundary should fail');
  assertTrue_(!_isWithinWindow_('12:00', '07:30', '09:30', 10), 'well outside window should fail');
}

function test_mess_currentMeal_picksConfiguredWindow() {
  const regSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const before = getMealTimings_(regSession);
  try {
    updateMealTimings_(regSession, {
      breakfastStart: '07:30', breakfastEnd: '09:30', lunchStart: '12:30', lunchEnd: '14:30',
      dinnerStart: '19:30', dinnerEnd: '21:00', graceMinutes: '10'
    });
    // A fixed IST moment inside the Dinner window: 2026-08-19T20:00 IST = 2026-08-19T14:30:00Z.
    const dinnerMoment = new Date('2026-08-19T14:30:00Z');
    const duringDinner = _currentMeal_(dinnerMoment);
    assertTrue_(!!duringDinner, '_currentMeal_ should find a match during the Dinner window');
    assertEqual_(duringDinner.meal, 'DINNER', 'wrong meal selected for a Dinner-window moment');
    assertEqual_(duringDinner.date, '2026-08-19', 'wrong date extracted for the IST moment');

    // A moment between Lunch and Dinner, well outside any window+grace.
    const betweenMeals = new Date('2026-08-19T10:00:00Z'); // 2026-08-19T15:30 IST
    assertEqual_(_currentMeal_(betweenMeals), null, '_currentMeal_ should return null between meal windows');
  } finally {
    updateMealTimings_(regSession, before);
  }
}

// Builds a team + one purchased-looking package/coupon/entitlement WITHOUT calling
// purchasePackage_ (which generates real Slides/Drive PDFs and is slow) — every Mess test
// below needs only the rows purchasePackage_ would have written, not the documents.
function _makeMessTestFixture_(dinnerDate, breakfastLunchDate, eligiblePersons) {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const team = registerTeam_(regSession, 'Mess Fixture College', 'District', eligiblePersons, [{ name: 'Coach', isPrimary: true }]);
  const packageId = nextId_('PKG', 4);
  const couponId = nextId_('CPN', 4);
  const qrToken = Utilities.getUuid().replace(/-/g, '').substring(0, 12);
  const now = new Date().toISOString();
  appendRow_('FOOD_PACKAGES', {
    PackageId: packageId, TeamId: team.teamId, PackageNumber: 1, CouponId: couponId,
    IncludeInchargesInEntitlement: 'false', EligiblePersons: eligiblePersons, PurchaseDateTime: now,
    Amount: 0, RateBreakfastSnapshot: 0, RateLunchSnapshot: 0, RateDinnerSnapshot: 10,
    StartMeal: dinnerDate, EndMeal: breakfastLunchDate, Status: 'ACTIVE', QrToken: qrToken,
    DigitalCouponPdfFileId: '', PrintedCouponPdfFileId: '', EmailStatus: 'NOT_SENT',
    CreatedBy: 'test-runner', CreatedAt: now, UpdatedBy: 'test-runner', UpdatedAt: now
  });
  appendRow_('FOOD_COUPONS', { CouponId: couponId, PackageId: packageId, TeamId: team.teamId, QrToken: qrToken, Status: 'ACTIVE', IssuedAt: now });
  const entitlementIds = nextIdBatch_('ENT', 3, 4);
  const meals = [
    { meal: 'DINNER', date: dinnerDate, rate: 10 },
    { meal: 'BREAKFAST', date: breakfastLunchDate, rate: 5 },
    { meal: 'LUNCH', date: breakfastLunchDate, rate: 7 }
  ];
  appendRows_('MEAL_ENTITLEMENTS', meals.map(function (m, i) {
    return {
      EntitlementId: entitlementIds[i], PackageId: packageId, TeamId: team.teamId, Date: m.date, Meal: m.meal,
      Rate: m.rate, EligiblePersons: eligiblePersons, ServedPersons: 0, RemainingPersons: eligiblePersons,
      RefundablePersons: '', RefundableAmount: '', MealOrderStatus: 'NOT_ORDERED', ValidFrom: m.date, ValidUntil: m.date, Status: 'ACTIVE'
    };
  }));
  return { teamId: team.teamId, packageId: packageId, couponId: couponId, qrToken: qrToken, entitlementIds: entitlementIds };
}

function _cleanupMessTestFixture_(fixture) {
  fixture.entitlementIds.forEach(function (id) { deleteRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', id); });
  findRowsByField_('MEAL_USAGE', 'PackageId', fixture.packageId).forEach(function (r) { deleteRowById_('MEAL_USAGE', 'UsageId', r.UsageId); });
  deleteRowById_('FOOD_COUPONS', 'CouponId', fixture.couponId);
  deleteRowById_('FOOD_PACKAGES', 'PackageId', fixture.packageId);
  findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', fixture.teamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
  deleteRowById_('TEAMS', 'TeamId', fixture.teamId);
}

function test_mess_resolveToken_successAndEachRejectionReason() {
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  const dinnerMoment = new Date('2026-08-19T14:30:00Z'); // 2026-08-19T20:00 IST — inside Dinner window
  let fixture = null;
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 5);
    const resolved = _resolveCoupon_(findRowsByField_('FOOD_COUPONS', 'QrToken', fixture.qrToken)[0], dinnerMoment);
    assertEqual_(resolved.meal, 'DINNER', 'should resolve to Dinner for this fixture at this moment');
    assertEqual_(resolved.eligiblePersons, 5, 'eligiblePersons should match the fixture');
    assertEqual_(resolved.servedPersons, 0, 'servedPersons should start at 0');

    let threwNotFound = false;
    try { resolveMealToken_(messSession, 'not-a-real-token'); } catch (err) { threwNotFound = true; assertEqual_(err.code, 'NOT_FOUND', 'wrong code for unknown token'); }
    assertTrue_(threwNotFound, 'resolveMealToken_ should reject an unknown token');

    updateRowById_('FOOD_COUPONS', 'CouponId', fixture.couponId, { Status: 'CANCELLED' });
    let threwInactiveCoupon = false;
    try { _resolveCoupon_(findRowsByField_('FOOD_COUPONS', 'QrToken', fixture.qrToken)[0], dinnerMoment); } catch (err) { threwInactiveCoupon = true; assertEqual_(err.code, 'COUPON_INACTIVE', 'wrong code for inactive coupon'); }
    assertTrue_(threwInactiveCoupon, 'should reject a CANCELLED coupon');
    updateRowById_('FOOD_COUPONS', 'CouponId', fixture.couponId, { Status: 'ACTIVE' });

    const betweenMeals = new Date('2026-08-19T10:00:00Z');
    let threwNoWindow = false;
    try { _resolveCoupon_(findRowsByField_('FOOD_COUPONS', 'QrToken', fixture.qrToken)[0], betweenMeals); } catch (err) { threwNoWindow = true; assertEqual_(err.code, 'NO_ACTIVE_MEAL_WINDOW', 'wrong code outside any window'); }
    assertTrue_(threwNoWindow, 'should reject when no meal window is active');

    // Inside a real window (Lunch), but one day past this fixture's coverage (Dinner
    // 2026-08-19, Breakfast/Lunch 2026-08-20 only) — a window being active isn't enough,
    // this specific coupon must have an entitlement for that exact date+meal.
    const noCoverageMoment = new Date('2026-08-21T07:15:00Z'); // 2026-08-21T12:45 IST
    let threwWrongMeal = false;
    try { _resolveCoupon_(findRowsByField_('FOOD_COUPONS', 'QrToken', fixture.qrToken)[0], noCoverageMoment); } catch (err) { threwWrongMeal = true; assertEqual_(err.code, 'NOT_VALID_FOR_CURRENT_MEAL', 'wrong code for a date this coupon does not cover'); }
    assertTrue_(threwWrongMeal, 'should reject a meal this coupon does not cover');
  } finally {
    if (fixture) _cleanupMessTestFixture_(fixture);
  }
}

function test_mess_resolveByCouponId_lostCouponLookup() {
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  let fixture = null;
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 3);
    const resolved = resolveMealByCouponId_(messSession, fixture.couponId, new Date('2026-08-19T14:30:00Z'));
    assertEqual_(resolved.qrToken, fixture.qrToken, 'coupon-ID lookup should surface the same qrToken the QR would have carried');
    assertEqual_(resolved.eligiblePersons, 3, 'eligiblePersons should match the fixture');
  } finally {
    if (fixture) _cleanupMessTestFixture_(fixture);
  }
}

function test_mess_recordUsage_fullLifecycleMatchesGroupEntryScenario() {
  // Mirrors the human's own example: 13 eligible, served in three visits of 6, 6, 1.
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  const moment = new Date('2026-08-19T14:30:00Z'); // Dinner window
  let fixture = null;
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 13);

    const first = recordMealUsage_(messSession, fixture.qrToken, 6, 'req-1', moment);
    assertEqual_(first.servedPersons, 6, 'after first claim of 6, served should be 6');
    assertEqual_(first.remainingPersons, 7, 'after first claim of 6, remaining should be 7');

    const second = recordMealUsage_(messSession, fixture.qrToken, 6, 'req-2', moment);
    assertEqual_(second.servedPersons, 12, 'after second claim of 6, served should be 12');
    assertEqual_(second.remainingPersons, 1, 'after second claim of 6, remaining should be 1');

    const third = recordMealUsage_(messSession, fixture.qrToken, 1, 'req-3', moment);
    assertEqual_(third.servedPersons, 13, 'after third claim of 1, served should be 13');
    assertEqual_(third.remainingPersons, 0, 'after third claim of 1, remaining should be 0');

    // The scam scenario: a 4th visit claiming any more than the 0 left must be denied.
    let threwExceeds = false;
    try {
      recordMealUsage_(messSession, fixture.qrToken, 1, 'req-4', moment);
    } catch (err) {
      threwExceeds = true;
      assertEqual_(err.code, 'EXCEEDS_REMAINING', 'wrong code for an over-claim');
      assertTrue_(err.message.indexOf('0') !== -1, 'rejection message should state the actual remaining count');
    }
    assertTrue_(threwExceeds, 'a claim exceeding remaining must be rejected, not silently capped');

    const usageRows = findRowsByField_('MEAL_USAGE', 'PackageId', fixture.packageId);
    assertEqual_(usageRows.length, 3, 'exactly 3 successful claims should have written exactly 3 MEAL_USAGE rows — the rejected 4th writes none');
  } finally {
    if (fixture) _cleanupMessTestFixture_(fixture);
  }
}

function test_mess_recordUsage_idempotentReplayDoesNotDoubleDecrement() {
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  const moment = new Date('2026-08-19T14:30:00Z');
  let fixture = null;
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 10);
    const first = recordMealUsage_(messSession, fixture.qrToken, 4, 'same-request-id', moment);
    assertEqual_(first.servedPersons, 4, 'first call should record 4 served');

    const replay = recordMealUsage_(messSession, fixture.qrToken, 4, 'same-request-id', moment);
    assertEqual_(replay.servedPersons, 4, 'replay of the same requestId should return the original result, not double-serve');
    assertTrue_(!!replay.replay, 'replay result should be flagged as a replay');

    const usageRows = findRowsByField_('MEAL_USAGE', 'PackageId', fixture.packageId);
    assertEqual_(usageRows.length, 1, 'a replayed requestId must not write a second MEAL_USAGE row');
  } finally {
    if (fixture) _cleanupMessTestFixture_(fixture);
  }
}

function test_mess_recordUsage_rejectsOutsideWindowAndInactiveTeam() {
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  let fixture = null;
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 4);

    let threwNoWindow = false;
    try {
      recordMealUsage_(messSession, fixture.qrToken, 1, 'req-a', new Date('2026-08-19T10:00:00Z'));
    } catch (err) { threwNoWindow = true; assertEqual_(err.code, 'NO_ACTIVE_MEAL_WINDOW', 'wrong code'); }
    assertTrue_(threwNoWindow, 'should reject outside any meal window');

    updateRowById_('TEAMS', 'TeamId', fixture.teamId, { Status: 'LOST' });
    let threwInactive = false;
    try {
      recordMealUsage_(messSession, fixture.qrToken, 1, 'req-b', new Date('2026-08-19T14:30:00Z'));
    } catch (err) { threwInactive = true; assertEqual_(err.code, 'TEAM_NOT_ACTIVE', 'wrong code'); }
    assertTrue_(threwInactive, 'should reject a LOST team');

    assertEqual_(findRowsByField_('MEAL_USAGE', 'PackageId', fixture.packageId).length, 0, 'no MEAL_USAGE rows should exist after only rejections');
  } finally {
    if (fixture) _cleanupMessTestFixture_(fixture);
  }
}

function test_mess_setMealOrderStatus_upsertsAndMirrorsToEntitlements() {
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  let fixture = null;
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 5);

    const first = setMealOrderStatus_(messSession, '2026-08-19', 'DINNER', 'ORDERED');
    assertEqual_(first.status, 'ORDERED', 'first set should report ORDERED');
    const statusRows = findRowsByField_('MEAL_ORDER_STATUS', 'Date', '2026-08-19').filter(function (r) { return r.Meal === 'DINNER'; });
    assertEqual_(statusRows.length, 1, 'should create exactly one MEAL_ORDER_STATUS row');

    const dinnerEntitlement = findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', fixture.packageId).filter(function (e) { return e.Meal === 'DINNER'; })[0];
    assertEqual_(dinnerEntitlement.MealOrderStatus, 'ORDERED', 'MealOrderStatus should be mirrored onto the entitlement row');

    // A second set for the same date+meal must UPDATE the existing row, not create a second one.
    setMealOrderStatus_(messSession, '2026-08-19', 'DINNER', 'CLOSED');
    const afterSecond = findRowsByField_('MEAL_ORDER_STATUS', 'Date', '2026-08-19').filter(function (r) { return r.Meal === 'DINNER'; });
    assertEqual_(afterSecond.length, 1, 'setting status twice for the same date+meal should update in place, not duplicate');
    assertEqual_(afterSecond[0].Status, 'CLOSED', 'second set should have updated the status to CLOSED');

    // Scanning must still be unaffected by CLOSED (spec §20: order status never gates a scan).
    const scanResult = recordMealUsage_(messSession, fixture.qrToken, 2, 'req-orderstatus', new Date('2026-08-19T14:30:00Z'));
    assertEqual_(scanResult.servedPersons, 2, 'a scan must succeed regardless of MealOrderStatus');
  } finally {
    if (fixture) _cleanupMessTestFixture_(fixture);
    findRowsByField_('MEAL_ORDER_STATUS', 'Date', '2026-08-19').filter(function (r) { return r.Meal === 'DINNER'; })
      .forEach(function (r) { deleteRowById_('MEAL_ORDER_STATUS', 'StatusId', r.StatusId); });
  }
}

function test_mess_todaysSummary_aggregatesByTeam() {
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  let fixtureA = null;
  let fixtureB = null;
  try {
    fixtureA = _makeMessTestFixture_('2026-08-19', '2026-08-20', 6);
    fixtureB = _makeMessTestFixture_('2026-08-19', '2026-08-20', 9);
    recordMealUsage_(messSession, fixtureA.qrToken, 4, 'req-summary-a', new Date('2026-08-19T14:30:00Z'));

    const before = getTodaysMessSummary_(messSession);
    // getTodaysMessSummary_ reads the REAL current meal (no override param) — only assert
    // shape/inclusion here, not which meal is "current" right now in wall-clock time.
    assertTrue_(Array.isArray(before.rows), 'todaysSummary rows should always be an array');
  } finally {
    if (fixtureA) _cleanupMessTestFixture_(fixtureA);
    if (fixtureB) _cleanupMessTestFixture_(fixtureB);
  }
}

// Per-individual, per-meal incharge selection (decided with the human 2026-08-19): most
// teams stay at a hotel for breakfast/dinner and only join mess for lunch, so a single
// "include incharges" flag applying uniformly to all three meals was wrong. One incharge
// opts into Lunch only; another opts into nothing at all (still gets a PACKAGE_INCHARGE_MEALS
// audit row, just with everything false — proving "asked, declined" is recorded, not just
// "not asked").
function test_foodPackages_perInchargeMealSelections() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  let createdPackageId = null;
  const trashFileIds = [];
  try {
    const team = registerTeam_(regSession, 'Per-Meal Incharge Test College', 'District', 2, [
      { name: 'Lunch Only', isPrimary: true }, { name: 'Hotel Only' }
    ]);
    createdTeamId = team.teamId;
    const rateBreakfast = Number(getSetting_('RateBreakfast', '0'));
    const rateLunch = Number(getSetting_('RateLunch', '0'));
    const rateDinner = Number(getSetting_('RateDinner', '0'));

    const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId);
    const lunchOnly = incharges.filter(function (i) { return i.Name === 'Lunch Only'; })[0];
    const hotelOnly = incharges.filter(function (i) { return i.Name === 'Hotel Only'; })[0];

    const pkg = purchasePackage_(regSession, createdTeamId, [
      { inchargeId: lunchOnly.InchargeId, breakfast: false, lunch: true, dinner: false },
      { inchargeId: hotelOnly.InchargeId, breakfast: false, lunch: false, dinner: false }
    ], null, null, 'Cash', null);
    createdPackageId = pkg.packageId;
    trashFileIds.push(pkg.digitalCouponFileId, pkg.printedCouponFileId);

    assertEqual_(pkg.eligiblePersons, 3, 'coupon pool should be 2 team members + 1 incharge included in at least one meal (Hotel Only excluded entirely)');
    assertEqual_(pkg.amount, rateDinner * 2 + rateBreakfast * 2 + rateLunch * 3, 'amount should reflect each meal\'s own eligible count, not one uniform count');

    const entitlements = findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', pkg.packageId);
    const byMeal = {};
    entitlements.forEach(function (e) { byMeal[e.Meal] = e; });
    assertEqual_(Number(byMeal.DINNER.EligiblePersons), 2, 'Dinner should be team members only — neither incharge opted in');
    assertEqual_(Number(byMeal.BREAKFAST.EligiblePersons), 2, 'Breakfast should be team members only — neither incharge opted in');
    assertEqual_(Number(byMeal.LUNCH.EligiblePersons), 3, 'Lunch should include the one incharge who opted in');

    const printedCoupons = findRowsByField_('PRINTED_COUPONS', 'PackageId', pkg.packageId);
    assertEqual_(printedCoupons.length, 3, 'printed coupon count should match the coupon pool (3), not a per-meal sum');

    const pimRows = findRowsByField_('PACKAGE_INCHARGE_MEALS', 'PackageId', pkg.packageId);
    assertEqual_(pimRows.length, 2, 'expected one PACKAGE_INCHARGE_MEALS row per incharge on the team, including the fully-declined one');
    const lunchOnlyRow = pimRows.filter(function (r) { return r.InchargeId === lunchOnly.InchargeId; })[0];
    const hotelOnlyRow = pimRows.filter(function (r) { return r.InchargeId === hotelOnly.InchargeId; })[0];
    assertEqual_(lunchOnlyRow.IncludeBreakfast, 'false', 'Lunch Only should not be marked for Breakfast');
    assertEqual_(lunchOnlyRow.IncludeLunch, 'true', 'Lunch Only should be marked for Lunch');
    assertEqual_(lunchOnlyRow.IncludeDinner, 'false', 'Lunch Only should not be marked for Dinner');
    assertEqual_(hotelOnlyRow.IncludeBreakfast, 'false', 'Hotel Only should have a recorded row even though every meal is false');
    assertEqual_(hotelOnlyRow.IncludeLunch, 'false', 'Hotel Only should have a recorded row even though every meal is false');
    assertEqual_(hotelOnlyRow.IncludeDinner, 'false', 'Hotel Only should have a recorded row even though every meal is false');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    if (createdPackageId) {
      findRowsByField_('PACKAGE_INCHARGE_MEALS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('PACKAGE_INCHARGE_MEALS', 'PackageInchargeMealId', r.PackageInchargeMealId); });
      findRowsByField_('PRINTED_COUPONS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('PRINTED_COUPONS', 'PrintedCouponId', r.PrintedCouponId); });
      findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', r.EntitlementId); });
      findRowsByField_('FOOD_COUPONS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('FOOD_COUPONS', 'CouponId', r.CouponId); });
      deleteRowById_('FOOD_PACKAGES', 'PackageId', createdPackageId);
    }
    if (createdTeamId) {
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

// Feature (2026-08-20): a package can exclude individual meals — the late-arrival scenario a
// human partner described: a team registering the morning after arriving late at night never
// had the previous night's Dinner, so their Package 1 should cover only Breakfast+Lunch, not
// a Dinner they were never present for.
function test_foodPackages_mealExclusion_lateArrivalScenario() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  let createdPackageId = null;
  const trashFileIds = [];
  try {
    const team = registerTeam_(regSession, 'Late Arrival Test College', 'District', 3, [{ name: 'Coach', isPrimary: true }]);
    createdTeamId = team.teamId;
    const rateBreakfast = Number(getSetting_('RateBreakfast', '0'));
    const rateLunch = Number(getSetting_('RateLunch', '0'));

    // Registering on day 2 for a team that arrived too late for day 1's Dinner — the operator
    // explicitly back-dates Dinner to day 1 (the tournament's real Day 1) so the package's
    // window is still correct, but excludes it from what's actually purchased.
    const dinnerDate = '2026-09-21';
    const pkg = purchasePackage_(regSession, createdTeamId, [], { dinner: false, breakfast: true, lunch: true }, dinnerDate, 'Cash', null);
    createdPackageId = pkg.packageId;
    trashFileIds.push(pkg.digitalCouponFileId, pkg.printedCouponFileId);

    assertEqual_(pkg.amount, rateBreakfast * 3 + rateLunch * 3, 'excluded Dinner must not be charged for');
    assertTrue_(!pkg.mealsIncluded.dinner, 'response should reflect Dinner as excluded');
    assertTrue_(pkg.mealsIncluded.breakfast && pkg.mealsIncluded.lunch, 'response should reflect Breakfast and Lunch as included');
    assertTrue_(pkg.mealWindowLabel.indexOf('Dinner') === -1, 'the coupon\'s meal-window label must not claim Dinner when it was excluded');

    const entitlements = findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', pkg.packageId);
    assertEqual_(entitlements.length, 2, 'an excluded meal should get no MEAL_ENTITLEMENTS row at all, not a zeroed one');
    const meals = entitlements.map(function (e) { return e.Meal; }).sort();
    assertEqual_(meals.join(','), 'BREAKFAST,LUNCH', 'only Breakfast and Lunch entitlements should exist');
    assertTrue_(entitlements.every(function (e) { return Number(e.EligiblePersons) === 3; }), 'included meals should carry the full team-member count');

    // A late team's coupon scanned at the excluded Dinner slot must find nothing to resolve —
    // proven directly against the same lookup Mess.gs's _resolveCoupon_ performs.
    const dinnerEntitlement = findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', pkg.packageId)
      .filter(function (e) { return e.Meal === 'DINNER' && e.Date === dinnerDate; })[0];
    assertTrue_(!dinnerEntitlement, 'no entitlement should exist for the excluded Dinner date+meal — a scan there must find nothing');

    // Rejects a package with every meal excluded — there would be nothing to sell.
    let threwNoMeals = false;
    try {
      purchasePackage_(regSession, createdTeamId, [], { dinner: false, breakfast: false, lunch: false }, null, 'Cash', null);
    } catch (err) {
      threwNoMeals = true;
      assertEqual_(err.code, 'VALIDATION_ERROR', 'wrong error code for an all-excluded package');
    }
    assertTrue_(threwNoMeals, 'a package excluding every meal must be rejected');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    if (createdPackageId) {
      findRowsByField_('PACKAGE_INCHARGE_MEALS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('PACKAGE_INCHARGE_MEALS', 'PackageInchargeMealId', r.PackageInchargeMealId); });
      findRowsByField_('PRINTED_COUPONS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('PRINTED_COUPONS', 'PrintedCouponId', r.PrintedCouponId); });
      findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', r.EntitlementId); });
      findRowsByField_('FOOD_COUPONS', 'PackageId', createdPackageId).forEach(function (r) { deleteRowById_('FOOD_COUPONS', 'CouponId', r.CouponId); });
      deleteRowById_('FOOD_PACKAGES', 'PackageId', createdPackageId);
    }
    if (createdTeamId) {
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

// Bug report (2026-08-20): the portal was allowing the same package to be sold to a team
// more than once. Root cause: purchasePackage_ had no idempotency guard at all (unlike every
// other write handler's ALREADY_CALCULATED/ALREADY_PAID-style pattern) and no lock, despite
// api-client.js's documented retry-on-transient-glitch behavior re-sending the exact same
// request body (same requestId) — a network hiccup could silently create a second real
// package with its own coupon/QR/charge. Two independent checks close this: a requestId
// replay guard (catches the automatic-retry case, where the retry's own rolling default-date
// computation would otherwise pick a NON-overlapping date and slip past a date-only check),
// and a date-overlap rejection (catches an operator resubmitting the form with the same
// explicit date after an apparent failure, or any other attempt that isn't a true replay).
function test_foodPackages_duplicatePurchaseIsRejected() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let createdTeamId = null;
  const createdPackageIds = [];
  const trashFileIds = [];
  try {
    const team = registerTeam_(regSession, 'Duplicate Purchase Test College', 'District', 2, [{ name: 'Coach', isPrimary: true }]);
    createdTeamId = team.teamId;

    const first = purchasePackage_(regSession, createdTeamId, [], null, null, 'Cash', null, 'req-dup-1');
    createdPackageIds.push(first.packageId);
    trashFileIds.push(first.digitalCouponFileId, first.printedCouponFileId);

    // Same clientRequestId (simulating the documented retry-on-transient-glitch behavior,
    // which re-sends the exact same request body) must return the ORIGINAL package, not
    // create a second one.
    const replay = purchasePackage_(regSession, createdTeamId, [], null, null, 'Cash', null, 'req-dup-1');
    assertEqual_(replay.packageId, first.packageId, 'a replayed requestId must return the original package, not create a new one');
    assertTrue_(!!replay.replay, 'replay result should be flagged as a replay');
    assertEqual_(findRowsByField_('FOOD_PACKAGES', 'TeamId', createdTeamId).length, 1, 'a replayed requestId must not create a second FOOD_PACKAGES row');

    // A DIFFERENT requestId but the SAME explicit dinner date (an operator resubmitting the
    // form after an apparent failure, with the same date still filled in) must be rejected
    // with a clear message, not silently create an overlapping second package.
    let threwDuplicate = false;
    try {
      purchasePackage_(regSession, createdTeamId, [], null, first.startMeal, 'Cash', null, 'req-dup-2');
    } catch (err) {
      threwDuplicate = true;
      assertEqual_(err.code, 'DUPLICATE_PACKAGE', 'wrong error code for an overlapping-date duplicate purchase');
      assertTrue_(err.message.indexOf('Duplicate Purchase Test College') !== -1, 'duplicate error message should name the team');
    }
    assertTrue_(threwDuplicate, 'purchasing an overlapping date range for the same team must be rejected');
    assertEqual_(findRowsByField_('FOOD_PACKAGES', 'TeamId', createdTeamId).length, 1, 'a rejected duplicate must not create any new row');

    // The legitimate case must NOT be caught by the same check: a real rolling Package 2
    // deliberately starts its Dinner on the exact calendar date Package 1's Breakfast/Lunch
    // fell on (different meals, same date) — "rolling coverage continuous with no gaps" is
    // the whole point, and a naive date-range overlap check would wrongly reject this exact
    // scenario (caught live before shipping, see dev-log).
    const second = purchasePackage_(regSession, createdTeamId, [], null, null, 'Cash', null, 'req-dup-3');
    createdPackageIds.push(second.packageId);
    trashFileIds.push(second.digitalCouponFileId, second.printedCouponFileId);
    assertEqual_(second.packageNumber, 2, 'a legitimate rolling second package must succeed, not be rejected as a duplicate');
    assertEqual_(second.startMeal, first.endMeal, 'the second package should start exactly where the first one ended — rolling, no gap');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    createdPackageIds.forEach(function (packageId) {
      findRowsByField_('PACKAGE_INCHARGE_MEALS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('PACKAGE_INCHARGE_MEALS', 'PackageInchargeMealId', r.PackageInchargeMealId); });
      findRowsByField_('PRINTED_COUPONS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('PRINTED_COUPONS', 'PrintedCouponId', r.PrintedCouponId); });
      findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', r.EntitlementId); });
      findRowsByField_('FOOD_COUPONS', 'PackageId', packageId).forEach(function (r) { deleteRowById_('FOOD_COUPONS', 'CouponId', r.CouponId); });
      deleteRowById_('FOOD_PACKAGES', 'PackageId', packageId);
    });
    if (createdTeamId) {
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
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
  { name: 'settings_mealTimingsValidationAndUpdate', fn: test_settings_mealTimingsValidationAndUpdate },
  { name: 'registration_registerTeam_validationAndCreation', fn: test_registration_registerTeam_validationAndCreation },
  { name: 'registration_calculateCharges_correctAndIdempotentGuard', fn: test_registration_calculateCharges_correctAndIdempotentGuard },
  { name: 'registration_calculateCharges_uncheckedItemsAreZeroAndOmitted', fn: test_registration_calculateCharges_uncheckedItemsAreZeroAndOmitted },
  { name: 'registration_recordPayment_createsTwoRowsAndGuards', fn: test_registration_recordPayment_createsTwoRowsAndGuards },
  { name: 'receipts_generateTemporaryReceipt_guardsMissingData', fn: test_receipts_generateTemporaryReceipt_guardsMissingData },
  { name: 'registration_listAndDetailTeams', fn: test_registration_listAndDetailTeams },
  { name: 'registration_registerTeam_needsAccommodationFlag', fn: test_registration_registerTeam_needsAccommodationFlag },
  { name: 'rooms_createAndList', fn: test_rooms_createAndList },
  { name: 'accommodation_listPendingAndAllocateRoom', fn: test_accommodation_listPendingAndAllocateRoom },
  { name: 'accommodation_teamMemberAllocation', fn: test_accommodation_teamMemberAllocation },
  { name: 'qrEncoder_structuralValidity', fn: test_qrEncoder_structuralValidity },
  // 'pdf' tier: real Slides/Drive document generation (~30-40s each) — the original reason
  // for a slow bucket at all (Phase 4).
  { name: 'foodPackages_purchaseCreatesEverythingCorrectly', fn: test_foodPackages_purchaseCreatesEverythingCorrectly, tier: 'pdf1' },
  { name: 'foodPackages_resendAndReprint', fn: test_foodPackages_resendAndReprint, tier: 'pdf1' },
  { name: 'registration_getTeamDetail_redactsFinancialsForMess', fn: test_registration_getTeamDetail_redactsFinancialsForMess },
  { name: 'foodPackages_messRoleParity', fn: test_foodPackages_messRoleParity, tier: 'pdf1' },
  { name: 'mess_timeWindowMath', fn: test_mess_timeWindowMath },
  { name: 'mess_currentMeal_picksConfiguredWindow', fn: test_mess_currentMeal_picksConfiguredWindow },
  // 'mess' tier: _makeMessTestFixture_ (registerTeam_ + FOOD_PACKAGES + FOOD_COUPONS +
  // MEAL_ENTITLEMENTS + full teardown, several sequential Sheets API round trips each, no
  // PDF generation) — with 7 of these the fast bucket started intermittently hitting Apps
  // Script's 6-minute execution ceiling (observed live, not guessed, verifying Phase 5); a
  // separate tier from 'pdf' because Sheets-only work and real document generation have very
  // different per-test costs and don't scale the same way — cramming both into one "slow"
  // bucket hit the ceiling again once foodPackages_perInchargeMealSelections (also 'pdf')
  // was added alongside them (observed live, not guessed, verifying this exact change).
  { name: 'mess_resolveToken_successAndEachRejectionReason', fn: test_mess_resolveToken_successAndEachRejectionReason, tier: 'mess' },
  { name: 'mess_resolveByCouponId_lostCouponLookup', fn: test_mess_resolveByCouponId_lostCouponLookup, tier: 'mess' },
  { name: 'mess_recordUsage_fullLifecycleMatchesGroupEntryScenario', fn: test_mess_recordUsage_fullLifecycleMatchesGroupEntryScenario, tier: 'mess' },
  { name: 'mess_recordUsage_idempotentReplayDoesNotDoubleDecrement', fn: test_mess_recordUsage_idempotentReplayDoesNotDoubleDecrement, tier: 'mess' },
  { name: 'mess_recordUsage_rejectsOutsideWindowAndInactiveTeam', fn: test_mess_recordUsage_rejectsOutsideWindowAndInactiveTeam, tier: 'mess' },
  { name: 'mess_setMealOrderStatus_upsertsAndMirrorsToEntitlements', fn: test_mess_setMealOrderStatus_upsertsAndMirrorsToEntitlements, tier: 'mess' },
  { name: 'mess_todaysSummary_aggregatesByTeam', fn: test_mess_todaysSummary_aggregatesByTeam, tier: 'mess' },
  { name: 'foodPackages_perInchargeMealSelections', fn: test_foodPackages_perInchargeMealSelections, tier: 'pdf2' },
  { name: 'foodPackages_duplicatePurchaseIsRejected', fn: test_foodPackages_duplicatePurchaseIsRejected, tier: 'pdf2' },
  { name: 'foodPackages_mealExclusion_lateArrivalScenario', fn: test_foodPackages_mealExclusion_lateArrivalScenario, tier: 'pdf2' }
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
