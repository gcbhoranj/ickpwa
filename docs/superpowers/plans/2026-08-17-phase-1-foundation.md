# Phase 1 (Foundation) Implementation Plan — HPU Inter-College Kabaddi Tournament 2026

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full technical foundation — Sheets schema, Drive structure, Apps Script
backend skeleton with working session-based auth, and a PWA shell that can log in a real user
end-to-end — so every later phase builds registration/mess/accommodation/refund features on
top of infrastructure that is already proven to work, not assumed to work.

**Architecture:** PWA (static HTML/CSS/JS) → Google Apps Script Web App (single `doPost`
entry point, JSON action-routed) → Google Sheet (the database) + Google Drive (documents).
No proxy, no gateway, no framework build step. Session credential travels as a field in a
`text/plain` POST body — never an `Authorization` header — per the connectivity POC finding.

**Tech Stack:** Vanilla JS PWA (manifest + service worker, no framework), Google Apps Script
(V8 runtime) managed locally with `clasp`, Google Sheets as the database, Google Drive for
file storage, GitHub Pages for static hosting.

**Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` — this plan
implements that spec's §17 Phase 1 scope plus the auth/session detail from §3 and §16. Where
this plan and the spec conflict, the spec is authoritative; flag the conflict rather than
silently picking one.

## Global Constraints

- Tournament dates 21–25 Sep 2026, timezone `Asia/Kolkata` (spec §0/§26).
- Google account of record: `gcbhoranj@gmail.com`. Database Sheet ID:
  `1eJpS9npNxcTQNTC9bfxnVOmJ74tv4dLiET6Xj6XcSyI` (spec §0).
- Session credential travels as a `sessionId` field in a `Content-Type: text/plain` JSON POST
  body. Never as a custom header — Apps Script can't complete a CORS preflight and can't read
  incoming headers at all (spec §16, empirically proven).
- No Firebase/Supabase/AWS/microservices/proxy/gateway. Every additional moving part is a
  tournament-week failure point (spec §1, user's recommendation #1).
- Capacity target: REG1–REG5, MESS1–MESS5, ACC1–ACC5 (15 concurrent operational users) + 1–2
  Admin accounts, all against the same live Sheet (spec §1).
- Financial/meal/coupon transaction tabs are **append-only**: corrections are new rows, never
  in-place edits or deletes (spec §5, §78 of the original prompt). The one exception in this
  phase is `deleteRowById_`, which exists only for test-fixture cleanup and is never called
  from a production action handler — noted explicitly wherever used.
- Concurrency-sensitive operations (counters, entitlement, allocation, refunds) use
  `LockService.getScriptLock()` (spec §4, §6). Phase 1 only touches ID counters and session
  creation, but the locking pattern established here is what later phases reuse verbatim.
- Role permission matrix (spec §12) — Phase 1 only implements ADMIN (bootstrap actions) and
  the shared login/session mechanism used by all four roles; role-gated screens/actions for
  REGISTRATION/MESS/ACCOMMODATION are Phase 2+. The matrix is reproduced here for reference:

  | Capability | ADMIN | REGISTRATION | MESS | ACCOMMODATION |
  |---|---|---|---|---|
  | Manage users, settings, rates | ✅ | ❌ | ❌ | ❌ |
  | Registration/coupons/departure | view-only | ✅ | ❌ | ❌ |
  | Scan/consume meals | view-only | view-only | ✅ | ❌ |
  | Rooms/NOC | view-only | view-only | ❌ | ✅ |

- **Testing model for this phase:** Apps Script has no local test runner. Every backend "red →
  green" cycle in this plan means: write the test function into `Tests.gs` → `clasp push` +
  `clasp deploy -i <deploymentId>` → call the deployed URL's `system.selfTest` action and
  confirm the specific test fails/passes. This is slower per-cycle than a local Jest loop but
  it is the only faithful way to test code that only really runs inside Apps Script — no
  shortcuts (e.g. `clasp run`) are taken because they require brittle extra GCP setup that
  isn't worth it for a project this size (verified during the connectivity POC).
- Document generation (PDFs), QR codes, email sending, and all business-logic modules
  (registration, coupons, mess, accommodation, refunds) are **out of scope for Phase 1** —
  they're Phases 3–8 per spec §17. Phase 1 ends at "a real user can log in through the real
  PWA against the real backend and get a session," nothing more.

---

## File structure this phase produces

```
/backend
  appsscript.json        Web app manifest (access, executeAs, timezone)
  Constants.gs            Sheet ID, roles, full 25-tab schema, ID prefixes
  SheetHelpers.gs          Generic sheet CRUD helpers used by every later phase
  IdGenerator.gs          Locked, counter-based ID/number allocator
  Auth.gs                  Password hashing, session create/validate/revoke
  Setup.gs                 One-time idempotent bootstrap: schema, settings, Drive folders, first admin
  Main.gs                  doPost/doGet router, response envelope, action table
  Tests.gs                 Hand-rolled assertion helpers + all Phase 1 test cases + runner
/frontend
  index.html               App shell: login form + role-landing placeholder
  manifest.json            PWA manifest
  service-worker.js        App-shell caching (never caches API calls)
  css/app.css              Shared styling
  js/api-client.js          fetch wrapper implementing the body-credential POST contract
  js/auth.js                Login/logout/session-restore logic
  js/app.js                 Bootstrap: route to login or role landing
  icons/icon-192.png        PWA icon (generated from the HPU logo asset)
  icons/icon-512.png        PWA icon (generated from the HPU logo asset)
/docs
  superpowers/dev-log.md    Running development log, one entry per completed task/phase
