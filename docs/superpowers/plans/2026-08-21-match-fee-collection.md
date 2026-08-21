# Match Fee Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Match Fee Collection module to the Registration Committee portal — two new
sheets, a `MatchFee.gs` backend, Admin financial-settings/reporting integration, and new
frontend screens — without touching Final Receipt/settlement logic.

**Architecture:** New `backend/MatchFee.gs` (match CRUD, per-team payment transactions, their
own receipt PDFs/emails, resend/void) + additive extensions to `Constants.gs`/`Setup.gs`/
`Settings.gs`/`Reports.gs`/`Main.gs` + a new `frontend/js/matchfee.js` + small additive
wiring in `registration.js`/`settings.js`/`reports.js`. No existing sheet, screen, or
document is redesigned.

**Tech Stack:** Same as every prior phase — Google Apps Script (V8) backend over a Google
Sheet, vanilla JS PWA frontend, Google Slides→PDF document generation, GmailApp email.

**Spec:** `docs/superpowers/specs/2026-08-21-match-fee-collection-design.md` (all sections).

## Global Constraints

- Deployment ID: `AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI`. Web
  App URL: `https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`.
- **This deployment is pinned by version, not `@HEAD`**: `clasp push` alone does not reach the
  live Web App URL — always follow with `clasp deploy -i <id>` before verifying against it.
- **curl gotcha: never use `-L` with POST.**
  ```bash
  URL="https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec"
  call_action() {
    curl -s -D /tmp/hpuick_headers.txt -o /tmp/hpuick_body.json -X POST -H "Content-Type: text/plain" --data-raw "$1" "$URL"
    LOCATION=$(grep -i '^location:' /tmp/hpuick_headers.txt | sed 's/^[Ll]ocation: //' | tr -d '\r')
    if [ -n "$LOCATION" ]; then curl -s "$LOCATION"; else cat /tmp/hpuick_body.json; fi
  }
  ```
- **Role gating** (spec §12): `matchfee.match.create/.list/.detail`, `matchfee.pay`,
  `matchfee.receipt.resend` → `[ROLES.ADMIN, ROLES.REGISTRATION]`. `matchfee.transaction.void`
  → `[ROLES.ADMIN]` only. `MESS`/`ACCOMMODATION` are never granted any `matchfee.*` action.
- **Idempotency & concurrency** (spec §6): `matchfee.pay` checks `ClientRequestId` both before
  and after acquiring `LockService.getScriptLock()` (pre-lock = fast path, post-lock =
  authoritative), and re-checks the one-`ACTIVE`-transaction-per-`(MatchId,TeamId)` invariant
  inside the same lock before writing — mirrors `purchasePackage_` (`FoodPackages.gs`) exactly.
- **Receipt number format is exact** (spec §9 of the original request): `nextDocumentNumber_
  ('MatchFee')` must produce `GCB/HPUICK-2026/MF/00001`, `00002`, … — verified by regex in
  Task 1's tests before anything else is built on top of it.
- **One-time Admin setup needed before the PDF-generating tests can pass**:
  `admin.bootstrap.createMatchFeeReceiptTemplate` (Task 3, new — mirrors
  `createTemporaryReceiptTemplate_`). Use a real Admin session's `sessionId` when calling it.
- **Testing**: this repo has no local test runner — `Tests.gs`'s `TEST_CASES` execute for real
  inside the deployed script via `system.selfTestSplit`, against the live production Sheet
  (`Tests.gs`'s own header comment). Non-PDF tests join the default (`fast`) tier; tests that
  do real Slides/Drive PDF generation join `tier: 'pdf2'` (this codebase's existing slow
  bucket for finalize/NOC/coupon-generation tests) so they never compete with `fast`'s own
  budget against the 6-minute Apps Script execution ceiling.
- **Final Receipt isolation is a hard invariant** (spec §9): no task in this plan modifies
  `FinalDocuments.gs`, `Receipts.gs`, `CouponDocuments.gs`, `SETTLEMENTS`, or `RECEIPTS`
  (Type=FINAL). Task 3 includes a regression test proving this.

---

## Task 1: Data model, numbering, and financial settings

**Files:**
- Modify: `backend/Constants.gs` (`SHEET_SCHEMAS`, `ID_PREFIXES`)
- Modify: `backend/Setup.gs` (`seedSettings_`, `resetTournamentData_`)
- Modify: `backend/Settings.gs` (`getRegistrationInfo_`, `updateRates_`)
- Modify: `backend/Tests.gs` (new tests + one existing test extended, registered in
  `TEST_CASES`)

**Interfaces:**
- Produces (consumed by Task 2+): `SHEET_SCHEMAS.MATCHES`, `SHEET_SCHEMAS.
  MATCH_FEE_TRANSACTIONS` (exact column lists below); `ID_PREFIXES.MATCHES = 'MATCH'`,
  `ID_PREFIXES.MATCH_FEE_TRANSACTIONS = 'MFTX'`; settings keys `MatchFeeRate`,
  `Numbering_Match_Prefix/Next/Padding`, `Numbering_MatchFee_Prefix/Next/Padding`;
  `getRegistrationInfo_(actorSession)` response gains `matchFeeRate: string`.

- [ ] **Step 1: Write the failing tests**

In `backend/Tests.gs`, add immediately after `test_idGenerator_nextDocumentNumber` (around
line 281):

```javascript
function test_setup_matchFeeSchemaAndSettingsSeeded() {
  ensureSheet_('MATCHES');
  ensureSheet_('MATCH_FEE_TRANSACTIONS');
  seedSettings_(); // idempotent — safe to call again
  assertEqual_(getSetting_('MatchFeeRate', null), '500', 'MatchFeeRate not seeded with the expected default');
  assertEqual_(getSetting_('Numbering_Match_Prefix', null), 'M-', 'Match number prefix not seeded');
  assertEqual_(getSetting_('Numbering_Match_Padding', null), '3', 'Match number padding not seeded');
  assertEqual_(getSetting_('Numbering_MatchFee_Prefix', null), 'GCB/HPUICK-2026/MF/', 'Match Fee receipt prefix not seeded');
  assertEqual_(getSetting_('Numbering_MatchFee_Padding', null), '5', 'Match Fee receipt padding not seeded');
}

// Verifies the EXACT receipt number format required by spec — critical, not cosmetic: any
// operator/report that parses this string depends on it never drifting.
function test_idGenerator_matchAndMatchFeeDocumentNumberFormats() {
  seedSettings_();
  const m1 = nextDocumentNumber_('Match');
  const m2 = nextDocumentNumber_('Match');
  assertTrue_(/^M-\d{3}$/.test(m1), 'unexpected Match number format: ' + m1);
  assertTrue_(m1 !== m2, 'nextDocumentNumber_("Match") produced a duplicate');

  const r1 = nextDocumentNumber_('MatchFee');
  const r2 = nextDocumentNumber_('MatchFee');
  assertTrue_(/^GCB\/HPUICK-2026\/MF\/\d{5}$/.test(r1), 'unexpected Match Fee receipt number format: ' + r1);
  assertTrue_(r1 !== r2, 'nextDocumentNumber_("MatchFee") produced a duplicate');
  assertEqual_(Number(r2.split('/').pop()), Number(r1.split('/').pop()) + 1, 'Match Fee receipt numbers should be strictly sequential');
}
```

Now extend the **existing** `test_settings_updateRatesAndLock` (around line 283) — every
`rates` object literal it passes to `updateRates_` must include `matchFee`, since Step 4
below makes that field required. Replace the whole function body with:

```javascript
function test_settings_updateRatesAndLock() {
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'x' };
  const messSession = { userId: 'USR-0001', role: ROLES.MESS, sessionId: 'y' };

  const before = getRegistrationInfo_(adminSession);
  assertTrue_(before.hasOwnProperty('rateDari'), 'getRegistrationInfo_ missing rateDari');
  assertTrue_(before.hasOwnProperty('financialSettingsLocked'), 'getRegistrationInfo_ missing financialSettingsLocked');
  assertTrue_(before.hasOwnProperty('matchFeeRate'), 'getRegistrationInfo_ missing matchFeeRate');

  // non-admin cannot update rates
  let threwForbidden = false;
  try {
    updateRates_(messSession, { breakfast: 50, lunch: 100, dinner: 100, dari: 100, security: 0, matchFee: 500 });
  } catch (err) {
    threwForbidden = true;
    assertEqual_(err.code, 'FORBIDDEN', 'wrong error code for non-admin rate update');
  }
  assertTrue_(threwForbidden, 'updateRates_ did not reject a non-admin caller');

  // admin can update rates when unlocked (restore original values afterward)
  const original = {
    breakfast: before.rateBreakfast, lunch: before.rateLunch, dinner: before.rateDinner,
    dari: before.rateDari, security: before.securityAmount, matchFee: before.matchFeeRate
  };
  try {
    updateRates_(adminSession, { breakfast: 51, lunch: 100, dinner: 100, dari: 100, security: 0, matchFee: 600 });
    const after = getRegistrationInfo_(adminSession);
    assertEqual_(after.rateBreakfast, '51', 'rate update did not take effect');
    assertEqual_(after.matchFeeRate, '600', 'matchFee rate update did not take effect');
  } finally {
    updateRates_(adminSession, {
      breakfast: original.breakfast, lunch: original.lunch, dinner: original.dinner,
      dari: original.dari, security: original.security, matchFee: original.matchFee
    });
  }

  // locking blocks further updates (including matchFee), then unlock restores ability
  setFinancialLock_(adminSession, true);
  let threwLocked = false;
  try {
    updateRates_(adminSession, { breakfast: 999, lunch: 100, dinner: 100, dari: 100, security: 0, matchFee: 999 });
  } catch (err) {
    threwLocked = true;
    assertEqual_(err.code, 'SETTINGS_LOCKED', 'wrong error code for locked rate update');
  }
  assertTrue_(threwLocked, 'updateRates_ did not respect the financial lock');
  setFinancialLock_(adminSession, false); // restore unlocked state for later tasks/tests
}
```

Register the two new tests in `TEST_CASES` (both default/fast tier), right after the
`idGenerator_nextDocumentNumber` entry:

```javascript
  { name: 'idGenerator_nextDocumentNumber', fn: test_idGenerator_nextDocumentNumber },
  { name: 'setup_matchFeeSchemaAndSettingsSeeded', fn: test_setup_matchFeeSchemaAndSettingsSeeded },
  { name: 'idGenerator_matchAndMatchFeeDocumentNumberFormats', fn: test_idGenerator_matchAndMatchFeeDocumentNumberFormats },
  { name: 'settings_updateRatesAndLock', fn: test_settings_updateRatesAndLock },
```

(This replaces, not duplicates, the existing `settings_updateRatesAndLock` entry already at
that position.)

- [ ] **Step 2: Push and verify the new tests fail**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Task 1: match fee schema/settings tests RED"
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"setup_matchFeeSchemaAndSettingsSeeded"}}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"idGenerator_matchAndMatchFeeDocumentNumberFormats"}}'
```

Expected: both FAIL — `MatchFeeRate not seeded with the expected default` (schema/settings
don't exist yet).

- [ ] **Step 3: Add the two new sheets to `backend/Constants.gs`**

In `SHEET_SCHEMAS`, add after the `AUDIT_LOG` entry (before the closing `};`):

```javascript
  MATCHES: ['MatchId', 'MatchNumber', 'MatchDate', 'Team1Id', 'Team2Id', 'Status',
    'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  MATCH_FEE_TRANSACTIONS: ['TransactionId', 'MatchId', 'TeamId', 'OpponentTeamId', 'Amount',
    'RateSnapshot', 'PaymentMethod', 'PaidAt', 'CollectedBy', 'ReceiptNumber',
    'ReceiptPdfFileId', 'EmailStatus', 'Status', 'VoidReason', 'VoidedBy', 'VoidedAt',
    'ClientRequestId', 'CreatedBy', 'CreatedAt']
```

Remove the trailing comma from the previous `AUDIT_LOG` line if it becomes the last-but-one
entry (it already has one — just append the two new entries after it, comma-separated, no
trailing comma on `MATCH_FEE_TRANSACTIONS`).

In `ID_PREFIXES`, add to the object literal:

```javascript
  MATCHES: 'MATCH', MATCH_FEE_TRANSACTIONS: 'MFTX'
