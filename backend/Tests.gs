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
  setSetting_(testKey, 'v1', 'test-runner');
  assertEqual_(getSetting_(testKey, null), 'v1', 'initial set failed');
  setSetting_(testKey, 'v2', 'test-runner');
  assertEqual_(getSetting_(testKey, null), 'v2', 'upsert (update) failed');
  assertEqual_(getSetting_('__NEVER_SET__', 'fallback'), 'fallback', 'default value failed');
  // cleanup: remove the scratch row so SETTINGS stays clean
  deleteRowById_('SETTINGS', 'Key', testKey);
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
}

// Each task appends its own test_xxx function and registers it here.
const TEST_CASES = [
  { name: 'sheetHelpers_appendFindUpdateDelete', fn: test_sheetHelpers_appendFindUpdateDelete },
  { name: 'setup_schemaAndSettingsIdempotent', fn: test_setup_schemaAndSettingsIdempotent }
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
