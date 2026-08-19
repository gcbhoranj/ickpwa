# Phase 5: Mess Committee Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Mess Committee role a working panel — scan a coupon's QR (or search by
Coupon ID), see Eligible/Served/Remaining, record how many people are eating right now with a
locked anti-fraud check, control today's meal-order status, see a per-college summary — and
also let Mess sell food packages at the counter with the same purchase/resend/reprint
capability Registration already has.

**Architecture:** Same PWA → single Apps Script Web App → Google Sheets/Drive architecture as
every prior phase. One new backend module (`Mess.gs`) adds `mess.*` actions on top of the
`MEAL_ENTITLEMENTS`/`MEAL_USAGE`/`MEAL_ORDER_STATUS`/`FOOD_COUPONS` sheets Phase 1/4 already
provisioned — no new sheets or columns. The package-sales addition is a role-permission
widening on Phase 4's existing `FoodPackages.gs`/`registration.teams.*` handlers, not new
backend logic. One new frontend file (`mess.js`) plus small, targeted edits to `app.js`,
`registration.js`, `index.html`, and `service-worker.js`.

**Tech Stack:** Same as Phases 1-4 — Apps Script (V8), vanilla JS PWA, no new dependencies.
QR *decoding* (new to this phase — Phase 4 only ever encoded) uses the browser's native
`BarcodeDetector` Shape Detection API, no vendored library, no network call.

**Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` — this plan
implements §20 (Phase 5 amendment), which fills in the 10-point scan validity check, the
QR-input approach, the MealOrderStatus/scan-gating relationship, and the package-sales
widening (role matrix §12, screen map §13) decided with the human partner on 2026-08-19.

## Global Constraints

- Deployment ID (reuse for every `clasp deploy -i <id>`, do not create a new one):
  `AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI`. Web App URL:
  `https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`.
- **curl gotcha: never use `-L` with POST.** Apps Script's response is a redirect to a
  one-time `script.googleusercontent.com` content URL, and following it automatically with
  `-L` on a POST has been unreliable in earlier phases. Capture the first hop's `Location`
  header, then issue a second plain GET. Use this helper for every backend verification step
  in this plan (run once per shell session):

  ```bash
  URL="https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec"
  call_action() {
    curl -s -D /tmp/hpuick_headers.txt -o /tmp/hpuick_body.json -X POST -H "Content-Type: text/plain" --data-raw "$1" "$URL"
    LOCATION=$(grep -i '^location:' /tmp/hpuick_headers.txt | sed 's/^[Ll]ocation: //' | tr -d '\r')
    if [ -n "$LOCATION" ]; then curl -s "$LOCATION"; else cat /tmp/hpuick_body.json; fi
  }
  ```

  If a call returns empty or an HTML error page, retry once before investigating further as a
  real failure (transient Google-edge flakiness, observed repeatedly, not a code bug).
- **Service worker cache versioning: bump `CACHE_NAME` in `frontend/service-worker.js` on
  EVERY task in this phase that changes any frontend file, and add `mess.js` to
  `SHELL_FILES`.** Current value is `'hpuick-shell-v12'`; this phase's two frontend tasks
  (Task 6, Task 7) bump it to v13, then v14, in order.
- **The 10-point scan validity check (spec §20, binding)** — `Mess.gs`'s internal resolver
  must implement all ten points, in this order, each with its own distinct error code so a
  rejection is unambiguous: role check (done by `requireRole_` before the resolver runs),
  coupon exists (`NOT_FOUND`), coupon `ACTIVE` (`COUPON_INACTIVE`), package `ACTIVE`
  (`PACKAGE_INACTIVE`), team not LOST/RELIEVED (`TEAM_NOT_ACTIVE`), a meal is currently in its
  serving window (`NO_ACTIVE_MEAL_WINDOW`), this coupon has an entitlement for exactly that
  date+meal (`NOT_VALID_FOR_CURRENT_MEAL`), entitlement `ACTIVE` (`ENTITLEMENT_INACTIVE`),
  requested count ≤ remaining (`EXCEEDS_REMAINING`, only checked by the write path), duplicate
  `ClientRequestId` short-circuits to the original result instead of re-validating at all
  (idempotent replay).
- **`MealOrderStatus` never gates a scan** (decided with the human, spec §20) — it is set by
  `mess.setMealOrderStatus`, shown on the Current Meal screen, and mirrored onto that
  date+meal's `MEAL_ENTITLEMENTS` rows for the later refund rule, but `mess.recordUsage` never
  reads it.
- **Denied/rejected scans are never persisted** (decided with the human) — a validation
  failure throws, writes nothing, and the on-screen rejection message is itself the mess
  operator's cue to deny entry. Only a *successful* claim writes a `MEAL_USAGE` row.
- **All times are IST (`Asia/Kolkata`, matching `appsscript.json`'s `timeZone`).** Existing
  code's `new Date().toISOString()` pattern returns *UTC*, which is fine for the date-only
  fields it's used for elsewhere, but wrong for this phase's time-of-day window checks — use
  `Utilities.formatDate(date, 'Asia/Kolkata', 'HH:mm')` / `'yyyy-MM-dd'` everywhere in
  `Mess.gs`, never `.toISOString()`.
- **Role gating for this phase's actions**, per spec §12/§20:
  - `mess.currentMeal`, `mess.resolveToken`, `mess.searchByCouponId`, `mess.todaysSummary`:
    `[ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]` (read-shared, matches the role matrix's
    "view-only" for Admin/Registration on this row).
  - `mess.recordUsage`, `mess.setMealOrderStatus`: `[ROLES.ADMIN, ROLES.MESS]` (write, matches
    every other phase's established pattern of ADMIN having override access alongside the
    primary role, even where the matrix prose says "view-only" — see `requireRole_` calls
    throughout `Registration.gs`/`FoodPackages.gs`/`Rooms.gs`).
  - `registration.package.*` (`purchasePackage_`/`listPackages_`/`resendCoupon_`/
    `reprintCoupon_`) and `registration.teams.*` (`listTeams_`/`getTeamDetail_`): widen from
    `[ROLES.ADMIN, ROLES.REGISTRATION]` to also include `ROLES.MESS` (spec §20's package-sales
    parity). `getTeamDetail_` additionally redacts `charges`/`payments`/`receipts` to
    `null`/`[]`/`[]` when the caller's role is `MESS` — Mess sees team identity and incharges
    (needed to sell a package) but never Dari/security/total-payable or the temp receipt.
- **No new sheets or schema columns** — `MEAL_ENTITLEMENTS`, `MEAL_USAGE`, `MEAL_ORDER_STATUS`,
  `FOOD_COUPONS` were all provisioned by Phase 1's `setupSchema_` and populated by Phase 4's
  `purchasePackage_`; this phase only adds actions/screens that read and write them.

---

## Task 1: Generalize the self-test slow/fast split away from a name-substring match

`system.selfTestSplit` currently buckets "slow" tests by checking whether the test's
*registered name* contains the literal substring `'foodPackages'` — a hack that happened to
work while only Phase 4's two PDF-generating tests were slow. This phase adds a third
PDF-generating test (Mess buying a package), so the filter needs to be an explicit flag, not a
string match, before that test is added.

**Files:**
- Modify: `backend/Tests.gs:929-958` (the `TEST_CASES` array — add `slow: true` to the two
  existing food-package entries)
- Modify: `backend/Main.gs:44-56` (the `system.selfTestSplit` handler's filter)

**Interfaces:**
- Produces: `TEST_CASES` entries may now carry an optional `slow: true` property, read by
  `system.selfTestSplit`. Every later task that registers a PDF-generating test sets
  `slow: true` on its entry; every other test omits the property (falsy, "fast" bucket).

- [ ] **Step 1: Change the two existing food-package `TEST_CASES` entries to carry `slow: true`**

In `backend/Tests.gs`, change:

```javascript
  { name: 'foodPackages_purchaseCreatesEverythingCorrectly', fn: test_foodPackages_purchaseCreatesEverythingCorrectly },
  { name: 'foodPackages_resendAndReprint', fn: test_foodPackages_resendAndReprint }