```

- [ ] **Step 4: Seed settings and extend the reset list in `backend/Setup.gs`**

In `seedSettings_`'s `defaults` object, add these keys anywhere before the closing `};`
(grouped near the other `Numbering_*` keys for readability):

```javascript
    MatchFeeRate: '500',
    Numbering_Match_Prefix: 'M-',
    Numbering_Match_Next: '1',
    Numbering_Match_Padding: '3',
    Numbering_MatchFee_Prefix: 'GCB/HPUICK-2026/MF/',
    Numbering_MatchFee_Next: '1',
    Numbering_MatchFee_Padding: '5',
```

In `resetTournamentData_`, change the `sheetsToClear` array from:

```javascript
  const sheetsToClear = [
    'TEAMS', 'CONTINGENT_INCHARGES', 'PAYMENTS', 'CHARGES', 'FOOD_PACKAGES', 'FOOD_COUPONS',
    'PACKAGE_INCHARGE_MEALS', 'PRINTED_COUPONS', 'MEAL_ENTITLEMENTS', 'MEAL_USAGE',
    'MEAL_ORDER_STATUS', 'ROOMS', 'ACCOMMODATION', 'ACCOMMODATION_NOC', 'REFUNDS',
    'SECURITY_REFUNDS', 'SETTLEMENTS', 'RECEIPTS', 'RELIEVING', 'DOCUMENTS', 'EMAIL_LOG', 'AUDIT_LOG'
  ];
```

to:

```javascript
  const sheetsToClear = [
    'TEAMS', 'CONTINGENT_INCHARGES', 'PAYMENTS', 'CHARGES', 'FOOD_PACKAGES', 'FOOD_COUPONS',
    'PACKAGE_INCHARGE_MEALS', 'PRINTED_COUPONS', 'MEAL_ENTITLEMENTS', 'MEAL_USAGE',
    'MEAL_ORDER_STATUS', 'ROOMS', 'ACCOMMODATION', 'ACCOMMODATION_NOC', 'REFUNDS',
    'SECURITY_REFUNDS', 'SETTLEMENTS', 'RECEIPTS', 'RELIEVING', 'DOCUMENTS', 'EMAIL_LOG', 'AUDIT_LOG',
    'MATCHES', 'MATCH_FEE_TRANSACTIONS'
  ];
```

and the numbering-reset loop from:

```javascript
  ['Registration', 'Receipt', 'Coupon', 'Refund', 'Relieving', 'Accommodation'].forEach(function (type) {
```

to:

```javascript
  ['Registration', 'Receipt', 'Coupon', 'Refund', 'Relieving', 'Accommodation', 'Match', 'MatchFee'].forEach(function (type) {
```

(No dedicated automated test for `resetTournamentData_` — it destructively clears the live
production Sheet the test suite itself runs against, per this file's own existing convention
of never exercising it from `Tests.gs`.)

- [ ] **Step 5: Extend `backend/Settings.gs`**

Change `getRegistrationInfo_` from:

```javascript
function getRegistrationInfo_(actorSession) {
  return {
    rateBreakfast: getSetting_('RateBreakfast', '0'),
    rateLunch: getSetting_('RateLunch', '0'),
    rateDinner: getSetting_('RateDinner', '0'),
    rateDari: getSetting_('RateDari', '0'),
    securityAmount: getSetting_('SecurityAmount', '0'),
    financialSettingsLocked: getSetting_('FinancialSettingsLocked', 'false')
  };
}
```

to:

```javascript
function getRegistrationInfo_(actorSession) {
  return {
    rateBreakfast: getSetting_('RateBreakfast', '0'),
    rateLunch: getSetting_('RateLunch', '0'),
    rateDinner: getSetting_('RateDinner', '0'),
    rateDari: getSetting_('RateDari', '0'),
    securityAmount: getSetting_('SecurityAmount', '0'),
    matchFeeRate: getSetting_('MatchFeeRate', '0'),
    financialSettingsLocked: getSetting_('FinancialSettingsLocked', 'false')
  };
}
```

Change `updateRates_` from:

```javascript
function updateRates_(actorSession, rates) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (getSetting_('FinancialSettingsLocked', 'false') === 'true') {
    throw apiError_('SETTINGS_LOCKED', 'Financial settings are locked. Unlock before changing rates.');
  }
  ['breakfast', 'lunch', 'dinner', 'dari', 'security'].forEach(function (key) {
    if (rates[key] === undefined || rates[key] === null || isNaN(Number(rates[key])) || Number(rates[key]) < 0) {
      throw apiError_('VALIDATION_ERROR', 'Rate "' + key + '" must be a non-negative number.');
    }
  });
  const now = new Date().toISOString();
  setSetting_('RateBreakfast', String(rates.breakfast), actorSession.userId);
  setSetting_('RateLunch', String(rates.lunch), actorSession.userId);
  setSetting_('RateDinner', String(rates.dinner), actorSession.userId);
  setSetting_('RateDari', String(rates.dari), actorSession.userId);
  setSetting_('SecurityAmount', String(rates.security), actorSession.userId);
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'UPDATE_RATES', Entity: 'SETTINGS', EntityId: 'RATES', PreviousState: '', NewState: JSON.stringify(rates)
  });
  return getRegistrationInfo_(actorSession);
}
```

to:

```javascript
function updateRates_(actorSession, rates) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (getSetting_('FinancialSettingsLocked', 'false') === 'true') {
    throw apiError_('SETTINGS_LOCKED', 'Financial settings are locked. Unlock before changing rates.');
  }
  ['breakfast', 'lunch', 'dinner', 'dari', 'security', 'matchFee'].forEach(function (key) {
    if (rates[key] === undefined || rates[key] === null || isNaN(Number(rates[key])) || Number(rates[key]) < 0) {
      throw apiError_('VALIDATION_ERROR', 'Rate "' + key + '" must be a non-negative number.');
    }
  });
  const now = new Date().toISOString();
  setSetting_('RateBreakfast', String(rates.breakfast), actorSession.userId);
  setSetting_('RateLunch', String(rates.lunch), actorSession.userId);
  setSetting_('RateDinner', String(rates.dinner), actorSession.userId);
  setSetting_('RateDari', String(rates.dari), actorSession.userId);
  setSetting_('SecurityAmount', String(rates.security), actorSession.userId);
  setSetting_('MatchFeeRate', String(rates.matchFee), actorSession.userId);
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'UPDATE_RATES', Entity: 'SETTINGS', EntityId: 'RATES', PreviousState: '', NewState: JSON.stringify(rates)
  });
  return getRegistrationInfo_(actorSession);
}
```

- [ ] **Step 6: Push, deploy, run the schema/settings sheet bootstrap once, verify tests pass**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Task 1: match fee schema/settings"
```

```bash
call_action '{"action":"admin.bootstrap.setupSchema","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"admin.bootstrap.seedSettings","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"setup_matchFeeSchemaAndSettingsSeeded"}}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"idGenerator_matchAndMatchFeeDocumentNumberFormats"}}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"settings_updateRatesAndLock"}}'
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: the three named tests report `"status":"PASS"`; the full `fast` tier run reports
every previously-passing test still passing.

- [ ] **Step 7: Commit**

```bash
git add backend/Constants.gs backend/Setup.gs backend/Settings.gs backend/Tests.gs
git commit -m "Match Fee Collection Task 1: schema, numbering, financial settings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HZcRi1y5CTbzdpanzfTKrX"
```

---

## Task 2: Match creation, listing, and detail

**Files:**
- Create: `backend/MatchFee.gs`
- Modify: `backend/Main.gs` (register three actions)
- Modify: `backend/Tests.gs` (one new test, registered in `TEST_CASES`)

**Interfaces:**
- Consumes: `SHEET_SCHEMAS.MATCHES` (Task 1); `findRowById_`, `findRowsByField_`,
  `rowsToObjects_`, `appendRow_` (`SheetHelpers.gs`); `nextId_`, `nextDocumentNumber_`
  (`IdGenerator.gs`); `requireRole_` (`Auth.gs`).
- Produces (consumed by Task 3+):
  - `createMatch_(actorSession, team1Id, team2Id, matchDate): {matchId, matchNumber,
    matchDate, team1Id, team2Id}`
  - `_matchTeamSideStatus_(matchId, teamId): {status, transactionId, receiptNumber,
    receiptPdfFileId, paymentMethod, paidAt, amount, emailStatus}` — `status` is `'PAID'` or
    `'PENDING'`, computed live from `MATCH_FEE_TRANSACTIONS` (never cached).
  - `_matchSummary_(matchRowValues): {matchId, matchNumber, matchDate, status, team1: {teamId,
    collegeName}, team2: {teamId, collegeName}, team1Status, team2Status, matchFeeRate}`
  - `listMatches_(actorSession): Array<matchSummary>`
  - `getMatchDetail_(actorSession, matchId): matchSummary`

- [ ] **Step 1: Write the failing test**

In `backend/Tests.gs`, add after `test_settings_mealTimingsValidationAndUpdate` (before
`test_registration_registerTeam_validationAndCreation`):

```javascript
function test_matchfee_createMatch_validatesTeamsAndListsDetail() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const messSession = { userId: 'USR-0001', role: ROLES.MESS, sessionId: 'y' };
  let team1Id = null, team2Id = null, matchId = null, repeatMatchId = null;
  try {
    team1Id = registerTeam_(regSession, 'Match Fee College A', 'District', 12, [{ name: 'Coach A', isPrimary: true }]).teamId;
    team2Id = registerTeam_(regSession, 'Match Fee College B', 'District', 12, [{ name: 'Coach B', isPrimary: true }]).teamId;

    let threwSameTeam = false;
    try {
      createMatch_(regSession, team1Id, team1Id, '2026-09-22');
    } catch (err) { threwSameTeam = true; assertEqual_(err.code, 'VALIDATION_ERROR', 'wrong code for same team on both sides'); }
    assertTrue_(threwSameTeam, 'createMatch_ did not reject Team 1 === Team 2');

    let threwUnknownTeam = false;
    try {
      createMatch_(regSession, team1Id, 'TEAM-DOES-NOT-EXIST', '2026-09-22');
    } catch (err) { threwUnknownTeam = true; assertEqual_(err.code, 'NOT_FOUND', 'wrong code for an unknown team'); }
    assertTrue_(threwUnknownTeam, 'createMatch_ did not reject an unregistered team id');

    let threwForbidden = false;
    try {
      createMatch_(messSession, team1Id, team2Id, '2026-09-22');
    } catch (err) { threwForbidden = true; assertEqual_(err.code, 'FORBIDDEN', 'wrong code for a Mess Committee caller'); }
    assertTrue_(threwForbidden, 'createMatch_ did not reject a Mess Committee caller');

    const created = createMatch_(regSession, team1Id, team2Id, '2026-09-22');
    matchId = created.matchId;
    assertTrue_(/^M-\d{3}$/.test(created.matchNumber), 'unexpected match number format: ' + created.matchNumber);

    const detail = getMatchDetail_(regSession, matchId);
    assertEqual_(detail.team1.collegeName, 'Match Fee College A', 'wrong Team 1 college name in detail');
    assertEqual_(detail.team2.collegeName, 'Match Fee College B', 'wrong Team 2 college name in detail');
    assertEqual_(detail.team1Status.status, 'PENDING', 'a brand-new match should start both teams PENDING');
    assertEqual_(detail.team2Status.status, 'PENDING', 'a brand-new match should start both teams PENDING');
    assertTrue_(detail.matchFeeRate >= 0, 'matchFeeRate should be a live-read non-negative number');

    const list = listMatches_(regSession);
    assertTrue_(list.some(function (m) { return m.matchId === matchId; }), 'listMatches_ should include the newly created match');

    // Legitimate repeat fixture — same two teams, a different date — must be allowed (spec §3).
    const repeat = createMatch_(regSession, team1Id, team2Id, '2026-09-24');
    repeatMatchId = repeat.matchId;
    assertTrue_(repeatMatchId !== matchId, 'a legitimate repeat fixture should create a distinct match');
  } finally {
    if (matchId) deleteRowById_('MATCHES', 'MatchId', matchId);
    if (repeatMatchId) deleteRowById_('MATCHES', 'MatchId', repeatMatchId);
    [team1Id, team2Id].forEach(function (id) {
      if (!id) return;
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', id).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', id);
    });
  }
}
```

Register it in `TEST_CASES` (default/fast tier), right after
`{ name: 'settings_mealTimingsValidationAndUpdate', ... }`:

```javascript
  { name: 'matchfee_createMatch_validatesTeamsAndListsDetail', fn: test_matchfee_createMatch_validatesTeamsAndListsDetail },
