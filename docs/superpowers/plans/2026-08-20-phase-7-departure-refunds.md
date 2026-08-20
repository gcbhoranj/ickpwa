# Phase 7: Departure Lock, Food Refund, Security Refund Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registration can initiate a departure lock on a team, record manual (Mess-Convener-
discretion, not formula-driven) food refunds per meal entitlement, and record one NOC-gated
security refund — the three pieces of Phase 7's scope per spec §22.

**Architecture:** New `Departure.gs` backend module + new `departure.js` frontend screen,
reached from Team Detail. No schema changes — `TEAMS.DepartureLockedBy/At`, `REFUNDS`, and
`SECURITY_REFUNDS` were all already fully specified and created by earlier phases' `setupSchema`
runs, just never populated. No `SETTLEMENTS` row here — that's Phase 8 (final receipt).

**Tech Stack:** Same as every prior phase — Apps Script (V8), vanilla JS PWA, no new
dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` §22 (Phase 7
amendment, decided 2026-08-20 with the human partner after the cited original-prompt refund
formula turned out unrecoverable — refund amounts are the Mess Convener's discretion, entered
manually, not computed).

## Global Constraints

- Deployment ID: `AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI`. Web
  App URL: `https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`.
- **This deployment is pinned by version, not `@HEAD`** (confirmed live during Phase 6):
  `clasp push` alone updates the saved script but NOT what the Web App URL serves. Every
  backend verification step below requires `clasp deploy -i <id>` after `clasp push`, not push
  alone.
- **curl gotcha: never use `-L` with POST.** Capture the first hop's `Location` header, then
  issue a second plain GET:

  ```bash
  URL="https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec"
  call_action() {
    curl -s -D /tmp/hpuick_headers.txt -o /tmp/hpuick_body.json -X POST -H "Content-Type: text/plain" --data-raw "$1" "$URL"
    LOCATION=$(grep -i '^location:' /tmp/hpuick_headers.txt | sed 's/^[Ll]ocation: //' | tr -d '\r')
    if [ -n "$LOCATION" ]; then curl -s "$LOCATION"; else cat /tmp/hpuick_body.json; fi
  }
  ```
- **Role gating: `[ROLES.ADMIN, ROLES.REGISTRATION]` only for every `departure.*` action** —
  the spec's role matrix (§12) gives MESS/ACCOMMODATION no access at all here, unlike the
  Teams-list widening Phase 6 gave them.
- **Locking**: `initiateDeparture_`, `recordFoodRefund_`, `recordSecurityRefund_` all take
  `LockService.getScriptLock()` (matches every other counter/balance-touching handler in this
  codebase) and re-fetch the `TEAMS`/entitlement rows *inside* the lock, not before it —
  matches `reallocateRoom_`'s established pattern from Phase 6, not a stale pre-lock read.
- **Testing**: no new sheets/PDF generation needed for these tests — reuse `Tests.gs`'s
  existing `_makeMessTestFixture_`/`_cleanupMessTestFixture_` helpers (Phase 5) for a
  team+entitlements fixture, and write directly into `ACCOMMODATION_NOC` via `appendRow_` for
  the NOC-gating test rather than calling the real `issueNoc_` (that function's own PDF
  generation is already covered by Phase 6's `accommodation_issueNoc` test — this phase's
  tests only need the status gate, not another real Slides/Drive round trip). Both new tests
  join the `fast` tier.
- **Service worker cache versioning**: bump `CACHE_NAME` in `frontend/service-worker.js` from
  `v21` to `v22` and add `./js/departure.js` to `SHELL_FILES` (new file, unlike Phase 6's NOC
  screen which lived in an existing file).

---

## Task 1: `Departure.gs` — lock lifecycle, food refund, security refund

**Files:**
- Create: `backend/Departure.gs`
- Modify: `backend/Main.gs` (register five actions)
- Modify: `backend/Tests.gs` (two new tests, registered in `TEST_CASES`)

**Interfaces:**
- Produces (consumed by Task 2's frontend):
  - `initiateDeparture_(actorSession, teamId): {teamId, departureLockedBy, resumed}`
  - `cancelDeparture_(actorSession, teamId): {teamId, cancelled: true}`
  - `getDepartureOverview_(actorSession, teamId): {team, incharges, packages, entitlements:
    [{entitlementId, meal, date, rate, eligiblePersons, servedPersons, remainingPersons,
    mealOrderStatus, alreadyRefunded}], securityCharged, refunds, securityRefunds, nocStatus,
    departureLockedBy}`
  - `recordFoodRefund_(actorSession, teamId, entries: [{entitlementId, amount}]): {teamId,
    refundIds}` — zero/blank `amount` entries are silently skipped, not errors.
  - `recordSecurityRefund_(actorSession, teamId, amount): {teamId, securityRefundId, amount}`

- [ ] **Step 1: Write the failing tests**

In `backend/Tests.gs`, add after `test_registration_getTeamDetail_redactsFinancialsForAccommodation`:

```javascript
function test_departure_lockLifecycle() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const otherRegSession = { userId: 'USR-0002', role: ROLES.REGISTRATION, sessionId: 'y' };
  const adminSession = { userId: 'USR-0003', role: ROLES.ADMIN, sessionId: 'z' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'Departure Lock Test College', 'District', 3, [{ name: 'Coach', isPrimary: true }]);
    createdTeamId = team.teamId;

    const first = initiateDeparture_(regSession, createdTeamId);
    assertEqual_(first.departureLockedBy, 'USR-0001', 'lock should be held by the initiating user');
    assertEqual_(first.resumed, false, 'first initiate should not be a resume');

    const resumed = initiateDeparture_(regSession, createdTeamId);
    assertEqual_(resumed.resumed, true, 're-initiating by the same user should be an idempotent resume');

    let threwLocked = false;
    try { initiateDeparture_(otherRegSession, createdTeamId); } catch (err) { threwLocked = true; assertEqual_(err.code, 'DEPARTURE_LOCKED', 'wrong code for a departure locked by someone else'); }
    assertTrue_(threwLocked, 'initiateDeparture_ should reject a different user while locked');

    let threwForbidden = false;
    try { cancelDeparture_(otherRegSession, createdTeamId); } catch (err) { threwForbidden = true; assertEqual_(err.code, 'FORBIDDEN', 'wrong code for a non-holder, non-admin cancel'); }
    assertTrue_(threwForbidden, 'cancelDeparture_ should reject a non-holder, non-admin caller');

    const cancelledByAdmin = cancelDeparture_(adminSession, createdTeamId);
    assertTrue_(cancelledByAdmin.cancelled, 'Admin should be able to cancel any locked departure');

    const afterCancel = findRowById_('TEAMS', 'TeamId', createdTeamId);
    assertEqual_(afterCancel.values.DepartureLockedBy, '', 'lock fields should be cleared after cancel');

    const cancelAgain = cancelDeparture_(regSession, createdTeamId);
    assertTrue_(cancelAgain.cancelled, 'cancelling an already-unlocked team should be a safe no-op');
  } finally {
    if (createdTeamId) {
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}

function test_departure_fullRefundFlow() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const otherRegSession = { userId: 'USR-0002', role: ROLES.REGISTRATION, sessionId: 'y' };
  const accSession = { userId: 'USR-0003', role: ROLES.ACCOMMODATION, sessionId: 'z' };
  let fixture = null;
  let createdTeamId = null;
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 5);
    createdTeamId = fixture.teamId;

    let threwNotInitiated = false;
    try { recordFoodRefund_(regSession, createdTeamId, [{ entitlementId: fixture.entitlementIds[0], amount: 50 }]); } catch (err) { threwNotInitiated = true; assertEqual_(err.code, 'DEPARTURE_NOT_INITIATED', 'wrong code before departure is initiated'); }
    assertTrue_(threwNotInitiated, 'recordFoodRefund_ should require departure to be initiated first');

    initiateDeparture_(regSession, createdTeamId);

    let threwOtherLocked = false;
    try { recordFoodRefund_(otherRegSession, createdTeamId, [{ entitlementId: fixture.entitlementIds[0], amount: 50 }]); } catch (err) { threwOtherLocked = true; assertEqual_(err.code, 'DEPARTURE_LOCKED', 'wrong code for a caller who does not hold the lock'); }
    assertTrue_(threwOtherLocked, 'recordFoodRefund_ should reject a caller who does not hold this team\'s departure lock');

    const refunded = recordFoodRefund_(regSession, createdTeamId, [
      { entitlementId: fixture.entitlementIds[0], amount: 50 },
      { entitlementId: fixture.entitlementIds[1], amount: 0 }
    ]);
    assertEqual_(refunded.refundIds.length, 1, 'only the nonzero entry should create a REFUNDS row');

    const refundRow = findRowById_('REFUNDS', 'RefundId', refunded.refundIds[0]);
    assertEqual_(Number(refundRow.values.RefundAmount), 50, 'REFUNDS row should record the manually-entered amount, not a computed one');
    assertEqual_(refundRow.values.TeamId, createdTeamId, 'REFUNDS row should belong to the right team');

    const teamAfter = findRowById_('TEAMS', 'TeamId', createdTeamId);
    assertEqual_(teamAfter.values.Status, 'REFUND_PROCESSING', 'team status should flip to REFUND_PROCESSING after a successful food refund');

    let threwAlready = false;
    try { recordFoodRefund_(regSession, createdTeamId, [{ entitlementId: fixture.entitlementIds[0], amount: 25 }]); } catch (err) { threwAlready = true; assertEqual_(err.code, 'ALREADY_REFUNDED', 'wrong code for refunding the same entitlement twice'); }
    assertTrue_(threwAlready, 'recordFoodRefund_ should reject refunding the same entitlement twice');

    let threwGated = false;
    try { recordSecurityRefund_(regSession, createdTeamId, 100); } catch (err) { threwGated = true; assertEqual_(err.code, 'SECURITY_GATED_ON_NOC', 'wrong code before NOC is granted'); }
    assertTrue_(threwGated, 'recordSecurityRefund_ should require NOC to be granted first');

    // Grant NOC directly (bypassing real PDF generation — issueNoc_'s own Phase 6 test
    // already covers that; this test only needs the status gate).
    appendRow_('ACCOMMODATION_NOC', {
      NocId: nextId_('NOC', 4), TeamId: createdTeamId, Status: 'NOC_GRANTED',
      IssuedBy: accSession.userId, IssuedAt: new Date().toISOString(), Notes: '', PdfFileId: 'test-fixture-no-real-pdf'
    });

    const securityRefund = recordSecurityRefund_(regSession, createdTeamId, 100);
    assertTrue_(!!securityRefund.securityRefundId, 'recordSecurityRefund_ should create a SECURITY_REFUNDS row');

    let threwSecurityAlready = false;
    try { recordSecurityRefund_(regSession, createdTeamId, 50); } catch (err) { threwSecurityAlready = true; assertEqual_(err.code, 'ALREADY_REFUNDED', 'wrong code for a second security refund on the same team'); }
    assertTrue_(threwSecurityAlready, 'recordSecurityRefund_ should reject a second refund for the same team');

    const overview = getDepartureOverview_(regSession, createdTeamId);
    assertEqual_(overview.refunds.length, 1, 'overview should list the one food refund recorded');
    assertEqual_(overview.securityRefunds.length, 1, 'overview should list the one security refund recorded');
    assertEqual_(overview.nocStatus, 'NOC_GRANTED', 'overview should reflect the granted NOC');
    assertTrue_(overview.entitlements.some(function (e) { return e.entitlementId === fixture.entitlementIds[0] && e.alreadyRefunded; }), 'overview should flag the refunded entitlement');
  } finally {
    if (createdTeamId) {
      findRowsByField_('REFUNDS', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('REFUNDS', 'RefundId', r.RefundId); });
      findRowsByField_('SECURITY_REFUNDS', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('SECURITY_REFUNDS', 'SecurityRefundId', r.SecurityRefundId); });
      findRowsByField_('ACCOMMODATION_NOC', 'TeamId', createdTeamId).forEach(function (n) { deleteRowById_('ACCOMMODATION_NOC', 'NocId', n.NocId); });
    }
    if (fixture) _cleanupMessTestFixture_(fixture);
  }
}
```

Register in `TEST_CASES` (after `registration_getTeamDetail_redactsFinancialsForAccommodation`):

```javascript
  { name: 'departure_lockLifecycle', fn: test_departure_lockLifecycle },
  { name: 'departure_fullRefundFlow', fn: test_departure_fullRefundFlow },