```

to:

```javascript
  { name: 'foodPackages_purchaseCreatesEverythingCorrectly', fn: test_foodPackages_purchaseCreatesEverythingCorrectly, slow: true },
  { name: 'foodPackages_resendAndReprint', fn: test_foodPackages_resendAndReprint, slow: true }
```

- [ ] **Step 2: Change `system.selfTestSplit`'s filter in `backend/Main.gs` to read the flag instead of matching a name substring**

Change:

```javascript
    const wantSlow = payload && payload.only === 'slow';
    const cases = TEST_CASES.filter(function (tc) { return (tc.name.indexOf('foodPackages') !== -1) === wantSlow; });
```

to:

```javascript
    const wantSlow = payload && payload.only === 'slow';
    const cases = TEST_CASES.filter(function (tc) { return !!tc.slow === wantSlow; });
```

Also update the comment two lines above (currently says "currently the food-package ones") to:
`// payload.only: 'slow' runs just the tests known to do real Slides/Drive document generation`
`// (flagged 'slow: true' in TEST_CASES); omit it to run everything else.`

- [ ] **Step 3: Push and verify both buckets still return the same counts as before**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"only":"slow"}}'
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: the `"only":"slow"` call reports `"summary":"2/2 passed"` (the two food-package
tests, now selected by `slow: true` instead of the name match); the other call reports the
same total pass count as it did before this change (all remaining registered tests).

- [ ] **Step 4: Commit**

```bash
git add backend/Tests.gs backend/Main.gs
git commit -m "Phase 5: generalize selfTestSplit's slow-test filter to an explicit flag

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XaHNhdFsr4nRrniGgw2gbJ"
```

---

## Task 2: Mess gets package purchase/resend/reprint parity + redacted team lookup

**Files:**
- Modify: `backend/FoodPackages.gs:56,157,171,187` (widen four `requireRole_` calls)
- Modify: `backend/Registration.gs:118,129-139` (widen two `requireRole_` calls, redact
  financials in `getTeamDetail_` for `MESS`)
- Modify: `backend/Tests.gs` (two new tests, registered in `TEST_CASES`)

**Interfaces:**
- Produces: `getTeamDetail_(actorSession, teamId)` now returns `charges: null, payments: [],
  receipts: []` when `actorSession.role === ROLES.MESS` (previously these were only ever
  `null`/`[]` for lack of data, now also redacted-by-role even once data exists). `team` and
  `incharges` are unchanged for every role.

- [ ] **Step 1: Write the two failing tests**

In `backend/Tests.gs`, add after `test_registration_registerTeam_needsAccommodationFlag`:

```javascript
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
  const messSession = { userId: 'USR-0002', role: ROLES.MESS, sessionId: 'y' };
  let createdTeamId = null;
  const createdPackageIds = [];
  const trashFileIds = [];
  try {
    const team = registerTeam_(messSession, 'Mess Sale Test College', 'District', 2, [{ name: 'Coach', isPrimary: true }]);
    createdTeamId = team.teamId;

    const pkg = purchasePackage_(messSession, createdTeamId, false, null, 'Cash', null);
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
```

Register both in `TEST_CASES` (`backend/Tests.gs`), the second flagged `slow: true` (it calls
`purchasePackage_`, which generates real PDFs):

```javascript
  { name: 'registration_getTeamDetail_redactsFinancialsForMess', fn: test_registration_getTeamDetail_redactsFinancialsForMess },
  { name: 'foodPackages_messRoleParity', fn: test_foodPackages_messRoleParity, slow: true }
```

(add both after the existing `foodPackages_resendAndReprint` entry from Task 1)

- [ ] **Step 2: Push and run to verify both fail**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"slow"}}'
```

Expected: `registration_getTeamDetail_redactsFinancialsForMess` FAILs with a `FORBIDDEN` error
(current `getTeamDetail_`/`listTeams_` only allow `ADMIN`/`REGISTRATION`);
`foodPackages_messRoleParity` FAILs the same way from `purchasePackage_`.

- [ ] **Step 3: Widen the role checks and add redaction**

In `backend/FoodPackages.gs`, change all four occurrences of:

```javascript
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
```

(lines 56 in `purchasePackage_`, 157 in `listPackages_`, 171 in `resendCoupon_`, 187 in
`reprintCoupon_`) to:

```javascript
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
```

In `backend/Registration.gs`, change `listTeams_`:

```javascript
function listTeams_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
```

to:

```javascript
function listTeams_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
```

and change `getTeamDetail_` from:

```javascript
function getTeamDetail_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId);
  return {
    team: team.values,
    incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
    charges: charges.length > 0 ? charges[0] : null,
    payments: findRowsByField_('PAYMENTS', 'TeamId', teamId),
    receipts: findRowsByField_('RECEIPTS', 'TeamId', teamId)
  };
```

to:

```javascript
function getTeamDetail_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  // Mess sells packages and needs team identity/incharges, but never Dari/security/
  // total-payable figures or the temporary receipt (spec §20, narrowing the shared
  // read endpoint's field visibility rather than duplicating the handler).
  if (actorSession.role === ROLES.MESS) {
    return {
      team: team.values,
      incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
      charges: null, payments: [], receipts: []
    };
  }
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId);
  return {
    team: team.values,
    incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
    charges: charges.length > 0 ? charges[0] : null,
    payments: findRowsByField_('PAYMENTS', 'TeamId', teamId),
    receipts: findRowsByField_('RECEIPTS', 'TeamId', teamId)
  };
```

- [ ] **Step 4: Push and verify both tests pass**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"slow"}}'
```