```

- [ ] **Step 2: Push and verify it fails**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"matchfee_createMatch_validatesTeamsAndListsDetail"}}'
```

Expected: FAILS — `createMatch_ is not defined` (deploy in Step 4 is what reaches the live
Web App; this failure is expected either way).

- [ ] **Step 3: Create `backend/MatchFee.gs`**

```javascript
// MatchFee.gs — Match Fee Collection: match identity, per-team payment transactions, their
// receipts, resend, and void. Completely separate financial stream from Registration/Dari/
// Security/Food — never enters SETTLEMENTS or RECEIPTS(Type=FINAL).
// Spec: docs/superpowers/specs/2026-08-21-match-fee-collection-design.md

function createMatch_(actorSession, team1Id, team2Id, matchDate) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!team1Id || !team2Id) throw apiError_('VALIDATION_ERROR', 'Both teams are required.');
  if (team1Id === team2Id) throw apiError_('VALIDATION_ERROR', 'Team 1 and Team 2 must be different teams.');
  const team1 = findRowById_('TEAMS', 'TeamId', team1Id);
  if (!team1) throw apiError_('NOT_FOUND', 'No such team: ' + team1Id);
  const team2 = findRowById_('TEAMS', 'TeamId', team2Id);
  if (!team2) throw apiError_('NOT_FOUND', 'No such team: ' + team2Id);
  if (!matchDate) throw apiError_('VALIDATION_ERROR', 'Match date is required.');

  const matchId = nextId_('MATCH', 4);
  const matchNumber = nextDocumentNumber_('Match');
  const now = new Date().toISOString();
  appendRow_('MATCHES', {
    MatchId: matchId, MatchNumber: matchNumber, MatchDate: matchDate, Team1Id: team1Id, Team2Id: team2Id,
    Status: 'SCHEDULED', CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'CREATE_MATCH', Entity: 'MATCH', EntityId: matchId, PreviousState: '', NewState: 'SCHEDULED'
  });
  return { matchId: matchId, matchNumber: matchNumber, matchDate: matchDate, team1Id: team1Id, team2Id: team2Id };
}

// Live-computed team-side status for one match — never cached on MATCHES (spec §2.1: avoids
// a second place this could drift from MATCH_FEE_TRANSACTIONS, the source of truth). "Has
// this team paid" always means "does an ACTIVE row exist for (matchId, teamId)" — the same
// invariant matchfee.pay (Task 3) enforces at write time.
function _matchTeamSideStatus_(matchId, teamId) {
  const active = findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId)
    .filter(function (t) { return t.TeamId === teamId && t.Status === 'ACTIVE'; })[0] || null;
  return {
    status: active ? 'PAID' : 'PENDING',
    transactionId: active ? active.TransactionId : null,
    receiptNumber: active ? active.ReceiptNumber : null,
    receiptPdfFileId: active ? active.ReceiptPdfFileId : null,
    paymentMethod: active ? active.PaymentMethod : null,
    paidAt: active ? active.PaidAt : null,
    amount: active ? Number(active.Amount) : null,
    emailStatus: active ? active.EmailStatus : null
  };
}

function _matchSummary_(m) {
  const team1 = findRowById_('TEAMS', 'TeamId', m.Team1Id);
  const team2 = findRowById_('TEAMS', 'TeamId', m.Team2Id);
  return {
    matchId: m.MatchId, matchNumber: m.MatchNumber, matchDate: m.MatchDate, status: m.Status,
    team1: { teamId: m.Team1Id, collegeName: team1 ? team1.values.CollegeName : '(team removed)' },
    team2: { teamId: m.Team2Id, collegeName: team2 ? team2.values.CollegeName : '(team removed)' },
    team1Status: _matchTeamSideStatus_(m.MatchId, m.Team1Id),
    team2Status: _matchTeamSideStatus_(m.MatchId, m.Team2Id),
    matchFeeRate: Number(getSetting_('MatchFeeRate', '0'))
  };
}

function listMatches_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  return rowsToObjects_('MATCHES').map(_matchSummary_);
}

function getMatchDetail_(actorSession, matchId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const match = findRowById_('MATCHES', 'MatchId', matchId);
  if (!match) throw apiError_('NOT_FOUND', 'No such match: ' + matchId);
  return _matchSummary_(match.values);
}
```

- [ ] **Step 4: Register three actions in `backend/Main.gs`'s `ACTIONS` table**

Add these entries (anywhere after the `admin.settings.updateMealTimings` entry is fine —
placed here right before `registration.team.create` to keep related actions together):

```javascript
  'matchfee.match.create': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createMatch_(session, payload.team1Id, payload.team2Id, payload.matchDate);
  },
  'matchfee.match.list': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { matches: listMatches_(session) };
  },
  'matchfee.match.detail': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getMatchDetail_(session, payload.matchId);
  },
```

- [ ] **Step 5: Push, deploy, verify the test passes**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Task 2: match creation, listing, detail"
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"matchfee_createMatch_validatesTeamsAndListsDetail"}}'
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: the named test reports `"status":"PASS"`; the full `fast` tier reports every
previously-passing test still passing, plus this one.

- [ ] **Step 6: Commit**

```bash
git add backend/MatchFee.gs backend/Main.gs backend/Tests.gs
git commit -m "Match Fee Collection Task 2: match creation, listing, detail

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HZcRi1y5CTbzdpanzfTKrX"
```

---

## Task 3: Match Fee Receipt template + collection (payment, PDF, email)

**Files:**
- Modify: `backend/MatchFee.gs` (receipt layout, template bootstrap, `collectMatchFee_`,
  email helper)
- Modify: `backend/Setup.gs` (`setupDriveFolders_` — one new subfolder)
- Modify: `backend/Main.gs` (register two actions)
- Modify: `backend/Tests.gs` (two new tests, registered in `TEST_CASES`, tier `pdf2`)

**Interfaces:**
- Consumes: `_numberToWordsIndian_`, `_drawSignatureOrLine_`, `_clearSlide_`,
  `_ensureSubfolder_`, `_getRootFolder_` (all existing globals, `FinalDocuments.gs`/
  `Receipts.gs`/`Setup.gs`); Task 2's `createMatch_`/`_matchTeamSideStatus_`.
- Produces (consumed by Task 4+):
  - `createMatchFeeReceiptTemplate_(actorSession, force): {templateId, created}`
  - `collectMatchFee_(actorSession, matchId, teamId, mode, recipientEmails,
    clientRequestId): {transactionId, matchId, teamId, amount, rateSnapshot, paymentMethod,
    paidAt, receiptNumber, receiptPdfFileId, receiptPdfUrl, emailStatus, status, replay}`
    — throws `ALREADY_PAID` (with `.receiptNumber`/`.transactionId` on the error object) if
    the team already has an `ACTIVE` transaction for this match.
  - `_matchFeeTransactionResponse_(txRowValues, isReplay): same shape as above`
  - `_sendMatchFeeReceiptEmail_(actorSession, transactionId, teamId, pdfFileId,
    recipientEmails, verb): {status, recipients}` — `status` is `'SENT'`/`'FAILED'`/
    `'NOT_SENT'`, matching `FOOD_PACKAGES.EmailStatus`'s existing vocabulary exactly.

- [ ] **Step 1: Write the failing tests**

In `backend/Tests.gs`, add after `test_finalDocuments_numberToWordsIndian` (so it sits
alongside the other `pdf2`-tier document-generation tests):

```javascript
function test_matchfee_collectMatchFee_fullPaymentAndProtectionFlow() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const adminSession = { userId: 'USR-0002', role: ROLES.ADMIN, sessionId: 'a' };
  let team1Id = null, team2Id = null, matchId = null;
  const trashFileIds = [];
  let originalMatchFeeRate = null;
  try {
    originalMatchFeeRate = getRegistrationInfo_(adminSession).matchFeeRate;
    team1Id = registerTeam_(regSession, 'Match Fee Pay College A', 'District', 12, [{ name: 'Coach A', isPrimary: true, email: 'not-a-real-inbox@example.invalid' }]).teamId;
    team2Id = registerTeam_(regSession, 'Match Fee Pay College B', 'District', 12, [{ name: 'Coach B', isPrimary: true, email: 'not-a-real-inbox@example.invalid' }]).teamId;
    const match = createMatch_(regSession, team1Id, team2Id, '2026-09-22');
    matchId = match.matchId;

    updateRates_(adminSession, { breakfast: 50, lunch: 100, dinner: 100, dari: 100, security: 0, matchFee: 500 });

    // Team 2 pays first — either order must work (spec §1).
    const team2Payment = collectMatchFee_(regSession, matchId, team2Id, 'Cash', [], null);
    trashFileIds.push(team2Payment.receiptPdfFileId);
    assertEqual_(team2Payment.amount, 500, 'Team 2 payment amount should equal the current Match Fee rate');
    assertEqual_(team2Payment.rateSnapshot, 500, 'Team 2 payment should snapshot the rate at payment time');
    assertTrue_(/^GCB\/HPUICK-2026\/MF\/\d{5}$/.test(team2Payment.receiptNumber), 'unexpected receipt number format: ' + team2Payment.receiptNumber);
    assertTrue_(['SENT', 'FAILED', 'NOT_SENT'].indexOf(team2Payment.emailStatus) !== -1, 'unexpected emailStatus: ' + team2Payment.emailStatus);

    let detail = getMatchDetail_(regSession, matchId);
    assertEqual_(detail.team1Status.status, 'PENDING', 'Team 1 should still be PENDING while only Team 2 has paid');
    assertEqual_(detail.team2Status.status, 'PAID', 'Team 2 should now be PAID');
    assertEqual_(detail.team2Status.receiptNumber, team2Payment.receiptNumber, 'match detail should reflect Team 2 receipt number');

    // Duplicate payment attempt for the SAME team — rejected server-side, carries the existing receipt number.
    let threwAlreadyPaid = false;
    try {
      collectMatchFee_(regSession, matchId, team2Id, 'Cash', [], null);
    } catch (err) {
      threwAlreadyPaid = true;
      assertEqual_(err.code, 'ALREADY_PAID', 'wrong error code for a duplicate Match Fee payment');
      assertEqual_(err.receiptNumber, team2Payment.receiptNumber, 'ALREADY_PAID error should carry the existing receipt number');
    }
    assertTrue_(threwAlreadyPaid, 'collectMatchFee_ did not reject a second payment for the same (match, team)');
    assertEqual_(findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId).filter(function (t) { return t.TeamId === team2Id; }).length, 1, 'a duplicate attempt must not create a second transaction row');

    // ClientRequestId replay — same request id twice must return the SAME transaction, no new receipt number.
    const team1First = collectMatchFee_(regSession, matchId, team1Id, 'Online', [], 'mf-replay-1');
    trashFileIds.push(team1First.receiptPdfFileId);
    const team1Replay = collectMatchFee_(regSession, matchId, team1Id, 'Online', [], 'mf-replay-1');
    assertEqual_(team1Replay.transactionId, team1First.transactionId, 'a ClientRequestId replay must return the original transaction');
    assertEqual_(team1Replay.receiptNumber, team1First.receiptNumber, 'a ClientRequestId replay must not allocate a new receipt number');
    assertTrue_(team1Replay.replay, 'a ClientRequestId replay result should be flagged as a replay');
    assertEqual_(findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId).filter(function (t) { return t.TeamId === team1Id; }).length, 1, 'a replayed request must not create a second transaction row');

    detail = getMatchDetail_(regSession, matchId);
    assertEqual_(detail.team1Status.status, 'PAID', 'Team 1 should now be PAID too');
    assertTrue_(detail.team1Status.receiptNumber !== detail.team2Status.receiptNumber, 'the two teams must have distinct receipt numbers');

    // Rate change AFTER payment must never alter an already-created transaction (spec §3/Q-R).
    updateRates_(adminSession, { breakfast: 50, lunch: 100, dinner: 100, dari: 100, security: 0, matchFee: 700 });
    const stillOldRateTx = findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', team2Payment.transactionId).values;
    assertEqual_(Number(stillOldRateTx.RateSnapshot), 500, 'an existing transaction must keep its original rate snapshot after Admin changes the rate');
    assertEqual_(Number(stillOldRateTx.Amount), 500, 'an existing transaction must keep its original amount after Admin changes the rate');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    if (originalMatchFeeRate !== null) updateRates_(adminSession, { breakfast: 50, lunch: 100, dinner: 100, dari: 100, security: 0, matchFee: Number(originalMatchFeeRate) });
    if (matchId) {
      findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId).forEach(function (t) { deleteRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', t.TransactionId); });
      deleteRowById_('MATCHES', 'MatchId', matchId);
    }
    [team1Id, team2Id].forEach(function (id) {
      if (!id) return;
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', id).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', id);
    });
  }
}

// Regression test for spec §9: Match Fee must never enter the Final Receipt/settlement
// calculation. Compares _computeSettlementPreview_'s output for the same team before and
// after a Match Fee transaction exists — must be byte-for-byte identical.
function test_matchfee_doesNotAffectFinalReceiptSettlement() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  let fixture = null;
  let createdTeamId = null;
  let opponentTeamId = null;
  let matchId = null;
  let transactionId = null;
  const trashFileIds = [];
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 3);
    createdTeamId = fixture.teamId;
    opponentTeamId = registerTeam_(regSession, 'Match Fee Isolation Opponent', 'District', 5, [{ name: 'Coach', isPrimary: true }]).teamId;

    const beforePreview = _computeSettlementPreview_(createdTeamId, '2026-08-20');

    const match = createMatch_(regSession, createdTeamId, opponentTeamId, '2026-08-19');
    matchId = match.matchId;
    const paid = collectMatchFee_(regSession, matchId, createdTeamId, 'Cash', [], null);
    transactionId = paid.transactionId;
    trashFileIds.push(paid.receiptPdfFileId);

    const afterPreview = _computeSettlementPreview_(createdTeamId, '2026-08-20');
    assertEqual_(afterPreview.grossMealCharges, beforePreview.grossMealCharges, 'Match Fee must not affect grossMealCharges');
    assertEqual_(afterPreview.grossDariCharges, beforePreview.grossDariCharges, 'Match Fee must not affect grossDariCharges');
    assertEqual_(afterPreview.grossCharges, beforePreview.grossCharges, 'Match Fee must not affect grossCharges');
    assertEqual_(afterPreview.netCharges, beforePreview.netCharges, 'Match Fee must not affect netCharges');
    assertEqual_(afterPreview.securityCollected, beforePreview.securityCollected, 'Match Fee must not affect securityCollected');
    assertEqual_(afterPreview.securityRefunded, beforePreview.securityRefunded, 'Match Fee must not affect securityRefunded');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    if (transactionId) deleteRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId);
    if (matchId) deleteRowById_('MATCHES', 'MatchId', matchId);
    if (opponentTeamId) {
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', opponentTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', opponentTeamId);
    }
    if (fixture) _cleanupMessTestFixture_(fixture);
  }
}
```

