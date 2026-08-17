# Phase 3 (Registration) Implementation Plan — HPU Inter-College Kabaddi Tournament 2026

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Registration staff register a team with its contingent incharges, have the
system automatically calculate Dari and Security charges from the locked rate card, record
the payment, and generate a real, data-driven temporary receipt PDF — the first phase that
handles real money and the first to generate a real document.

**Architecture:** Same PWA → Apps Script Web App → Sheets/Drive architecture as Phases 1-2.
Adds: Admin-configurable document numbering (distinct from internal record IDs), rate
settings management, the registration+charges+payment backend flow, and the first
document-generation pipeline using Google Slides as a template engine (per the approved
design spec §8), empirically verified in this session before writing this plan (see
"Document generation approach" below).

**Tech Stack:** Same as Phases 1-2 — Apps Script (V8), vanilla JS PWA, no new frontend
dependencies. Backend gains one new Apps Script built-in service usage: `SlidesApp`
(no manifest/Advanced Service dependency needed — see below).

**Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` — this plan
implements §17 Phase 3 scope. Per an explicit scope decision made before writing this plan
(the original prompt's §20-21/§87 describe Package 1 as bundled into registration's charge
calculation, but the approved design spec §17 puts food packages entirely in Phase 4): **this
phase is food-free.** Charges calculated here are Dari + Security only. Food package
purchase, meal charges, and coupons are Phase 4's job, built as a separate action Registration
staff will use right after this phase's flow completes for a new team — not part of one
combined step.

## Document generation approach — verified in this session, not assumed

A live spike against the real backend (results below) determined the actual capabilities and
limits of Apps Script's Slides integration, since the design spec called for "exact custom
page dimensions" which turned out not to be achievable:

- `SlidesApp.create(name)`, `Presentation.replaceAllText(pattern, replacement)`, and
  `DriveFile.getAs('application/pdf')` all work reliably with no manifest changes — no
  Advanced Slides Service needed.
- Neither `SlidesApp`'s simple service nor the raw Advanced Slides API's
  `Presentations.create({pageSize: ...})` can set a custom page size (A5) — both attempts
  empirically produced the default 720×405pt (10in × 5.625in, 16:9) page regardless of what
  was requested. This is a genuine platform limitation, not a mechanics mistake — confirmed
  by two independent approaches both failing the same way.
- **Decision:** generate the temporary receipt as a real, data-driven Slides→PDF document
  using the default page size for now. Exact physical dimensions (A5) are explicitly deferred
  per the spec's own repeated statement that "the exact visual format will be supplied later"
  (original prompt §57/§59) — when it is, resizing to A5 is a one-time manual step in the
  Slides UI (File → Page setup → Custom, 148mm × 210mm) on the template file itself, not
  something the generation code needs to handle. Document **accuracy** (correct data) is this
  phase's job; document **physical sizing** is explicitly out of scope until a real format is
  supplied, matching the project's own stated priority order (accuracy over polish).
- Like the earlier Sheets/Drive scope surprises in Phase 1, calling `SlidesApp` for the first
  time will very likely require one more one-time manual OAuth authorization (already
  completed once in this session as part of the spike — should not recur, but if it does,
  the pattern is identical: open the script editor, run any Slides-touching function, approve
  the consent screen).

## Global Constraints

- Deployment ID (reuse for every `clasp deploy -i <id>`, do not create a new one):
  `AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI`. Web App URL:
  `https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`.
- GitHub Pages URL: `https://gcbhoranj.github.io/ickpwa/`. Frontend repo remote
  `frontend-origin` already configured; push via
  `git subtree push --prefix=frontend frontend-origin main` from the project root.
- **curl gotcha (still applies): never use `-L` with POST.** Capture the first hop's
  `Location:` header, issue a second plain GET. Write intermediate files inside the SDD
  workspace, never `/tmp`. **New pattern observed this session: the redirect occasionally
  needs one retry (empty body or a Google "page not found" HTML page on the first attempt,
  succeeding on retry) — this appears to be transient Google-edge flakiness, not a code bug.
  If a curl-based verification returns empty or an HTML error page, retry once before
  investigating further as a real failure.**
- **Service worker cache versioning: bump `CACHE_NAME` in `frontend/service-worker.js` on
  EVERY task in this phase that changes any frontend file, and add any new JS file to
  `SHELL_FILES`.** This was missed once already in Phase 2 and caused a live-deploy failure
  that looked like a broken feature. Do not repeat it — increment on the frontend tasks in
  this plan (noted explicitly in each relevant task).
- Two distinct ID families remain in play (design spec §4): **internal record IDs**
  (`nextId_(prefix, padding)`, already exists) and **document numbers** (Admin-configurable
  prefix/next/padding stored in SETTINGS, human-facing — e.g. `GCB/HPUICK/REG-001`). This
  phase adds `nextDocumentNumber_(type)` for the second family, used for Registration Numbers
  and Receipt Numbers.
- Charges this phase: **Dari Charges = RateDari × TotalContingentPersons** (team members +
  incharges, matching how "everyone needs a mat/bedding" per original prompt §16). **Security
  = a flat per-team amount** from `SETTINGS.SecurityAmount`, not multiplied by headcount
  (original prompt §18 describes it as a single configured amount, not a per-person rate).
  **Meal charges are 0 this phase** — `CHARGES.MealCharges` stays 0 until Phase 4 packages
  exist; it is not removed from the schema, just unused until then.
- `RECEIPTS.GrandTotal` represents **charges only** (Dari, and later meal) — **never security**,
  for consistency with how the Final Receipt (Phase 8) must present them per original prompt
  §60-61 ("Security must NOT appear in this charge table"). The temporary receipt template
  shows Security as a separately labeled, explicitly non-charge line, and a separate
  "Total Amount Received" figure (charges + security) that has no dedicated schema column —
  it's computed at generation time from `CHARGES` and confirmed-paid `PAYMENTS` rows.
- `RECEIPTS.AmountInWords` stays blank for `TEMPORARY` receipts this phase — number-to-words
  conversion is only spec'd for the Final Receipt (original prompt §60) and is Phase 8's job,
  not invented here.