```

- [ ] **Step 2: Push and verify both fail**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"departure_lockLifecycle"}}'
```

Expected: FAILs — `initiateDeparture_ is not defined` (push alone doesn't reach the live Web
App per Global Constraints — this failure is expected either way, from either the missing
function or the stale deployment; Step 4 deploys before the real pass/fail check).

- [ ] **Step 3: Create `backend/Departure.gs`**

```javascript
// Departure.gs — Phase 7: departure-lock lifecycle, food refund, security refund.
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §22.
// No SETTLEMENTS row here — that's Phase 8's job (final receipt generation).

function _requireDepartureLockHeldByCaller_(actorSession, team) {
  if (!team.values.DepartureLockedBy) {
    throw apiError_('DEPARTURE_NOT_INITIATED', 'Departure has not been initiated for this team yet.');
  }
  if (team.values.DepartureLockedBy !== actorSession.userId && actorSession.role !== ROLES.ADMIN) {
    throw apiError_('DEPARTURE_LOCKED', 'Departure processing is already in progress by ' + team.values.DepartureLockedBy + '.');
  }
}

function initiateDeparture_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    if (team.values.DepartureLockedBy && team.values.DepartureLockedBy !== actorSession.userId) {
      throw apiError_('DEPARTURE_LOCKED', 'Departure processing is already in progress by ' + team.values.DepartureLockedBy + '.');
    }
    if (team.values.DepartureLockedBy === actorSession.userId) {
      return { teamId: teamId, departureLockedBy: actorSession.userId, resumed: true };
    }
    const now = new Date().toISOString();
    updateRowById_('TEAMS', 'TeamId', teamId, { DepartureLockedBy: actorSession.userId, DepartureLockedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'INITIATE_DEPARTURE', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: 'DEPARTURE_INITIATED'
    });
    return { teamId: teamId, departureLockedBy: actorSession.userId, resumed: false };
  } finally {
    lock.releaseLock();
  }
}

function cancelDeparture_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    if (!team.values.DepartureLockedBy) {
      return { teamId: teamId, cancelled: true }; // idempotent: nothing to cancel
    }
    if (team.values.DepartureLockedBy !== actorSession.userId && actorSession.role !== ROLES.ADMIN) {
      throw apiError_('FORBIDDEN', 'Only ' + team.values.DepartureLockedBy + ' or an Admin can cancel this departure.');
    }
    const now = new Date().toISOString();
    updateRowById_('TEAMS', 'TeamId', teamId, { DepartureLockedBy: '', DepartureLockedAt: '', UpdatedBy: actorSession.userId, UpdatedAt: now });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'CANCEL_DEPARTURE', Entity: 'TEAM', EntityId: teamId, PreviousState: 'DEPARTURE_INITIATED', NewState: ''
    });
    return { teamId: teamId, cancelled: true };
  } finally {
    lock.releaseLock();
  }
}

function getDepartureOverview_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const refunds = findRowsByField_('REFUNDS', 'TeamId', teamId);
  const refundedEntitlementIds = {};
  refunds.forEach(function (r) { refundedEntitlementIds[r.EntitlementId] = true; });
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId)[0] || null;
  const nocStatus = getNocStatus_(actorSession, teamId);

  return {
    team: team.values,
    incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
    packages: findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId),
    entitlements: findRowsByField_('MEAL_ENTITLEMENTS', 'TeamId', teamId).map(function (e) {
      return {
        entitlementId: e.EntitlementId, meal: e.Meal, date: e.Date, rate: Number(e.Rate),
        eligiblePersons: Number(e.EligiblePersons), servedPersons: Number(e.ServedPersons),
        remainingPersons: Number(e.RemainingPersons), mealOrderStatus: e.MealOrderStatus,
        alreadyRefunded: !!refundedEntitlementIds[e.EntitlementId]
      };
    }),
    securityCharged: charges ? Number(charges.SecurityCharges) : 0,
    refunds: refunds,
    securityRefunds: findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId),
    nocStatus: nocStatus.status,
    departureLockedBy: team.values.DepartureLockedBy || null
  };
}

// entries with a zero/blank amount are silently skipped (the operator simply left that row
// alone), not treated as errors — matches the manual, per-row nature of this action.
function recordFoodRefund_(actorSession, teamId, entries) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!entries || entries.length === 0) throw apiError_('VALIDATION_ERROR', 'At least one refund entry is required.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    _requireDepartureLockHeldByCaller_(actorSession, team);

    const created = [];
    const now = new Date().toISOString();
    entries.forEach(function (entry) {
      const amount = Number(entry.amount);
      if (!amount || amount <= 0) return;
      const entitlement = findRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', entry.entitlementId);
      if (!entitlement || entitlement.values.TeamId !== teamId) {
        throw apiError_('NOT_FOUND', 'No such entitlement for this team: ' + entry.entitlementId);
      }
      const existing = findRowsByField_('REFUNDS', 'EntitlementId', entry.entitlementId)[0];
      if (existing) throw apiError_('ALREADY_REFUNDED', 'Entitlement ' + entry.entitlementId + ' has already been refunded.');

      const refundId = nextId_('REF', 5);
      appendRow_('REFUNDS', {
        RefundId: refundId, TeamId: teamId, EntitlementId: entry.entitlementId,
        Meal: entitlement.values.Meal, Date: entitlement.values.Date,
        EligiblePersons: entitlement.values.EligiblePersons, ServedPersons: entitlement.values.ServedPersons,
        MealOrderStatusAtCalc: entitlement.values.MealOrderStatus,
        RefundablePersons: Number(entitlement.values.EligiblePersons) - Number(entitlement.values.ServedPersons),
        RefundAmount: amount, CalculatedAt: now, ProcessedAt: now, ProcessedBy: actorSession.userId
      });
      created.push(refundId);
    });

    if (created.length > 0) {
      updateRowById_('TEAMS', 'TeamId', teamId, { Status: 'REFUND_PROCESSING', UpdatedBy: actorSession.userId, UpdatedAt: now });
      appendRow_('AUDIT_LOG', {
        AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
        Action: 'RECORD_FOOD_REFUND', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: created.join(',')
      });
    }
    return { teamId: teamId, refundIds: created };
  } finally {
    lock.releaseLock();
  }
}

function recordSecurityRefund_(actorSession, teamId, amount) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const refundAmount = Number(amount);
  if (!refundAmount || refundAmount <= 0) throw apiError_('VALIDATION_ERROR', 'Refund amount must be greater than 0.');

  const nocStatus = getNocStatus_(actorSession, teamId);
  if (nocStatus.status !== 'NOC_GRANTED') {
    throw apiError_('SECURITY_GATED_ON_NOC', 'Security refund requires the Accommodation NOC to be granted first.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    _requireDepartureLockHeldByCaller_(actorSession, team);

    const existing = findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId)[0];
    if (existing) throw apiError_('ALREADY_REFUNDED', 'A security refund has already been recorded for this team.');

    const nocRow = findRowsByField_('ACCOMMODATION_NOC', 'TeamId', teamId)[0];
    const securityRefundId = nextId_('SREF', 4);
    const now = new Date().toISOString();
    appendRow_('SECURITY_REFUNDS', {
      SecurityRefundId: securityRefundId, TeamId: teamId, Amount: refundAmount,
      NocId: nocRow ? nocRow.NocId : '', RefundedAt: now, RefundedBy: actorSession.userId, Ticked: 'true'
    });
    updateRowById_('TEAMS', 'TeamId', teamId, { Status: 'REFUND_PROCESSING', UpdatedBy: actorSession.userId, UpdatedAt: now });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'RECORD_SECURITY_REFUND', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: securityRefundId
    });
    return { teamId: teamId, securityRefundId: securityRefundId, amount: refundAmount };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 4: Register five actions in `backend/Main.gs`'s `ACTIONS` table**

Change the end of the `ACTIONS` object literal from:

```javascript
  'accommodation.noc.issue': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return issueNoc_(session, payload.teamId);
  }
};
```

to:

```javascript
  'accommodation.noc.issue': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return issueNoc_(session, payload.teamId);
  },
  'departure.initiate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return initiateDeparture_(session, payload.teamId);
  },
  'departure.cancel': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return cancelDeparture_(session, payload.teamId);
  },
  'departure.overview': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getDepartureOverview_(session, payload.teamId);
  },
  'departure.recordFoodRefund': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return recordFoodRefund_(session, payload.teamId, payload.entries || []);
  },
  'departure.recordSecurityRefund': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return recordSecurityRefund_(session, payload.teamId, payload.amount);
  }
};
```

- [ ] **Step 5: Push, deploy a new version, and verify both new tests pass**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Phase 7: departure lock, food refund, security refund"
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"departure_lockLifecycle"}}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"departure_fullRefundFlow"}}'
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: both named tests report `"status":"PASS"`; the full `fast` tier reports every
previously-passing test still passing, plus these two (2 pre-existing/environmental failures
from `calculateCharges_`/receipt tests may still appear — those are unrelated to this phase,
noted already in the Phase 6 dev-log entry; do not attempt to fix them here).

- [ ] **Step 6: Commit**

```bash
git add backend/Departure.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 7: Departure.gs - lock lifecycle, food refund, security refund

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```

---

## Task 2: Frontend — Departure screen

**Files:**
- Create: `frontend/js/departure.js`
- Modify: `frontend/js/registration.js` (`renderTeamDetail` gains a "Process Departure" button
  for the REGISTRATION role)
- Modify: `frontend/index.html` (add the new script tag)
- Modify: `frontend/service-worker.js` (bump `CACHE_NAME`, add `departure.js` to `SHELL_FILES`)

**Interfaces:**
- Consumes: `departure.initiate`, `departure.cancel`, `departure.overview`,
  `departure.recordFoodRefund`, `departure.recordSecurityRefund` (Task 1), `apiCall`,
  `navigateTo`, `goBack` (all already global).

- [ ] **Step 1: Create `frontend/js/departure.js`**

```javascript
// departure.js — Phase 7: Departure screen (Registration role only). Shows the departure-lock
// state, meal-entitlement reference data (Eligible/Served/Remaining/MealOrderStatus — no
// formula applied, refund amounts are the Mess Convener's discretion per spec §22), a manual
// per-entitlement food-refund entry form, and the NOC-gated security-refund action.