Register both in `TEST_CASES`, tier `pdf2`, right after
`{ name: 'finalDocuments_numberToWordsIndian', ... }`:

```javascript
  { name: 'matchfee_collectMatchFee_fullPaymentAndProtectionFlow', fn: test_matchfee_collectMatchFee_fullPaymentAndProtectionFlow, tier: 'pdf2' },
  { name: 'matchfee_doesNotAffectFinalReceiptSettlement', fn: test_matchfee_doesNotAffectFinalReceiptSettlement, tier: 'pdf2' },
```

- [ ] **Step 2: Push and verify both fail**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"matchfee_collectMatchFee_fullPaymentAndProtectionFlow"}}'
```

Expected: FAILS — `collectMatchFee_ is not defined`.

- [ ] **Step 3: Add one subfolder to `backend/Setup.gs`'s `setupDriveFolders_`**

Change the `structure` object from:

```javascript
  const structure = {
    Database: _ensureSubfolder_(root, 'Database'),
    'Registration/Temporary Receipts': _ensureSubfolder_(registration, 'Temporary Receipts'),
    'Registration/Final Receipts': _ensureSubfolder_(registration, 'Final Receipts'),
    'Food Coupons/Digital': _ensureSubfolder_(coupons, 'Digital'),
    'Food Coupons/Printed': _ensureSubfolder_(coupons, 'Printed'),
    Refunds: _ensureSubfolder_(root, 'Refunds'),
    'Relieving Orders': _ensureSubfolder_(root, 'Relieving Orders'),
    Accommodation: _ensureSubfolder_(root, 'Accommodation'),
    'Accommodation/NOC Certificates': _ensureSubfolder_(_ensureSubfolder_(root, 'Accommodation'), 'NOC Certificates'),
    Templates: _ensureSubfolder_(root, 'Templates'),
    Assets: _ensureSubfolder_(root, 'Assets'),
    Reports: _ensureSubfolder_(root, 'Reports')
  };
```

to (one new line, `'Match Fee Receipts'`, added):

```javascript
  const structure = {
    Database: _ensureSubfolder_(root, 'Database'),
    'Registration/Temporary Receipts': _ensureSubfolder_(registration, 'Temporary Receipts'),
    'Registration/Final Receipts': _ensureSubfolder_(registration, 'Final Receipts'),
    'Food Coupons/Digital': _ensureSubfolder_(coupons, 'Digital'),
    'Food Coupons/Printed': _ensureSubfolder_(coupons, 'Printed'),
    Refunds: _ensureSubfolder_(root, 'Refunds'),
    'Relieving Orders': _ensureSubfolder_(root, 'Relieving Orders'),
    Accommodation: _ensureSubfolder_(root, 'Accommodation'),
    'Accommodation/NOC Certificates': _ensureSubfolder_(_ensureSubfolder_(root, 'Accommodation'), 'NOC Certificates'),
    Templates: _ensureSubfolder_(root, 'Templates'),
    Assets: _ensureSubfolder_(root, 'Assets'),
    Reports: _ensureSubfolder_(root, 'Reports'),
    'Match Fee Receipts': _ensureSubfolder_(root, 'Match Fee Receipts')
  };
```

- [ ] **Step 4: Append the receipt layout + collection logic to `backend/MatchFee.gs`**

Add at the end of the file:

```javascript
// Own template file, own layout — never shares the Temporary/Final Receipt template (spec
// §8/§10: title MATCH FEE RECEIPT, one receipt per team-payment, never combined). A5 portrait
// like Receipts.gs's Temporary Receipt Template — same one-time-manual-resize trade-off
// documented in that file's header (Slides/Advanced Slides API don't honor a requested page
// size programmatically).
function _buildMatchFeeReceiptLayout_(pres, data) {
  const slide = pres.getSlides()[0];
  _clearSlide_(slide);
  if (!data) return slide; // template-setup call: leave the page blank, just holding its size

  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();
  const margin = pageWidth * 0.08;
  const contentWidth = pageWidth - margin * 2;
  let y = pageHeight * 0.03;

  function addLine(text, heightFraction, fontSize, opts) {
    const box = slide.insertTextBox(text, margin, y, contentWidth, pageHeight * heightFraction);
    const style = box.getText().getTextStyle().setFontSize(fontSize);
    if (opts && opts.bold) style.setBold(true);
    box.getText().getParagraphStyle().setParagraphAlignment(
      opts && opts.left ? SlidesApp.ParagraphAlignment.START : SlidesApp.ParagraphAlignment.CENTER
    );
    y += pageHeight * heightFraction;
  }

  addLine(data.tournamentName, 0.04, 11, { bold: true });
  addLine(data.organizer, 0.03, 9, {});
  addLine(data.districtAddress, 0.03, 8, {});
  y += pageHeight * 0.015;
  addLine('MATCH FEE RECEIPT', 0.045, 13, { bold: true });
  y += pageHeight * 0.02;

  addLine('Receipt No: ' + data.receiptNumber, 0.03, 9, { left: true });
  addLine('Date: ' + data.date, 0.03, 9, { left: true });
  y += pageHeight * 0.02;

  addLine('Received a sum of Rs. ' + data.amount, 0.04, 10, { left: true });
  addLine('(Rupees ' + data.amountInWords + ')', 0.045, 9, { left: true });
  y += pageHeight * 0.015;
  addLine('from: ' + data.payingTeamName, 0.04, 10, { left: true, bold: true });
  y += pageHeight * 0.015;
  addLine('as Match Fee for the match between', 0.035, 9, { left: true });
  addLine(data.team1Name + ' and ' + data.team2Name, 0.04, 10, { left: true, bold: true });
  addLine('on ' + data.matchDate, 0.035, 9, { left: true });
  y += pageHeight * 0.05;

  _drawSignatureOrLine_(slide, margin, y, contentWidth * 0.45, 'Signature, Registration Committee Convener', 'RegistrationInchargeSignatureFileId');

  return slide;
}

function createMatchFeeReceiptTemplate_(actorSession, force) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const existing = templatesFolder.getFilesByName('Match Fee Receipt Template');

  if (existing.hasNext()) {
    const existingFile = existing.next();
    if (!force) return { templateId: existingFile.getId(), created: false };
    const pres = SlidesApp.openById(existingFile.getId());
    _buildMatchFeeReceiptLayout_(pres, null);
    pres.saveAndClose();
    return { templateId: existingFile.getId(), created: false };
  }

  const pres = SlidesApp.create('Match Fee Receipt Template');
  const fileId = pres.getId();
  DriveApp.getFileById(fileId).moveTo(templatesFolder);
  _buildMatchFeeReceiptLayout_(pres, null);
  pres.saveAndClose();
  return { templateId: fileId, created: true };
}

// Mirrors _sendFinalDocumentsEmail_ (FinalDocuments.gs) exactly, but scoped to the PAYING
// team's own incharges only — the opponent's incharges are never read here, so a combined or
// cross-team send is structurally impossible, not merely disallowed by convention.
function _sendMatchFeeReceiptEmail_(actorSession, transactionId, teamId, pdfFileId, recipientEmails, verb) {
  let recipients = recipientEmails;
  if (!recipients || recipients.length === 0) {
    recipients = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId)
      .map(function (i) { return i.EmailAddress; }).filter(function (e) { return !!e; });
  }
  if (recipients.length === 0) {
    appendRow_('EMAIL_LOG', {
      EmailId: nextId_('EML', 4), DocumentId: transactionId, Recipient: '', Subject: '',
      SentAt: new Date().toISOString(), User: actorSession.userId, Status: 'NOT_SENT', ErrorMessage: 'No incharge email on file.'
    });
    return { status: 'NOT_SENT', recipients: [] };
  }

  const team = findRowById_('TEAMS', 'TeamId', teamId);
  const subject = 'Match Fee Receipt — ' + (team ? team.values.RegistrationNumber : teamId);
  const body = 'Please find attached your Match Fee Receipt' + (verb === 'resent' ? ' (resent).' : '.');
  let status = 'SENT';
  let errorMessage = '';
  try {
    GmailApp.sendEmail(recipients.join(','), subject, body, {
      attachments: [DriveApp.getFileById(pdfFileId).getBlob()],
      name: getSetting_('OrganizerName', '')
    });
  } catch (err) {
    status = 'FAILED';
    errorMessage = err.message;
  }
  appendRow_('EMAIL_LOG', {
    EmailId: nextId_('EML', 4), DocumentId: transactionId, Recipient: recipients.join(','), Subject: subject,
    SentAt: new Date().toISOString(), User: actorSession.userId, Status: status, ErrorMessage: errorMessage
  });
  return { status: status, recipients: recipients };
}