README.md                  Root: what this project is, how to run/deploy each half
```

---

### Task 1: Backend project scaffold, schema constants, minimal router

**Files:**
- Create: `backend/appsscript.json`
- Create: `backend/Constants.gs`
- Create: `backend/Main.gs`
- Create: `backend/Tests.gs`

**Interfaces:**
- Produces: `SHEET_ID` (string), `ROLES` (object), `SHEET_SCHEMAS` (object: sheetName → header
  array), `ID_PREFIXES` (object: sheetName → prefix string), `ID_PADDING_OVERRIDES` (object),
  `jsonOutput_(obj)` (returns `ContentService.TextOutput`), `apiError_(code, message)` (throws
  an `Error` with a `.code` property), `runAllTests_()` (returns `{summary, results}`).

- [ ] **Step 1: Create the real backend Apps Script project**

```bash
cd "C:\Users\princ\Downloads\HPUICK"
mkdir backend
cd backend
npx --yes @google/clasp create --type standalone --title "HPUICK Backend" --rootDir .
```

This creates a **new, real** (non-throwaway) standalone Apps Script project under
`gcbhoranj@gmail.com` and writes `.clasp.json` (gitignored) + a default `appsscript.json`.
Note the script ID printed in the output — you'll need it for later `clasp` commands only if
`.clasp.json` isn't present in the working directory (it will be, so normally unnecessary).

- [ ] **Step 2: Write the web app manifest**

Replace the generated `backend/appsscript.json` with:

```json
{
  "timeZone": "Asia/Kolkata",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "access": "ANYONE_ANONYMOUS",
    "executeAs": "USER_DEPLOYING"
  }
}
```

- [ ] **Step 3: Write `Constants.gs`**

```javascript
// Constants.gs — single source of truth for sheet IDs, roles, and schema.

const SHEET_ID = '1eJpS9npNxcTQNTC9bfxnVOmJ74tv4dLiET6Xj6XcSyI';

const ROLES = {
  ADMIN: 'ADMIN',
  REGISTRATION: 'REGISTRATION',
  MESS: 'MESS',
  ACCOMMODATION: 'ACCOMMODATION'
};