async function renderDepartureScreen(root, user, teamId, registrationNumber, collegeName) {
  root.innerHTML = '<div class="wizard-card"><h1>Process Departure</h1><p>Loading…</p></div>';
  let overview = await apiCall('departure.overview', { teamId: teamId });

  if (!overview.departureLockedBy) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Process Departure</h1>' +
        '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + '</p>' +
        '<div id="departure-error" class="error" style="display:none"></div>' +
        '<button id="initiate-btn">Process Departure</button>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';
    document.getElementById('initiate-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('departure-error');
      errEl.style.display = 'none';
      try {
        await apiCall('departure.initiate', { teamId: teamId });
        overview = await apiCall('departure.overview', { teamId: teamId });
        renderInProgress();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
    return;
  }

  renderInProgress();

  function renderInProgress() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Process Departure</h1>' +
        '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + ' &middot; ' + overview.team.Status + '</p>' +
        '<div id="departure-error" class="error" style="display:none"></div>' +
        '<h2>Meal Entitlements (reference only — refund amount is your judgment call)</h2>' +
        '<table><thead><tr><th>Date</th><th>Meal</th><th>Eligible</th><th>Served</th><th>Remaining</th><th>Order Status</th><th>Refund Amount</th></tr></thead><tbody>' +
          overview.entitlements.map(function (e) {
            return '<tr><td>' + e.date + '</td><td>' + e.meal + '</td><td>' + e.eligiblePersons + '</td><td>' + e.servedPersons + '</td><td>' + e.remainingPersons + '</td><td>' + e.mealOrderStatus + '</td>' +
              '<td>' + (e.alreadyRefunded ? 'Refunded' : '<input type="number" min="0" class="food-refund-input" data-entid="' + e.entitlementId + '" value="0">') + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        '<button id="submit-food-refund-btn" style="margin-top:8px">Record Food Refund</button>' +
        '<h2 style="margin-top:16px">Security Refund</h2>' +
        '<p>Charged: Rs ' + overview.securityCharged + ' &middot; NOC: ' + overview.nocStatus + '</p>' +
        (overview.securityRefunds.length > 0
          ? '<p>Security refund recorded: Rs ' + overview.securityRefunds[0].Amount + '</p>'
          : (overview.nocStatus === 'NOC_GRANTED'
              ? '<label>Amount<input type="number" id="security-refund-amount" min="0" value="' + overview.securityCharged + '"></label><button id="submit-security-refund-btn">Record Security Refund</button>'
              : '<p>NOC not yet granted — security refund unavailable.</p>')) +
        '<button id="cancel-departure-btn" style="margin-top:16px;background:#999">Cancel Departure</button>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';

    document.getElementById('submit-food-refund-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('departure-error');
      errEl.style.display = 'none';
      const entries = Array.prototype.map.call(document.querySelectorAll('.food-refund-input'), function (input) {
        return { entitlementId: input.getAttribute('data-entid'), amount: Number(input.value) };
      }).filter(function (e) { return e.amount > 0; });
      if (entries.length === 0) return;
      try {
        await apiCall('departure.recordFoodRefund', { teamId: teamId, entries: entries });
        overview = await apiCall('departure.overview', { teamId: teamId });
        renderInProgress();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    if (document.getElementById('submit-security-refund-btn')) {
      document.getElementById('submit-security-refund-btn').addEventListener('click', async function () {
        const errEl = document.getElementById('departure-error');
        errEl.style.display = 'none';
        try {
          await apiCall('departure.recordSecurityRefund', { teamId: teamId, amount: Number(document.getElementById('security-refund-amount').value) });
          overview = await apiCall('departure.overview', { teamId: teamId });
          renderInProgress();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    }

    document.getElementById('cancel-departure-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('departure-error');
      errEl.style.display = 'none';
      try {
        await apiCall('departure.cancel', { teamId: teamId });
        goBack();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
```

- [ ] **Step 2: Add the "Process Departure" button to `renderTeamDetail` in `frontend/js/registration.js`**

Change:

```javascript
      (user.role !== 'ACCOMMODATION' ? '<button id="packages-btn" style="margin-top:12px">Food Packages</button>' : '') +
      (user.role === 'ACCOMMODATION' ? '<button id="noc-btn" style="margin-top:12px">Accommodation NOC</button>' : '') +
      '<button id="back-btn" style="margin-top:12px">Back to Teams</button>' +
    '</div>';
  if (document.getElementById('packages-btn')) {
    document.getElementById('packages-btn').addEventListener('click', function () {
      navigateTo(renderPackagesScreen, root, user, teamId, data.team.RegistrationNumber, data.incharges);
    });
  }
  if (document.getElementById('noc-btn')) {
    document.getElementById('noc-btn').addEventListener('click', function () {
      navigateTo(renderNocScreen, root, user, teamId, data.team.RegistrationNumber, data.team.CollegeName);
    });
  }
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}
```

to:

```javascript
      (user.role !== 'ACCOMMODATION' ? '<button id="packages-btn" style="margin-top:12px">Food Packages</button>' : '') +
      (user.role === 'ACCOMMODATION' ? '<button id="noc-btn" style="margin-top:12px">Accommodation NOC</button>' : '') +
      (user.role === 'REGISTRATION' ? '<button id="departure-btn" style="margin-top:12px">Process Departure</button>' : '') +
      '<button id="back-btn" style="margin-top:12px">Back to Teams</button>' +
    '</div>';
  if (document.getElementById('packages-btn')) {
    document.getElementById('packages-btn').addEventListener('click', function () {
      navigateTo(renderPackagesScreen, root, user, teamId, data.team.RegistrationNumber, data.incharges);
    });
  }
  if (document.getElementById('noc-btn')) {
    document.getElementById('noc-btn').addEventListener('click', function () {
      navigateTo(renderNocScreen, root, user, teamId, data.team.RegistrationNumber, data.team.CollegeName);
    });
  }
  if (document.getElementById('departure-btn')) {
    document.getElementById('departure-btn').addEventListener('click', function () {
      navigateTo(renderDepartureScreen, root, user, teamId, data.team.RegistrationNumber, data.team.CollegeName);
    });
  }
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}
```

- [ ] **Step 3: Add the script tag to `frontend/index.html`**

Change:

```html
  <script src="js/mess.js"></script>
  <script src="js/app.js"></script>
```

to:

```html
  <script src="js/mess.js"></script>
  <script src="js/departure.js"></script>
  <script src="js/app.js"></script>
```

- [ ] **Step 4: Bump the service worker in `frontend/service-worker.js`**

Change:

```javascript
const CACHE_NAME = 'hpuick-shell-v21';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/packages.js', './js/settings.js', './js/rooms.js', './js/accommodation.js',
  './js/mess.js', './js/app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];
```

to:

```javascript
const CACHE_NAME = 'hpuick-shell-v22';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/packages.js', './js/settings.js', './js/rooms.js', './js/accommodation.js',
  './js/mess.js', './js/departure.js', './js/app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];
```

- [ ] **Step 5: Commit and deploy the frontend**

```bash
cd "C:\Users\princ\Downloads\HPUICK"
git add frontend/js/departure.js frontend/js/registration.js frontend/index.html frontend/service-worker.js
git commit -m "Phase 7: frontend — Departure screen (lock, food refund, security refund)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
git subtree push --prefix=frontend frontend-origin main
```

---

## Task 3: Dev-log entry

**Files:**
- Modify: `docs/superpowers/dev-log.md`

- [ ] **Step 1: Write the entry**

Append to `docs/superpowers/dev-log.md`, following the existing entries' format: summarize the
refund-formula-unrecoverable finding and the human's discretion-based decision, the
departure-lock design, the two idempotency guards (`ALREADY_REFUNDED` for both refund types),
the role-gating narrowing vs. Phase 6, and the actual live `fast`-tier test totals from Task
1's Step 5 (do not guess the numbers — read them from that live result).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/dev-log.md
git commit -m "Phase 7: dev log entry — departure lock, food refund, security refund

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```