- Financial settings locking (`FinancialSettingsLocked`) is **not** a hard gate on charge
  calculation in this phase's code — the original prompt (§19) describes it as an operational
  safety practice ("Admin enters rates before registration begins... lock... so ordinary
  users cannot modify rates"), not a technical precondition for registration to function. Rate
  *updates* are blocked while locked; charge *calculation* reads whatever the current rate is,
  locked or not. Do not invent a stricter rule than the spec states.
- Payment for registration is recorded as **two PAYMENTS rows in one action** (Purpose
  `REGISTRATION_CHARGES` for the Dari amount, Purpose `SECURITY` for the security amount) —
  matches the `Purpose` enum already defined in the Phase 1 schema, and lets later reports
  distinguish charge revenue from refundable-deposit collection cleanly. The action takes no
  `amount` parameter from the operator — it always collects exactly `CHARGES.DariCharges` +
  `CHARGES.SecurityCharges`, removing any chance of a typo mismatching the calculated total.
  Partial payments/installments are not in scope — not spec'd, not built.
- All new backend actions in this phase are gated to `[ROLES.ADMIN, ROLES.REGISTRATION]` per
  the role matrix (design spec §12) — Mess and Accommodation have no access to any of this.
- **No Admin Settings frontend screen this phase.** Task 2's rate/lock actions
  (`admin.settings.updateRates`, `admin.settings.setFinancialLock`) are real, tested, and
  necessary — Phase 1 seeded placeholder rates (e.g. `SecurityAmount: '0'`) that Admin must be
  able to change to real values before real registrations begin — but there is no frontend
  screen calling them yet. Admin sets real rates via curl for now (documented in the dev-log);
  a Settings screen is a reasonable candidate for a later phase, not invented here.
- **Hard lesson from Phase 1/2: implement exactly what each task specifies, nothing more.**
  Task 3's Phase 1 incident (3 fix-rounds from unrequested "extra protection" causing a real
  production data-loss bug) and Phase 2's live service-worker miss both came from skipping a
  documented step or adding unscoped extras. This phase touches real payment/charge data —
  extra care applies, not less.
- Every write to a string-typed-looking field continues to use explicit strings (`'true'`,
  `'false'`), never a raw JS boolean, per the Phase 1 incident and Phase 2's `_isActiveFlag_`
  precedent.

---

## File structure this phase touches

```
/backend
  SheetHelpers.gs   Modify — add findRowsByField_
  IdGenerator.gs    Modify — add nextDocumentNumber_
  Settings.gs       Create — rate/financial-lock management, public registration-info read
  Registration.gs   Create — team+incharges registration, charge calc, payment, team list/detail
  Receipts.gs       Create — temporary receipt template setup + generation (SlidesApp)
  Main.gs           Modify — register ~10 new actions
  Tests.gs          Modify — test cases for all of the above
/frontend
  js/registration.js   Create — Registration Dashboard nav, the registration wizard, Teams list/detail
  js/app.js            Modify — REGISTRATION role's landing renders the real dashboard instead of the placeholder
  index.html           Modify — include registration.js
  css/app.css           Modify — minimal additions for the wizard/list (reuse existing classes first)
  service-worker.js     Modify — CACHE_NAME bump + registration.js added to SHELL_FILES
/docs
  superpowers/dev-log.md   Modify — Phase 3 entry
```

---

### Task 1: `findRowsByField_` and `nextDocumentNumber_`

**Files:**
- Modify: `backend/SheetHelpers.gs` (append)
- Modify: `backend/IdGenerator.gs` (append)
- Modify: `backend/Tests.gs`

**Interfaces:**
- Produces: `findRowsByField_(sheetName, fieldName, value)` — returns an array of plain row
  objects (not `{rowNumber, values}`) matching `row[fieldName] === value`, empty array if
  none. Unlike `findRowById_`, this is for one-to-many lookups (a team's incharges, a team's
  payments, etc.) — every later task in this phase depends on it.
- Produces: `nextDocumentNumber_(type)` — reads `Numbering_<type>_Prefix`,
  `Numbering_<type>_Next`, `Numbering_<type>_Padding` from SETTINGS (already seeded by Phase
  1 for `Registration`, `Receipt`, `Coupon`, `Refund`, `Relieving`, `Accommodation`),
  increments `Next` under `LockService`, returns the formatted string (e.g.
  `GCB/HPUICK/REG-001`). Distinct from `nextId_` (internal record IDs) — never confuse the
  two in later tasks.

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add both to `TEST_CASES`: `{ name: 'sheetHelpers_findRowsByField', fn: test_sheetHelpers_findRowsByField }`,
`{ name: 'idGenerator_nextDocumentNumber', fn: test_idGenerator_nextDocumentNumber }`

- [ ] **Step 2: Push, deploy, verify both fail** (expect `findRowsByField_ is not defined` and
  `nextDocumentNumber_ is not defined`).

- [ ] **Step 3: Implement — append to `backend/SheetHelpers.gs`**

```javascript
function findRowsByField_(sheetName, fieldName, value) {
  return rowsToObjects_(sheetName).filter(function (row) { return row[fieldName] === value; });
}
```

- [ ] **Step 4: Implement — append to `backend/IdGenerator.gs`**

```javascript
function nextDocumentNumber_(type) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prefix = getSetting_('Numbering_' + type + '_Prefix', '');
    const next = parseInt(getSetting_('Numbering_' + type + '_Next', '1'), 10);
    const padding = parseInt(getSetting_('Numbering_' + type + '_Padding', '3'), 10);
    setSetting_('Numbering_' + type + '_Next', String(next + 1), 'system');
    return prefix + String(next).padStart(padding, '0');
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 5: Push, deploy, verify both pass.**

- [ ] **Step 6: Commit**

```bash
git add backend/SheetHelpers.gs backend/IdGenerator.gs backend/Tests.gs
git commit -m "Phase 3: findRowsByField_ and nextDocumentNumber_

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 2: Rate settings management

**Files:**
- Create: `backend/Settings.gs`
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `requireSession_`, `getSetting_`, `setSetting_`, `ROLES`.
- Produces: `updateRates_(actorSession, rates)` — ADMIN only; `rates` is
  `{breakfast, lunch, dinner, dari, security}` (all required, numeric, ≥ 0); rejects with
  `apiError_('SETTINGS_LOCKED', ...)` if `FinancialSettingsLocked === 'true'`; writes each as
  a string via `setSetting_`; writes one `AUDIT_LOG` entry. Produces
  `setFinancialLock_(actorSession, locked)` — ADMIN only; writes `FinancialSettingsLocked` as
  `'true'`/`'false'`; writes `AUDIT_LOG`. Produces `getRegistrationInfo_(actorSession)` — any
  authenticated session (no role restriction, matches `auth.whoami`'s pattern); returns
  `{rateBreakfast, rateLunch, rateDinner, rateDari, securityAmount, financialSettingsLocked}`
  as the current values, all as their stored string form (frontend parses to number as needed).

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'settings_updateRatesAndLock', fn: test_settings_updateRatesAndLock }`

- [ ] **Step 2: Push, deploy, verify it fails** (expect `getRegistrationInfo_ is not defined`).

- [ ] **Step 3: Implement `backend/Settings.gs`**

```javascript
// Settings.gs — rate/financial-lock management and the public registration-info read.

// Takes actorSession for signature consistency with the rest of this file, but does not
// itself call requireRole_/requireSession_ — the caller (the settings.getRegistrationInfo
// action in Main.gs) is responsible for calling requireSession_ before invoking this, the
// same pattern auth.whoami already uses (any authenticated role, no specific role gate).
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