// sheetName -> ordered header row. This IS the schema; SheetHelpers/Setup read from here.
const SHEET_SCHEMAS = {
  SETTINGS: ['Key', 'Value', 'UpdatedBy', 'UpdatedAt'],
  USERS: ['UserId', 'Name', 'Email', 'LoginId', 'Role', 'PasswordHash', 'PasswordSalt',
    'Active', 'CreatedDate', 'LastLoginAt', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  SESSIONS: ['SessionId', 'UserId', 'Role', 'IssuedAt', 'ExpiresAt', 'Status', 'LastSeenAt'],
  LOGIN_LOG: ['LogId', 'Attempted', 'Result', 'Timestamp'],
  TEAMS: ['TeamId', 'RegistrationNumber', 'CollegeName', 'DistrictName', 'NumberOfTeamMembers',
    'NumberOfContingentIncharges', 'TotalContingentPersons', 'RegistrationDateTime', 'Status',
    'DepartureLockedBy', 'DepartureLockedAt', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  CONTINGENT_INCHARGES: ['InchargeId', 'TeamId', 'Name', 'Designation', 'WhatsAppNumber',
    'EmailAddress', 'IsPrimary', 'Active', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  PAYMENTS: ['PaymentId', 'TeamId', 'Amount', 'Mode', 'ReceivedAt', 'Purpose', 'ReversalOf',
    'CreatedBy', 'CreatedAt'],
  CHARGES: ['ChargeId', 'TeamId', 'RateBreakfastSnapshot', 'RateLunchSnapshot',
    'RateDinnerSnapshot', 'RateDariSnapshot', 'SecurityAmountSnapshot', 'DariCharges',
    'MealCharges', 'SecurityCharges', 'TotalPayable', 'CalculatedAt', 'CreatedBy'],
  FOOD_PACKAGES: ['PackageId', 'TeamId', 'PackageNumber', 'CouponId',
    'IncludeInchargesInEntitlement', 'EligiblePersons', 'PurchaseDateTime', 'Amount',
    'RateBreakfastSnapshot', 'RateLunchSnapshot', 'RateDinnerSnapshot', 'StartMeal', 'EndMeal',
    'Status', 'QrToken', 'DigitalCouponPdfFileId', 'PrintedCouponPdfFileId', 'EmailStatus',
    'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  FOOD_COUPONS: ['CouponId', 'PackageId', 'TeamId', 'QrToken', 'Status', 'IssuedAt'],
  PRINTED_COUPONS: ['PrintedCouponId', 'CouponId', 'PackageId', 'SequenceNumber', 'TotalCount',
    'PrintBatchId', 'GeneratedAt', 'GeneratedBy'],
  MEAL_ENTITLEMENTS: ['EntitlementId', 'PackageId', 'TeamId', 'Date', 'Meal', 'Rate',
    'EligiblePersons', 'ServedPersons', 'RemainingPersons', 'RefundablePersons',
    'RefundableAmount', 'MealOrderStatus', 'ValidFrom', 'ValidUntil', 'Status'],
  MEAL_USAGE: ['UsageId', 'CouponId', 'PackageId', 'TeamId', 'EntitlementId', 'Date', 'Meal',
    'PreviousServedCount', 'ClaimAmount', 'NewServedTotal', 'RemainingAfter', 'MessUser',
    'Timestamp', 'ClientRequestId'],
  MEAL_ORDER_STATUS: ['StatusId', 'Date', 'Meal', 'Status', 'SetBy', 'SetAt'],
  ROOMS: ['RoomId', 'RoomNumber', 'Building', 'Floor', 'Capacity', 'Status', 'CreatedBy',
    'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  ACCOMMODATION: ['AllocationId', 'TeamId', 'RoomId', 'PersonsAllocated', 'AllocatedAt',
    'VacatedAt', 'Status', 'CreatedBy', 'UpdatedBy', 'UpdatedAt'],
  ACCOMMODATION_NOC: ['NocId', 'TeamId', 'Status', 'IssuedBy', 'IssuedAt', 'Notes'],
  REFUNDS: ['RefundId', 'TeamId', 'EntitlementId', 'Meal', 'Date', 'EligiblePersons',
    'ServedPersons', 'MealOrderStatusAtCalc', 'RefundablePersons', 'RefundAmount',
    'CalculatedAt', 'ProcessedAt', 'ProcessedBy'],
  SECURITY_REFUNDS: ['SecurityRefundId', 'TeamId', 'Amount', 'NocId', 'RefundedAt',
    'RefundedBy', 'Ticked'],
  SETTLEMENTS: ['SettlementId', 'TeamId', 'GrossMealCharges', 'GrossDariCharges',
    'GrossCharges', 'FoodRefund', 'OtherAdjustments', 'NetCharges', 'SecurityCollected',
    'SecurityRefunded', 'FinalBalance', 'SettledAt', 'SettledBy', 'Status'],
  RECEIPTS: ['ReceiptId', 'ReceiptNumber', 'Type', 'TeamId', 'SettlementId',
    'GrossMealCharges', 'GrossDariCharges', 'GrandTotal', 'FoodRefundTotal', 'NetAmount',
    'AmountInWords', 'GeneratedAt', 'GeneratedBy', 'PdfFileId'],
  RELIEVING: ['RelievingId', 'RelievingNumber', 'TeamId', 'Session', 'RelievingDate',
    'InchargeNamesText', 'TeamMemberCount', 'GeneratedAt', 'GeneratedBy', 'PdfFileId'],
  DOCUMENTS: ['DocumentId', 'Type', 'TeamId', 'RelatedId', 'DriveFileId', 'GeneratedAt',
    'GeneratedBy'],
  EMAIL_LOG: ['EmailId', 'DocumentId', 'Recipient', 'Subject', 'SentAt', 'User', 'Status',
    'ErrorMessage'],
  AUDIT_LOG: ['AuditId', 'Timestamp', 'UserId', 'Role', 'Action', 'Entity', 'EntityId',
    'PreviousState', 'NewState']
};

// sheetName -> ID prefix. SETTINGS (keyed) and SESSIONS (opaque random) intentionally excluded.
const ID_PREFIXES = {
  TEAMS: 'TEAM', CONTINGENT_INCHARGES: 'INC', PAYMENTS: 'PAY', CHARGES: 'CHG',
  FOOD_PACKAGES: 'PKG', FOOD_COUPONS: 'CPN', PRINTED_COUPONS: 'PRC',
  MEAL_ENTITLEMENTS: 'ENT', MEAL_USAGE: 'USG', MEAL_ORDER_STATUS: 'STA', ROOMS: 'ROOM',
  ACCOMMODATION: 'ALLOC', ACCOMMODATION_NOC: 'NOC', REFUNDS: 'REF',
  SECURITY_REFUNDS: 'SREF', SETTLEMENTS: 'SETL', RECEIPTS: 'RCT', RELIEVING: 'REL',
  DOCUMENTS: 'DOC', EMAIL_LOG: 'EML', AUDIT_LOG: 'AUD', USERS: 'USR', LOGIN_LOG: 'LOG'
};

// Wider zero-padding for high-volume append-only logs (spec §4).
const ID_PADDING_OVERRIDES = { AUD: 7, USG: 7, LOG: 6 };
```

- [ ] **Step 4: Write `Main.gs` with the response envelope and a minimal router**

```javascript
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
```

- [ ] **Step 5: Write `Tests.gs` with the assertion helpers and runner (no test cases yet)**

```javascript
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

// Each task appends its own test_xxx function and registers it here.
const TEST_CASES = [];

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
```

- [ ] **Step 6: Push and deploy**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy --description "Phase 1 - initial skeleton"
npx --yes @google/clasp deployments
```

Note the deployment ID from the `deployments` output (the one matching the description above,
`@1`) — call it `<DEPLOYMENT_ID>` for the rest of this plan. All future `clasp deploy` calls in
Phase 1 reuse it: `clasp deploy -i <DEPLOYMENT_ID> -d "<description>"`, so the web app URL
never changes mid-phase.

- [ ] **Step 7: Verify via HTTP (this is the "run the test" step for this task)**

```bash
URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
curl -s -L "$URL?action=ping" | tail -1
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"system.ping"}' "$URL" | tail -1
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"system.selfTest"}' "$URL" | tail -1
```

Expected: the first two return `{"ok":true,"data":{"pong":true,...}}`; the third returns
`{"ok":true,"data":{"summary":"0/0 passed","results":[]}}` (no test cases registered yet —
correct at this point).

- [ ] **Step 8: Commit**

```bash
cd "C:\Users\princ\Downloads\HPUICK"
git add backend/appsscript.json backend/Constants.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 1: backend scaffold, schema constants, minimal router

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 2: Sheet helper utilities

**Files:**
- Create: `backend/SheetHelpers.gs`
- Modify: `backend/Tests.gs` (add test cases, register them)

**Interfaces:**
- Consumes: `SHEET_ID`, `SHEET_SCHEMAS` (Task 1), `assertEqual_`/`assertTrue_`/`TEST_CASES`
  (Task 1).
- Produces: `getSpreadsheet_()`, `ensureSheet_(name)` (creates sheet + header row if missing,
  idempotent), `getSheet_(name)` (throws if missing), `appendRow_(sheetName, obj)` (returns
  the written row as an object), `rowsToObjects_(sheetName)` (array of objects),
  `findRowById_(sheetName, idColumn, idValue)` (returns `{rowNumber, values}` or `null`),
  `updateRowById_(sheetName, idColumn, idValue, patch)`, `deleteRowById_(sheetName, idColumn,
  idValue)` (**test-fixture cleanup only — never called from a production handler**),
  `getSetting_(key, defaultValue)`, `setSetting_(key, value, actorId)`.

- [ ] **Step 1: Add the failing test to `Tests.gs`**

Append to `backend/Tests.gs`, before the `TEST_CASES` array declaration stays put but the
array literal now lists this test:

```javascript
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
```

Update the `TEST_CASES` array in `Tests.gs`:

```javascript
const TEST_CASES = [
  { name: 'sheetHelpers_appendFindUpdateDelete', fn: test_sheetHelpers_appendFindUpdateDelete }
];
```

- [ ] **Step 2: Push, deploy, verify it fails**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i <DEPLOYMENT_ID> -d "Phase 1 - sheet helpers (red)"
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"system.selfTest"}' "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" | tail -1
```

Expected: `"status":"FAIL"` with an error like `setSetting_ is not defined` — confirms the test
runs and fails for the right reason before any implementation exists.

- [ ] **Step 3: Implement `backend/SheetHelpers.gs`**

```javascript
// SheetHelpers.gs — generic, schema-driven CRUD used by every later phase.

let _ss = null;
function getSpreadsheet_() {
  if (!_ss) _ss = SpreadsheetApp.openById(SHEET_ID);
  return _ss;
}

function ensureSheet_(name) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  const headers = SHEET_SCHEMAS[name];
  if (!headers) throw apiError_('UNKNOWN_SHEET', 'No schema defined for sheet: ' + name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const existingHeaderRange = sheet.getRange(1, 1, 1, headers.length);
  const existingHeaders = sheet.getLastRow() >= 1 ? existingHeaderRange.getValues()[0] : [];
  const headersMatch = headers.every(function (h, i) { return existingHeaders[i] === h; });
  if (!headersMatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw apiError_('SHEET_NOT_FOUND', 'Sheet not found: ' + name + ' — run admin.bootstrap.setupSchema first.');
  return sheet;
}

function headerIndex_(sheet) {
  const headers = SHEET_SCHEMAS[sheet.getName()];
  const map = {};
  headers.forEach(function (h, i) { map[h] = i; });
  return map;
}

function appendRow_(sheetName, obj) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const row = headers.map(function (h) {
    return obj.hasOwnProperty(h) ? obj[h] : '';
  });
  sheet.appendRow(row);
  return obj;
}

function rowsToObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function findRowById_(sheetName, idColumn, idValue) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const colIndex = headers.indexOf(idColumn);
  if (colIndex === -1) throw apiError_('BAD_COLUMN', idColumn + ' is not a column of ' + sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][colIndex] === idValue) {
      const obj = {};
      headers.forEach(function (h, j) { obj[h] = values[i][j]; });
      return { rowNumber: i + 2, values: obj };
    }
  }
  return null;
}

function updateRowById_(sheetName, idColumn, idValue, patch) {
  const found = findRowById_(sheetName, idColumn, idValue);
  if (!found) throw apiError_('NOT_FOUND', sheetName + ' row not found for ' + idColumn + '=' + idValue);
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const merged = Object.assign({}, found.values, patch);
  const row = headers.map(function (h) { return merged[h]; });
  sheet.getRange(found.rowNumber, 1, 1, headers.length).setValues([row]);
  return merged;
}

// TEST-FIXTURE CLEANUP ONLY. Production handlers must never call this — transaction/config
// tabs are append-only per the spec (§5, §78 of the original prompt).
function deleteRowById_(sheetName, idColumn, idValue) {
  const found = findRowById_(sheetName, idColumn, idValue);
  if (!found) return false;
  getSheet_(sheetName).deleteRow(found.rowNumber);
  return true;
}

function getSetting_(key, defaultValue) {
  const found = findRowById_('SETTINGS', 'Key', key);
  return found ? found.values.Value : defaultValue;
}

function setSetting_(key, value, actorId) {
  const found = findRowById_('SETTINGS', 'Key', key);
  const now = new Date().toISOString();
  if (found) {
    updateRowById_('SETTINGS', 'Key', key, { Value: value, UpdatedBy: actorId || 'system', UpdatedAt: now });
  } else {
    appendRow_('SETTINGS', { Key: key, Value: value, UpdatedBy: actorId || 'system', UpdatedAt: now });
  }
}
```

- [ ] **Step 4: Push, deploy, verify it passes**

```bash
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i <DEPLOYMENT_ID> -d "Phase 1 - sheet helpers (green)"
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"system.selfTest"}' "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec" | tail -1
```

Expected: `"summary":"1/1 passed"`.

- [ ] **Step 5: Commit**

```bash
git add backend/SheetHelpers.gs backend/Tests.gs
git commit -m "Phase 1: generic sheet CRUD helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 3: Schema setup, settings seed, Drive folder structure

**Files:**
- Create: `backend/Setup.gs`
- Modify: `backend/Main.gs` (register 3 new actions)
- Modify: `backend/Tests.gs` (add test case)

**Interfaces:**
- Consumes: `ensureSheet_`, `SHEET_SCHEMAS`, `setSetting_`/`getSetting_` (Task 2).
- Produces: `setupSchema_()` (returns array of sheet names ensured), `seedSettings_()`
  (returns array of keys seeded), `setupDriveFolders_()` (returns `{rootFolderId, folders}`).

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`:
```javascript
{ name: 'setup_schemaAndSettingsIdempotent', fn: test_setup_schemaAndSettingsIdempotent }
```

- [ ] **Step 2: Push, deploy, verify it fails** (same pattern as Task 2 Step 2 — expect
  `setupSchema_ is not defined`).

- [ ] **Step 3: Implement `backend/Setup.gs`**

```javascript
// Setup.gs — one-time, idempotent bootstrap actions. Safe to call repeatedly.

function setupSchema_() {
  return Object.keys(SHEET_SCHEMAS).map(function (name) {
    ensureSheet_(name);
    return name;
  });
}

function seedSettings_() {
  const defaults = {
    TournamentName: 'HPU Inter-College Kabaddi (Men) Tournament 2026',
    OrganizerName: 'Government College Bhoranj (Tarkwari)',
    DistrictAddress: 'District Hamirpur, Himachal Pradesh 177025',
    Timezone: 'Asia/Kolkata',
    TournamentStartDate: '2026-09-21',
    TournamentEndDate: '2026-09-25',
    RateBreakfast: '50',
    RateLunch: '100',
    RateDinner: '100',
    RateDari: '100',
    SecurityAmount: '0',
    FinancialSettingsLocked: 'false',
    MealTimingBreakfastStart: '',
    MealTimingBreakfastEnd: '',
    MealTimingLunchStart: '',
    MealTimingLunchEnd: '',
    MealTimingDinnerStart: '',
    MealTimingDinnerEnd: '',
    Numbering_Registration_Prefix: 'GCB/HPUICK/REG-',
    Numbering_Registration_Next: '1',
    Numbering_Registration_Padding: '3',
    Numbering_Receipt_Prefix: 'GCB/HPUICK/Receipt-',
    Numbering_Receipt_Next: '1',
    Numbering_Receipt_Padding: '3',
    Numbering_Coupon_Prefix: 'GCB/HPUICK/Coupon-',
    Numbering_Coupon_Next: '1',
    Numbering_Coupon_Padding: '3',
    Numbering_Refund_Prefix: 'GCB/HPUICK/Refund-',
    Numbering_Refund_Next: '1',
    Numbering_Refund_Padding: '3',
    Numbering_Relieving_Prefix: 'GCB/HPUICK/Relieving-',
    Numbering_Relieving_Next: '1',
    Numbering_Relieving_Padding: '3',
    Numbering_Accommodation_Prefix: 'GCB/HPUICK/Room-',
    Numbering_Accommodation_Next: '1',
    Numbering_Accommodation_Padding: '3',
    PrincipalSignatureFileId: '',
    RegistrationInchargeSignatureFileId: '',
    CollegeSealFileId: '',
    AllowSelfTest: 'true'
  };
  return Object.keys(defaults).map(function (key) {
    if (getSetting_(key, null) === null) {
      setSetting_(key, defaults[key], 'setup');
    }
    return key;
  });
}

function _ensureSubfolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

function setupDriveFolders_() {
  const rootName = 'HPU Inter College Kabaddi Tournament 2026';
  const existingRoots = DriveApp.getFoldersByName(rootName);
  const root = existingRoots.hasNext() ? existingRoots.next() : DriveApp.createFolder(rootName);

  const registration = _ensureSubfolder_(root, 'Registration');
  const coupons = _ensureSubfolder_(root, 'Food Coupons');

  const structure = {
    Database: _ensureSubfolder_(root, 'Database'),
    'Registration/Temporary Receipts': _ensureSubfolder_(registration, 'Temporary Receipts'),
    'Registration/Final Receipts': _ensureSubfolder_(registration, 'Final Receipts'),
    'Food Coupons/Digital': _ensureSubfolder_(coupons, 'Digital'),
    'Food Coupons/Printed': _ensureSubfolder_(coupons, 'Printed'),
    Refunds: _ensureSubfolder_(root, 'Refunds'),
    'Relieving Orders': _ensureSubfolder_(root, 'Relieving Orders'),
    Accommodation: _ensureSubfolder_(root, 'Accommodation'),
    Templates: _ensureSubfolder_(root, 'Templates'),
    Assets: _ensureSubfolder_(root, 'Assets'),
    Reports: _ensureSubfolder_(root, 'Reports')
  };

  setSetting_('DriveRootFolderId', root.getId(), 'setup');
  const folderIds = {};
  Object.keys(structure).forEach(function (key) { folderIds[key] = structure[key].getId(); });
  return { rootFolderId: root.getId(), folders: folderIds };
}
```

- [ ] **Step 4: Register the three bootstrap actions in `Main.gs`**

Add to the `ACTIONS` object in `backend/Main.gs`:

```javascript
  'admin.bootstrap.setupSchema': function () {
    return { sheetsEnsured: setupSchema_() };
  },
  'admin.bootstrap.seedSettings': function () {
    return { keysSeeded: seedSettings_() };
  },
  'admin.bootstrap.setupDriveFolders': function () {
    return setupDriveFolders_();
  },
```

- [ ] **Step 5: Push, deploy, verify it passes, and actually bootstrap the real Sheet/Drive**

```bash
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i <DEPLOYMENT_ID> -d "Phase 1 - setup functions"
URL="https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
curl -s -L -X POST -H "Content-Type: text/plain" --data-raw '{"action":"system.selfTest"}' "$URL" | tail -1
# Now actually run the real bootstrap against production:
curl -s -L -X POST -H "Content-Type: text/plain" --data-raw '{"action":"admin.bootstrap.setupSchema"}' "$URL" | tail -1
curl -s -L -X POST -H "Content-Type: text/plain" --data-raw '{"action":"admin.bootstrap.seedSettings"}' "$URL" | tail -1
curl -s -L -X POST -H "Content-Type: text/plain" --data-raw '{"action":"admin.bootstrap.setupDriveFolders"}' "$URL" | tail -1
```

Expected: `system.selfTest` shows `"summary":"2/2 passed"`; the three bootstrap calls return
`ok:true` with the sheet/key/folder lists. After this step, open the real Sheet
(`docs.google.com/spreadsheets/d/1eJpS9np.../edit`) and confirm all 25 tabs exist with header
rows, and confirm the `HPU Inter College Kabaddi Tournament 2026` folder tree exists in Drive.

- [ ] **Step 6: Commit**

```bash
git add backend/Setup.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 1: schema setup, settings seed, Drive folder structure

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 4: ID/number generator with locking

**Files:**
- Create: `backend/IdGenerator.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `getSetting_`, `setSetting_` (Task 2), `LockService` (built-in).
- Produces: `nextId_(prefix, padding)` — returns a string like `TEAM-0001`, guaranteed unique
  and monotonically increasing per prefix even under concurrent calls.

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'idGenerator_sequentialAndUnique', fn: test_idGenerator_sequentialAndUnique }`

- [ ] **Step 2: Push, deploy, verify it fails** (expect `nextId_ is not defined`).

- [ ] **Step 3: Implement `backend/IdGenerator.gs`**

```javascript
// IdGenerator.gs — locked, counter-based ID/document-number allocator.
// Every counter lives as a SETTINGS row keyed "Counter_<prefix>_Next", auto-initialized to 1.

function nextId_(prefix, padding) {
  padding = padding || ID_PADDING_OVERRIDES[prefix] || 4;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const key = 'Counter_' + prefix + '_Next';
    const current = parseInt(getSetting_(key, '1'), 10);
    setSetting_(key, String(current + 1), 'system');
    const padded = String(current).padStart(padding, '0');
    return prefix + '-' + padded;
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 4: Push, deploy, verify it passes**

```bash
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i <DEPLOYMENT_ID> -d "Phase 1 - ID generator"
curl -s -L -X POST -H "Content-Type: text/plain" --data-raw '{"action":"system.selfTest"}' "$URL" | tail -1
```

Expected: `"summary":"3/3 passed"`.

- [ ] **Step 5: Commit**

```bash
git add backend/IdGenerator.gs backend/Tests.gs
git commit -m "Phase 1: locked ID/number generator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 5: Password hashing and first-admin bootstrap

**Files:**
- Create: `backend/Auth.gs` (hashing portion only — session portion is Task 6)
- Modify: `backend/Main.gs` (register `admin.bootstrap.seedFirstAdmin`)
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `appendRow_`, `rowsToObjects_` (Task 2), `nextId_` (Task 4).
- Produces: `generateSalt_()`, `hashPassword_(password, salt)` (hex string), `seedFirstAdmin_(name,
  email, password)` — throws `apiError_('ADMIN_EXISTS', ...)` if a Role=ADMIN user already
  exists (this guard, not a secret, is what keeps the action safe to leave callable).

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'auth_passwordHashing', fn: test_auth_passwordHashing }`

- [ ] **Step 2: Push, deploy, verify it fails** (expect `generateSalt_ is not defined`).

- [ ] **Step 3: Implement the hashing portion of `backend/Auth.gs`**

```javascript
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
```

- [ ] **Step 4: Register the bootstrap action in `Main.gs`**

```javascript
  'admin.bootstrap.seedFirstAdmin': function (payload) {
    return seedFirstAdmin_(payload.name, payload.email, payload.password);
  },
```

- [ ] **Step 5: Push, deploy, verify the unit test passes**

```bash
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i <DEPLOYMENT_ID> -d "Phase 1 - password hashing"
curl -s -L -X POST -H "Content-Type: text/plain" --data-raw '{"action":"system.selfTest"}' "$URL" | tail -1
```

Expected: `"summary":"4/4 passed"`.

- [ ] **Step 6: Seed the real first Admin account — ASK THE USER FIRST**

This writes a real, permanent credential into the production Sheet. **Do not invent a name,
email, or password.** Ask the user (via AskUserQuestion or direct chat) for the Admin's name,
email, and the password they want, then run:

```bash
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"admin.bootstrap.seedFirstAdmin","payload":{"name":"<NAME>","email":"<EMAIL>","password":"<PASSWORD>"}}' \
  "$URL" | tail -1
```

Confirm the response is `{"ok":true,"data":{"userId":"USR-0001","email":"<EMAIL>"}}`, then
confirm a second call now correctly fails with `ADMIN_EXISTS`:

```bash
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"admin.bootstrap.seedFirstAdmin","payload":{"name":"x","email":"x@x.com","password":"x"}}' \
  "$URL" | tail -1
```

Expected: `{"ok":false,"error":{"code":"ADMIN_EXISTS", ...}}`. Never echo the chosen password
back into chat, commits, or logs — only confirm success/failure.

- [ ] **Step 7: Commit**

```bash
git add backend/Auth.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 1: password hashing and first-admin bootstrap

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 6: Sessions and the login/logout/whoami actions

**Files:**
- Modify: `backend/Auth.gs` (append session functions)
- Modify: `backend/Main.gs` (register auth.* actions, add `requireSession_`)
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `appendRow_`, `findRowById_`, `updateRowById_`, `rowsToObjects_`, `deleteRowById_`
  (Task 2); `hashPassword_` (Task 5).
- Produces: `createSession_(userId, role)` (returns `{sessionId, expiresAt}`),
  `validateSession_(sessionId)` (returns `{userId, role, sessionId}` or `null`),
  `revokeSession_(sessionId)`, `requireSession_(sessionId)` (throws `apiError_('UNAUTHORIZED',
  ...)` if invalid — used by every non-public action from Task 7 onward).

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'auth_sessionLifecycle', fn: test_auth_sessionLifecycle }`

- [ ] **Step 2: Push, deploy, verify it fails** (expect `createSession_ is not defined`).

- [ ] **Step 3: Append session functions to `backend/Auth.gs`**

```javascript
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

function _findActiveUserByIdentifier_(identifier) {
  const users = rowsToObjects_('USERS');
  return users.find(function (u) {
    return u.Active === true && (u.Email === identifier || u.LoginId === identifier);
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
```

- [ ] **Step 4: Register `auth.*` actions and wire `requireSession_` in `backend/Main.gs`**

Update `handleRequest_` to pass session lookup to handlers, and add the three actions:

```javascript
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
  },
```

And change the call site in `handleRequest_` from `handler(body.payload || {}, body.sessionId
|| null)` to pass the raw `sessionId` through unchanged (already does — no further change
needed there since handlers now do their own `requireSession_` call using the second argument).

- [ ] **Step 5: Push, deploy, verify unit test passes**

```bash
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i <DEPLOYMENT_ID> -d "Phase 1 - sessions and auth actions"
curl -s -L -X POST -H "Content-Type: text/plain" --data-raw '{"action":"system.selfTest"}' "$URL" | tail -1
```

Expected: `"summary":"5/5 passed"`.

- [ ] **Step 6: End-to-end test against the real seeded Admin**

```bash
# Successful login (use the real password chosen with the user in Task 5, do not paste it into any file)
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"auth.login","payload":{"identifier":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}}' \
  "$URL" | tail -1
# Copy the returned sessionId into SID below:
SID="<paste sessionId here>"
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw "{\"action\":\"auth.whoami\",\"sessionId\":\"$SID\"}" "$URL" | tail -1
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw "{\"action\":\"auth.logout\",\"sessionId\":\"$SID\"}" "$URL" | tail -1
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw "{\"action\":\"auth.whoami\",\"sessionId\":\"$SID\"}" "$URL" | tail -1
# Wrong password:
curl -s -L -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"auth.login","payload":{"identifier":"<ADMIN_EMAIL>","password":"wrong"}}' \
  "$URL" | tail -1
```

Expected: login succeeds with a session + user object; whoami returns the admin's identity;
logout succeeds; whoami *after* logout returns `UNAUTHORIZED`; wrong password returns
`INVALID_CREDENTIALS`.

- [ ] **Step 7: Commit**

```bash
git add backend/Auth.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 1: session lifecycle and auth.login/logout/whoami actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 7: PWA shell — manifest, service worker, login screen

**Files:**
- Create: `frontend/manifest.json`
- Create: `frontend/service-worker.js`
- Create: `frontend/index.html`
- Create: `frontend/css/app.css`
- Create: `frontend/js/api-client.js`
- Create: `frontend/js/auth.js`
- Create: `frontend/js/app.js`
- Create: `frontend/icons/icon-192.png`, `frontend/icons/icon-512.png`

**Interfaces:**
- Consumes: the deployed backend URL from Task 6 (`<DEPLOYMENT_ID>`), the `auth.login` /
  `auth.whoami` / `auth.logout` action contracts from Task 6.
- Produces: a working login screen; on success, a role-labeled landing placeholder per role
  (`ADMIN`/`REGISTRATION`/`MESS`/`ACCOMMODATION`) — full per-role dashboards are Phase 2+.

- [ ] **Step 1: Generate the PWA icons from the existing HPU logo asset**

```powershell
Add-Type -AssemblyName System.Drawing
$src = "C:\Users\princ\Downloads\HPUICK\Himachal_Pradesh_University_Shimla_Logo.svg.png"
$img = [System.Drawing.Image]::FromFile($src)
New-Item -ItemType Directory -Force -Path "C:\Users\princ\Downloads\HPUICK\frontend\icons" | Out-Null
foreach ($size in 192,512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($img, 0, 0, $size, $size)
  $bmp.Save("C:\Users\princ\Downloads\HPUICK\frontend\icons\icon-$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$img.Dispose()
```

(Both source and generated icons are square already — no cropping distortion. A dedicated
higher-fidelity icon can replace these in a later visual-polish pass; this is a real, working
icon set, not a stand-in.)

- [ ] **Step 2: Write `frontend/manifest.json`**

```json
{
  "name": "HPU Inter-College Kabaddi Tournament 2026",
  "short_name": "HPUICK 2026",
  "description": "Tournament management — Government College Bhoranj (Tarkwari)",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#0b3d2e",
  "theme_color": "#0b3d2e",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 3: Write `frontend/service-worker.js`** (caches the app shell only — never API
  calls, per spec §81: critical operations must always hit the live backend)

```javascript
const CACHE_NAME = 'hpuick-shell-v1';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/app.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_FILES); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);
  // Never intercept calls to the Apps Script backend — those must always be live.
  if (url.hostname.indexOf('script.google') !== -1 || url.hostname.indexOf('googleusercontent') !== -1) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function (cached) { return cached || fetch(event.request); })
  );
});
```

- [ ] **Step 4: Write `frontend/js/api-client.js`** (the body-credential POST contract, per
  the connectivity POC decision)

```javascript
// api-client.js — every backend call goes through here. Credential travels in the JSON
// body, never a header (see docs/superpowers/specs/... §16 — Apps Script can't read
// headers and can't complete a CORS preflight).

const API_URL = '<PASTE_DEPLOYMENT_URL_HERE>'; // https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
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
```

- [ ] **Step 5: Write `frontend/js/auth.js`**

```javascript
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
```

- [ ] **Step 6: Write `frontend/js/app.js`** (bootstrap + role landing)

```javascript
// app.js — page bootstrap: show login, or route to a role-labeled landing placeholder.

const ROLE_LABELS = {
  ADMIN: 'Admin', REGISTRATION: 'Registration Committee',
  MESS: 'Mess Committee', ACCOMMODATION: 'Accommodation Committee'
};

function renderLogin(root, errorMessage) {
  root.innerHTML =
    '<div class="login-card">' +
      '<h1>HPU Inter-College Kabaddi 2026</h1>' +
      '<p class="subtitle">Government College Bhoranj (Tarkwari) &middot; 21&ndash;25 Sep 2026</p>' +
      (errorMessage ? '<p class="error">' + errorMessage + '</p>' : '') +
      '<form id="login-form">' +
        '<label>Login ID / Email<input type="text" id="identifier" required autocomplete="username"></label>' +
        '<label>Password<input type="password" id="password" required autocomplete="current-password"></label>' +
        '<button type="submit">Log In</button>' +
      '</form>' +
    '</div>';
  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const identifier = document.getElementById('identifier').value.trim();
    const password = document.getElementById('password').value;
    try {
      const user = await login(identifier, password);
      renderLanding(root, user);
    } catch (err) {
      renderLogin(root, err.message);
    }
  });
}

function renderLanding(root, user) {
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">' + (ROLE_LABELS[user.role] || user.role) + '</p>' +
      '<p>This role\'s screens are built in a later phase. Foundation phase confirms your ' +
      'login and session work end-to-end.</p>' +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    renderLogin(root, null);
  });
}

(async function bootstrap() {
  const root = document.getElementById('app-root');
  const restored = await restoreSession();
  if (restored) {
    renderLanding(root, restored);
  } else {
    renderLogin(root, null);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(function () {});
  }
})();
```

- [ ] **Step 7: Write `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HPU Inter-College Kabaddi 2026</title>
  <link rel="manifest" href="manifest.json">
  <link rel="icon" href="icons/icon-192.png">
  <link rel="stylesheet" href="css/app.css">
</head>
<body>
  <div id="app-root"></div>
  <script src="js/api-client.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 8: Write `frontend/css/app.css`**

```css
:root {
  --brand: #0b3d2e;
  --brand-light: #14603f;
  --bg: #f4f6f5;
  --card-bg: #ffffff;
  --text: #1a1a1a;
  --error: #b91c1c;
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg); color: var(--text); min-height: 100vh;
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.login-card, .landing-card {
  background: var(--card-bg); border-radius: 12px; padding: 32px 28px;
  max-width: 380px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  text-align: center;
}
h1 { font-size: 1.3rem; color: var(--brand); margin: 0 0 4px; }
.subtitle { color: #555; font-size: 0.9rem; margin: 0 0 20px; }
form label { display: block; text-align: left; font-size: 0.85rem; margin: 12px 0 4px; color: #333; }
form input {
  width: 100%; padding: 10px 12px; font-size: 1rem; border: 1px solid #ccc;
  border-radius: 8px; margin-top: 4px;
}
button {
  width: 100%; margin-top: 20px; padding: 12px; font-size: 1rem; font-weight: 600;
  background: var(--brand); color: white; border: none; border-radius: 8px; cursor: pointer;
}
button:hover { background: var(--brand-light); }
.error { color: var(--error); font-size: 0.85rem; margin: 8px 0; }
```

- [ ] **Step 9: Fill in the deployed backend URL and test locally**

Edit `frontend/js/api-client.js`, replacing `<PASTE_DEPLOYMENT_URL_HERE>` with the real
`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec` URL from Task 1.

```bash
cd "C:\Users\princ\Downloads\HPUICK\frontend"
npx --yes http-server -p 5544 -c-1
```

Open `http://localhost:5544/index.html` in a real browser (ask the user to check it, the same
way the connectivity POC was verified, since the Chrome automation extension isn't connected
in this session) and confirm: login form appears; logging in with the real Admin credentials
shows the "Welcome, `<name>`" landing with role "Admin"; Log Out returns to the login form;
reloading the page after login restores the session without re-entering credentials; entering
a wrong password shows an inline error without a page reload.

- [ ] **Step 10: Commit**

```bash
git add frontend/
git commit -m "Phase 1: PWA shell — manifest, service worker, login, role landing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 8: Deploy the frontend to GitHub Pages

**Files:** none created — this is a deployment/configuration task using files from Task 7.

- [ ] **Step 1: Create the GitHub repository (manual — no `gh` CLI in this environment)**

Ask the user to create a new **public** GitHub repository (Pages' free tier requires public
unless they have GitHub Pro) — e.g. `hpuick-2026-frontend` — and share the remote URL. Public
is safe here: the frontend contains no secrets, only the Web App URL, which enforces its own
login (Task 6) regardless of who can see it.

- [ ] **Step 2: Push the frontend folder to that repository**

```bash
cd "C:\Users\princ\Downloads\HPUICK\frontend"
git init
git add .
git commit -m "Initial PWA shell for GitHub Pages"
git branch -M main
git remote add origin <REPO_URL_FROM_USER>
git push -u origin main
```

(The frontend gets its own small git history since it deploys independently to Pages; the
main project repo keeps tracking `frontend/` too via the files already committed in Task 7 —
both are fine to coexist, they just serve different purposes: one for Pages deployment, one
for the project's own history.)

- [ ] **Step 3: Enable GitHub Pages**

Ask the user to go to the repository's Settings → Pages → Source → "Deploy from a branch" →
`main` / `/ (root)` → Save. Note the resulting `https://<username>.github.io/<repo>/` URL.

- [ ] **Step 4: Final Phase 1 acceptance test — the real public URL against the real backend**

Ask the user to open the GitHub Pages URL on their phone (or desktop) and repeat the same
checks as Task 7 Step 9: login, landing, logout, session-restore-on-reload, wrong-password
handling. This is the first time the whole stack runs exactly as it will during the
tournament — a phone, on a real network, hitting the real deployed backend, with no
`localhost` involved.

- [ ] **Step 5: Record the URLs**

Append to `docs/superpowers/dev-log.md` (created in Task 9) once that file exists — or note
here now for Task 9 to pick up: backend Web App URL and GitHub Pages URL, both needed by
every subsequent phase.

---

### Task 9: Documentation and Phase 1 close-out

**Files:**
- Create: `README.md`
- Create: `docs/superpowers/dev-log.md`
- Modify: `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` (§18 open
  items — mark the GitHub Pages item resolved, record the real URLs)

- [ ] **Step 1: Write `README.md`**

```markdown
# HPU Inter-College Kabaddi (Men) Tournament 2026 — Management System

Tournament management PWA for Government College Bhoranj (Tarkwari), 21–25 Sep 2026.

- **Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md`
- **Plans:** `docs/superpowers/plans/`
- **Backend** (`/backend`): Google Apps Script, managed with `clasp`. Push with
  `cd backend && npx @google/clasp push`, deploy with
  `npx @google/clasp deploy -i <DEPLOYMENT_ID> -d "<description>"`.
- **Frontend** (`/frontend`): static PWA, no build step. Run locally with
  `cd frontend && npx http-server -p 5544 -c-1`. Deployed to GitHub Pages at
  `<GITHUB_PAGES_URL>`.
- **Database:** Google Sheet `HPU Inter-College Kabaddi`
  (`1eJpS9npNxcTQNTC9bfxnVOmJ74tv4dLiET6Xj6XcSyI`), owned by `gcbhoranj@gmail.com`.
- **Backend Web App URL:** `<DEPLOYMENT_URL>`

See the spec for full architecture, schema, and business rules; see
`docs/superpowers/dev-log.md` for what's actually been built so far.
```

(Fill in `<GITHUB_PAGES_URL>` and `<DEPLOYMENT_URL>` with the real values from Tasks 1 and 8.)

- [ ] **Step 2: Write `docs/superpowers/dev-log.md`**

```markdown
# Development Log

## 2026-08-17 — Phase 1 (Foundation) complete

- Backend: standalone Apps Script project, deployed as a Web App
  (`<DEPLOYMENT_URL>`). 25-tab Sheet schema created in the real production Sheet.
  Drive folder structure created under "HPU Inter College Kabaddi Tournament 2026".
  SETTINGS seeded with defaults (rates, blank meal timings, numbering prefixes) —
  Admin still needs to review/lock these before registration opens (Phase 3).
- Auth: password hashing (SHA-256 + per-user salt), opaque server-side sessions
  (SESSIONS sheet, 12h expiry), auth.login/auth.logout/auth.whoami actions. First
  real Admin account seeded. Session credential confirmed working as a body field,
  not a header, per the connectivity POC.
- Frontend: installable PWA shell (manifest, service worker caching the app shell
  only, never API calls), login screen, minimal per-role landing placeholder.
  Deployed to GitHub Pages at `<GITHUB_PAGES_URL>`, tested end-to-end from a real
  device against the real backend.
- Explicitly NOT built yet (later phases): Admin user management UI, per-role
  dashboards, registration, coupons/QR, mess scanning, accommodation, refunds,
  document generation, reports. See spec §17 for the full phase order.
- Known follow-up for Phase 2 hardening: the `admin.bootstrap.*` actions are
  currently reachable by anyone who has the Web App URL. `setupSchema`/
  `seedSettings`/`setupDriveFolders` are idempotent and harmless to leave open;
  `seedFirstAdmin` self-locks once an admin exists. No change needed unless this
  assessment turns out wrong in practice.
```

- [ ] **Step 3: Update the spec's open items**

In `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` §18, replace the
GitHub Pages bullet with the resolved state (real repo/URL now exist) — edit in place, don't
duplicate the section.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/dev-log.md docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md
git commit -m "Phase 1: README, dev log, close out foundation phase

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

## Phase 1 acceptance checklist

- [ ] All 25 Sheet tabs exist in the real spreadsheet with correct headers.
- [ ] Drive folder tree exists under "HPU Inter College Kabaddi Tournament 2026".
- [ ] SETTINGS seeded with defaults; rates/timings clearly still need Admin review (Phase 3).
- [ ] `system.selfTest` reports all Phase 1 test cases passing.
- [ ] A real Admin account exists (password known only to the user, never committed anywhere).
- [ ] Login/logout/whoami work end-to-end via curl against the deployed backend.
- [ ] The PWA logs in, shows a role landing, logs out, and restores session on reload —
      verified both on `localhost` and on the live GitHub Pages URL from a real device.
- [ ] Nothing from Phases 2–10 (user management UI, registration, coupons, mess, rooms,
      refunds, documents, reports) has been built yet.