Expected: both new tests report `"status":"PASS"`, and every previously-passing test still
passes (same total counts as Task 1's Step 3, plus these two).

- [ ] **Step 5: Commit**

```bash
git add backend/FoodPackages.gs backend/Registration.gs backend/Tests.gs
git commit -m "Phase 5: Mess gets package purchase/resend/reprint parity + redacted team lookup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XaHNhdFsr4nRrniGgw2gbJ"
```

---

## Task 3: `Mess.gs` — meal-window resolution + read actions (`currentMeal`, `resolveToken`, `searchByCouponId`)

**Files:**
- Create: `backend/Mess.gs`
- Modify: `backend/Main.gs` (register three new `mess.*` actions)
- Modify: `backend/Tests.gs` (new tests, registered in `TEST_CASES`)

**Interfaces:**
- Produces (consumed by Task 4 and the frontend):
  - `_timeToMinutes_(hhmm: string): number`
  - `_isWithinWindow_(timeHHMM: string, startHHMM: string, endHHMM: string, graceMinutes: number): boolean`
  - `_currentMeal_(nowOverride?: Date): {meal: 'BREAKFAST'|'LUNCH'|'DINNER', date: string, windowStart: string, windowEnd: string} | null`
  - `_resolveCoupon_(coupon: object, nowOverride?: Date): {couponId, packageId, packageNumber, teamId, collegeName, entitlementId, meal, date, rate, eligiblePersons, servedPersons, qrToken}` — throws `apiError_` with the codes listed in Global Constraints on any of points 2-8 of the validity check; used by Task 4's `recordMealUsage_` too.
  - `resolveMealToken_(actorSession, qrToken): same shape as _resolveCoupon_ + remainingPersons`
  - `resolveMealByCouponId_(actorSession, couponId): same shape`
  - `getMessCurrentMealView_(actorSession): {date, currentMeal, windowStart, windowEnd, orderStatuses: [{meal, status}]}`

- [ ] **Step 1: Write the failing tests**

In `backend/Tests.gs`, add:

```javascript
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
```

Register in `TEST_CASES`:

```javascript
  { name: 'mess_timeWindowMath', fn: test_mess_timeWindowMath },
  { name: 'mess_currentMeal_picksConfiguredWindow', fn: test_mess_currentMeal_picksConfiguredWindow },
  { name: 'mess_resolveToken_successAndEachRejectionReason', fn: test_mess_resolveToken_successAndEachRejectionReason },
  { name: 'mess_resolveByCouponId_lostCouponLookup', fn: test_mess_resolveByCouponId_lostCouponLookup },
```

- [ ] **Step 2: Push and verify all four fail** (undefined functions)

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: all four new tests FAIL with `"... is not defined"`.

- [ ] **Step 3: Create `backend/Mess.gs`**

```javascript
// Mess.gs — Phase 5: Mess Committee panel. Scan/resolve a coupon's QR (or Coupon ID),
// enforce the 10-point scan validity check (spec §20), record group meal consumption under
// a lock, control today's meal-order status, and summarize today's meal by team.
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §20.
//
// All times below are IST (Asia/Kolkata, matching appsscript.json's timeZone) via
// Utilities.formatDate — never .toISOString(), which is UTC and would be off by 5:30.

function _timeToMinutes_(hhmm) {
  const parts = hhmm.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function _isWithinWindow_(timeHHMM, startHHMM, endHHMM, graceMinutes) {
  const t = _timeToMinutes_(timeHHMM);
  const start = _timeToMinutes_(startHHMM) - graceMinutes;
  const end = _timeToMinutes_(endHHMM) + graceMinutes;
  return t >= start && t <= end;
}

// nowOverride lets tests pin a specific IST moment; production callers omit it (real "now").
function _currentMeal_(nowOverride) {
  const now = nowOverride || new Date();
  const date = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
  const time = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm');
  const timings = getMealTimings_(null);
  const grace = parseInt(timings.graceMinutes, 10) || 0;
  const candidates = [
    { meal: 'BREAKFAST', start: timings.breakfastStart, end: timings.breakfastEnd },
    { meal: 'LUNCH', start: timings.lunchStart, end: timings.lunchEnd },
    { meal: 'DINNER', start: timings.dinnerStart, end: timings.dinnerEnd }
  ];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c.start || !c.end) continue; // meal timings not configured yet
    if (_isWithinWindow_(time, c.start, c.end, grace)) {
      return { meal: c.meal, date: date, windowStart: c.start, windowEnd: c.end };
    }
  }
  return null;
}

// Points 2-8 of the 10-point validity check (spec §20) — point 1 (role) is enforced by the
// caller via requireRole_ before this runs; point 9 (count <= remaining) is write-path only,
// checked by recordMealUsage_; point 10 (idempotent replay) is also recordMealUsage_'s job.
// Shared by both entry points (QR token, Coupon ID) so a lost/damaged-coupon lookup goes
// through identically strict validation, never a shortcut.
function _resolveCoupon_(coupon, nowOverride) {
  if (coupon.Status !== 'ACTIVE') throw apiError_('COUPON_INACTIVE', 'This coupon is not active (status: ' + coupon.Status + ').');

  const pkg = findRowById_('FOOD_PACKAGES', 'PackageId', coupon.PackageId);
  if (!pkg || pkg.values.Status !== 'ACTIVE') {
    throw apiError_('PACKAGE_INACTIVE', 'This package is not active (status: ' + (pkg ? pkg.values.Status : 'MISSING') + ').');
  }

  const team = findRowById_('TEAMS', 'TeamId', coupon.TeamId);
  if (!team) throw apiError_('NOT_FOUND', 'Team not found for this coupon.');
  if (team.values.Status === 'LOST' || team.values.Status === 'RELIEVED') {
    throw apiError_('TEAM_NOT_ACTIVE', 'This team\'s status is ' + team.values.Status + ' — not eligible for meals.');
  }

  const current = _currentMeal_(nowOverride);
  if (!current) throw apiError_('NO_ACTIVE_MEAL_WINDOW', 'No meal is currently within its serving window.');

  const entitlement = findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', coupon.PackageId)
    .filter(function (e) { return e.Meal === current.meal && e.Date === current.date; })[0];
  if (!entitlement) {
    throw apiError_('NOT_VALID_FOR_CURRENT_MEAL',
      'This coupon (Package ' + pkg.values.PackageNumber + ') does not cover today\'s ' + current.meal + ' (' + current.date + ').');
  }
  if (entitlement.Status !== 'ACTIVE') {
    throw apiError_('ENTITLEMENT_INACTIVE', 'This meal entitlement is ' + entitlement.Status + ', not ACTIVE.');
  }

  return {
    couponId: coupon.CouponId, packageId: pkg.values.PackageId, packageNumber: Number(pkg.values.PackageNumber),
    teamId: team.values.TeamId, collegeName: team.values.CollegeName, entitlementId: entitlement.EntitlementId,
    meal: entitlement.Meal, date: entitlement.Date, rate: Number(entitlement.Rate),
    eligiblePersons: Number(entitlement.EligiblePersons), servedPersons: Number(entitlement.ServedPersons),
    qrToken: coupon.QrToken
  };
}

function resolveMealToken_(actorSession, qrToken, nowOverride) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  if (!qrToken) throw apiError_('VALIDATION_ERROR', 'QR token is required.');
  const coupon = findRowsByField_('FOOD_COUPONS', 'QrToken', qrToken)[0];
  if (!coupon) throw apiError_('NOT_FOUND', 'No coupon found for this QR code.');
  const resolved = _resolveCoupon_(coupon, nowOverride);
  resolved.remainingPersons = resolved.eligiblePersons - resolved.servedPersons;
  return resolved;
}

function resolveMealByCouponId_(actorSession, couponId, nowOverride) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  if (!couponId) throw apiError_('VALIDATION_ERROR', 'Coupon ID is required.');
  const found = findRowById_('FOOD_COUPONS', 'CouponId', couponId);
  if (!found) throw apiError_('NOT_FOUND', 'No such coupon: ' + couponId);
  const resolved = _resolveCoupon_(found.values, nowOverride);
  resolved.remainingPersons = resolved.eligiblePersons - resolved.servedPersons;
  return resolved;
}

function getMessCurrentMealView_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const current = _currentMeal_();
  const date = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const orderStatuses = ['BREAKFAST', 'LUNCH', 'DINNER'].map(function (meal) {
    const row = findRowsByField_('MEAL_ORDER_STATUS', 'Date', date).filter(function (r) { return r.Meal === meal; })[0];
    return { meal: meal, status: row ? row.Status : 'NOT_ORDERED' };
  });
  return {
    date: date, currentMeal: current ? current.meal : null,
    windowStart: current ? current.windowStart : null, windowEnd: current ? current.windowEnd : null,
    orderStatuses: orderStatuses
  };
}
```

- [ ] **Step 4: Register the three read actions in `backend/Main.gs`'s `ACTIONS` table**

Change the end of the `ACTIONS` object literal from:

```javascript
  'registration.package.reprint': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return reprintCoupon_(session, payload.packageId);
  }
};
```

to:

```javascript
  'registration.package.reprint': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return reprintCoupon_(session, payload.packageId);
  },
  'mess.currentMeal': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getMessCurrentMealView_(session);
  },
  'mess.resolveToken': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resolveMealToken_(session, payload.qrToken);
  },
  'mess.searchByCouponId': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resolveMealByCouponId_(session, payload.couponId);
  }
};
```

- [ ] **Step 5: Push and verify all four Task 3 tests pass**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: `mess_timeWindowMath`, `mess_currentMeal_picksConfiguredWindow`,
`mess_resolveToken_successAndEachRejectionReason`, `mess_resolveByCouponId_lostCouponLookup`
all report `"status":"PASS"`.

- [ ] **Step 6: Commit**

```bash
git add backend/Mess.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 5: Mess.gs meal-window resolution + currentMeal/resolveToken/searchByCouponId

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XaHNhdFsr4nRrniGgw2gbJ"
```

---

## Task 4: `mess.recordUsage` — the locked commit, with idempotent replay

**Files:**
- Modify: `backend/Main.gs` (thread `requestId` into every handler; register `mess.recordUsage`)
- Modify: `backend/Mess.gs` (add `recordMealUsage_`)
- Modify: `backend/Tests.gs` (new tests, registered in `TEST_CASES`)

**Interfaces:**
- Consumes: `_resolveCoupon_` (Task 3, same file), `LockService`, `nextId_`, `appendRow_`,
  `updateRowById_`.
- Produces: `recordMealUsage_(actorSession, qrToken, count, clientRequestId, nowOverride):
  {usageId, collegeName, packageNumber, meal, date, eligiblePersons, servedPersons,
  remainingPersons, replay?: true}` — throws `EXCEEDS_REMAINING` (message embeds the
  requested/eligible/served/remaining numbers per spec §43) or any of `_resolveCoupon_`'s
  codes. The frontend (Task 7) calls this via the `mess.recordUsage` action.

- [ ] **Step 1: Write the failing tests**

In `backend/Tests.gs`, add:

```javascript
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
```

Register in `TEST_CASES`:

```javascript
  { name: 'mess_recordUsage_fullLifecycleMatchesGroupEntryScenario', fn: test_mess_recordUsage_fullLifecycleMatchesGroupEntryScenario },
  { name: 'mess_recordUsage_idempotentReplayDoesNotDoubleDecrement', fn: test_mess_recordUsage_idempotentReplayDoesNotDoubleDecrement },
  { name: 'mess_recordUsage_rejectsOutsideWindowAndInactiveTeam', fn: test_mess_recordUsage_rejectsOutsideWindowAndInactiveTeam },
```

- [ ] **Step 2: Push and verify all three fail**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: all three FAIL — `recordMealUsage_ is not defined`.

- [ ] **Step 3: Thread `requestId` into every action handler**

In `backend/Main.gs`, change `handleRequest_`'s handler invocation from:

```javascript
    const data = handler(body.payload || {}, body.sessionId || null);
```

to:

```javascript
    const data = handler(body.payload || {}, body.sessionId || null, body.requestId || null);
```

Every existing handler function declares only two parameters, so this is additive and
harmless to them (JS ignores unused extra arguments) — only `mess.recordUsage`'s handler
(added in the next step) reads the third.

- [ ] **Step 4: Add `recordMealUsage_` to `backend/Mess.gs`**

Append:

```javascript
// The locked check-and-commit — recordUsage's own idempotency (spec §20 point 10, §47/§48):
// a repeated clientRequestId returns the ORIGINAL result without touching Served/Remaining
// again, protecting against the frontend's documented retry-on-parse-error behavior
// (api-client.js) re-submitting the exact same claim.
function recordMealUsage_(actorSession, qrToken, count, clientRequestId, nowOverride) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.MESS]);
  if (!qrToken) throw apiError_('VALIDATION_ERROR', 'QR token is required.');
  const requestedCount = parseInt(count, 10);
  if (!requestedCount || requestedCount < 1) throw apiError_('VALIDATION_ERROR', 'Count must be at least 1.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (clientRequestId) {
      const dup = findRowsByField_('MEAL_USAGE', 'ClientRequestId', clientRequestId)[0];
      if (dup) {
        return {
          usageId: dup.UsageId, collegeName: findRowById_('TEAMS', 'TeamId', dup.TeamId).values.CollegeName,
          packageNumber: Number(findRowById_('FOOD_PACKAGES', 'PackageId', dup.PackageId).values.PackageNumber),
          meal: dup.Meal, date: dup.Date, eligiblePersons: Number(dup.NewServedTotal) + Number(dup.RemainingAfter),
          servedPersons: Number(dup.NewServedTotal), remainingPersons: Number(dup.RemainingAfter), replay: true
        };
      }
    }

    const coupon = findRowsByField_('FOOD_COUPONS', 'QrToken', qrToken)[0];
    if (!coupon) throw apiError_('NOT_FOUND', 'No coupon found for this QR code.');
    const resolved = _resolveCoupon_(coupon, nowOverride);
    const remaining = resolved.eligiblePersons - resolved.servedPersons;
    if (requestedCount > remaining) {
      throw apiError_('EXCEEDS_REMAINING',
        'Requested ' + requestedCount + ' exceeds remaining ' + remaining + ' (eligible ' +
        resolved.eligiblePersons + ', already served ' + resolved.servedPersons + ') for ' + resolved.collegeName + '.');
    }

    const newServedTotal = resolved.servedPersons + requestedCount;
    const remainingAfter = resolved.eligiblePersons - newServedTotal;
    const usageId = nextId_('USG', 7);
    const now = new Date().toISOString();
    appendRow_('MEAL_USAGE', {
      UsageId: usageId, CouponId: resolved.couponId, PackageId: resolved.packageId, TeamId: resolved.teamId,
      EntitlementId: resolved.entitlementId, Date: resolved.date, Meal: resolved.meal,
      PreviousServedCount: resolved.servedPersons, ClaimAmount: resolved.rate * requestedCount,
      NewServedTotal: newServedTotal, RemainingAfter: remainingAfter, MessUser: actorSession.userId,
      Timestamp: now, ClientRequestId: clientRequestId || ''
    });
    updateRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', resolved.entitlementId, {
      ServedPersons: newServedTotal, RemainingPersons: remainingAfter
    });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'RECORD_MEAL_USAGE', Entity: 'ENTITLEMENT', EntityId: resolved.entitlementId,
      PreviousState: String(resolved.servedPersons), NewState: String(newServedTotal)
    });

    return {
      usageId: usageId, collegeName: resolved.collegeName, packageNumber: resolved.packageNumber,
      meal: resolved.meal, date: resolved.date, eligiblePersons: resolved.eligiblePersons,
      servedPersons: newServedTotal, remainingPersons: remainingAfter
    };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 5: Register `mess.recordUsage` in `backend/Main.gs`'s `ACTIONS` table**

Change the end of the `ACTIONS` object literal (as Task 3 left it) from:

```javascript
  'mess.searchByCouponId': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resolveMealByCouponId_(session, payload.couponId);
  }
};
```

to:

```javascript
  'mess.searchByCouponId': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resolveMealByCouponId_(session, payload.couponId);
  },
  'mess.recordUsage': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return recordMealUsage_(session, payload.qrToken, payload.count, requestId);
  }
};
```

- [ ] **Step 6: Push and verify all three Task 4 tests pass**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: `mess_recordUsage_fullLifecycleMatchesGroupEntryScenario`,
`mess_recordUsage_idempotentReplayDoesNotDoubleDecrement`,
`mess_recordUsage_rejectsOutsideWindowAndInactiveTeam` all report `"status":"PASS"`, and every
prior test still passes.

- [ ] **Step 7: Commit**

```bash
git add backend/Main.gs backend/Mess.gs backend/Tests.gs
git commit -m "Phase 5: mess.recordUsage — locked commit with idempotent replay

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XaHNhdFsr4nRrniGgw2gbJ"
```

---

## Task 5: `mess.setMealOrderStatus` + `mess.todaysSummary`

**Files:**
- Modify: `backend/Mess.gs` (add `setMealOrderStatus_`, `getTodaysMessSummary_`)
- Modify: `backend/Main.gs` (register both actions)
- Modify: `backend/Tests.gs` (new tests, registered in `TEST_CASES`)

**Interfaces:**
- Produces: `setMealOrderStatus_(actorSession, date, meal, status): {date, meal, status}` —
  upserts one `MEAL_ORDER_STATUS` row per date+meal and mirrors `status` onto every matching
  `MEAL_ENTITLEMENTS` row's `MealOrderStatus` column (schema's own documented intent).
  `getTodaysMessSummary_(actorSession): {date, meal, rows: [{teamId, collegeName,
  eligiblePersons, servedPersons, remainingPersons}]}` — `meal`/`rows` are `null`/`[]` when no
  meal window is currently active.

- [ ] **Step 1: Write the failing tests**

In `backend/Tests.gs`, add:

```javascript
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
```

Register in `TEST_CASES`:

```javascript
  { name: 'mess_setMealOrderStatus_upsertsAndMirrorsToEntitlements', fn: test_mess_setMealOrderStatus_upsertsAndMirrorsToEntitlements },
  { name: 'mess_todaysSummary_aggregatesByTeam', fn: test_mess_todaysSummary_aggregatesByTeam },