function _matchFeeTransactionResponse_(tx, isReplay) {
  return {
    transactionId: tx.TransactionId, matchId: tx.MatchId, teamId: tx.TeamId, amount: Number(tx.Amount),
    rateSnapshot: Number(tx.RateSnapshot), paymentMethod: tx.PaymentMethod, paidAt: tx.PaidAt,
    receiptNumber: tx.ReceiptNumber, receiptPdfFileId: tx.ReceiptPdfFileId,
    receiptPdfUrl: tx.ReceiptPdfFileId ? 'https://drive.google.com/file/d/' + tx.ReceiptPdfFileId + '/view' : '',
    emailStatus: tx.EmailStatus, status: tx.Status, replay: !!isReplay
  };
}

// Mirrors purchasePackage_'s idempotency/locking shape (FoodPackages.gs) and
// finalizeDepartureAndGenerateDocuments_'s fast-path-then-generate shape (FinalDocuments.gs):
// the financial transaction is durably written and the lock released BEFORE the PDF/email
// work, so a PDF or email failure can never leave a payment unrecorded or untraceable (spec
// §25). Enforces the one-ACTIVE-transaction-per-(MatchId,TeamId) invariant (spec §2.2) inside
// the lock — the actual duplicate/concurrent-payment protection.
function collectMatchFee_(actorSession, matchId, teamId, mode, recipientEmails, clientRequestId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!mode) throw apiError_('VALIDATION_ERROR', 'Payment mode is required.');
  const match = findRowById_('MATCHES', 'MatchId', matchId);
  if (!match) throw apiError_('NOT_FOUND', 'No such match: ' + matchId);
  if (match.values.Status === 'VOID') throw apiError_('MATCH_VOID', 'This match has been voided.');
  if (teamId !== match.values.Team1Id && teamId !== match.values.Team2Id) {
    throw apiError_('VALIDATION_ERROR', 'That team is not part of this match.');
  }
  const opponentTeamId = teamId === match.values.Team1Id ? match.values.Team2Id : match.values.Team1Id;
  const matchFeeRate = Number(getSetting_('MatchFeeRate', '0'));
  if (!matchFeeRate || matchFeeRate <= 0) {
    throw apiError_('VALIDATION_ERROR', 'Match Fee rate is not configured. Ask Admin to set it in Financial Settings.');
  }

  function replayResult() {
    if (!clientRequestId) return null;
    const byRequestId = findRowsByField_('MATCH_FEE_TRANSACTIONS', 'ClientRequestId', clientRequestId)[0];
    return byRequestId ? _matchFeeTransactionResponse_(byRequestId, true) : null;
  }

  const fastReplay = replayResult();
  if (fastReplay) return fastReplay;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let txRow;
  try {
    const authoritativeReplay = replayResult();
    if (authoritativeReplay) return authoritativeReplay;

    const alreadyPaid = findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId)
      .filter(function (t) { return t.TeamId === teamId && t.Status === 'ACTIVE'; })[0] || null;
    if (alreadyPaid) {
      const err = apiError_('ALREADY_PAID', 'Match Fee already paid for this team for Match No. ' + match.values.MatchNumber + '. Receipt No.: ' + alreadyPaid.ReceiptNumber);
      err.receiptNumber = alreadyPaid.ReceiptNumber;
      err.transactionId = alreadyPaid.TransactionId;
      throw err;
    }

    const transactionId = nextId_('MFTX', 5);
    const receiptNumber = nextDocumentNumber_('MatchFee');
    const now = new Date().toISOString();
    txRow = {
      TransactionId: transactionId, MatchId: matchId, TeamId: teamId, OpponentTeamId: opponentTeamId,
      Amount: matchFeeRate, RateSnapshot: matchFeeRate, PaymentMethod: mode, PaidAt: now,
      CollectedBy: actorSession.userId, ReceiptNumber: receiptNumber, ReceiptPdfFileId: '',
      EmailStatus: 'NOT_SENT', Status: 'ACTIVE', VoidReason: '', VoidedBy: '', VoidedAt: '',
      ClientRequestId: clientRequestId || '', CreatedBy: actorSession.userId, CreatedAt: now
    };
    appendRow_('MATCH_FEE_TRANSACTIONS', txRow);
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'COLLECT_MATCH_FEE', Entity: 'MATCH_FEE_TRANSACTION', EntityId: transactionId, PreviousState: '', NewState: 'ACTIVE'
    });
  } finally {
    lock.releaseLock();
  }

  // --- PDF + email, outside the lock (purchasePackage_'s comment applies identically here):
  // the transaction row above is already durable even if either step below fails.
  const payingTeam = findRowById_('TEAMS', 'TeamId', teamId).values;
  const opponentTeam = findRowById_('TEAMS', 'TeamId', opponentTeamId).values;
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const templateFileIter = templatesFolder.getFilesByName('Match Fee Receipt Template');
  if (!templateFileIter.hasNext()) {
    throw apiError_('NOT_FOUND', 'Match Fee Receipt template not set up — run admin.bootstrap.createMatchFeeReceiptTemplate first. Payment was recorded (Receipt No. ' + txRow.ReceiptNumber + ') and is not lost.');
  }
  const templateFile = templateFileIter.next();
  const receiptsFolder = _ensureSubfolder_(_getRootFolder_(), 'Match Fee Receipts');
  const now2 = new Date();
  const amountInWords = _numberToWordsIndian_(matchFeeRate);

  const copyFile = templateFile.makeCopy('Match Fee Receipt - ' + txRow.ReceiptNumber.replace(/\//g, '-'), receiptsFolder);
  const pres = SlidesApp.openById(copyFile.getId());
  _buildMatchFeeReceiptLayout_(pres, {
    tournamentName: getSetting_('TournamentName', ''), organizer: getSetting_('OrganizerName', ''),
    districtAddress: getSetting_('DistrictAddress', ''), receiptNumber: txRow.ReceiptNumber,
    date: Utilities.formatDate(now2, 'Asia/Kolkata', 'yyyy-MM-dd'), amount: matchFeeRate, amountInWords: amountInWords,
    payingTeamName: payingTeam.CollegeName,
    team1Name: teamId === match.values.Team1Id ? payingTeam.CollegeName : opponentTeam.CollegeName,
    team2Name: teamId === match.values.Team2Id ? payingTeam.CollegeName : opponentTeam.CollegeName,
    matchDate: match.values.MatchDate
  });
  pres.saveAndClose();
  const pdfBlob = DriveApp.getFileById(copyFile.getId()).getAs('application/pdf');
  const pdfFile = receiptsFolder.createFile(pdfBlob).setName('Match-Fee-Receipt-' + txRow.ReceiptNumber.replace(/\//g, '-') + '.pdf');
  DriveApp.getFileById(copyFile.getId()).setTrashed(true);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  updateRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', txRow.TransactionId, { ReceiptPdfFileId: pdfFile.getId() });

  const emailResult = _sendMatchFeeReceiptEmail_(actorSession, txRow.TransactionId, teamId, pdfFile.getId(), recipientEmails, 'sent');
  updateRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', txRow.TransactionId, { EmailStatus: emailResult.status });

  return _matchFeeTransactionResponse_(findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', txRow.TransactionId).values, false);
}
```

- [ ] **Step 5: Register two actions in `backend/Main.gs`**

Add, right after the `matchfee.match.detail` entry from Task 2:

```javascript
  'admin.bootstrap.createMatchFeeReceiptTemplate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createMatchFeeReceiptTemplate_(session, !!(payload && payload.force));
  },
  'matchfee.pay': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return collectMatchFee_(session, payload.matchId, payload.teamId, payload.mode, payload.recipientEmails, requestId);
  },
```

- [ ] **Step 6: Push, deploy, create the Match Fee Receipt template and Drive folder once, verify both tests pass**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Task 3: match fee receipt template + collection"
```

```bash
call_action '{"action":"admin.bootstrap.setupDriveFolders","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"admin.bootstrap.createMatchFeeReceiptTemplate","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"matchfee_collectMatchFee_fullPaymentAndProtectionFlow"}}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"matchfee_doesNotAffectFinalReceiptSettlement"}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"pdf2"}}'
```

Expected: both new tests report `"status":"PASS"`; the full `pdf2` tier reports every
previously-passing test still passing, plus these two.

- [ ] **Step 7: Commit**

```bash
git add backend/MatchFee.gs backend/Setup.gs backend/Main.gs backend/Tests.gs
git commit -m "Match Fee Collection Task 3: receipt template, collection (PDF + email)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HZcRi1y5CTbzdpanzfTKrX"
```

---

## Task 4: Resend and void

**Files:**
- Modify: `backend/MatchFee.gs` (`resendMatchFeeReceipt_`, `voidMatchFeeTransaction_`)
- Modify: `backend/Main.gs` (register two actions)
- Modify: `backend/Tests.gs` (one new test, registered in `TEST_CASES`, tier `pdf2`)

**Interfaces:**
- Consumes: Task 3's `collectMatchFee_`, `_sendMatchFeeReceiptEmail_`,
  `_matchFeeTransactionResponse_`.
- Produces (consumed by Task 6/7's frontend):
  - `resendMatchFeeReceipt_(actorSession, transactionId, recipientEmails): same shape as
    _matchFeeTransactionResponse_` — reuses the existing `ReceiptPdfFileId`/`ReceiptNumber`,
    never regenerates, never reissues a number.
  - `voidMatchFeeTransaction_(actorSession, transactionId, reason): {transactionId, status:
    'VOID', receiptNumber}` — `ADMIN` only, requires a non-empty `reason`.

- [ ] **Step 1: Write the failing test**

In `backend/Tests.gs`, add after `test_matchfee_doesNotAffectFinalReceiptSettlement`:

```javascript
function test_matchfee_resendAndVoidThenRecollect() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const adminSession = { userId: 'USR-0002', role: ROLES.ADMIN, sessionId: 'a' };
  let team1Id = null, team2Id = null, matchId = null;
  const trashFileIds = [];
  try {
    team1Id = registerTeam_(regSession, 'Match Fee Void College A', 'District', 6, [{ name: 'Coach A', isPrimary: true }]).teamId;
    team2Id = registerTeam_(regSession, 'Match Fee Void College B', 'District', 6, [{ name: 'Coach B', isPrimary: true }]).teamId;
    const match = createMatch_(regSession, team1Id, team2Id, '2026-09-23');
    matchId = match.matchId;

    const paid = collectMatchFee_(regSession, matchId, team1Id, 'Cash', [], null);
    trashFileIds.push(paid.receiptPdfFileId);

    // Resend reuses the SAME receipt — never a new number, never a new transaction.
    const resent = resendMatchFeeReceipt_(regSession, paid.transactionId, []);
    assertEqual_(resent.receiptNumber, paid.receiptNumber, 'resend must reuse the same receipt number');
    assertEqual_(resent.receiptPdfFileId, paid.receiptPdfFileId, 'resend must reuse the same receipt PDF');
    assertEqual_(findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId).filter(function (t) { return t.TeamId === team1Id; }).length, 1, 'resend must not create a second transaction');

    // Void requires ADMIN and a reason.
    let threwForbidden = false;
    try {
      voidMatchFeeTransaction_(regSession, paid.transactionId, 'wrong role test');
    } catch (err) { threwForbidden = true; assertEqual_(err.code, 'FORBIDDEN', 'wrong code for a Registration caller voiding'); }
    assertTrue_(threwForbidden, 'voidMatchFeeTransaction_ did not reject a non-Admin caller');

    let threwNoReason = false;
    try {
      voidMatchFeeTransaction_(adminSession, paid.transactionId, '');
    } catch (err) { threwNoReason = true; assertEqual_(err.code, 'VALIDATION_ERROR', 'wrong code for a missing void reason'); }
    assertTrue_(threwNoReason, 'voidMatchFeeTransaction_ did not require a reason');

    const voided = voidMatchFeeTransaction_(adminSession, paid.transactionId, 'Collected in error — wrong team');
    assertEqual_(voided.status, 'VOID', 'void should set Status to VOID');
    assertEqual_(voided.receiptNumber, paid.receiptNumber, 'void must retain the original receipt number');

    const voidedRow = findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', paid.transactionId).values;
    assertEqual_(voidedRow.VoidReason, 'Collected in error — wrong team', 'void reason not recorded');
    assertEqual_(voidedRow.VoidedBy, adminSession.userId, 'voidedBy not recorded');
    assertTrue_(!!voidedRow.VoidedAt, 'voidedAt not recorded');

    let threwAlreadyVoid = false;
    try {
      voidMatchFeeTransaction_(adminSession, paid.transactionId, 'double void attempt');
    } catch (err) { threwAlreadyVoid = true; assertEqual_(err.code, 'ALREADY_VOID', 'wrong code for double-void'); }
    assertTrue_(threwAlreadyVoid, 'voidMatchFeeTransaction_ did not reject voiding an already-voided transaction');

    // The team can now be re-collected — new transaction, new receipt number, old row stays VOID.
    const recollected = collectMatchFee_(regSession, matchId, team1Id, 'Online', [], null);
    trashFileIds.push(recollected.receiptPdfFileId);
    assertTrue_(recollected.transactionId !== paid.transactionId, 're-collection after void must create a new transaction');
    assertTrue_(recollected.receiptNumber !== paid.receiptNumber, 're-collection after void must allocate a new receipt number, never the voided one');

    const allTxForTeam1 = findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId).filter(function (t) { return t.TeamId === team1Id; });
    assertEqual_(allTxForTeam1.length, 2, 'both the voided and the new transaction should remain in history');
    assertEqual_(allTxForTeam1.filter(function (t) { return t.Status === 'VOID'; }).length, 1, 'exactly one of the two rows should be VOID');
    assertEqual_(allTxForTeam1.filter(function (t) { return t.Status === 'ACTIVE'; }).length, 1, 'exactly one of the two rows should be ACTIVE');

    const detail = getMatchDetail_(regSession, matchId);
    assertEqual_(detail.team1Status.status, 'PAID', 'team1 should be PAID again via the new transaction');
    assertEqual_(detail.team1Status.receiptNumber, recollected.receiptNumber, 'match detail should reflect the NEW receipt number, not the voided one');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    if (matchId) {
      findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId).forEach(function (t) { deleteRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', t.TransactionId); });
      deleteRowById_('MATCHES', 'MatchId', matchId);
    }
    [team1Id, team2Id].forEach(function (id) {
      if (!id) return;
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', id).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', id);
    });
  }
}
```

Register it in `TEST_CASES`, tier `pdf2`, right after
`{ name: 'matchfee_doesNotAffectFinalReceiptSettlement', ... }`:

```javascript
  { name: 'matchfee_resendAndVoidThenRecollect', fn: test_matchfee_resendAndVoidThenRecollect, tier: 'pdf2' },
```

- [ ] **Step 2: Push and verify it fails**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"matchfee_resendAndVoidThenRecollect"}}'
```

Expected: FAILS — `resendMatchFeeReceipt_ is not defined`.

- [ ] **Step 3: Append resend + void to `backend/MatchFee.gs`**

```javascript
// Re-sends the EXISTING receipt PDF — never regenerates it, never allocates a new receipt
// number, never creates a new transaction. Mirrors resendFinalDocuments_/resendCoupon_.
function resendMatchFeeReceipt_(actorSession, transactionId, recipientEmails) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const tx = findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId);
  if (!tx) throw apiError_('NOT_FOUND', 'No such Match Fee transaction: ' + transactionId);
  if (!tx.values.ReceiptPdfFileId) throw apiError_('NOT_FOUND', 'No receipt PDF has been generated for this transaction yet.');

  const result = _sendMatchFeeReceiptEmail_(actorSession, transactionId, tx.values.TeamId, tx.values.ReceiptPdfFileId, recipientEmails, 'resent');
  updateRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId, { EmailStatus: result.status });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: new Date().toISOString(), UserId: actorSession.userId, Role: actorSession.role,
    Action: 'RESEND_MATCH_FEE_RECEIPT', Entity: 'MATCH_FEE_TRANSACTION', EntityId: transactionId, PreviousState: '', NewState: result.status
  });
  return _matchFeeTransactionResponse_(findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId).values, false);
}