function setFinancialLock_(actorSession, locked) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const now = new Date().toISOString();
  setSetting_('FinancialSettingsLocked', locked ? 'true' : 'false', actorSession.userId);
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: locked ? 'LOCK_FINANCIAL_SETTINGS' : 'UNLOCK_FINANCIAL_SETTINGS', Entity: 'SETTINGS',
    EntityId: 'FinancialSettingsLocked', PreviousState: '', NewState: locked ? 'true' : 'false'
  });
  return { financialSettingsLocked: locked };
}
```

- [ ] **Step 4: Register three actions in `backend/Main.gs`**

```javascript
  'admin.settings.updateRates': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return updateRates_(session, payload);
  },
  'admin.settings.setFinancialLock': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return setFinancialLock_(session, !!payload.locked);
  },
  'settings.getRegistrationInfo': function (payload, sessionId) {
    requireSession_(sessionId);
    return getRegistrationInfo_(null);
  },
```

- [ ] **Step 5: Push, deploy, verify it passes.**

- [ ] **Step 6: Commit**

```bash
git add backend/Settings.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 3: rate settings management (update, lock, public read)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 3: Team + contingent incharges registration

**Files:**
- Create: `backend/Registration.gs`
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `requireSession_`, `nextId_`, `nextDocumentNumber_`, `appendRow_`,
  `ROLES`.
- Produces: `registerTeam_(actorSession, collegeName, districtName, numberOfTeamMembers,
  incharges)` — `incharges` is an array of `{name, designation, whatsapp, email, isPrimary}`;
  validates college/district non-empty, `numberOfTeamMembers >= 1`, at least one incharge with
  a non-empty name; if no incharge has `isPrimary` truthy, the first one is auto-marked
  primary; creates one `TEAMS` row (`Status: 'REGISTERED'`) and one `CONTINGENT_INCHARGES` row
  per incharge; writes `AUDIT_LOG`; returns
  `{teamId, registrationNumber, totalContingentPersons}`.

- [ ] **Step 1: Add the failing test**

```javascript
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
    assertEqual_(team.NumberOfContingentIncharges, 2, 'incharge count mismatch on TEAMS row');

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
```

Add to `TEST_CASES`: `{ name: 'registration_registerTeam_validationAndCreation', fn: test_registration_registerTeam_validationAndCreation }`

- [ ] **Step 2: Push, deploy, verify it fails** (expect `registerTeam_ is not defined`).

- [ ] **Step 3: Implement `backend/Registration.gs`**

```javascript
// Registration.gs — team + contingent incharges registration.

function registerTeam_(actorSession, collegeName, districtName, numberOfTeamMembers, incharges) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!collegeName) throw apiError_('VALIDATION_ERROR', 'College name is required.');
  if (!districtName) throw apiError_('VALIDATION_ERROR', 'District name is required.');
  const members = parseInt(numberOfTeamMembers, 10);
  if (!members || members < 1) throw apiError_('VALIDATION_ERROR', 'Number of team members must be at least 1.');
  if (!incharges || incharges.length === 0) throw apiError_('VALIDATION_ERROR', 'At least one contingent incharge is required.');
  incharges.forEach(function (inc) {
    if (!inc.name) throw apiError_('VALIDATION_ERROR', 'Every incharge needs a name.');
  });

  const hasPrimary = incharges.some(function (inc) { return !!inc.isPrimary; });
  const totalContingent = members + incharges.length;
  const teamId = nextId_('TEAM', 4);
  const registrationNumber = nextDocumentNumber_('Registration');
  const now = new Date().toISOString();

  appendRow_('TEAMS', {
    TeamId: teamId, RegistrationNumber: registrationNumber, CollegeName: collegeName, DistrictName: districtName,
    NumberOfTeamMembers: members, NumberOfContingentIncharges: incharges.length, TotalContingentPersons: totalContingent,
    RegistrationDateTime: now, Status: 'REGISTERED', DepartureLockedBy: '', DepartureLockedAt: '',
    CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });

  incharges.forEach(function (inc, i) {
    appendRow_('CONTINGENT_INCHARGES', {
      InchargeId: nextId_('INC', 4), TeamId: teamId, Name: inc.name, Designation: inc.designation || '',
      WhatsAppNumber: inc.whatsapp || '', EmailAddress: inc.email || '',
      IsPrimary: (hasPrimary ? !!inc.isPrimary : i === 0) ? 'true' : 'false', Active: 'true',
      CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
    });
  });

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'REGISTER_TEAM', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: 'REGISTERED'
  });

  return { teamId: teamId, registrationNumber: registrationNumber, totalContingentPersons: totalContingent };
}
```

- [ ] **Step 4: Register the action in `backend/Main.gs`**

```javascript
  'registration.team.create': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return registerTeam_(session, payload.collegeName, payload.districtName, payload.numberOfTeamMembers, payload.incharges || []);
  },
```

- [ ] **Step 5: Push, deploy, verify it passes.**

- [ ] **Step 6: Commit**

```bash
git add backend/Registration.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 3: team and contingent incharge registration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 4: Charge calculation

**Files:**
- Modify: `backend/Registration.gs` (append)
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `findRowById_`, `findRowsByField_`, `appendRow_`, `nextId_`,
  `getSetting_`.
- Produces: `calculateCharges_(actorSession, teamId)` — rejects `NOT_FOUND` if the team
  doesn't exist, rejects `ALREADY_CALCULATED` if a CHARGES row already exists for this team
  (append-only, one calculation per team's initial registration); computes
  `dariCharges = RateDari × TotalContingentPersons`, `securityCharges = SecurityAmount` (flat),
  `totalPayable = dariCharges + securityCharges`; appends one CHARGES row with rate snapshots;
  returns `{chargeId, dariCharges, securityCharges, totalPayable, totalContingentPersons}`.

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'registration_calculateCharges_correctAndIdempotentGuard', fn: test_registration_calculateCharges_correctAndIdempotentGuard }`

- [ ] **Step 2: Push, deploy, verify it fails.**

- [ ] **Step 3: Implement — append to `backend/Registration.gs`**

```javascript
function calculateCharges_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const existing = findRowsByField_('CHARGES', 'TeamId', teamId);
  if (existing.length > 0) {
    throw apiError_('ALREADY_CALCULATED', 'Charges have already been calculated for this team.');
  }

  const rateDari = Number(getSetting_('RateDari', '0'));
  const rateBreakfast = Number(getSetting_('RateBreakfast', '0'));
  const rateLunch = Number(getSetting_('RateLunch', '0'));
  const rateDinner = Number(getSetting_('RateDinner', '0'));
  const securityAmount = Number(getSetting_('SecurityAmount', '0'));

  const dariCharges = rateDari * Number(team.values.TotalContingentPersons);
  const totalPayable = dariCharges + securityAmount;
  const chargeId = nextId_('CHG', 4);
  const now = new Date().toISOString();

  appendRow_('CHARGES', {
    ChargeId: chargeId, TeamId: teamId, RateBreakfastSnapshot: rateBreakfast, RateLunchSnapshot: rateLunch,
    RateDinnerSnapshot: rateDinner, RateDariSnapshot: rateDari, SecurityAmountSnapshot: securityAmount,
    DariCharges: dariCharges, MealCharges: 0, SecurityCharges: securityAmount, TotalPayable: totalPayable,
    CalculatedAt: now, CreatedBy: actorSession.userId
  });

  return {
    chargeId: chargeId, dariCharges: dariCharges, securityCharges: securityAmount, totalPayable: totalPayable,
    totalContingentPersons: Number(team.values.TotalContingentPersons)
  };
}
```