```

(Note: `test_mess_todaysSummary_aggregatesByTeam` deliberately doesn't assert on `before.rows`
contents — `getTodaysMessSummary_` reads the *real* current wall-clock meal, which won't
generally match this fixture's fixed `2026-08-19` date when the test actually runs. This is a
shape/no-throw smoke test; Task 3's `_currentMeal_` date/meal-selection logic is already
covered precisely by `test_mess_currentMeal_picksConfiguredWindow`'s injected `nowOverride`.)

- [ ] **Step 2: Push and verify both fail**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: both FAIL — `setMealOrderStatus_ is not defined` / `getTodaysMessSummary_ is not defined`.

- [ ] **Step 3: Add both functions to `backend/Mess.gs`**

```javascript
function setMealOrderStatus_(actorSession, date, meal, status) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.MESS]);
  if (!date) throw apiError_('VALIDATION_ERROR', 'Date is required.');
  if (['BREAKFAST', 'LUNCH', 'DINNER'].indexOf(meal) === -1) throw apiError_('VALIDATION_ERROR', 'Meal must be BREAKFAST, LUNCH, or DINNER.');
  if (['NOT_ORDERED', 'ORDERED', 'CLOSED'].indexOf(status) === -1) throw apiError_('VALIDATION_ERROR', 'Status must be NOT_ORDERED, ORDERED, or CLOSED.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date().toISOString();
    const existing = findRowsByField_('MEAL_ORDER_STATUS', 'Date', date).filter(function (r) { return r.Meal === meal; })[0];
    if (existing) {
      updateRowById_('MEAL_ORDER_STATUS', 'StatusId', existing.StatusId, { Status: status, SetBy: actorSession.userId, SetAt: now });
    } else {
      appendRow_('MEAL_ORDER_STATUS', { StatusId: nextId_('STA', 4), Date: date, Meal: meal, Status: status, SetBy: actorSession.userId, SetAt: now });
    }
    // Mirror onto every matching entitlement row (schema's documented intent: MEAL_ENTITLEMENTS.
    // MealOrderStatus "mirrors MEAL_ORDER_STATUS for that date+meal") — the future refund rule
    // reads it directly off the entitlement row rather than cross-referencing this sheet.
    findRowsByField_('MEAL_ENTITLEMENTS', 'Date', date).filter(function (e) { return e.Meal === meal; })
      .forEach(function (e) { updateRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', e.EntitlementId, { MealOrderStatus: status }); });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'SET_MEAL_ORDER_STATUS', Entity: 'MEAL_ORDER_STATUS', EntityId: date + '/' + meal,
      PreviousState: existing ? existing.Status : '', NewState: status
    });
    return { date: date, meal: meal, status: status };
  } finally {
    lock.releaseLock();
  }
}