// ADMIN only (spec §18/§19). The row is updated in place, never deleted — its ReceiptNumber
// is retained and never reused; the global Numbering_MatchFee_Next counter is untouched by a
// void, so it only ever advances forward. Once VOID, the (MatchId, TeamId) pair has zero
// ACTIVE transactions again, so collectMatchFee_'s invariant check allows a fresh, fully
// independent re-collection — new TransactionId, new RateSnapshot (the current rate), new
// ReceiptNumber, new PDF, new email (spec §7).
function voidMatchFeeTransaction_(actorSession, transactionId, reason) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (!reason) throw apiError_('VALIDATION_ERROR', 'A reason is required to void a Match Fee transaction.');
  const tx = findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId);
  if (!tx) throw apiError_('NOT_FOUND', 'No such Match Fee transaction: ' + transactionId);
  if (tx.values.Status === 'VOID') throw apiError_('ALREADY_VOID', 'This transaction has already been voided.');

  const now = new Date().toISOString();
  updateRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId, {
    Status: 'VOID', VoidReason: reason, VoidedBy: actorSession.userId, VoidedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'VOID_MATCH_FEE_TRANSACTION', Entity: 'MATCH_FEE_TRANSACTION', EntityId: transactionId, PreviousState: 'ACTIVE', NewState: 'VOID'
  });
  return { transactionId: transactionId, status: 'VOID', receiptNumber: tx.values.ReceiptNumber };
}
```

- [ ] **Step 4: Register two actions in `backend/Main.gs`**

Add, right after the `matchfee.pay` entry from Task 3:

```javascript
  'matchfee.receipt.resend': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resendMatchFeeReceipt_(session, payload.transactionId, payload.recipientEmails);
  },
  'matchfee.transaction.void': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return voidMatchFeeTransaction_(session, payload.transactionId, payload.reason);
  },
```

- [ ] **Step 5: Push, deploy, verify the test passes**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Task 4: resend + void"
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"matchfee_resendAndVoidThenRecollect"}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"pdf2"}}'
```

Expected: the named test reports `"status":"PASS"`; the full `pdf2` tier reports every
previously-passing test still passing, plus this one.

- [ ] **Step 6: Commit**

```bash
git add backend/MatchFee.gs backend/Main.gs backend/Tests.gs
git commit -m "Match Fee Collection Task 4: resend + void

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HZcRi1y5CTbzdpanzfTKrX"
```

---

## Task 5: Admin reports and dashboard

**Files:**
- Modify: `backend/Reports.gs` (`getReportsBundle_`)
- Modify: `backend/Tests.gs` (one new test, registered in `TEST_CASES`, fast tier)