- [ ] **Step 4: Register the action in `backend/Main.gs`**

```javascript
  'registration.charges.calculate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return calculateCharges_(session, payload.teamId);
  },
```

- [ ] **Step 5: Push, deploy, verify it passes.**

- [ ] **Step 6: Commit**

```bash
git add backend/Registration.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 3: charge calculation (Dari + Security)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 5: Payment recording

**Files:**
- Modify: `backend/Registration.gs` (append)
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `findRowsByField_`, `appendRow_`, `nextId_`.
- Produces: `recordPayment_(actorSession, teamId, mode)` — rejects `NOT_FOUND` if no CHARGES
  row exists yet for the team; rejects `ALREADY_PAID` if a `REGISTRATION_CHARGES`-purpose
  payment already exists for this team; creates exactly two PAYMENTS rows (one
  `REGISTRATION_CHARGES` for `CHARGES.DariCharges`, one `SECURITY` for
  `CHARGES.SecurityCharges`), both with the given `mode`; writes `AUDIT_LOG`; returns
  `{dariPaymentId, securityPaymentId, totalReceived}`.

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'registration_recordPayment_createsTwoRowsAndGuards', fn: test_registration_recordPayment_createsTwoRowsAndGuards }`

- [ ] **Step 2: Push, deploy, verify it fails.**

- [ ] **Step 3: Implement — append to `backend/Registration.gs`**

```javascript
function recordPayment_(actorSession, teamId, mode) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!mode) throw apiError_('VALIDATION_ERROR', 'Payment mode is required.');
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId);
  if (charges.length === 0) throw apiError_('NOT_FOUND', 'Charges have not been calculated yet for this team.');
  const charge = charges[0];

  const existingPayments = findRowsByField_('PAYMENTS', 'TeamId', teamId).filter(function (p) { return p.Purpose === 'REGISTRATION_CHARGES'; });
  if (existingPayments.length > 0) {
    throw apiError_('ALREADY_PAID', 'Registration payment has already been recorded for this team.');
  }

  const now = new Date().toISOString();
  const dariPaymentId = nextId_('PAY', 4);
  appendRow_('PAYMENTS', {
    PaymentId: dariPaymentId, TeamId: teamId, Amount: charge.DariCharges, Mode: mode, ReceivedAt: now,
    Purpose: 'REGISTRATION_CHARGES', ReversalOf: '', CreatedBy: actorSession.userId, CreatedAt: now
  });
  const securityPaymentId = nextId_('PAY', 4);
  appendRow_('PAYMENTS', {
    PaymentId: securityPaymentId, TeamId: teamId, Amount: charge.SecurityCharges, Mode: mode, ReceivedAt: now,
    Purpose: 'SECURITY', ReversalOf: '', CreatedBy: actorSession.userId, CreatedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'RECORD_PAYMENT', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: mode
  });

  return {
    dariPaymentId: dariPaymentId, securityPaymentId: securityPaymentId,
    totalReceived: Number(charge.DariCharges) + Number(charge.SecurityCharges)
  };
}
```

- [ ] **Step 4: Register the action in `backend/Main.gs`**

```javascript
  'registration.payment.record': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return recordPayment_(session, payload.teamId, payload.mode);
  },
```

- [ ] **Step 5: Push, deploy, verify it passes.**

- [ ] **Step 6: Commit**

```bash
git add backend/Registration.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 3: payment recording (Dari + Security, two-row split)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 6: Temporary receipt — template setup and generation

**Files:**
- Create: `backend/Receipts.gs`
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `findRowById_`, `findRowsByField_`, `appendRow_`, `nextId_`,
  `nextDocumentNumber_`, `getSetting_`, `_ensureSubfolder_` (already exists in `Setup.gs` from
  Phase 1 — reused here, not redefined).
- Produces: `_getRootFolder_()` — returns the Drive folder for `DriveRootFolderId`, throws
  `NOT_FOUND` if unset. Produces `createTemporaryReceiptTemplate_(actorSession)` — ADMIN only;
  idempotent (returns the existing template file if one named "Temporary Receipt Template"
  already exists in the Templates folder, only creates if missing); returns
  `{templateId, created}`. Produces `generateTemporaryReceipt_(actorSession, teamId)` — rejects
  if team/charges/payment don't exist yet, or if a TEMPORARY receipt already exists for this
  team (`ALREADY_GENERATED`); duplicates the template, replaces placeholder tokens, exports to
  PDF into `Registration/Temporary Receipts/`, deletes the intermediate Slides copy, appends
  one RECEIPTS row, writes `AUDIT_LOG`; returns
  `{receiptId, receiptNumber, pdfFileId, pdfUrl}`.

**This is the highest-risk task in this phase — the first document generation, using
mechanics verified live in this session (see the "Document generation approach" section
above) but not yet exercised end-to-end as a full pipeline. Take the verification steps
seriously; don't skip the actual PDF inspection.**

- [ ] **Step 1: Add the failing test (setup + guard behavior only — full PDF generation is
  verified via a real HTTP call in Step 5, not a unit test, since it touches Drive file
  creation extensively and a `finally`-cleaned unit test would defeat the point of proving the
  file really exists)**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'receipts_generateTemporaryReceipt_guardsMissingData', fn: test_receipts_generateTemporaryReceipt_guardsMissingData }`

- [ ] **Step 2: Push, deploy, verify it fails** (expect `generateTemporaryReceipt_ is not defined`).

- [ ] **Step 3: Implement `backend/Receipts.gs`**

