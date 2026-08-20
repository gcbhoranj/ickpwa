# Phase 6: Accommodation — Reallocate, Vacate, NOC Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Accommodation role's remaining scope from the spec's Phase 6: reallocate
and vacate an existing room allocation, and issue an Accommodation NOC (status flip + generated
PDF certificate) — closing out the allocate-only narrowing Phase 3.5 deliberately left open.

**Architecture:** Pure extension of existing code — no new subsystem. `Accommodation.gs` gains
`vacateRoom_`/`reallocateRoom_`/`listActiveAccommodation_` alongside its existing
`allocateRoom_`. A new `Noc.gs` (same Slides-copy-and-render pattern `Receipts.gs` already uses)
adds NOC certificate generation against the `ACCOMMODATION_NOC` sheet the schema already
reserves but has never populated. `Registration.gs`'s `listTeams_`/`getTeamDetail_` widen to the
`ACCOMMODATION` role with the same financial redaction Phase 5 already gave `MESS`. Frontend:
`accommodation.js` gains an active-allocations section (Reallocate/Vacate) and a new NOC screen;
`registration.js`'s Team Detail gains a Grant-NOC entry point for the Accommodation role.

**Tech Stack:** Same as every prior phase — Apps Script (V8), vanilla JS PWA, Slides→PDF via
`SlidesApp`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` — this plan
implements §21 (Phase 6 amendment, decided 2026-08-20 with the human partner): allocation stays
per-team/per-incharge (not per-team-member), and NOC issuance is both the schema's
`PENDING`/`NOC_GRANTED` status flip and a generated PDF certificate.

## Global Constraints

- Deployment ID (reuse for every `clasp deploy -i <id>`, do not create a new one):
  `AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI`. Web App URL:
  `https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`.
- **curl gotcha: never use `-L` with POST.** Capture the first hop's `Location` header, then
  issue a second plain GET. Use this helper for every backend verification step (run once per
  shell session):

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
- **Schema changes take effect only after re-running `admin.bootstrap.setupSchema` against the
  live Sheet** — `ensureSheet_` rewrites row 1 whenever the stored header row doesn't match
  `SHEET_SCHEMAS` (checked, not assumed — see `backend/SheetHelpers.gs:9-29`), which is how
  every prior phase's new columns landed on the live production Sheet. Every task below that
  changes `SHEET_SCHEMAS` must re-run it after pushing.
- **Idempotency, decided per-action (not uniform) based on real duplication risk** — the
  established lesson from the duplicate-purchase bug (dev-log 2026-08-20): a genuine risk gets
  a `ClientRequestId` guard, a merely-repeatable status flip does not need one.
  - `vacateRoom_`: naturally idempotent — flipping an already-`VACATED` row again is a no-op
    (no new row, no double-decrement possible since capacity is always summed live from
    currently-`ALLOCATED` rows). No `ClientRequestId` needed.
  - `reallocateRoom_`: creates a **new** `ACCOMMODATION` row (via `allocateRoom_`), so a retry
    could double-allocate into the new room. Gets a `ClientRequestId` guard (new column), same
    shape as `FOOD_PACKAGES`' existing one.
  - `issueNoc_`: finds-or-creates a single `ACCOMMODATION_NOC` row per team; granting an
    already-`NOC_GRANTED` team returns the existing certificate rather than regenerating or
    erroring. No `ClientRequestId` needed (no duplicate-row risk by construction).
- **Role gating for this phase's write actions matches `allocateRoom_`'s existing convention in
  the same file — `[ROLES.ACCOMMODATION]` only, no ADMIN override** (unlike `Mess.gs`'s
  `[ADMIN, MESS]` pattern — follow the sibling function in the same file, not a different
  file's convention): `vacateRoom_`, `reallocateRoom_`, `issueNoc_`. Read actions match
  `listPendingAccommodation_`'s existing `[ADMIN, REGISTRATION, ACCOMMODATION]`:
  `listActiveAccommodation_`, `getNocStatus_`. `createNocTemplate_` matches
  `createTemporaryReceiptTemplate_`'s `[ADMIN]`-only gate.
- **Service worker cache versioning: bump `CACHE_NAME` in `frontend/service-worker.js` on the
  frontend task.** Current value is `'hpuick-shell-v20'`; this phase's one frontend task bumps
  it to `v21`. No new frontend file is added (NOC screen lives in the existing
  `accommodation.js`), so `SHELL_FILES` itself does not change.
- **Testing tiers: no new tier.** Per the cost-based rationale that created the
  `fast`/`mess`/`pdf1`/`pdf2` split (Sheets-only work and real document generation don't scale
  the same way): the vacate/reallocate and redacted-team-access tests are cheap Sheets round
  trips → `fast` (join `rooms_createAndList`/`accommodation_listPendingAndAllocateRoom`); the
  NOC-issuance test does real Slides/Drive PDF generation → `pdf2`.

---

## Task 1: `Accommodation.gs` — vacate, reallocate, list active allocations

**Files:**
- Modify: `backend/Constants.gs` (add `ClientRequestId` to the `ACCOMMODATION` schema array)
- Modify: `backend/Accommodation.gs` (add three functions)
- Modify: `backend/Main.gs` (register three actions)
- Modify: `backend/Tests.gs` (one new test, registered in `TEST_CASES`)

**Interfaces:**
- Produces (consumed by Task 4's frontend):
  - `listActiveAccommodation_(actorSession, kind): [{allocationId, teamId, registrationNumber,
    collegeName, roomId, roomNumber, building, personsAllocated, allocatedAt}]`
  - `vacateRoom_(actorSession, allocationId): {allocationId, roomId, status: 'VACATED'}`
  - `reallocateRoom_(actorSession, allocationId, newRoomId, clientRequestId): {allocationId,
    teamId, roomId, personsAllocated, kind}` — `allocationId` in the response is the **new**
    allocation's ID, not the one passed in.

- [ ] **Step 1: Write the failing test**

In `backend/Tests.gs`, add after `test_accommodation_teamMemberAllocation`:

```javascript
function test_accommodation_vacateAndReallocate() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const adminSession = { userId: 'USR-0001', role: ROLES.ADMIN, sessionId: 'w' };
  const accSession = { userId: 'USR-0001', role: ROLES.ACCOMMODATION, sessionId: 'z' };
  const marker = 'TEST-REALLOC-' + new Date().getTime();
  let createdTeamId = null;
  let roomAId = null, roomBId = null;
  try {
    const team = registerTeam_(regSession, 'Reallocation Test College', 'District', 4, [{ name: 'Coach', isPrimary: true }]);
    createdTeamId = team.teamId;
    const roomA = createRoom_(adminSession, marker + '-A', 'Hostel A', '1', 4, ROOM_TYPES.TEAM);
    roomAId = roomA.roomId;
    const roomB = createRoom_(adminSession, marker + '-B', 'Hostel B', '1', 4, ROOM_TYPES.TEAM);
    roomBId = roomB.roomId;

    const allocation = allocateRoom_(accSession, createdTeamId, roomAId, 4, ROOM_TYPES.TEAM);
    assertEqual_(listRooms_(accSession).filter(function (r) { return r.roomId === roomAId; })[0].remaining, 0, 'room A should be fully allocated');

    const active = listActiveAccommodation_(accSession, ROOM_TYPES.TEAM).filter(function (a) { return a.teamId === createdTeamId; });
    assertEqual_(active.length, 1, 'listActiveAccommodation_ should show the one active allocation');
    assertEqual_(active[0].roomId, roomAId, 'listActiveAccommodation_ should report the correct room');

    // Vacate: room A frees up, allocation flips to VACATED, idempotent on repeat.
    const vacated = vacateRoom_(accSession, allocation.allocationId);
    assertEqual_(vacated.status, 'VACATED', 'vacateRoom_ should report VACATED');
    assertEqual_(listRooms_(accSession).filter(function (r) { return r.roomId === roomAId; })[0].remaining, 4, 'room A should be fully freed after vacating');
    const vacatedAgain = vacateRoom_(accSession, allocation.allocationId);
    assertEqual_(vacatedAgain.status, 'VACATED', 'vacating an already-vacated allocation should be a safe no-op, not an error');

    let threwForbidden = false;
    try { vacateRoom_(regSession, allocation.allocationId); } catch (err) { threwForbidden = true; assertEqual_(err.code, 'FORBIDDEN', 'wrong code for non-Accommodation caller'); }
    assertTrue_(threwForbidden, 'vacateRoom_ did not reject a non-Accommodation caller');

    // Reallocate a fresh allocation from room A into room B, with a duplicate-retry guard.
    const fresh = allocateRoom_(accSession, createdTeamId, roomAId, 4, ROOM_TYPES.TEAM);
    const realloc1 = reallocateRoom_(accSession, fresh.allocationId, roomBId, 'realloc-req-1');
    assertEqual_(realloc1.roomId, roomBId, 'reallocateRoom_ should move the allocation into the new room');
    assertEqual_(listRooms_(accSession).filter(function (r) { return r.roomId === roomAId; })[0].remaining, 4, 'old room should be freed after reallocation');
    assertEqual_(listRooms_(accSession).filter(function (r) { return r.roomId === roomBId; })[0].remaining, 0, 'new room should now be fully allocated');

    // Retry with the same clientRequestId (simulating the frontend's automatic retry-on-
    // transient-glitch behavior, api-client.js) must not create a second allocation in room B.
    const realloc1Replay = reallocateRoom_(accSession, fresh.allocationId, roomBId, 'realloc-req-1');
    assertEqual_(realloc1Replay.allocationId, realloc1.allocationId, 'a replayed reallocation should return the original result, not create a new one');
    assertEqual_(listActiveAccommodation_(accSession, ROOM_TYPES.TEAM).filter(function (a) { return a.teamId === createdTeamId; }).length, 1, 'a replayed reallocation must not leave two active allocations for the same team');
  } finally {
    if (createdTeamId) {
      findRowsByField_('ACCOMMODATION', 'TeamId', createdTeamId).forEach(function (a) { deleteRowById_('ACCOMMODATION', 'AllocationId', a.AllocationId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
    if (roomAId) deleteRowById_('ROOMS', 'RoomId', roomAId);
    if (roomBId) deleteRowById_('ROOMS', 'RoomId', roomBId);
  }
}
```

Register in `TEST_CASES` (after `accommodation_teamMemberAllocation`):

```javascript
  { name: 'accommodation_vacateAndReallocate', fn: test_accommodation_vacateAndReallocate },
```

- [ ] **Step 2: Push and verify it fails**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"accommodation_vacateAndReallocate"}}'
```

Expected: FAILs — `listActiveAccommodation_ is not defined`.

- [ ] **Step 3: Add `ClientRequestId` to the `ACCOMMODATION` schema**

In `backend/Constants.gs`, change:

```javascript
  ACCOMMODATION: ['AllocationId', 'TeamId', 'RoomId', 'PersonsAllocated', 'AllocatedAt',
    'VacatedAt', 'Status', 'CreatedBy', 'UpdatedBy', 'UpdatedAt', 'SubjectType'],
```

to:

```javascript
  ACCOMMODATION: ['AllocationId', 'TeamId', 'RoomId', 'PersonsAllocated', 'AllocatedAt',
    'VacatedAt', 'Status', 'CreatedBy', 'UpdatedBy', 'UpdatedAt', 'SubjectType', 'ClientRequestId'],
```

- [ ] **Step 4: Add the three functions to `backend/Accommodation.gs`**

Append to the end of the file:

```javascript
function listActiveAccommodation_(actorSession, kind) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.ACCOMMODATION]);
  if (kind !== ROOM_TYPES.TEAM && kind !== ROOM_TYPES.INCHARGE) {
    throw apiError_('VALIDATION_ERROR', 'kind must be TEAM or INCHARGE.');
  }
  const teams = rowsToObjects_('TEAMS');
  const rooms = rowsToObjects_('ROOMS');
  return rowsToObjects_('ACCOMMODATION')
    .filter(function (a) { return a.Status === 'ALLOCATED' && a.SubjectType === kind; })
    .map(function (a) {
      const team = teams.filter(function (t) { return t.TeamId === a.TeamId; })[0];
      const room = rooms.filter(function (r) { return r.RoomId === a.RoomId; })[0];
      return {
        allocationId: a.AllocationId, teamId: a.TeamId,
        registrationNumber: team ? team.RegistrationNumber : '', collegeName: team ? team.CollegeName : '',
        roomId: a.RoomId, roomNumber: room ? room.RoomNumber : '', building: room ? room.Building : '',
        personsAllocated: Number(a.PersonsAllocated), allocatedAt: a.AllocatedAt
      };
    });
}

// Idempotent by construction: capacity is always summed live from currently-ALLOCATED rows
// (Rooms.gs's listRooms_), so flipping an already-VACATED row again changes nothing and is a
// safe no-op — unlike a financial action, vacating twice has no different effect than once.
function vacateRoom_(actorSession, allocationId) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  const alloc = findRowById_('ACCOMMODATION', 'AllocationId', allocationId);
  if (!alloc) throw apiError_('NOT_FOUND', 'No such allocation: ' + allocationId);
  if (alloc.values.Status === 'VACATED') {
    return { allocationId: allocationId, roomId: alloc.values.RoomId, status: 'VACATED' };
  }

  const now = new Date().toISOString();
  updateRowById_('ACCOMMODATION', 'AllocationId', allocationId, {
    Status: 'VACATED', VacatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });

  const room = findRowById_('ROOMS', 'RoomId', alloc.values.RoomId);
  if (room && room.values.Status === 'FULL') {
    updateRowById_('ROOMS', 'RoomId', alloc.values.RoomId, { Status: 'AVAILABLE', UpdatedBy: actorSession.userId, UpdatedAt: now });
  }

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'VACATE_ROOM', Entity: 'ACCOMMODATION', EntityId: allocationId, PreviousState: 'ALLOCATED', NewState: 'VACATED'
  });

  return { allocationId: allocationId, roomId: alloc.values.RoomId, status: 'VACATED' };
}

// Vacate + allocate composed under one lock (not two independent calls) — a retry carrying the
// same clientRequestId short-circuits to the ORIGINAL new allocation instead of creating a
// second one, the same class of protection FOOD_PACKAGES' purchasePackage_ needed after the
// 2026-08-20 duplicate-purchase bug (dev-log). Reuses allocateRoom_'s own capacity/room-type
// checks rather than duplicating them.
function reallocateRoom_(actorSession, allocationId, newRoomId, clientRequestId) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  if (clientRequestId) {
    const dup = findRowsByField_('ACCOMMODATION', 'ClientRequestId', clientRequestId)[0];
    if (dup) {
      return { allocationId: dup.AllocationId, teamId: dup.TeamId, roomId: dup.RoomId, personsAllocated: Number(dup.PersonsAllocated), kind: dup.SubjectType };
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const alloc = findRowById_('ACCOMMODATION', 'AllocationId', allocationId);
    if (!alloc) throw apiError_('NOT_FOUND', 'No such allocation: ' + allocationId);
    if (alloc.values.Status !== 'ALLOCATED') {
      throw apiError_('ALREADY_VACATED', 'This allocation has already been vacated — nothing to reallocate.');
    }
    if (newRoomId === alloc.values.RoomId) {
      throw apiError_('VALIDATION_ERROR', 'New room must be different from the current room.');
    }

    vacateRoom_(actorSession, allocationId);
    const fresh = allocateRoom_(actorSession, alloc.values.TeamId, newRoomId, Number(alloc.values.PersonsAllocated), alloc.values.SubjectType);
    if (clientRequestId) {
      updateRowById_('ACCOMMODATION', 'AllocationId', fresh.allocationId, { ClientRequestId: clientRequestId });
    }
    return fresh;
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 5: Register the three actions in `backend/Main.gs`'s `ACTIONS` table**

Change the end of the `ACTIONS` object literal from:

```javascript
  'mess.todaysSummary': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getTodaysMessSummary_(session);
  }
};
```

to:

```javascript
  'mess.todaysSummary': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getTodaysMessSummary_(session);
  },
  'accommodation.listActive': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { allocations: listActiveAccommodation_(session, payload.kind) };
  },
  'accommodation.vacateRoom': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return vacateRoom_(session, payload.allocationId);
  },
  'accommodation.reallocateRoom': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return reallocateRoom_(session, payload.allocationId, payload.newRoomId, requestId);
  }
};
```

- [ ] **Step 6: Push, re-run schema setup, and verify the test passes**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"admin.bootstrap.setupSchema","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"accommodation_vacateAndReallocate"}}'
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: the setup call includes `"ACCOMMODATION"` in `sheetsEnsured`; the named test reports
`"status":"PASS"`; the full `fast` tier still reports every previously-passing test passing,
plus this one.

- [ ] **Step 7: Commit**

```bash
git add backend/Constants.gs backend/Accommodation.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 6: Accommodation.gs vacate/reallocate + listActiveAccommodation_

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```

---

## Task 2: `Noc.gs` — NOC status + certificate generation

**Files:**
- Modify: `backend/Constants.gs` (add `PdfFileId` to `ACCOMMODATION_NOC`)
- Modify: `backend/Setup.gs` (pre-create the `Accommodation/NOC Certificates` Drive subfolder)
- Create: `backend/Noc.gs`
- Modify: `backend/Main.gs` (register three actions)
- Modify: `backend/Tests.gs` (one new test, registered in `TEST_CASES`)

**Interfaces:**
- Consumes: `_ensureSubfolder_`, `_getRootFolder_`, `_clearSlide_` (all from `Receipts.gs`,
  already global in Apps Script's single-namespace model), `nextDocumentNumber_('Accommodation')`
  (uses the `Numbering_Accommodation_*` settings seeded since Phase 1, never consumed until now).
- Produces (consumed by Task 4's frontend):
  - `getNocStatus_(actorSession, teamId): {teamId, status: 'PENDING'|'NOC_GRANTED', pdfFileId,
    pdfUrl, issuedBy, issuedAt}`
  - `issueNoc_(actorSession, teamId): {nocId, teamId, status: 'NOC_GRANTED', pdfFileId, pdfUrl}`
  - `createNocTemplate_(actorSession, force): {templateId, created}`

- [ ] **Step 1: Write the failing test**

In `backend/Tests.gs`, add after `test_accommodation_vacateAndReallocate`:

```javascript
function test_accommodation_issueNoc() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const accSession = { userId: 'USR-0001', role: ROLES.ACCOMMODATION, sessionId: 'z' };
  let createdTeamId = null;
  let pdfFileIdToTrash = null;
  try {
    const team = registerTeam_(regSession, 'NOC Test College', 'District', 3, [{ name: 'Coach', isPrimary: true }]);
    createdTeamId = team.teamId;

    const before = getNocStatus_(accSession, createdTeamId);
    assertEqual_(before.status, 'PENDING', 'a team with no NOC row yet should report PENDING');

    let threwForbidden = false;
    try { issueNoc_(regSession, createdTeamId); } catch (err) { threwForbidden = true; assertEqual_(err.code, 'FORBIDDEN', 'wrong code for non-Accommodation caller'); }
    assertTrue_(threwForbidden, 'issueNoc_ did not reject a non-Accommodation caller');

    const granted = issueNoc_(accSession, createdTeamId);
    pdfFileIdToTrash = granted.pdfFileId;
    assertEqual_(granted.status, 'NOC_GRANTED', 'issueNoc_ should report NOC_GRANTED');
    assertTrue_(!!granted.pdfFileId, 'issueNoc_ should generate a real PDF file');

    const after = getNocStatus_(accSession, createdTeamId);
    assertEqual_(after.status, 'NOC_GRANTED', 'getNocStatus_ should reflect the granted NOC');
    assertEqual_(after.pdfFileId, granted.pdfFileId, 'getNocStatus_ should surface the same PDF');

    // Idempotent: granting again returns the same certificate, does not regenerate.
    const regranted = issueNoc_(accSession, createdTeamId);
    assertEqual_(regranted.pdfFileId, granted.pdfFileId, 'granting an already-granted NOC should return the existing certificate, not a new one');
    assertEqual_(findRowsByField_('ACCOMMODATION_NOC', 'TeamId', createdTeamId).length, 1, 'exactly one ACCOMMODATION_NOC row should exist even after a repeat grant');
  } finally {
    if (pdfFileIdToTrash) DriveApp.getFileById(pdfFileIdToTrash).setTrashed(true);
    if (createdTeamId) {
      findRowsByField_('ACCOMMODATION_NOC', 'TeamId', createdTeamId).forEach(function (n) { deleteRowById_('ACCOMMODATION_NOC', 'NocId', n.NocId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}
```

Register in `TEST_CASES` (after `accommodation_vacateAndReallocate`, in the `pdf2` block
alongside `foodPackages_mealExclusion_lateArrivalScenario`):

```javascript
  { name: 'accommodation_issueNoc', fn: test_accommodation_issueNoc, tier: 'pdf2' },
```

- [ ] **Step 2: Push and verify it fails**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"accommodation_issueNoc"}}'
```

Expected: FAILs — `getNocStatus_ is not defined`.

- [ ] **Step 3: Add `PdfFileId` to the `ACCOMMODATION_NOC` schema**

In `backend/Constants.gs`, change:

```javascript
  ACCOMMODATION_NOC: ['NocId', 'TeamId', 'Status', 'IssuedBy', 'IssuedAt', 'Notes'],
```

to:

```javascript
  ACCOMMODATION_NOC: ['NocId', 'TeamId', 'Status', 'IssuedBy', 'IssuedAt', 'Notes', 'PdfFileId'],
```

- [ ] **Step 4: Pre-create the NOC certificates Drive subfolder in `backend/Setup.gs`**

In `setupDriveFolders_`'s `structure` object, change:

```javascript
    Accommodation: _ensureSubfolder_(root, 'Accommodation'),
```

to:

```javascript
    Accommodation: _ensureSubfolder_(root, 'Accommodation'),
    'Accommodation/NOC Certificates': _ensureSubfolder_(_ensureSubfolder_(root, 'Accommodation'), 'NOC Certificates'),
```

- [ ] **Step 5: Create `backend/Noc.gs`**

```javascript
// Noc.gs — Phase 6: Accommodation NOC (No Objection Certificate) status + generation.
// ACCOMMODATION_NOC (spec §5) was reserved since Phase 1 but never populated until now — its
// Status (PENDING/NOC_GRANTED) is what Phase 7's security refund will gate on; granting it
// also produces a one-page PDF certificate via the same Slides-copy-and-render pattern
// Receipts.gs uses for the temporary receipt (_ensureSubfolder_/_getRootFolder_/_clearSlide_
// are that file's, already global in Apps Script's single-namespace model).
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §21.

function _buildNocLayout_(pres, data) {
  const slide = pres.getSlides()[0];
  _clearSlide_(slide);
  if (!data) return slide; // template-setup call: leave the page blank, just holding its size

  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();
  const margin = pageWidth * 0.08;
  const contentWidth = pageWidth - margin * 2;
  let y = pageHeight * 0.05;

  function addLine(text, heightFraction, fontSize, opts) {
    const box = slide.insertTextBox(text, margin, y, contentWidth, pageHeight * heightFraction);
    const style = box.getText().getTextStyle().setFontSize(fontSize);
    if (opts && opts.bold) style.setBold(true);
    box.getText().getParagraphStyle().setParagraphAlignment(
      opts && opts.left ? SlidesApp.ParagraphAlignment.START : SlidesApp.ParagraphAlignment.CENTER
    );
    y += pageHeight * heightFraction;
    return box;
  }

  addLine(data.tournamentName, 0.05, 12, { bold: true });
  addLine(data.organizer, 0.03, 9, {});
  y += pageHeight * 0.03;
  addLine('NO OBJECTION CERTIFICATE', 0.06, 14, { bold: true });
  y += pageHeight * 0.03;
  addLine('NOC No: ' + data.nocNumber, 0.03, 9, { left: true });
  addLine('Date: ' + data.date, 0.03, 9, { left: true });
  y += pageHeight * 0.02;
  // Deliberately does not assert the rooms have been physically vacated — Phase 6 issues NOC
  // independent of the departure workflow (not yet built), so the wording only certifies the
  // Accommodation Committee's own clearance, not a fact this code cannot yet verify.
  addLine(
    'This is to certify that the Accommodation Committee has no objection to the departure of ' +
    'the team of ' + data.collegeName + ' (Registration No: ' + data.registrationNumber + ') ' +
    'from the tournament accommodation.',
    0.14, 10, { left: true }
  );
  y += pageHeight * 0.05;
  addLine('________________________', 0.03, 9, { left: true });
  addLine('Signature, Accommodation Committee', 0.035, 8, { left: true });

  return slide;
}

// `force`: mirrors createTemporaryReceiptTemplate_ exactly — clears the EXISTING template's
// slide back to blank in place (preserving any manual page-size resize) rather than
// delete/recreate. Default stays idempotent: returns the existing template untouched.
function createNocTemplate_(actorSession, force) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const existing = templatesFolder.getFilesByName('NOC Certificate Template');

  if (existing.hasNext()) {
    const existingFile = existing.next();
    if (!force) return { templateId: existingFile.getId(), created: false };
    const pres = SlidesApp.openById(existingFile.getId());
    _buildNocLayout_(pres, null);
    pres.saveAndClose();
    return { templateId: existingFile.getId(), created: false };
  }

  const pres = SlidesApp.create('NOC Certificate Template');
  const fileId = pres.getId();
  DriveApp.getFileById(fileId).moveTo(templatesFolder);
  _buildNocLayout_(pres, null);
  pres.saveAndClose();
  return { templateId: fileId, created: true };
}

function getNocStatus_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.ACCOMMODATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const row = findRowsByField_('ACCOMMODATION_NOC', 'TeamId', teamId)[0];
  if (!row) return { teamId: teamId, status: 'PENDING', pdfFileId: null, pdfUrl: null, issuedBy: null, issuedAt: null };
  return {
    teamId: teamId, status: row.Status, pdfFileId: row.PdfFileId || null,
    pdfUrl: row.PdfFileId ? 'https://drive.google.com/file/d/' + row.PdfFileId + '/view' : null,
    issuedBy: row.IssuedBy || null, issuedAt: row.IssuedAt || null
  };
}

// Idempotent by design (see Global Constraints): finds-or-creates the one ACCOMMODATION_NOC
// row for this team. Granting an already-NOC_GRANTED team returns the existing certificate —
// no financial harm in a repeat grant, unlike purchasePackage_, so no ClientRequestId needed.
function issueNoc_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);

  const existing = findRowsByField_('ACCOMMODATION_NOC', 'TeamId', teamId)[0];
  if (existing && existing.Status === 'NOC_GRANTED') {
    return {
      nocId: existing.NocId, teamId: teamId, status: 'NOC_GRANTED', pdfFileId: existing.PdfFileId,
      pdfUrl: 'https://drive.google.com/file/d/' + existing.PdfFileId + '/view'
    };
  }

  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const templateFileIter = templatesFolder.getFilesByName('NOC Certificate Template');
  if (!templateFileIter.hasNext()) {
    throw apiError_('NOT_FOUND', 'NOC certificate template not set up — run admin.bootstrap.createNocTemplate first.');
  }
  const templateFile = templateFileIter.next();

  const nocFolder = _ensureSubfolder_(_ensureSubfolder_(_getRootFolder_(), 'Accommodation'), 'NOC Certificates');
  const now = new Date();
  const nocNumber = nextDocumentNumber_('Accommodation');

  const copyFile = templateFile.makeCopy('NOC - ' + team.values.RegistrationNumber, nocFolder);
  const copyId = copyFile.getId();
  const pres = SlidesApp.openById(copyId);
  _buildNocLayout_(pres, {
    tournamentName: getSetting_('TournamentName', ''),
    organizer: getSetting_('OrganizerName', ''),
    nocNumber: nocNumber,
    date: Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd'),
    collegeName: team.values.CollegeName,
    registrationNumber: team.values.RegistrationNumber
  });
  pres.saveAndClose();

  const pdfBlob = DriveApp.getFileById(copyId).getAs('application/pdf');
  const pdfFile = nocFolder.createFile(pdfBlob).setName('NOC-' + nocNumber.replace(/\//g, '-') + '.pdf');
  DriveApp.getFileById(copyId).setTrashed(true);

  const nowIso = now.toISOString();
  let nocId;
  if (existing) {
    nocId = existing.NocId;
    updateRowById_('ACCOMMODATION_NOC', 'NocId', nocId, {
      Status: 'NOC_GRANTED', IssuedBy: actorSession.userId, IssuedAt: nowIso, PdfFileId: pdfFile.getId()
    });
  } else {
    nocId = nextId_('NOC', 4);
    appendRow_('ACCOMMODATION_NOC', {
      NocId: nocId, TeamId: teamId, Status: 'NOC_GRANTED', IssuedBy: actorSession.userId,
      IssuedAt: nowIso, Notes: '', PdfFileId: pdfFile.getId()
    });
  }

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: nowIso, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'ISSUE_NOC', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: 'NOC_GRANTED'
  });

  return { nocId: nocId, teamId: teamId, status: 'NOC_GRANTED', pdfFileId: pdfFile.getId(), pdfUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view' };
}
```

- [ ] **Step 6: Register three actions in `backend/Main.gs`'s `ACTIONS` table**

Change the end of the `ACTIONS` object literal (as Task 1 left it) from:

```javascript
  'accommodation.reallocateRoom': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return reallocateRoom_(session, payload.allocationId, payload.newRoomId, requestId);
  }
};
```

to:

```javascript
  'accommodation.reallocateRoom': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return reallocateRoom_(session, payload.allocationId, payload.newRoomId, requestId);
  },
  'admin.bootstrap.createNocTemplate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createNocTemplate_(session, !!(payload && payload.force));
  },
  'accommodation.noc.status': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getNocStatus_(session, payload.teamId);
  },
  'accommodation.noc.issue': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return issueNoc_(session, payload.teamId);
  }
};
```

- [ ] **Step 7: Push, re-run schema + Drive folder setup, create the NOC template once, then verify the test passes**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"admin.bootstrap.setupSchema","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"admin.bootstrap.setupDriveFolders","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"admin.bootstrap.createNocTemplate","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"accommodation_issueNoc"}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"pdf2"}}'
```

Expected: the setup calls succeed (idempotent, same as every prior phase); `createNocTemplate_`
reports `"created":true` the first time; the named test and the whole `pdf2` tier report
`"status":"PASS"` for every test, same total count as before plus this one.

- [ ] **Step 8: Commit**

```bash
git add backend/Constants.gs backend/Setup.gs backend/Noc.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 6: Noc.gs — NOC status + certificate generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```

---

## Task 3: Accommodation gets team lookup + redacted team detail (needed for the NOC screen's team search)

**Files:**
- Modify: `backend/Registration.gs:118-127,129-151` (widen two `requireRole_` calls, extend the
  existing `MESS` redaction branch to also cover `ACCOMMODATION`)
- Modify: `backend/Tests.gs` (one new test, registered in `TEST_CASES`)

**Interfaces:**
- Produces: `getTeamDetail_(actorSession, teamId)` now also returns `charges: null, payments:
  [], receipts: []` when `actorSession.role === ROLES.ACCOMMODATION` (same redaction Phase 5
  already gave `MESS`). `listTeams_` now also accepts `ACCOMMODATION`.

- [ ] **Step 1: Write the failing test**

In `backend/Tests.gs`, add after `test_registration_getTeamDetail_redactsFinancialsForMess`:

```javascript
function test_registration_getTeamDetail_redactsFinancialsForAccommodation() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const accSession = { userId: 'USR-0001', role: ROLES.ACCOMMODATION, sessionId: 'z' };
  let createdTeamId = null;
  try {
    const team = registerTeam_(regSession, 'Accommodation Redaction Test College', 'District', 6, [{ name: 'Incharge', isPrimary: true }]);
    createdTeamId = team.teamId;
    calculateCharges_(regSession, createdTeamId, true, true);
    recordPayment_(regSession, createdTeamId, 'Cash');

    const asAccommodation = getTeamDetail_(accSession, createdTeamId);
    assertEqual_(asAccommodation.team.TeamId, createdTeamId, 'ACCOMMODATION caller should still see team identity');
    assertEqual_(asAccommodation.charges, null, 'ACCOMMODATION caller must not see charges');
    assertEqual_(asAccommodation.payments.length, 0, 'ACCOMMODATION caller must not see payments');
    assertEqual_(asAccommodation.receipts.length, 0, 'ACCOMMODATION caller must not see receipts');

    const list = listTeams_(accSession);
    assertTrue_(list.some(function (t) { return t.teamId === createdTeamId; }), 'ACCOMMODATION caller should be able to list teams');
  } finally {
    if (createdTeamId) {
      findRowsByField_('PAYMENTS', 'TeamId', createdTeamId).forEach(function (p) { deleteRowById_('PAYMENTS', 'PaymentId', p.PaymentId); });
      findRowsByField_('CHARGES', 'TeamId', createdTeamId).forEach(function (c) { deleteRowById_('CHARGES', 'ChargeId', c.ChargeId); });
      findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', createdTeamId).forEach(function (i) { deleteRowById_('CONTINGENT_INCHARGES', 'InchargeId', i.InchargeId); });
      deleteRowById_('TEAMS', 'TeamId', createdTeamId);
    }
  }
}
```

Register in `TEST_CASES` (after `registration_getTeamDetail_redactsFinancialsForMess`):

```javascript
  { name: 'registration_getTeamDetail_redactsFinancialsForAccommodation', fn: test_registration_getTeamDetail_redactsFinancialsForAccommodation },
```

- [ ] **Step 2: Push and verify it fails**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"registration_getTeamDetail_redactsFinancialsForAccommodation"}}'
```

Expected: FAILs with `FORBIDDEN` (current gate only allows `ADMIN`/`REGISTRATION`/`MESS`).

- [ ] **Step 3: Widen the role checks in `backend/Registration.gs`**

Change:

```javascript
function listTeams_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
```

to:

```javascript
function listTeams_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS, ROLES.ACCOMMODATION]);
```

Change:

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
```

to:

```javascript
function getTeamDetail_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS, ROLES.ACCOMMODATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  // Mess sells packages, Accommodation searches teams to grant NOC — both need team
  // identity/incharges but never Dari/security/total-payable figures or the temporary
  // receipt (spec §20/§21, narrowing the shared read endpoint's field visibility rather
  // than duplicating the handler).
  if (actorSession.role === ROLES.MESS || actorSession.role === ROLES.ACCOMMODATION) {
    return {
      team: team.values,
      incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
      charges: null, payments: [], receipts: []
    };
  }
```

- [ ] **Step 4: Push and verify the test passes**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
```

Expected: `registration_getTeamDetail_redactsFinancialsForAccommodation` reports `"status":"PASS"`,
and every previously-passing `fast`-tier test still passes.

- [ ] **Step 5: Commit**

```bash
git add backend/Registration.gs backend/Tests.gs
git commit -m "Phase 6: Accommodation gets team lookup + redacted team detail

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```

---

## Task 4: Frontend — active allocations (reallocate/vacate), NOC screen, Team Detail entry point

**Files:**
- Modify: `frontend/js/accommodation.js` (rewrite: active-allocations sections with
  Reallocate/Vacate, new `renderNocScreen`, dashboard gains a Teams nav button)
- Modify: `frontend/js/registration.js:229-260` (`renderTeamDetail` gains Accommodation's
  Grant-NOC entry point, redaction condition, hides the Packages button for Accommodation)
- Modify: `frontend/service-worker.js` (bump `CACHE_NAME`)

**Interfaces:**
- Consumes: `accommodation.listActive`, `accommodation.vacateRoom`, `accommodation.reallocateRoom`,
  `accommodation.noc.status`, `accommodation.noc.issue` (Tasks 1-2), `registration.teams.list`/
  `registration.teams.detail` (Task 3), `apiCall`, `navigateTo`, `goBack`, `renderTeamsList` (all
  already global per the existing frontend's single-namespace `<script>` loading in
  `index.html`).

- [ ] **Step 1: Rewrite `frontend/js/accommodation.js`**

```javascript
// accommodation.js — Accommodation Dashboard: two pending lists (allocate), two active-
// allocation lists (reallocate/vacate), and the NOC screen (spec §13's 3-screen Accommodation
// nav: Teams [reuses registration.js's renderTeamsList/renderTeamDetail, same pattern Phase 5
// used for Mess] · Rooms [this dashboard] · NOC).

function _pendingSection(kind, title, pending, noneText) {
  if (pending.length === 0) return '<h2>' + title + '</h2><p>' + noneText + '</p>';
  return '<h2>' + title + '</h2>' +
    '<table><thead><tr><th>Reg. No.</th><th>College</th><th>Remaining</th><th></th></tr></thead><tbody>' +
      pending.map(function (t) {
        return '<tr><td>' + t.registrationNumber + '</td><td>' + t.collegeName + '</td><td>' + t.remainingCount + '</td>' +
          '<td><button class="allocate-btn" data-kind="' + kind + '" data-teamid="' + t.teamId + '" data-remaining="' + t.remainingCount + '">Allocate</button></td></tr>';
      }).join('') +
    '</tbody></table>';
}

function _roomsSection(title, rooms) {
  if (rooms.length === 0) return '<h2>' + title + '</h2><p>None yet.</p>';
  return '<h2>' + title + '</h2>' +
    '<table><thead><tr><th>Building / Hotel</th><th>Room No.</th><th>Capacity</th><th>Remaining</th><th>Status</th></tr></thead><tbody>' +
      rooms.map(function (r) {
        return '<tr><td>' + r.building + '</td><td>' + r.roomNumber + '</td><td>' + r.capacity + '</td><td>' + r.remaining + '</td><td>' + r.status + '</td></tr>';
      }).join('') +
    '</tbody></table>';
}

function _activeSection(kind, title, active, noneText) {
  if (active.length === 0) return '<h2>' + title + '</h2><p>' + noneText + '</p>';
  return '<h2>' + title + '</h2>' +
    '<table><thead><tr><th>Reg. No.</th><th>College</th><th>Room</th><th>Persons</th><th></th><th></th></tr></thead><tbody>' +
      active.map(function (a) {
        return '<tr><td>' + a.registrationNumber + '</td><td>' + a.collegeName + '</td>' +
          '<td>' + (a.building ? a.building + ' — ' : '') + a.roomNumber + '</td><td>' + a.personsAllocated + '</td>' +
          '<td><button class="reallocate-btn" data-kind="' + kind + '" data-allocid="' + a.allocationId + '">Reallocate</button></td>' +
          '<td><button class="vacate-btn" data-allocid="' + a.allocationId + '">Vacate</button></td></tr>';
      }).join('') +
    '</tbody></table>';
}

async function renderAccommodationDashboard(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Welcome, ' + user.name + '</h1><p class="subtitle">Accommodation Committee</p><p>Loading…</p></div>';
  await refresh();

  async function refresh() {
    const pendingTeams = await apiCall('accommodation.listPending', { kind: 'TEAM' });
    const pendingIncharges = await apiCall('accommodation.listPending', { kind: 'INCHARGE' });
    const activeTeams = await apiCall('accommodation.listActive', { kind: 'TEAM' });
    const activeIncharges = await apiCall('accommodation.listActive', { kind: 'INCHARGE' });
    const roomsData = await apiCall('rooms.list', {});
    const teamRooms = roomsData.rooms.filter(function (r) { return r.roomType === 'TEAM'; });
    const inchargeRooms = roomsData.rooms.filter(function (r) { return r.roomType === 'INCHARGE'; });

    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Welcome, ' + user.name + '</h1>' +
        '<p class="subtitle">Accommodation Committee</p>' +
        '<div id="accom-error" class="error" style="display:none"></div>' +
        '<button id="teams-btn" style="margin-bottom:12px">Teams</button>' +
        _pendingSection('TEAM', 'Teams Needing Accommodation', pendingTeams.teams, 'No teams currently have members waiting for a room.') +
        _pendingSection('INCHARGE', 'Incharges Needing Accommodation', pendingIncharges.teams, 'No teams currently have incharges waiting for a room.') +
        _activeSection('TEAM', 'Team Rooms — Currently Allocated', activeTeams.allocations, 'No active team allocations yet.') +
        _activeSection('INCHARGE', 'Incharge Rooms — Currently Allocated', activeIncharges.allocations, 'No active incharge allocations yet.') +
        _roomsSection('Team Rooms (on-campus)', teamRooms) +
        _roomsSection('Incharge Rooms (rest houses / hotels)', inchargeRooms) +
        '<button id="logout-btn" style="margin-top:16px">Log Out</button>' +
      '</div>';

    document.getElementById('teams-btn').addEventListener('click', function () { navigateTo(renderTeamsList, root, user); });

    Array.prototype.forEach.call(document.querySelectorAll('.allocate-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const kind = btn.getAttribute('data-kind');
        const roomList = kind === 'TEAM' ? teamRooms : inchargeRooms;
        renderAllocateForm(kind, btn.getAttribute('data-teamid'), Number(btn.getAttribute('data-remaining')), roomList);
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.vacate-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('accom-error');
        errEl.style.display = 'none';
        try {
          await apiCall('accommodation.vacateRoom', { allocationId: btn.getAttribute('data-allocid') });
          await refresh();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.reallocate-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const kind = btn.getAttribute('data-kind');
        const roomList = kind === 'TEAM' ? teamRooms : inchargeRooms;
        renderReallocateForm(btn.getAttribute('data-allocid'), roomList);
      });
    });

    document.getElementById('logout-btn').addEventListener('click', async function () {
      await logout();
      resetNavigation(renderLogin, root, null);
    });
  }

  function renderAllocateForm(kind, teamId, remaining, roomList) {
    const availableRooms = roomList.filter(function (r) { return r.remaining > 0; });
    const subjectLabel = kind === 'TEAM' ? 'team member(s)' : 'incharge(s)';
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Allocate Room</h1>' +
        '<p class="subtitle">' + remaining + ' ' + subjectLabel + ' still need a room</p>' +
        '<div id="allocate-error" class="error" style="display:none"></div>' +
        '<form id="allocate-form">' +
          '<label>Room<select id="allocate-room">' +
            availableRooms.map(function (r) {
              return '<option value="' + r.roomId + '">' + (r.building ? r.building + ' — ' : '') + r.roomNumber + ' (remaining: ' + r.remaining + ')</option>';
            }).join('') +
          '</select></label>' +
          '<label>Persons to Allocate<input type="number" id="allocate-persons" min="1" max="' + remaining + '" value="1" required></label>' +
          '<button type="submit">Allocate</button>' +
        '</form>' +
        '<button id="cancel-btn" style="margin-top:8px;background:#999">Cancel</button>' +
      '</div>';

    document.getElementById('cancel-btn').addEventListener('click', function () { refresh(); });

    document.getElementById('allocate-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('allocate-error');
      errEl.style.display = 'none';
      try {
        await apiCall('accommodation.allocateRoom', {
          kind: kind,
          teamId: teamId,
          roomId: document.getElementById('allocate-room').value,
          personsAllocated: Number(document.getElementById('allocate-persons').value)
        });
        await refresh();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  function renderReallocateForm(allocationId, roomList) {
    const availableRooms = roomList.filter(function (r) { return r.remaining > 0; });
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Reallocate Room</h1>' +
        '<div id="reallocate-error" class="error" style="display:none"></div>' +
        '<form id="reallocate-form">' +
          '<label>New Room<select id="reallocate-room">' +
            availableRooms.map(function (r) {
              return '<option value="' + r.roomId + '">' + (r.building ? r.building + ' — ' : '') + r.roomNumber + ' (remaining: ' + r.remaining + ')</option>';
            }).join('') +
          '</select></label>' +
          '<button type="submit">Reallocate</button>' +
        '</form>' +
        '<button id="cancel-btn" style="margin-top:8px;background:#999">Cancel</button>' +
      '</div>';

    document.getElementById('cancel-btn').addEventListener('click', function () { refresh(); });

    document.getElementById('reallocate-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('reallocate-error');
      errEl.style.display = 'none';
      try {
        await apiCall('accommodation.reallocateRoom', {
          allocationId: allocationId,
          newRoomId: document.getElementById('reallocate-room').value
        });
        await refresh();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }
}

// Reached from registration.js's renderTeamDetail via the Accommodation role's "Accommodation
// NOC" button (Team Detail is already reused across roles — Phase 5 did the same for Mess).
async function renderNocScreen(root, user, teamId, registrationNumber, collegeName) {
  root.innerHTML = '<div class="wizard-card"><h1>Accommodation NOC</h1><p>Loading…</p></div>';
  const status = await apiCall('accommodation.noc.status', { teamId: teamId });
  render(status);

  function render(status) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Accommodation NOC</h1>' +
        '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + '</p>' +
        '<div id="noc-error" class="error" style="display:none"></div>' +
        '<p>Status: <strong>' + status.status + '</strong></p>' +
        (status.status === 'NOC_GRANTED'
          ? '<a href="' + status.pdfUrl + '" target="_blank" rel="noopener"><button type="button">View NOC Certificate</button></a>'
          : '<button id="grant-btn">Grant NOC</button>') +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';

    if (status.status !== 'NOC_GRANTED') {
      document.getElementById('grant-btn').addEventListener('click', async function () {
        const errEl = document.getElementById('noc-error');
        errEl.style.display = 'none';
        try {
          const granted = await apiCall('accommodation.noc.issue', { teamId: teamId });
          render({ status: 'NOC_GRANTED', pdfUrl: granted.pdfUrl });
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    }
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
```

- [ ] **Step 2: Update `renderTeamDetail` in `frontend/js/registration.js`**

Change:

```javascript
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
      '<button id="back-btn" style="margin-top:12px">Back to Teams</button>' +
    '</div>';
  document.getElementById('packages-btn').addEventListener('click', function () {
    navigateTo(renderPackagesScreen, root, user, teamId, data.team.RegistrationNumber, data.incharges);
  });
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}
```

to:

```javascript
      // MESS/ACCOMMODATION never see Dari/security/total-payable or the temp receipt (backend
      // redacts these fields to null/[] for those roles — getTeamDetail_, spec §20/§21) — the
      // frontend simply skips rendering the sections rather than showing a misleading state.
      (user.role !== 'MESS' && user.role !== 'ACCOMMODATION'
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

- [ ] **Step 3: Bump the service worker cache version**

In `frontend/service-worker.js`, change:

```javascript
const CACHE_NAME = 'hpuick-shell-v20';
```

to:

```javascript
const CACHE_NAME = 'hpuick-shell-v21';
```

- [ ] **Step 4: Deploy and manually verify against the real Web App**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI
```

Push the frontend to GitHub Pages the same way every prior phase did (check `git remote -v` /
existing deploy docs if unsure of the exact command — this project deploys `frontend/` to
`https://gcbhoranj.github.io/ickpwa/`).

Log in as the real ACCOMMODATION test account (`prince`/Accommodation, per the dev-log's
Phase 2 operational note) and confirm live, on a real device or browser:
1. Dashboard shows a "Teams" button; clicking it lists teams, clicking a team shows its
   detail with no charges/payments/receipt section, an "Accommodation NOC" button (no "Food
   Packages" button), and a working Back button.
2. Allocate a room to a team, confirm it appears under "Currently Allocated" with working
   Vacate and Reallocate buttons; Vacate frees the room's remaining count back up; Reallocate
   moves the allocation to a different room and frees the old one.
3. From a team's detail, click "Accommodation NOC" — status shows PENDING, click "Grant NOC",
   status flips to NOC_GRANTED with a working "View NOC Certificate" link that opens a real PDF.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/accommodation.js frontend/js/registration.js frontend/service-worker.js
git commit -m "Phase 6: frontend — reallocate/vacate active allocations, NOC screen, Team Detail entry point

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```

---

## Task 5: Full regression pass + dev-log entry

**Files:**
- Modify: `docs/superpowers/dev-log.md` (new entry)

- [ ] **Step 1: Run every test tier against the live deployed backend**

```bash
call_action '{"action":"system.selfTestSplit","payload":{}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"mess"}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"pdf1"}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"pdf2"}}'
```

Expected: every tier reports all tests passing (fast tier count grows by 3 over Phase 5's
total — Task 1's and Task 3's new tests; `pdf2` grows by 1 — Task 2's new test). Record the
exact totals in the dev-log entry (do not guess them — read them from these live results).

- [ ] **Step 2: Write the dev-log entry**

Append to `docs/superpowers/dev-log.md`, following the existing entries' format (one `##
YYYY-MM-DD — <title>` section, bullet points, no placeholders): summarize what Phase 6 shipped
(reallocate/vacate/NOC issuance), the two idempotency decisions (naturally-idempotent vacate
and NOC-grant vs. `ClientRequestId`-guarded reallocate), the redaction widening to
`ACCOMMODATION`, and the actual live test totals from Step 1.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/dev-log.md
git commit -m "Phase 6: dev log entry — Accommodation reallocate/vacate/NOC

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```