function getTodaysMessSummary_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const current = _currentMeal_();
  const date = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  if (!current) return { date: date, meal: null, rows: [] };
  const rows = findRowsByField_('MEAL_ENTITLEMENTS', 'Date', current.date)
    .filter(function (e) { return e.Meal === current.meal; })
    .map(function (e) {
      const team = findRowById_('TEAMS', 'TeamId', e.TeamId);
      return {
        teamId: e.TeamId, collegeName: team ? team.values.CollegeName : e.TeamId,
        eligiblePersons: Number(e.EligiblePersons), servedPersons: Number(e.ServedPersons), remainingPersons: Number(e.RemainingPersons)
      };
    });
  return { date: current.date, meal: current.meal, rows: rows };
}
```

- [ ] **Step 4: Register both actions in `backend/Main.gs`**

Change the end of the `ACTIONS` object literal (as Task 4 left it) from:

```javascript
  'mess.recordUsage': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return recordMealUsage_(session, payload.qrToken, payload.count, requestId);
  }
};
```

to:

```javascript
  'mess.recordUsage': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return recordMealUsage_(session, payload.qrToken, payload.count, requestId);
  },
  'mess.setMealOrderStatus': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return setMealOrderStatus_(session, payload.date, payload.meal, payload.status);
  },
  'mess.todaysSummary': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getTodaysMessSummary_(session);
  }
};
```

- [ ] **Step 5: Push and verify both pass**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: `mess_setMealOrderStatus_upsertsAndMirrorsToEntitlements` and
`mess_todaysSummary_aggregatesByTeam` both report `"status":"PASS"`; run
`call_action '{"action":"system.selfTestSplit","payload":{"only":"slow"}}'` too and confirm the
slow bucket is unaffected (`"summary":"3/3 passed"` — the two Phase-4 tests plus Task 2's
`foodPackages_messRoleParity`).

- [ ] **Step 6: Commit**

```bash
git add backend/Mess.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 5: mess.setMealOrderStatus + mess.todaysSummary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XaHNhdFsr4nRrniGgw2gbJ"
```

Backend is now complete and fully tested — Tasks 6-7 build the frontend against it.

---

## Task 6: Frontend — Mess Dashboard, Current Meal, and Today's Summary screens

**Files:**
- Create: `frontend/js/mess.js`
- Modify: `frontend/js/app.js` (route `MESS` role to `renderMessDashboard`)
- Modify: `frontend/index.html` (add the `mess.js` script tag)
- Modify: `frontend/service-worker.js` (bump `CACHE_NAME` to v13, add `mess.js` to `SHELL_FILES`)

**Interfaces:**
- Consumes: `apiCall('mess.currentMeal', {})`, `apiCall('mess.setMealOrderStatus', {date, meal,
  status})`, `apiCall('mess.todaysSummary', {})`, `navigateTo`/`goBack`/`resetNavigation`
  (globals from `app.js`), `logout`/`renderLogin` (globals from `auth.js`/`app.js`),
  `renderTeamsList` (global from `registration.js`) — all already loaded before `mess.js` in
  `index.html`.
- Produces (consumed by Task 7 and `app.js`): `renderMessDashboard(root, user)`,
  `renderCurrentMealScreen(root, user)`, `renderTodaysSummaryScreen(root, user)` — all global
  functions, matching every other screen file's convention (no modules/bundler in this repo).

- [ ] **Step 1: Create `frontend/js/mess.js` with the dashboard, Current Meal, and Today's Summary screens**

```javascript
// mess.js — Mess Committee panel (Phase 5). Current Meal (order-status control), Scan
// (Task 7), Today's Summary, and Teams (reuses registration.js's renderTeamsList/
// renderTeamDetail + packages.js's renderPackagesScreen — no separate Mess-specific team
// screens needed, spec §20's package-sales parity).