```javascript
// Receipts.gs — temporary receipt template setup and generation (Google Slides → PDF).
// See docs/superpowers/plans/2026-08-17-phase-3-registration.md for the verified Slides
// mechanics this relies on: SlidesApp.create/replaceAllText/getAs('application/pdf') all
// work; custom page sizing does not (confirmed via live spike, not assumed) — physical A5
// sizing is a manual one-time step on the template file once a real format is supplied.

function _getRootFolder_() {
  const rootId = getSetting_('DriveRootFolderId', null);
  if (!rootId) throw apiError_('NOT_FOUND', 'Drive root folder not set up yet — run admin.bootstrap.setupDriveFolders first.');
  return DriveApp.getFolderById(rootId);
}

function createTemporaryReceiptTemplate_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const existing = templatesFolder.getFilesByName('Temporary Receipt Template');
  if (existing.hasNext()) {
    return { templateId: existing.next().getId(), created: false };
  }
  const pres = SlidesApp.create('Temporary Receipt Template');
  const slide = pres.getSlides()[0];
  slide.insertTextBox(
    '{{TOURNAMENT_NAME}}\n{{ORGANIZER}}\n{{DISTRICT_ADDRESS}}\n\nTEMPORARY RECEIPT\n\n' +
    'Registration No: {{REGISTRATION_NUMBER}}\nDate: {{DATE}}\n\n' +
    'Received from: {{INCHARGE_NAMES}}\nCollege: {{COLLEGE_NAME}}\nDistrict: {{DISTRICT_NAME}}\n\n' +
    'Team Members: {{TEAM_MEMBERS}}   Incharges: {{INCHARGES_COUNT}}   Total Contingent: {{TOTAL_CONTINGENT}}\n\n' +
    'Dari Charges ({{TOTAL_CONTINGENT}} x Rs {{DARI_RATE}}): Rs {{DARI_CHARGES}}\n' +
    'Grand Total (charges): Rs {{DARI_CHARGES}}\n\n' +
    'Security Amount (refundable, not a charge): Rs {{SECURITY_AMOUNT}}\n\n' +
    'Total Amount Received (Payment Mode: {{PAYMENT_MODE}}): Rs {{TOTAL_RECEIVED}}\n\n' +
    'This is a temporary receipt acknowledging the initial transaction. A final settlement ' +
    'receipt will be issued at departure.'
  );
  pres.saveAndClose();
  const fileId = pres.getId();
  DriveApp.getFileById(fileId).moveTo(templatesFolder);
  return { templateId: fileId, created: true };
}

function generateTemporaryReceipt_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);

  const charges = findRowsByField_('CHARGES', 'TeamId', teamId);
  if (charges.length === 0) throw apiError_('NOT_FOUND', 'No charges calculated yet for this team.');
  const charge = charges[0];

  const payments = findRowsByField_('PAYMENTS', 'TeamId', teamId).filter(function (p) { return p.Purpose === 'REGISTRATION_CHARGES'; });
  if (payments.length === 0) throw apiError_('NOT_FOUND', 'Payment not recorded yet for this team.');

  const existingReceipts = findRowsByField_('RECEIPTS', 'TeamId', teamId).filter(function (r) { return r.Type === 'TEMPORARY'; });
  if (existingReceipts.length > 0) {
    throw apiError_('ALREADY_GENERATED', 'A temporary receipt already exists for this team.');
  }

  const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId);
  const inchargeNames = incharges.map(function (i) { return i.Name; }).join(', ');

  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const templateFileIter = templatesFolder.getFilesByName('Temporary Receipt Template');
  if (!templateFileIter.hasNext()) {
    throw apiError_('NOT_FOUND', 'Temporary receipt template not set up — run admin.bootstrap.createReceiptTemplate first.');
  }
  const templateFile = templateFileIter.next();

  const receiptsFolder = _ensureSubfolder_(_ensureSubfolder_(_getRootFolder_(), 'Registration'), 'Temporary Receipts');
  const now = new Date();
  const receiptNumber = nextDocumentNumber_('Receipt');

  const copyFile = templateFile.makeCopy('Temp Receipt - ' + team.values.RegistrationNumber, receiptsFolder);
  const copyId = copyFile.getId();
  const pres = SlidesApp.openById(copyId);
  const totalReceived = Number(charge.DariCharges) + Number(charge.SecurityCharges);
  const replacements = {
    '{{TOURNAMENT_NAME}}': getSetting_('TournamentName', ''),
    '{{ORGANIZER}}': getSetting_('OrganizerName', ''),
    '{{DISTRICT_ADDRESS}}': getSetting_('DistrictAddress', ''),
    '{{REGISTRATION_NUMBER}}': team.values.RegistrationNumber,
    '{{DATE}}': now.toISOString().slice(0, 10),
    '{{INCHARGE_NAMES}}': inchargeNames,
    '{{COLLEGE_NAME}}': team.values.CollegeName,
    '{{DISTRICT_NAME}}': team.values.DistrictName,
    '{{TEAM_MEMBERS}}': String(team.values.NumberOfTeamMembers),
    '{{INCHARGES_COUNT}}': String(team.values.NumberOfContingentIncharges),
    '{{TOTAL_CONTINGENT}}': String(team.values.TotalContingentPersons),
    '{{DARI_RATE}}': String(charge.RateDariSnapshot),
    '{{DARI_CHARGES}}': String(charge.DariCharges),
    '{{SECURITY_AMOUNT}}': String(charge.SecurityCharges),
    '{{PAYMENT_MODE}}': payments[0].Mode,
    '{{TOTAL_RECEIVED}}': String(totalReceived)
  };
  Object.keys(replacements).forEach(function (token) {
    pres.replaceAllText(token, replacements[token]);
  });
  pres.saveAndClose();

  const pdfBlob = DriveApp.getFileById(copyId).getAs('application/pdf');
  const pdfFile = receiptsFolder.createFile(pdfBlob).setName('Receipt-' + receiptNumber.replace(/\//g, '-') + '.pdf');
  DriveApp.getFileById(copyId).setTrashed(true); // keep only the final PDF, not the intermediate Slides copy

  const receiptId = nextId_('RCT', 4);
  appendRow_('RECEIPTS', {
    ReceiptId: receiptId, ReceiptNumber: receiptNumber, Type: 'TEMPORARY', TeamId: teamId,
    SettlementId: '', GrossMealCharges: 0, GrossDariCharges: charge.DariCharges,
    GrandTotal: charge.DariCharges, FoodRefundTotal: '', NetAmount: '', AmountInWords: '',
    GeneratedAt: now.toISOString(), GeneratedBy: actorSession.userId, PdfFileId: pdfFile.getId()
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now.toISOString(), UserId: actorSession.userId, Role: actorSession.role,
    Action: 'GENERATE_TEMP_RECEIPT', Entity: 'RECEIPT', EntityId: receiptId, PreviousState: '', NewState: ''
  });

  return {
    receiptId: receiptId, receiptNumber: receiptNumber, pdfFileId: pdfFile.getId(),
    pdfUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view'
  };
}
```

Note: `receiptNumber.replace(/\//g, '-')` guards against the `/` characters in
`GCB/HPUICK/Receipt-001`-style numbers breaking the PDF filename — Drive tolerates slashes in
names technically, but avoiding them keeps filenames unambiguous.

- [ ] **Step 4: Register two actions in `backend/Main.gs`**

```javascript
  'admin.bootstrap.createReceiptTemplate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createTemporaryReceiptTemplate_(session);
  },
  'registration.receipt.generateTemporary': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return generateTemporaryReceipt_(session, payload.teamId);
  },
```

- [ ] **Step 5: Push, deploy, verify the guard test passes, then run the real template setup
  and a full real generation against production**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Phase 3 - temp receipt generation"
```

Confirm `system.selfTest` passes, then, using a real Admin session (log in first):

```bash
# 1. Create the real template (idempotent — safe to call once now)
# call action: admin.bootstrap.createReceiptTemplate with the admin session
# 2. Register a real throwaway test team, calculate its charges, record its payment
#    (registration.team.create, registration.charges.calculate, registration.payment.record)
# 3. Generate its temporary receipt (registration.receipt.generateTemporary)
```

**Then actually open the returned `pdfUrl` (or the Drive file by ID) and read it** — confirm
it's a real PDF, the placeholder tokens were genuinely replaced (no literal `{{...}}` left in
the output), and the numbers match what you expect from the rates and headcount used. This is
the one step in this whole plan where "the API call returned `ok:true`" is not sufficient
evidence — the actual PDF content is the thing being verified.

- [ ] **Step 6: Commit**

```bash
git add backend/Receipts.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 3: temporary receipt template setup and generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 7: Team listing and detail