**Interfaces:**
- Produces (consumed by Task 6's frontend): `getReportsBundle_`'s response gains
  `dashboard.matchFeeCollected/matchFeePending/matchFeeTeamPayments/
  matchFeeReceiptsGenerated: number` and a top-level `matchFee: {transactions:
  Array<{transactionId, matchId, matchNumber, matchDate, payingTeam, opponent, amount,
  receiptNumber, paymentMethod, paidAt, collectedBy, status, emailStatus}>, summary:
  {totalCollected, matchesCount, teamPaymentsCount, pendingCount, cashCollected,
  onlineCollected, chequeCollected}}` — computed only from `MATCHES`/
  `MATCH_FEE_TRANSACTIONS`, never merged into `financial`/`collegeWiseFinalStatement`.

- [ ] **Step 1: Write the failing test**

In `backend/Tests.gs`, add after `test_reports_getAll_adminOnlyAndAggregatesTeamCorrectly`:

```javascript
function test_reports_getAll_includesMatchFeeSeparately() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const adminSession = { userId: 'USR-0002', role: ROLES.ADMIN, sessionId: 'y' };
  let team1Id = null, team2Id = null, matchId = null, transactionId = null;
  try {
    team1Id = registerTeam_(regSession, 'Match Fee Report College A', 'District', 5, [{ name: 'Coach', isPrimary: true }]).teamId;
    team2Id = registerTeam_(regSession, 'Match Fee Report College B', 'District', 5, [{ name: 'Coach', isPrimary: true }]).teamId;
    const match = createMatch_(regSession, team1Id, team2Id, '2026-09-22');
    matchId = match.matchId;

    // Direct fixture write, bypassing collectMatchFee_ — no real PDF/email needed to test
    // report aggregation, matching this codebase's existing fixture convention
    // (_makeMessTestFixture_ writes FOOD_PACKAGES directly for the same reason).
    transactionId = nextId_('MFTX', 5);
    const now = new Date().toISOString();
    appendRow_('MATCH_FEE_TRANSACTIONS', {
      TransactionId: transactionId, MatchId: matchId, TeamId: team1Id, OpponentTeamId: team2Id,
      Amount: 500, RateSnapshot: 500, PaymentMethod: 'Cash', PaidAt: now, CollectedBy: regSession.userId,
      ReceiptNumber: 'GCB/HPUICK-2026/MF/09999', ReceiptPdfFileId: 'test-fixture-no-real-pdf',
      EmailStatus: 'SENT', Status: 'ACTIVE', VoidReason: '', VoidedBy: '', VoidedAt: '',
      ClientRequestId: '', CreatedBy: regSession.userId, CreatedAt: now
    });

    const bundle = getReportsBundle_(adminSession);
    assertTrue_(bundle.dashboard.hasOwnProperty('matchFeeCollected'), 'dashboard should expose matchFeeCollected');
    assertTrue_(!!bundle.matchFee, 'reports bundle should include a matchFee section');

    const txRow = bundle.matchFee.transactions.filter(function (t) { return t.transactionId === transactionId; })[0];
    assertTrue_(!!txRow, 'matchFee.transactions should include the fixture transaction');
    assertEqual_(txRow.payingTeam, 'Match Fee Report College A', 'wrong paying team name in matchFee report row');
    assertEqual_(txRow.opponent, 'Match Fee Report College B', 'wrong opponent name in matchFee report row');
    assertEqual_(txRow.matchNumber, match.matchNumber, 'wrong match number in matchFee report row');

    assertTrue_(bundle.matchFee.summary.totalCollected >= 500, 'matchFee summary totalCollected should include the fixture amount');
    assertTrue_(bundle.matchFee.summary.cashCollected >= 500, 'matchFee summary cashCollected should include the Cash fixture amount');

    // Isolation (spec §9 applies to reporting too): this transaction must never appear as a
    // Dari/food/security figure in the EXISTING financial report.
    const financialRow = bundle.financial.filter(function (r) { return r.teamId === team1Id; })[0];
    assertTrue_(!!financialRow, 'financial report should still include the team');
    assertEqual_(financialRow.dariCharges, 0, 'Match Fee must never be counted as dariCharges in the financial report');
    assertEqual_(financialRow.packageRevenue, 0, 'Match Fee must never be counted as packageRevenue in the financial report');
  } finally {
    if (transactionId) deleteRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId);
    if (matchId) deleteRowById_('MATCHES', 'MatchId', matchId);
    [team1Id, team2Id].forEach(function (id) {
      if (!id) return;
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', id).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', id);
    });
  }
}
```

Register it in `TEST_CASES` (default/fast tier), right after
`{ name: 'reports_getAll_adminOnlyAndAggregatesTeamCorrectly', ... }`:

```javascript
  { name: 'reports_getAll_includesMatchFeeSeparately', fn: test_reports_getAll_includesMatchFeeSeparately },
```

- [ ] **Step 2: Push and verify it fails**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"reports_getAll_includesMatchFeeSeparately"}}'
```

Expected: FAILS — `bundle.matchFee` is undefined.

- [ ] **Step 3: Extend `getReportsBundle_` in `backend/Reports.gs`**

Change the function's ending from:

```javascript
  return {
    dashboard: dashboard, financial: financial, food: food, accommodation: accommodation,
    departure: departure, collegeWiseFinalStatement: collegeWiseFinalStatement
  };
}
```

to (new block inserted just above the `return`, and `matchFee: matchFee` added to the
returned object):

```javascript
  // --- Match Fee (spec §20/§9 — a separate stream, never merged into financial/
  // collegeWiseFinalStatement) ---
  const matchFeeTransactions = rowsToObjects_('MATCH_FEE_TRANSACTIONS');
  const matches = rowsToObjects_('MATCHES');
  const matchesById = {};
  matches.forEach(function (m) { matchesById[m.MatchId] = m; });
  const teamsById = {};
  teams.forEach(function (t) { teamsById[t.TeamId] = t; });

  const activeMatchFeeTx = matchFeeTransactions.filter(function (t) { return t.Status === 'ACTIVE'; });
  const matchFeeByMethod = { Cash: 0, Online: 0, Cheque: 0 };
  activeMatchFeeTx.forEach(function (t) { matchFeeByMethod[t.PaymentMethod] = (matchFeeByMethod[t.PaymentMethod] || 0) + Number(t.Amount); });

  let matchFeePendingCount = 0;
  matches.forEach(function (m) {
    [m.Team1Id, m.Team2Id].forEach(function (teamId) {
      const paid = activeMatchFeeTx.some(function (t) { return t.MatchId === m.MatchId && t.TeamId === teamId; });
      if (!paid) matchFeePendingCount++;
    });
  });

  const matchFee = {
    transactions: matchFeeTransactions.map(function (t) {
      const m = matchesById[t.MatchId];
      const payingTeam = teamsById[t.TeamId];
      const opponentTeam = teamsById[t.OpponentTeamId];
      return {
        transactionId: t.TransactionId, matchId: t.MatchId, matchNumber: m ? m.MatchNumber : '',
        matchDate: m ? m.MatchDate : '', payingTeam: payingTeam ? payingTeam.CollegeName : '',
        opponent: opponentTeam ? opponentTeam.CollegeName : '', amount: Number(t.Amount),
        receiptNumber: t.ReceiptNumber, paymentMethod: t.PaymentMethod, paidAt: t.PaidAt,
        collectedBy: t.CollectedBy, status: t.Status, emailStatus: t.EmailStatus
      };
    }),
    summary: {
      totalCollected: sum(activeMatchFeeTx, 'Amount'), matchesCount: matches.length,
      teamPaymentsCount: activeMatchFeeTx.length, pendingCount: matchFeePendingCount,
      cashCollected: matchFeeByMethod.Cash, onlineCollected: matchFeeByMethod.Online, chequeCollected: matchFeeByMethod.Cheque
    }
  };
  dashboard.matchFeeCollected = matchFee.summary.totalCollected;
  dashboard.matchFeePending = matchFee.summary.pendingCount;
  dashboard.matchFeeTeamPayments = matchFee.summary.teamPaymentsCount;
  dashboard.matchFeeReceiptsGenerated = activeMatchFeeTx.filter(function (t) { return !!t.ReceiptPdfFileId; }).length;

  return {
    dashboard: dashboard, financial: financial, food: food, accommodation: accommodation,
    departure: departure, collegeWiseFinalStatement: collegeWiseFinalStatement, matchFee: matchFee
  };
}
```

- [ ] **Step 4: Push, deploy, verify the test passes**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Task 5: match fee reports/dashboard"
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"reports_getAll_includesMatchFeeSeparately"}}'
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: the named test reports `"status":"PASS"`; the full `fast` tier reports every
previously-passing test still passing, plus this one.

- [ ] **Step 5: Commit**

```bash
git add backend/Reports.gs backend/Tests.gs
git commit -m "Match Fee Collection Task 5: admin reports + dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HZcRi1y5CTbzdpanzfTKrX"
```

---

## Task 6: Wire Match Fee into existing frontend screens

**Files:**
- Modify: `frontend/js/registration.js` (dashboard button)
- Modify: `frontend/js/settings.js` (Match Fee rate field)
- Modify: `frontend/js/reports.js` (dashboard summary line + report tab)

No backend changes — no automated test step (this codebase has no frontend test harness;
manual verification happens once Task 7 completes the screens these link to).

- [ ] **Step 1: Add the dashboard button in `frontend/js/registration.js`**

Change `renderRegistrationDashboard` from:

```javascript
function renderRegistrationDashboard(root, user) {
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">Registration Committee</p>' +
      '<button id="register-team-btn">Register New Team</button>' +
      '<button id="view-teams-btn">Teams</button>' +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  document.getElementById('register-team-btn').addEventListener('click', function () {
    navigateTo(renderRegisterWizard, root, user);
  });
  document.getElementById('view-teams-btn').addEventListener('click', function () {
    navigateTo(renderTeamsList, root, user);
  });
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    resetNavigation(renderLogin, root, null);
  });
}
```

to:

```javascript
function renderRegistrationDashboard(root, user) {
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">Registration Committee</p>' +
      '<button id="register-team-btn">Register New Team</button>' +
      '<button id="view-teams-btn">Teams</button>' +
      '<button id="match-fee-btn">Match Fee Collection</button>' +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  document.getElementById('register-team-btn').addEventListener('click', function () {
    navigateTo(renderRegisterWizard, root, user);
  });
  document.getElementById('view-teams-btn').addEventListener('click', function () {
    navigateTo(renderTeamsList, root, user);
  });
  document.getElementById('match-fee-btn').addEventListener('click', function () {
    navigateTo(renderMatchFeeList, root, user);
  });
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    resetNavigation(renderLogin, root, null);
  });
}
```

- [ ] **Step 2: Add the Match Fee rate field in `frontend/js/settings.js`**

Change the Rates form block from:

```javascript
        '<h2 style="margin-top:24px">Rates &amp; Security</h2>' +
        '<form id="rates-form">' +
          '<label>Breakfast Rate (Rs)<input type="number" id="rate-breakfast" min="0" step="1" value="' + info.rateBreakfast + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Lunch Rate (Rs)<input type="number" id="rate-lunch" min="0" step="1" value="' + info.rateLunch + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Dinner Rate (Rs)<input type="number" id="rate-dinner" min="0" step="1" value="' + info.rateDinner + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Dari Rate (Rs, per team member)<input type="number" id="rate-dari" min="0" step="1" value="' + info.rateDari + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Security Amount (Rs, flat per team)<input type="number" id="rate-security" min="0" step="1" value="' + info.securityAmount + '" ' + (locked ? 'disabled' : '') + '></label>' +
          (locked ? '' : '<button type="submit">Save Rates</button>') +
        '</form>' +
```

to:

```javascript
        '<h2 style="margin-top:24px">Rates &amp; Security</h2>' +
        '<form id="rates-form">' +
          '<label>Breakfast Rate (Rs)<input type="number" id="rate-breakfast" min="0" step="1" value="' + info.rateBreakfast + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Lunch Rate (Rs)<input type="number" id="rate-lunch" min="0" step="1" value="' + info.rateLunch + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Dinner Rate (Rs)<input type="number" id="rate-dinner" min="0" step="1" value="' + info.rateDinner + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Dari Rate (Rs, per team member)<input type="number" id="rate-dari" min="0" step="1" value="' + info.rateDari + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Security Amount (Rs, flat per team)<input type="number" id="rate-security" min="0" step="1" value="' + info.securityAmount + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Match Fee (Rs, per team per match)<input type="number" id="rate-matchfee" min="0" step="1" value="' + info.matchFeeRate + '" ' + (locked ? 'disabled' : '') + '></label>' +
          (locked ? '' : '<button type="submit">Save Rates</button>') +
        '</form>' +
```

Change the rates-form submit handler from:

```javascript
          const updated = await apiCall('admin.settings.updateRates', {
            breakfast: Number(document.getElementById('rate-breakfast').value),
            lunch: Number(document.getElementById('rate-lunch').value),
            dinner: Number(document.getElementById('rate-dinner').value),
            dari: Number(document.getElementById('rate-dari').value),
            security: Number(document.getElementById('rate-security').value)
          });
```

to:

```javascript
          const updated = await apiCall('admin.settings.updateRates', {
            breakfast: Number(document.getElementById('rate-breakfast').value),
            lunch: Number(document.getElementById('rate-lunch').value),
            dinner: Number(document.getElementById('rate-dinner').value),
            dari: Number(document.getElementById('rate-dari').value),
            security: Number(document.getElementById('rate-security').value),
            matchFee: Number(document.getElementById('rate-matchfee').value)
          });
```

- [ ] **Step 3: Add the dashboard line and report tab in `frontend/js/reports.js`**

Change `renderAdminDashboard`'s summary block from:

```javascript
      '<p>NOC Granted: ' + d.nocGrantedCount + ' &middot; Pending: ' + d.nocPendingCount + '</p>' +
      '<button id="manage-users-btn" style="margin-top:12px">Manage Users</button>' +
```

to:

```javascript
      '<p>NOC Granted: ' + d.nocGrantedCount + ' &middot; Pending: ' + d.nocPendingCount + '</p>' +
      '<p>Match Fee — Collected: Rs ' + d.matchFeeCollected + ' &middot; Pending Team Payments: ' + d.matchFeePending + ' &middot; Team Payments: ' + d.matchFeeTeamPayments + ' &middot; Receipts: ' + d.matchFeeReceiptsGenerated + '</p>' +
      '<button id="manage-users-btn" style="margin-top:12px">Manage Users</button>' +
```

Change `_renderReportTab`'s tab list in `renderReportsScreen` from:

```javascript
  const tabs = [
    { key: 'financial', label: 'Financial' }, { key: 'food', label: 'Food' },
    { key: 'accommodation', label: 'Accommodation' }, { key: 'departure', label: 'Departure' },
    { key: 'final', label: 'Final Statement' }
  ];
```

to:

```javascript
  const tabs = [
    { key: 'financial', label: 'Financial' }, { key: 'food', label: 'Food' },
    { key: 'accommodation', label: 'Accommodation' }, { key: 'departure', label: 'Departure' },
    { key: 'final', label: 'Final Statement' }, { key: 'matchFee', label: 'Match Fee' }
  ];
```

Add a new branch to `_renderReportTab`, inserted right before the function's final
`// 'final'` fallback block (i.e. after the `if (tab === 'departure') { ... }` block and
before the trailing `if (bundle.collegeWiseFinalStatement.length === 0) ...`):

```javascript
  if (tab === 'matchFee') {
    const s = bundle.matchFee.summary;
    return '<p>Total Collected: Rs ' + s.totalCollected + ' &middot; Matches: ' + s.matchesCount + ' &middot; Team Payments: ' + s.teamPaymentsCount + ' &middot; Pending: ' + s.pendingCount + '</p>' +
      '<p>Cash: Rs ' + s.cashCollected + ' &middot; Online: Rs ' + s.onlineCollected + ' &middot; Cheque: Rs ' + s.chequeCollected + '</p>' +
      '<table><thead><tr><th>Match No</th><th>Date</th><th>Paying Team</th><th>Opponent</th><th>Amount</th><th>Receipt No.</th><th>Method</th><th>Paid At</th><th>Collected By</th><th>Status</th></tr></thead><tbody>' +
      bundle.matchFee.transactions.map(function (t) {
        return '<tr><td>' + t.matchNumber + '</td><td>' + t.matchDate + '</td><td>' + t.payingTeam + '</td><td>' + t.opponent + '</td><td>' + t.amount + '</td><td>' + t.receiptNumber + '</td><td>' + t.paymentMethod + '</td><td>' + t.paidAt + '</td><td>' + t.collectedBy + '</td><td>' + t.status + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
```

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\princ\Downloads\HPUICK"
git add frontend/js/registration.js frontend/js/settings.js frontend/js/reports.js
git commit -m "Match Fee Collection Task 6: wire into existing dashboard/settings/reports screens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HZcRi1y5CTbzdpanzfTKrX"
```

---

## Task 7: New Match Fee screens, service worker, deploy, dev-log

**Files:**
- Create: `frontend/js/matchfee.js`
- Modify: `frontend/index.html` (script tag)
- Modify: `frontend/service-worker.js` (bump `CACHE_NAME`, add the new file to
  `SHELL_FILES`)
- Modify: `docs/superpowers/dev-log.md`

No backend changes — no automated test step (same reasoning as Task 6).

- [ ] **Step 1: Create `frontend/js/matchfee.js`**

```javascript
// matchfee.js — Match Fee Collection: match list/history, create match, collect/view/resend
// receipts, and (Admin only) void a transaction. Backend actions: matchfee.match.create/
// .list/.detail, matchfee.pay, matchfee.receipt.resend, matchfee.transaction.void.