async function renderMessDashboard(root, user) {
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">Mess Committee</p>' +
      '<button id="current-meal-btn">Current Meal</button>' +
      '<button id="scan-btn">Scan</button>' +
      '<button id="summary-btn">Today\'s Summary</button>' +
      '<button id="teams-btn">Teams (Sell Package)</button>' +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  document.getElementById('current-meal-btn').addEventListener('click', function () { navigateTo(renderCurrentMealScreen, root, user); });
  document.getElementById('scan-btn').addEventListener('click', function () { navigateTo(renderScanScreen, root, user); });
  document.getElementById('summary-btn').addEventListener('click', function () { navigateTo(renderTodaysSummaryScreen, root, user); });
  document.getElementById('teams-btn').addEventListener('click', function () { navigateTo(renderTeamsList, root, user); });
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    resetNavigation(renderLogin, root, null);
  });
}

async function renderCurrentMealScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Current Meal</h1><p>Loading…</p></div>';
  await refresh();

  async function refresh() {
    const data = await apiCall('mess.currentMeal', {});
    const rows = data.orderStatuses.map(function (o) {
      const isCurrent = o.meal === data.currentMeal;
      return '<tr' + (isCurrent ? ' style="font-weight:bold"' : '') + '>' +
        '<td>' + o.meal + (isCurrent ? ' (current)' : '') + '</td><td>' + o.status + '</td>' +
        '<td>' +
          '<button class="order-btn" data-meal="' + o.meal + '" data-status="ORDERED">Mark ORDERED</button> ' +
          '<button class="order-btn" data-meal="' + o.meal + '" data-status="CLOSED">Mark CLOSED</button>' +
        '</td></tr>';
    }).join('');
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Current Meal</h1>' +
        '<p class="subtitle">' + data.date + '</p>' +
        '<p>' + (data.currentMeal
          ? 'Currently serving: <strong>' + data.currentMeal + '</strong> (' + data.windowStart + '\u2013' + data.windowEnd + ')'
          : 'No meal is currently within its serving window.') + '</p>' +
        '<div id="mess-error" class="error" style="display:none"></div>' +
        '<table><thead><tr><th>Meal</th><th>Order Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<button id="back-btn" style="margin-top:16px">Back</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.order-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('mess-error');
        errEl.style.display = 'none';
        try {
          await apiCall('mess.setMealOrderStatus', { date: data.date, meal: btn.getAttribute('data-meal'), status: btn.getAttribute('data-status') });
          await refresh();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}

async function renderTodaysSummaryScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Today\'s Summary</h1><p>Loading…</p></div>';
  const data = await apiCall('mess.todaysSummary', {});
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>Today\'s Summary</h1>' +
      '<p class="subtitle">' + data.date + (data.meal ? ' \u2014 ' + data.meal : ' \u2014 no meal currently active') + '</p>' +
      (data.rows.length === 0
        ? '<p>No teams have an entitlement for the current meal.</p>'
        : '<table><thead><tr><th>College</th><th>Eligible</th><th>Served</th><th>Remaining</th></tr></thead><tbody>' +
            data.rows.map(function (r) {
              return '<tr><td>' + r.collegeName + '</td><td>' + r.eligiblePersons + '</td><td>' + r.servedPersons + '</td><td>' + r.remainingPersons + '</td></tr>';
            }).join('') +
          '</tbody></table>') +
      '<button id="back-btn" style="margin-top:16px">Back</button>' +
    '</div>';
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}
```

(`renderScanScreen` is intentionally not defined yet — Task 7 adds it. The dashboard's
Scan button will 404 against an undefined function until then; this is fine mid-plan, not
fine to ship, and Task 7 lands directly after this one.)

- [ ] **Step 2: Wire `app.js` to route the `MESS` role to the new dashboard**

In `frontend/js/app.js`, change:

```javascript
function renderLanding(root, user) {
  const isAdmin = user.role === 'ADMIN';
  const isRegistration = user.role === 'REGISTRATION';
  const isAccommodation = user.role === 'ACCOMMODATION';
  if (isRegistration) {
    renderRegistrationDashboard(root, user);
    return;
  }
  if (isAccommodation) {
    renderAccommodationDashboard(root, user);
    return;
  }
```

to:

```javascript
function renderLanding(root, user) {
  const isAdmin = user.role === 'ADMIN';
  const isRegistration = user.role === 'REGISTRATION';
  const isAccommodation = user.role === 'ACCOMMODATION';
  const isMess = user.role === 'MESS';
  if (isRegistration) {
    renderRegistrationDashboard(root, user);
    return;
  }
  if (isAccommodation) {
    renderAccommodationDashboard(root, user);
    return;
  }
  if (isMess) {
    renderMessDashboard(root, user);
    return;
  }
```

- [ ] **Step 3: Add the script tag and bump the service worker cache**

In `frontend/index.html`, change:

```html
  <script src="js/accommodation.js"></script>
  <script src="js/app.js"></script>
```

to:

```html
  <script src="js/accommodation.js"></script>
  <script src="js/mess.js"></script>
  <script src="js/app.js"></script>
```

In `frontend/service-worker.js`, change:

```javascript
const CACHE_NAME = 'hpuick-shell-v12';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/packages.js', './js/settings.js', './js/rooms.js', './js/accommodation.js',
  './js/app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
```

to:

```javascript
const CACHE_NAME = 'hpuick-shell-v13';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/packages.js', './js/settings.js', './js/rooms.js', './js/accommodation.js',
  './js/mess.js', './js/app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
```

- [ ] **Step 4: Manually verify in a local server** (this repo has no frontend test runner —
  every prior phase's frontend verification is manual against a real login)

```bash
cd "C:\Users\princ\Downloads\HPUICK\frontend"
npx http-server -p 5544 -c-1
```

Log in as a MESS-role user (create one first via an ADMIN session's `admin.users.create` if
none exists yet, role `MESS`). Confirm: the dashboard shows Current Meal / Scan / Today's
Summary / Teams / Log Out; Current Meal loads without error and its ORDERED/CLOSED buttons
work; Today's Summary loads without error; Teams navigates into the existing team list/detail
screens (Scan will error until Task 7 — expected at this point).

- [ ] **Step 5: Commit**

```bash
git add frontend/js/mess.js frontend/js/app.js frontend/index.html frontend/service-worker.js
git commit -m "Phase 5: Mess Dashboard, Current Meal, Today's Summary screens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XaHNhdFsr4nRrniGgw2gbJ"
```

---

## Task 7: Frontend — Scan screen (camera + manual entry) and Team Detail redaction

**Files:**
- Modify: `frontend/js/mess.js` (add `renderScanScreen`)
- Modify: `frontend/js/registration.js:229-255` (`renderTeamDetail` — hide charges/receipt for
  `MESS`)
- Modify: `frontend/service-worker.js` (bump `CACHE_NAME` to v14)

**Interfaces:**
- Consumes: `apiCall('mess.resolveToken', {qrToken})`, `apiCall('mess.searchByCouponId',
  {couponId})`, `apiCall('mess.recordUsage', {qrToken, count})`.
- Produces: `renderScanScreen(root, user)` — completes the dashboard button wired in Task 6.

- [ ] **Step 1: Add `renderScanScreen` to `frontend/js/mess.js`**

```javascript
// Camera decode uses the browser's native BarcodeDetector Shape Detection API — no vendored
// library, no network call, same self-contained principle as QrEncoder.gs's encoder. Where
// unsupported (desktop Firefox/Safari, or a damaged/unscannable QR), the manual token field
// below is always available as a full fallback, never just a secondary option.
async function renderScanScreen(root, user) {
  let stream = null;
  let detectTimer = null;

  function stopCamera() {
    if (detectTimer) { clearInterval(detectTimer); detectTimer = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  function renderIdle(errorMessage) {
    stopCamera();
    const supportsCamera = 'BarcodeDetector' in window;
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Scan</h1>' +
        (errorMessage ? '<div class="error">' + errorMessage + '</div>' : '') +
        (supportsCamera
          ? '<video id="scan-video" autoplay playsinline muted style="width:100%;max-width:360px;background:#000"></video>'
          : '<p>Camera scanning is not supported in this browser \u2014 use manual entry below.</p>') +
        '<h2>Manual Entry</h2>' +
        '<label>QR Token<input type="text" id="manual-token"></label>' +
        '<button id="lookup-token-btn">Look Up by QR Token</button>' +
        '<label style="margin-top:8px">Coupon ID (lost/damaged coupon)<input type="text" id="manual-coupon-id"></label>' +
        '<button id="lookup-coupon-btn">Look Up by Coupon ID</button>' +
        '<button id="back-btn" style="margin-top:16px;background:#999">Back</button>' +
      '</div>';

    document.getElementById('lookup-token-btn').addEventListener('click', function () {
      const token = document.getElementById('manual-token').value.trim();
      if (token) resolveAndShow('mess.resolveToken', { qrToken: token });
    });
    document.getElementById('lookup-coupon-btn').addEventListener('click', function () {
      const couponId = document.getElementById('manual-coupon-id').value.trim();
      if (couponId) resolveAndShow('mess.searchByCouponId', { couponId: couponId });
    });
    document.getElementById('back-btn').addEventListener('click', function () { stopCamera(); goBack(); });

    if (supportsCamera) startCamera();
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
      return; // camera permission denied/unavailable — manual entry above still works
    }
    const video = document.getElementById('scan-video');
    if (!video) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
    video.srcObject = stream;
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    detectTimer = setInterval(async function () {
      if (!video.videoWidth) return;
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          resolveAndShow('mess.resolveToken', { qrToken: barcodes[0].rawValue });
        }
      } catch (err) { /* transient decode failure — keep polling */ }
    }, 350);
  }

  async function resolveAndShow(action, payload) {
    stopCamera();
    root.innerHTML = '<div class="wizard-card"><h1>Scan</h1><p>Looking up…</p></div>';
    let resolved;
    try {
      resolved = await apiCall(action, payload);
    } catch (err) {
      renderIdle(err.message);
      return;
    }
    renderConfirm(resolved);
  }

  function renderConfirm(resolved) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Scan</h1>' +
        '<p class="subtitle">' + resolved.collegeName + ' \u2014 Package ' + resolved.packageNumber + '</p>' +
        '<p>' + resolved.meal + ' (' + resolved.date + ')</p>' +
        '<table><tbody>' +
          '<tr><th>Eligible</th><td>' + resolved.eligiblePersons + '</td></tr>' +
          '<tr><th>Already Served</th><td>' + resolved.servedPersons + '</td></tr>' +
          '<tr><th>Remaining</th><td>' + resolved.remainingPersons + '</td></tr>' +
        '</tbody></table>' +
        '<div id="scan-error" class="error" style="display:none"></div>' +
        '<label>How many are eating right now?<input type="number" id="claim-count" min="1" value="' + resolved.remainingPersons + '"></label>' +
        '<button id="confirm-btn">Confirm</button>' +
        '<button id="deny-btn" style="background:#999">Deny / Scan Next</button>' +
      '</div>';

    document.getElementById('confirm-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('scan-error');
      errEl.style.display = 'none';
      const count = parseInt(document.getElementById('claim-count').value, 10);
      try {
        const result = await apiCall('mess.recordUsage', { qrToken: resolved.qrToken, count: count });
        renderSuccess(result);
      } catch (err) {
        errEl.textContent = err.message; // the eligible/served/remaining/requested numbers are already visible above
        errEl.style.display = 'block';
      }
    });
    document.getElementById('deny-btn').addEventListener('click', function () { renderIdle(null); });
  }

  function renderSuccess(result) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Scan</h1>' +
        '<p>' + result.collegeName + ' \u2014 ' + result.meal + ': served, remaining now ' + result.remainingPersons + '.' + (result.replay ? ' (duplicate submission, no change made)' : '') + '</p>' +
        '<button id="scan-next-btn">Scan Next</button>' +
        '<button id="back-btn" style="background:#999">Back to Dashboard</button>' +
      '</div>';
    document.getElementById('scan-next-btn').addEventListener('click', function () { renderIdle(null); });
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }

  renderIdle(null);
}
```

- [ ] **Step 2: Hide charges/receipt for the `MESS` role in `renderTeamDetail`**

In `frontend/js/registration.js`, change:

```javascript
      '<h2>Incharges</h2>' +
      '<ul>' + data.incharges.map(function (i) { return '<li>' + i.Name + (i.IsPrimary === 'true' ? ' (Primary)' : '') + '</li>'; }).join('') + '</ul>' +
      (data.charges
        ? '<p>' + [
            Number(data.charges.DariCharges) > 0 ? 'Dari: Rs ' + data.charges.DariCharges : null,
            Number(data.charges.SecurityCharges) > 0 ? 'Security: Rs ' + data.charges.SecurityCharges : null
          ].filter(function (s) { return s; }).join(' &middot; ') + '</p>'
        : '<p>Charges not yet calculated.</p>') +
      (receipt
        ? '<a href="https://drive.google.com/file/d/' + receipt.PdfFileId + '/view" target="_blank" rel="noopener"><button type="button">View Receipt</button></a>'
        : '<p>No receipt generated yet.</p>') +
      '<button id="packages-btn" style="margin-top:12px">Food Packages</button>' +