**Files:**
- Modify: `backend/Registration.gs` (append)
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `rowsToObjects_`, `findRowById_`, `findRowsByField_`.
- Produces: `listTeams_(actorSession)` — returns an array of
  `{teamId, registrationNumber, collegeName, districtName, totalContingentPersons, status,
  registrationDateTime}` for every team. Produces `getTeamDetail_(actorSession, teamId)` —
  returns `{team, incharges, charges, payments, receipts}` where `charges` is the single
  CHARGES row or `null`, and `incharges`/`payments`/`receipts` are arrays (possibly empty).

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'registration_listAndDetailTeams', fn: test_registration_listAndDetailTeams }`

- [ ] **Step 2: Push, deploy, verify it fails.**

- [ ] **Step 3: Implement — append to `backend/Registration.gs`**

```javascript
function listTeams_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  return rowsToObjects_('TEAMS').map(function (t) {
    return {
      teamId: t.TeamId, registrationNumber: t.RegistrationNumber, collegeName: t.CollegeName,
      districtName: t.DistrictName, totalContingentPersons: t.TotalContingentPersons, status: t.Status,
      registrationDateTime: t.RegistrationDateTime
    };
  });
}

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
}
```

- [ ] **Step 4: Register two actions in `backend/Main.gs`**

```javascript
  'registration.teams.list': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { teams: listTeams_(session) };
  },
  'registration.teams.detail': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getTeamDetail_(session, payload.teamId);
  },
```

- [ ] **Step 5: Push, deploy, verify it passes.**

- [ ] **Step 6: Commit**

```bash
git add backend/Registration.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 3: team listing and detail actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 8: Registration Dashboard shell (frontend)

**Files:**
- Modify: `frontend/js/app.js` (REGISTRATION role's landing renders the dashboard)
- Create: `frontend/js/registration.js` (dashboard nav only in this task — wizard and list
  screens are Tasks 9-10)
- Modify: `frontend/index.html` (include registration.js)
- Modify: `frontend/service-worker.js` (**bump `CACHE_NAME` to `'hpuick-shell-v3'`, add
  `'./js/registration.js'` to `SHELL_FILES`** — do this now, in this task, not deferred; this
  is exactly the step Phase 2 forgot)

**Interfaces:**
- Consumes: nothing new yet (nav shell only).
- Produces: `renderRegistrationDashboard(root, user)` — two buttons, "Register New Team" and
  "Teams", plus the existing "Log Out" button; wired to `renderRegisterWizard`/`renderTeamsList`
  (defined in Tasks 9-10 — this task's dashboard can reference them by name since all
  `<script>` files load before any of them execute, matching the existing pattern from
  `users.js`/`app.js` in Phase 2).

- [ ] **Step 1: Read the current `frontend/js/app.js`'s `renderLanding` function** (it now
  has the `isAdmin` branch from Phase 2) and add a parallel `isRegistration` branch:

```javascript
function renderLanding(root, user) {
  const isAdmin = user.role === 'ADMIN';
  const isRegistration = user.role === 'REGISTRATION';
  if (isRegistration) {
    renderRegistrationDashboard(root, user);
    return;
  }
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">' + (ROLE_LABELS[user.role] || user.role) + '</p>' +
      (isAdmin
        ? '<p>Manage committee accounts below. Other screens are built in a later phase.</p>'
        : '<p>This role\'s screens are built in a later phase. Foundation phase confirms your ' +
          'login and session work end-to-end.</p>') +
      (isAdmin ? '<button id="manage-users-btn">Manage Users</button>' : '') +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  if (isAdmin) {
    document.getElementById('manage-users-btn').addEventListener('click', function () {
      renderUsersScreen(root, user);
    });
  }
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    renderLogin(root, null);
  });
}
```

(Registration gets its own full-screen dashboard rather than a button bolted onto the shared
landing card, since it has real multi-step workflows — Admin's simpler single-button case
stays as-is.)

- [ ] **Step 2: Write `frontend/js/registration.js`**

```javascript
// registration.js — Registration Dashboard nav, the registration wizard, and Teams list/detail.
// Wizard/list screens are added in Tasks 9-10 of this phase's plan; this file starts with
// just the dashboard shell.

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
    renderRegisterWizard(root, user);
  });
  document.getElementById('view-teams-btn').addEventListener('click', function () {
    renderTeamsList(root, user);
  });
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    renderLogin(root, null);
  });
}
```

- [ ] **Step 3: Include `registration.js` in `frontend/index.html`**, before `app.js`:

```html
  <script src="js/api-client.js"></script>
  <script src="js/auth.js"></script>
  <script src="js/users.js"></script>
  <script src="js/registration.js"></script>
  <script src="js/app.js"></script>
```

- [ ] **Step 4: Bump the service worker cache version**

In `frontend/service-worker.js`, change:
```javascript
const CACHE_NAME = 'hpuick-shell-v2';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];
```
to:
```javascript
const CACHE_NAME = 'hpuick-shell-v3';
const SHELL_FILES = [
  './index.html', './css/app.css', './js/api-client.js', './js/auth.js', './js/users.js',
  './js/registration.js', './js/app.js', './manifest.json', './icons/icon-192.png',
  './icons/icon-512.png'
];
```

- [ ] **Step 5: Test locally** — start `npx http-server -p 5544 -c-1` in `frontend/`, ask the
  human to log in as a Registration user (create one via the Admin Users screen first if none
  exists yet) and confirm the dashboard shows "Register New Team" and "Teams" buttons (their
  click handlers will error harmlessly until Tasks 9-10 exist — that's expected at this point,
  just confirm the dashboard itself renders correctly and Log Out still works).

- [ ] **Step 6: Commit**