async function renderMatchFeeList(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Match Fee Collection</h1><p>Loading…</p></div>';
  const data = await apiCall('matchfee.match.list', {});
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>Match Fee Collection</h1>' +
      '<p class="subtitle">Every match and both teams\' payment status — this list is also the Match Fee history.</p>' +
      '<button id="create-match-btn">+ Create Match</button>' +
      '<div style="overflow-x:auto"><table><thead><tr><th>Match No.</th><th>Date</th><th>Team 1</th><th>Status</th><th>Team 2</th><th>Status</th></tr></thead>' +
      '<tbody id="matches-tbody">' +
        data.matches.map(function (m) {
          return '<tr class="match-row" data-matchid="' + m.matchId + '" style="cursor:pointer">' +
            '<td>' + m.matchNumber + '</td><td>' + m.matchDate + '</td>' +
            '<td>' + m.team1.collegeName + '</td><td><strong>' + m.team1Status.status + '</strong></td>' +
            '<td>' + m.team2.collegeName + '</td><td><strong>' + m.team2Status.status + '</strong></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<button id="back-btn" style="margin-top:12px">Back</button>' +
    '</div>';
  Array.prototype.forEach.call(document.querySelectorAll('.match-row'), function (row) {
    row.addEventListener('click', function () { navigateTo(renderMatchDetail, root, user, row.getAttribute('data-matchid')); });
  });
  document.getElementById('create-match-btn').addEventListener('click', function () {
    navigateTo(renderCreateMatchForm, root, user);
  });
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}

async function renderCreateMatchForm(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Create Match</h1><p>Loading teams…</p></div>';
  const data = await apiCall('registration.teams.list', {});

  function teamOptions(excludeTeamId) {
    return data.teams
      .filter(function (t) { return t.teamId !== excludeTeamId; })
      .map(function (t) { return '<option value="' + t.teamId + '">' + t.collegeName + '</option>'; })
      .join('');
  }

  function render(team1Id, team2Id) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Create Match</h1>' +
        '<div id="create-match-error" class="error" style="display:none"></div>' +
        '<form id="create-match-form">' +
          '<label>Team 1<select id="team1-select" required><option value="">Select team…</option>' + teamOptions(team2Id) + '</select></label>' +
          '<label>Team 2<select id="team2-select" required><option value="">Select team…</option>' + teamOptions(team1Id) + '</select></label>' +
          '<label>Match Date<input type="date" id="match-date" required></label>' +
          '<button type="submit">Create Match</button>' +
        '</form>' +
        '<button id="cancel-btn" style="margin-top:8px;background:#999">Cancel</button>' +
      '</div>';

    if (team1Id) document.getElementById('team1-select').value = team1Id;
    if (team2Id) document.getElementById('team2-select').value = team2Id;

    // Picking a team in one selector removes it from the other's options — a client-side
    // convenience only; matchfee.match.create is what actually enforces distinct teams.
    document.getElementById('team1-select').addEventListener('change', function () {
      render(this.value || null, document.getElementById('team2-select').value || null);
    });
    document.getElementById('team2-select').addEventListener('change', function () {
      render(document.getElementById('team1-select').value || null, this.value || null);
    });

    document.getElementById('cancel-btn').addEventListener('click', function () { goBack(); });

    document.getElementById('create-match-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('create-match-error');
      errEl.style.display = 'none';
      try {
        const result = await apiCall('matchfee.match.create', {
          team1Id: document.getElementById('team1-select').value,
          team2Id: document.getElementById('team2-select').value,
          matchDate: document.getElementById('match-date').value
        });
        navigateReplace(renderMatchDetail, root, user, result.matchId);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  render(null, null);
}

function _matchFeeTeamCardHtml(sideLabel, teamStatus, teamName, rate, canCollect, sideKey, isAdmin) {
  const paid = teamStatus.status === 'PAID';
  return (
    '<div style="margin:12px 0;padding:12px;border:1px solid #ddd;border-radius:8px">' +
      '<p style="margin:0 0 4px"><strong>' + sideLabel + ': ' + teamName + '</strong></p>' +
      '<p style="margin:0 0 4px">Status: <strong style="color:' + (paid ? 'var(--success)' : 'var(--error)') + '">' + teamStatus.status + '</strong></p>' +
      '<p style="margin:0 0 8px">Match Fee: Rs ' + rate + '</p>' +
      (paid
        ? ('<p class="hint" style="margin:0 0 8px">Receipt No.: ' + teamStatus.receiptNumber + ' &middot; Email: ' + teamStatus.emailStatus + '</p>' +
           '<a href="' + (teamStatus.receiptPdfFileId ? 'https://drive.google.com/file/d/' + teamStatus.receiptPdfFileId + '/view' : '#') + '" target="_blank" rel="noopener"><button type="button">View Receipt</button></a>' +
           '<button type="button" class="mf-resend-btn" data-txid="' + teamStatus.transactionId + '" style="margin-top:8px;background:#666">Resend Receipt</button>' +
           '<div class="mf-resend-status" data-txid="' + teamStatus.transactionId + '" style="margin-top:4px"></div>' +
           (isAdmin
             ? ('<button type="button" class="mf-void-toggle-btn" data-txid="' + teamStatus.transactionId + '" style="margin-top:8px;background:#b91c1c">Void Transaction</button>' +
                '<div class="mf-void-form" data-txid="' + teamStatus.transactionId + '" style="display:none;margin-top:8px">' +
                  '<label>Reason for void<input type="text" class="mf-void-reason" data-txid="' + teamStatus.transactionId + '"></label>' +
                  '<button type="button" class="mf-void-confirm-btn" data-txid="' + teamStatus.transactionId + '" style="background:#b91c1c">Confirm Void</button>' +
                  '<div class="mf-void-status" data-txid="' + teamStatus.transactionId + '" style="margin-top:4px"></div>' +
                '</div>')
             : ''))
        : (canCollect
            ? ('<label>Payment Mode<select class="mf-mode-select" data-side="' + sideKey + '">' +
                 '<option value="Cash">Cash</option>' +
                 '<option value="Online">Online / Bank Transfer</option>' +
                 '<option value="Cheque">Cheque</option>' +
               '</select></label>' +
               '<button type="button" class="mf-collect-btn" data-side="' + sideKey + '">Collect Match Fee</button>')
            : '<p class="hint">Only Registration Committee/Admin can collect Match Fee.</p>')) +
    '</div>'
  );
}

async function renderMatchDetail(root, user, matchId) {
  root.innerHTML = '<div class="wizard-card"><h1>Match Detail</h1><p>Loading…</p></div>';
  const initial = await apiCall('matchfee.match.detail', { matchId: matchId });
  render(initial);

  async function _refreshMatchDetail(errMessage) {
    const refreshed = await apiCall('matchfee.match.detail', { matchId: matchId });
    render(refreshed);
    if (errMessage) {
      const errEl = document.getElementById('matchfee-error');
      errEl.textContent = errMessage;
      errEl.style.display = 'block';
    }
  }

  function render(m) {
    const canCollect = user.role === 'REGISTRATION' || user.role === 'ADMIN';
    const isAdmin = user.role === 'ADMIN';
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Match ' + m.matchNumber + '</h1>' +
        '<p class="subtitle">' + m.matchDate + '</p>' +
        '<div id="matchfee-error" class="error" style="display:none"></div>' +
        _matchFeeTeamCardHtml('Team 1', m.team1Status, m.team1.collegeName, m.matchFeeRate, canCollect, 'team1', isAdmin) +
        _matchFeeTeamCardHtml('Team 2', m.team2Status, m.team2.collegeName, m.matchFeeRate, canCollect, 'team2', isAdmin) +
        '<button id="back-btn" style="margin-top:12px">Back to Match Fee Collection</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.mf-collect-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const side = btn.getAttribute('data-side');
        const teamId = side === 'team1' ? m.team1.teamId : m.team2.teamId;
        const mode = document.querySelector('.mf-mode-select[data-side="' + side + '"]').value;
        btn.disabled = true;
        btn.textContent = 'Collecting…';
        try {
          await apiCall('matchfee.pay', { matchId: matchId, teamId: teamId, mode: mode });
          showToast('Match Fee collected for ' + (side === 'team1' ? m.team1.collegeName : m.team2.collegeName));
          await _refreshMatchDetail(null);
        } catch (err) {
          await _refreshMatchDetail(err.message);
        }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.mf-resend-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const txId = btn.getAttribute('data-txid');
        const statusEl = document.querySelector('.mf-resend-status[data-txid="' + txId + '"]');
        statusEl.textContent = 'Sending…';
        try {
          const result = await apiCall('matchfee.receipt.resend', { transactionId: txId, recipientEmails: [] });
          statusEl.textContent = result.emailStatus === 'SENT' ? 'Resent.' : 'Resend attempt status: ' + result.emailStatus;
        } catch (err) {
          statusEl.textContent = err.message;
        }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.mf-void-toggle-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const txId = btn.getAttribute('data-txid');
        document.querySelector('.mf-void-form[data-txid="' + txId + '"]').style.display = 'block';
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.mf-void-confirm-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const txId = btn.getAttribute('data-txid');
        const reason = document.querySelector('.mf-void-reason[data-txid="' + txId + '"]').value.trim();
        const statusEl = document.querySelector('.mf-void-status[data-txid="' + txId + '"]');
        if (!reason) { statusEl.textContent = 'A reason is required.'; return; }
        statusEl.textContent = 'Voiding…';
        try {
          await apiCall('matchfee.transaction.void', { transactionId: txId, reason: reason });
          showToast('Match Fee transaction voided.');
          await _refreshMatchDetail(null);
        } catch (err) {
          statusEl.textContent = err.message;
        }
      });
    });

    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
```

- [ ] **Step 2: Register the script in `frontend/index.html`**

Change:

```html
  <script src="js/packages.js"></script>
  <script src="js/settings.js"></script>
```

to:

```html
  <script src="js/packages.js"></script>
  <script src="js/matchfee.js"></script>
  <script src="js/settings.js"></script>
```

- [ ] **Step 3: Bump the service worker in `frontend/service-worker.js`**

Change:

```javascript
const CACHE_NAME = 'hpuick-shell-v31';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/packages.js', './js/settings.js', './js/rooms.js', './js/accommodation.js',
  './js/mess.js', './js/departure.js', './js/reports.js', './js/app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
];
```

to:

```javascript
const CACHE_NAME = 'hpuick-shell-v32';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/packages.js', './js/matchfee.js', './js/settings.js', './js/rooms.js', './js/accommodation.js',
  './js/mess.js', './js/departure.js', './js/reports.js', './js/app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png'
];
```

- [ ] **Step 4: Commit and deploy the frontend**

```bash
cd "C:\Users\princ\Downloads\HPUICK"
git add frontend/js/matchfee.js frontend/index.html frontend/service-worker.js
git commit -m "Match Fee Collection Task 7: new frontend screens (list/create/collect/void)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HZcRi1y5CTbzdpanzfTKrX"
git subtree push --prefix=frontend frontend-origin main
```

- [ ] **Step 5: Dev-log entry**

Append a new entry to `docs/superpowers/dev-log.md`, dated 2026-08-21, summarizing: the new
`MATCHES`/`MATCH_FEE_TRANSACTIONS` sheets and why team-side status is always computed live
rather than cached; the `nextDocumentNumber_('MatchFee')` reuse that produces the exact
`GCB/HPUICK-2026/MF/00001` format; the one-`ACTIVE`-per-`(MatchId,TeamId)` invariant and how
`collectMatchFee_` enforces it inside the lock; the void→re-collect workflow and that voided
receipt numbers are never reused; the Final Receipt isolation regression test; and the actual
live test totals from Tasks 1-5's verification steps (pull the real `PASS`/`FAIL` counts from
those steps' terminal output, not placeholders).

```bash
git add docs/superpowers/dev-log.md
git commit -m "Match Fee Collection: dev log entry

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HZcRi1y5CTbzdpanzfTKrX"
```