```

to:

```javascript
      '<h2>Incharges</h2>' +
      '<ul>' + data.incharges.map(function (i) { return '<li>' + i.Name + (i.IsPrimary === 'true' ? ' (Primary)' : '') + '</li>'; }).join('') + '</ul>' +
      // MESS never sees Dari/security/total-payable or the temp receipt (backend redacts
      // these fields to null/[] for that role — getTeamDetail_, spec §20) — the frontend
      // simply skips rendering the sections rather than showing a misleading "not yet" state.
      (user.role !== 'MESS'
        ? (data.charges
            ? '<p>' + [
                Number(data.charges.DariCharges) > 0 ? 'Dari: Rs ' + data.charges.DariCharges : null,
                Number(data.charges.SecurityCharges) > 0 ? 'Security: Rs ' + data.charges.SecurityCharges : null
              ].filter(function (s) { return s; }).join(' &middot; ') + '</p>'
            : '<p>Charges not yet calculated.</p>') +
          (receipt
            ? '<a href="https://drive.google.com/file/d/' + receipt.PdfFileId + '/view" target="_blank" rel="noopener"><button type="button">View Receipt</button></a>'
            : '<p>No receipt generated yet.</p>')
        : '') +
      '<button id="packages-btn" style="margin-top:12px">Food Packages</button>' +