```bash
git add frontend/js/app.js frontend/js/registration.js frontend/index.html frontend/service-worker.js
git commit -m "Phase 3: Registration Dashboard shell

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 9: Registration wizard (frontend)

**Files:**
- Modify: `frontend/js/registration.js` (append the wizard)
- Modify: `frontend/css/app.css` (minimal additions)
- Modify: `frontend/service-worker.js` (**bump `CACHE_NAME` to `'hpuick-shell-v4'`** — this
  task changes `registration.js`, already in `SHELL_FILES` from Task 8, so only the version
  number needs bumping here, not the file list)

**Interfaces:**
- Consumes: `apiCall` for `registration.team.create`, `registration.charges.calculate`,
  `registration.payment.record`, `registration.receipt.generateTemporary`.
- Produces: `renderRegisterWizard(root, user)` — a linear, auto-advancing flow (no back
  navigation — a front-desk data-entry workflow, not a form the operator needs to revise
  mid-flight): Team Details → Contingent Incharges (dynamic add/remove rows) → Charges
  (auto-calculated on arrival, shown for confirmation) → Payment (mode selection) → Receipt
  (generated automatically, download link shown, "Done" returns to the dashboard). Each step
  keeps accumulated state in a closure variable across the whole wizard session.

- [ ] **Step 1: Append the wizard to `frontend/js/registration.js`**

```javascript
function renderRegisterWizard(root, user) {
  const state = { teamId: null, registrationNumber: null, incharges: [{ name: '', designation: '', whatsapp: '', email: '', isPrimary: true }] };

  function renderTeamDetailsStep() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Register Team — Step 1 of 4</h1>' +
        '<div id="wizard-error" class="error" style="display:none"></div>' +
        '<form id="team-details-form">' +
          '<label>College Name<input type="text" id="college-name" required></label>' +
          '<label>District Name<input type="text" id="district-name" required></label>' +
          '<label>Number of Team Members<input type="number" id="team-members" min="1" required></label>' +
          '<div id="incharges-container"></div>' +
          '<button type="button" id="add-incharge-btn" style="background:#666">+ Add Contingent Incharge</button>' +
          '<button type="submit">Next: Calculate Charges</button>' +
        '</form>' +
        '<button id="cancel-btn" style="margin-top:8px;background:#999">Cancel</button>' +
      '</div>';

    function renderInchargeRows() {
      const container = document.getElementById('incharges-container');
      container.innerHTML = state.incharges.map(function (inc, i) {
        return '<fieldset style="margin:12px 0;padding:10px;border:1px solid #ddd;border-radius:8px">' +
          '<legend>Incharge ' + (i + 1) + '</legend>' +
          '<label>Name<input type="text" data-field="name" data-idx="' + i + '" value="' + inc.name + '" required></label>' +
          '<label>Designation<input type="text" data-field="designation" data-idx="' + i + '" value="' + inc.designation + '"></label>' +
          '<label>WhatsApp<input type="text" data-field="whatsapp" data-idx="' + i + '" value="' + inc.whatsapp + '"></label>' +
          '<label>Email<input type="email" data-field="email" data-idx="' + i + '" value="' + inc.email + '"></label>' +
          '<label><input type="radio" name="primary-incharge" data-idx="' + i + '" ' + (inc.isPrimary ? 'checked' : '') + ' style="width:auto;display:inline"> Primary contact</label>' +
        '</fieldset>';
      }).join('');
      Array.prototype.forEach.call(container.querySelectorAll('input[data-field]'), function (el) {
        el.addEventListener('input', function () {
          state.incharges[Number(el.getAttribute('data-idx'))][el.getAttribute('data-field')] = el.value;
        });
      });
      Array.prototype.forEach.call(container.querySelectorAll('input[name="primary-incharge"]'), function (el) {
        el.addEventListener('change', function () {
          state.incharges.forEach(function (inc, i) { inc.isPrimary = i === Number(el.getAttribute('data-idx')); });
        });
      });
    }
    renderInchargeRows();

    document.getElementById('add-incharge-btn').addEventListener('click', function () {
      state.incharges.push({ name: '', designation: '', whatsapp: '', email: '', isPrimary: false });
      renderInchargeRows();
    });

    document.getElementById('cancel-btn').addEventListener('click', function () {
      renderRegistrationDashboard(root, user);
    });

    document.getElementById('team-details-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('wizard-error');
      errEl.style.display = 'none';
      try {
        const result = await apiCall('registration.team.create', {
          collegeName: document.getElementById('college-name').value.trim(),
          districtName: document.getElementById('district-name').value.trim(),
          numberOfTeamMembers: Number(document.getElementById('team-members').value),
          incharges: state.incharges
        });
        state.teamId = result.teamId;
        state.registrationNumber = result.registrationNumber;
        renderChargesStep();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  async function renderChargesStep() {
    root.innerHTML = '<div class="wizard-card"><h1>Register Team — Step 2 of 4</h1><p>Calculating charges…</p></div>';
    try {
      const charges = await apiCall('registration.charges.calculate', { teamId: state.teamId });
      state.charges = charges;
      root.innerHTML =
        '<div class="wizard-card">' +
          '<h1>Register Team — Step 2 of 4</h1>' +
          '<p class="subtitle">Registration No. ' + state.registrationNumber + '</p>' +
          '<table><tbody>' +
            '<tr><td>Total Contingent</td><td>' + charges.totalContingentPersons + '</td></tr>' +
            '<tr><td>Dari Charges</td><td>Rs ' + charges.dariCharges + '</td></tr>' +
            '<tr><td>Security (refundable, not a charge)</td><td>Rs ' + charges.securityCharges + '</td></tr>' +
            '<tr><td><b>Total to Collect</b></td><td><b>Rs ' + charges.totalPayable + '</b></td></tr>' +
          '</tbody></table>' +
          '<button id="next-payment-btn">Next: Record Payment</button>' +
        '</div>';
      document.getElementById('next-payment-btn').addEventListener('click', function () { renderPaymentStep(); });
    } catch (err) {
      root.innerHTML = '<div class="wizard-card"><h1>Register Team</h1><p class="error">' + err.message + '</p></div>';
    }
  }

  function renderPaymentStep() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Register Team — Step 3 of 4</h1>' +
        '<p>Total to collect: Rs ' + state.charges.totalPayable + '</p>' +
        '<div id="wizard-error" class="error" style="display:none"></div>' +
        '<form id="payment-form">' +
          '<label>Payment Mode<select id="payment-mode">' +
            '<option value="Cash">Cash</option>' +
            '<option value="Online">Online / Bank Transfer</option>' +
            '<option value="Cheque">Cheque</option>' +
          '</select></label>' +
          '<button type="submit">Confirm Payment Received</button>' +
        '</form>' +
      '</div>';
    document.getElementById('payment-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('wizard-error');
      errEl.style.display = 'none';
      try {
        await apiCall('registration.payment.record', { teamId: state.teamId, mode: document.getElementById('payment-mode').value });
        renderReceiptStep();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  async function renderReceiptStep() {
    root.innerHTML = '<div class="wizard-card"><h1>Register Team — Step 4 of 4</h1><p>Generating temporary receipt…</p></div>';
    try {
      const receipt = await apiCall('registration.receipt.generateTemporary', { teamId: state.teamId });
      root.innerHTML =
        '<div class="wizard-card">' +
          '<h1>Registration Complete</h1>' +
          '<p class="subtitle">Registration No. ' + state.registrationNumber + '</p>' +
          '<p>Receipt No. ' + receipt.receiptNumber + '</p>' +
          '<a href="' + receipt.pdfUrl + '" target="_blank" rel="noopener"><button type="button">View / Download Receipt</button></a>' +
          '<button id="done-btn" style="margin-top:12px">Done</button>' +
        '</div>';
      document.getElementById('done-btn').addEventListener('click', function () { renderRegistrationDashboard(root, user); });
    } catch (err) {
      root.innerHTML = '<div class="wizard-card"><h1>Register Team</h1><p class="error">' + err.message + '</p></div>';
    }
  }

  renderTeamDetailsStep();
}
```

- [ ] **Step 2: Add minimal CSS — append to `frontend/css/app.css`**

```css
.wizard-card { background: var(--card-bg); border-radius: 12px; padding: 24px; max-width: 520px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
fieldset { border-radius: 8px; }
legend { font-weight: 600; color: var(--brand); padding: 0 6px; }
```

- [ ] **Step 3: Bump `CACHE_NAME` to `'hpuick-shell-v4'`** in `frontend/service-worker.js`
  (file list unchanged from Task 8, only the version string).

- [ ] **Step 4: Test locally** — full run-through with the human: register a real test team
  (2 incharges), confirm charges display matches `rate × headcount` math by hand, confirm
  payment step submits, confirm a receipt is generated and the "View / Download Receipt" link
  opens a real PDF with the correct data.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/registration.js frontend/css/app.css frontend/service-worker.js
git commit -m "Phase 3: registration wizard (team, charges, payment, receipt)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 10: Teams list and detail (frontend)

**Files:**
- Modify: `frontend/js/registration.js` (append)
- Modify: `frontend/service-worker.js` (**bump `CACHE_NAME` to `'hpuick-shell-v5'`**)

**Interfaces:**
- Consumes: `apiCall` for `registration.teams.list`, `registration.teams.detail`.
- Produces: `renderTeamsList(root, user)` — a simple table (Registration No., College,
  District, Total Contingent, Status), each row clickable to a detail view showing incharges,
  charges, payments, and a receipt download link if one exists. **No search this phase** —
  the plan's approved scope decision kept Phase 3 minimal; add search when the team count
  grows enough to need it (explicitly deferred, not silently dropped).

- [ ] **Step 1: Append to `frontend/js/registration.js`**

```javascript
async function renderTeamsList(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Teams</h1><p>Loading…</p></div>';
  const data = await apiCall('registration.teams.list', {});
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>Teams</h1>' +
      '<table><thead><tr><th>Reg. No.</th><th>College</th><th>District</th><th>Contingent</th><th>Status</th></tr></thead>' +
      '<tbody id="teams-tbody">' +
        data.teams.map(function (t) {
          return '<tr class="team-row" data-teamid="' + t.teamId + '" style="cursor:pointer">' +
            '<td>' + t.registrationNumber + '</td><td>' + t.collegeName + '</td><td>' + t.districtName + '</td>' +
            '<td>' + t.totalContingentPersons + '</td><td>' + t.status + '</td></tr>';
        }).join('') +
      '</tbody></table>' +
      '<button id="back-btn">Back</button>' +
    '</div>';
  Array.prototype.forEach.call(document.querySelectorAll('.team-row'), function (row) {
    row.addEventListener('click', function () { renderTeamDetail(root, user, row.getAttribute('data-teamid')); });
  });
  document.getElementById('back-btn').addEventListener('click', function () { renderRegistrationDashboard(root, user); });
}

async function renderTeamDetail(root, user, teamId) {
  root.innerHTML = '<div class="wizard-card"><h1>Team Detail</h1><p>Loading…</p></div>';
  const data = await apiCall('registration.teams.detail', { teamId: teamId });
  const receipt = data.receipts.filter(function (r) { return r.Type === 'TEMPORARY'; })[0];
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>' + data.team.CollegeName + '</h1>' +
      '<p class="subtitle">' + data.team.RegistrationNumber + ' &middot; ' + data.team.DistrictName + ' &middot; ' + data.team.Status + '</p>' +
      '<h2>Incharges</h2>' +
      '<ul>' + data.incharges.map(function (i) { return '<li>' + i.Name + (i.IsPrimary === 'true' ? ' (Primary)' : '') + '</li>'; }).join('') + '</ul>' +
      (data.charges
        ? '<p>Dari: Rs ' + data.charges.DariCharges + ' &middot; Security: Rs ' + data.charges.SecurityCharges + '</p>'
        : '<p>Charges not yet calculated.</p>') +
      (receipt
        ? '<a href="https://drive.google.com/file/d/' + receipt.PdfFileId + '/view" target="_blank" rel="noopener"><button type="button">View Receipt</button></a>'
        : '<p>No receipt generated yet.</p>') +
      '<button id="back-btn" style="margin-top:12px">Back to Teams</button>' +
    '</div>';
  document.getElementById('back-btn').addEventListener('click', function () { renderTeamsList(root, user); });
}
```

- [ ] **Step 2: Bump `CACHE_NAME` to `'hpuick-shell-v5'`** in `frontend/service-worker.js`.

- [ ] **Step 3: Test locally** — confirm the Teams list shows the team registered in Task 9's
  test, clicking it shows correct detail including the receipt link.

- [ ] **Step 4: Commit**

```bash
git add frontend/js/registration.js frontend/service-worker.js
git commit -m "Phase 3: teams list and detail view

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 11: Deploy and live end-to-end verification

**Files:** none created.

- [ ] **Step 1: Push the frontend**

```bash
cd "C:\Users\princ\Downloads\HPUICK"
git subtree push --prefix=frontend frontend-origin main
```

- [ ] **Step 2: Wait for GitHub Pages to rebuild** (`gh api repos/gcbhoranj/ickpwa/pages`,
  poll until `"status":"built"` — same pattern as Phase 2).

- [ ] **Step 3: Ask the human to register one real team through the live public URL**
  (`https://gcbhoranj.github.io/ickpwa/`) end to end: team details, at least one incharge,
  charges display, payment, and confirm the generated receipt PDF opens and shows correct
  data. **Do not skip this because Task 9's local test already passed** — Phase 2's incident
  proved local-only testing isn't sufficient evidence for what's actually live.

- [ ] **Step 4: If everything works, no further action.** If the service worker serves a
  stale shell again despite the version bumps in Tasks 8-10, the cause is different this time
  (version was bumped) — investigate for real rather than assuming it's the same known issue.

---

### Task 12: Documentation

**Files:**
- Modify: `docs/superpowers/dev-log.md`

- [ ] **Step 1: Append a Phase 3 entry** covering: what was built (rate management, team
  registration, charge calculation, payment recording, temporary receipt generation via
  Slides), the Slides page-sizing limitation discovered and the decision made about it, the
  explicit scope decision to keep food out of this phase, and confirmation of the live
  end-to-end registration test from Task 11 (real team, real receipt PDF, correct data).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/dev-log.md
git commit -m "Phase 3: dev log entry

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

## Phase 3 acceptance checklist

- [ ] Admin can update rates when unlocked, cannot when locked; lock/unlock both work.
- [ ] Registration can register a team with 1+ incharges; primary incharge auto-assigned if
      none specified.
- [ ] Charges calculate correctly (Dari = rate × total contingent, Security = flat amount) and
      cannot be recalculated for the same team.
- [ ] Payment recording creates exactly two PAYMENTS rows (charges + security) and cannot be
      recorded twice for the same team.
- [ ] A real temporary receipt PDF is generated, stored in
      `Registration/Temporary Receipts/`, linked on the RECEIPTS row, and — verified by
      actually opening it — contains correct data with no unreplaced `{{...}}` tokens.
- [ ] Teams list and detail show correct, live data.
- [ ] All of the above verified live on `https://gcbhoranj.github.io/ickpwa/`, not just
      localhost.
- [ ] `system.selfTest` reports all tests passing.
- [ ] Nothing from Phases 4-10 (food packages/coupons, mess scanning, accommodation, refunds,
      final documents, reports) has been built yet.