```

- [ ] **Step 3: Bump the service worker cache**

In `frontend/service-worker.js`, change `'hpuick-shell-v13'` to `'hpuick-shell-v14'`.

- [ ] **Step 4: Manually verify end-to-end against the deployed backend**

```bash
cd "C:\Users\princ\Downloads\HPUICK\frontend"
npx http-server -p 5544 -c-1
```

As a REGISTRATION or ADMIN user, register a small test team and purchase a food package for
it (Phase 4's existing screen) to get a real coupon. As the MESS user: open Scan, confirm the
manual "Coupon ID" and "QR Token" lookups both resolve that package correctly (camera testing
requires a phone/webcam pointed at the printed/digital coupon — verify at least manual entry
here, camera separately on a device that has one); confirm the count field defaults to
Remaining, Confirm records usage and decrements Remaining on screen, and a count entered
above Remaining is rejected with a message stating the actual numbers. As MESS, open Teams →
that team's detail — confirm no Dari/Security/receipt line appears, but Food Packages still
works and the amount is visible there.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/mess.js frontend/js/registration.js frontend/service-worker.js
git commit -m "Phase 5: Scan screen (camera + manual entry) + Team Detail redaction for Mess

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XaHNhdFsr4nRrniGgw2gbJ"
```

---

## Done criteria

- `system.selfTestSplit` (both `{}` and `{"only":"slow"}`) reports 100% passing, including
  every test added by this plan.
- A MESS-role user can: see Current Meal + set order status; scan (camera or manual) a real
  purchased package's coupon and see Eligible/Served/Remaining; record a partial claim and see
  Remaining drop; be rejected with a clear message when claiming more than Remaining; see
  Today's Summary; find a team via Teams search and sell it a new package, resend, or reprint,
  seeing the package amount but never Dari/security/total charges or the temp receipt.
- Deploy: `cd backend && npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Phase 5 - Mess Committee panel"`.
