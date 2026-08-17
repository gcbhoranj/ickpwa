# Phase 2 (Users & Roles) Implementation Plan — HPU Inter-College Kabaddi Tournament 2026

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Admin the ability to create/disable Registration, Mess, Accommodation, and
additional Admin accounts; make role-based authorization a real, reusable, tested mechanism
every future business action will use; and close out the one deferred security item from
Phase 1 (the `admin.bootstrap.*` actions were left unauthenticated pending this phase).

**Architecture:** Same PWA → Apps Script Web App → Sheets/Drive architecture as Phase 1 — no
new components. Adds one new backend authorization primitive (`requireRole_`), three new
Admin-only actions (`admin.users.create/list/setActive`), retrofits role-gating onto the
bootstrap actions, and adds one new frontend screen (Admin → Users) to the existing PWA shell.

**Tech Stack:** Same as Phase 1 — Apps Script (V8), vanilla JS PWA, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` — this plan
implements that spec's §17 Phase 2 scope ("auth (login/session) [done in Phase 1], Admin user
management, role-gated routing, access-restriction tests") plus the role permission matrix in
§12. Where this plan and the spec conflict, the spec is authoritative.

## Global Constraints

- Deployment ID (reuse for every `clasp deploy -i <id>` in this phase, do not create a new
  one): `AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI`. Web App
  URL: `https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`.
- GitHub Pages URL for the live frontend: `https://gcbhoranj.github.io/ickpwa/`. Repo:
  `https://github.com/gcbhoranj/ickpwa` (remote `frontend-origin` already configured in this
  repo). Backend Apps Script editor (only needed if a new Google service scope is touched —
  not expected this phase, since Sheets/Drive scopes are already authorized):
  `https://script.google.com/d/1TFgSbzpfbKuvgtyPwrfB5Rui4Cvrs3n5DnzirXy1vwMLC6meHJRove4f/edit`.
- **curl gotcha (still applies): never use `-L` with POST against the Web App** — capture the
  first hop's `Location:` header and issue a second plain GET to it. Write intermediate files
  inside the SDD workspace, never `/tmp`.
- Four roles, exactly: `ADMIN`, `REGISTRATION`, `MESS`, `ACCOMMODATION` (`ROLES` in
  `backend/Constants.gs` — do not add a fifth).
- Role permission matrix (spec §12), restated for this phase's scope:

  | Capability | ADMIN | REGISTRATION | MESS | ACCOMMODATION |
  |---|---|---|---|---|
  | Manage users, roles, settings | ✅ | ❌ | ❌ | ❌ |
  | Everything else in this phase | view-only or n/a | n/a | n/a | n/a |

  Every non-ADMIN role gets `FORBIDDEN` from every action this phase adds. There is nothing
  for REGISTRATION/MESS/ACCOMMODATION to *do* yet (their business screens are Phases 3, 5, 6)
  — this phase only needs to prove the authorization mechanism actually blocks them.
- **Server-side enforcement only** — the frontend hiding a nav item is never the security
  boundary, per Phase 1's established pattern. Every new action re-checks the role itself via
  `requireRole_`, independent of what the UI shows.
- Users are **disabled, never deleted** (`Active` column flips to `'false'`) — matches
  original prompt §5 ("Create users, Disable users") and keeps history intact.
- **Write `Active` as the string `'true'`/`'false'`, never a raw JS boolean** — Phase 1's own
  incident (a raw boolean silently coerced by Sheets into a string on a later write, breaking
  a strict equality check) makes this a hard rule now, not just a habit. `_isActiveFlag_`
  (already in `backend/Auth.gs`) stays as the read-side safety net regardless.
- No password-reset feature in this phase — not in the original spec's Phase 2 scope
  (§5 lists only "Create users, Disable users, Assign roles"). Don't add it; flag it in the
  dev-log as a candidate for a later phase if it turns out to be needed operationally.
- Testing model: same as Phase 1 — Apps Script has no local runner, so every backend
  red→green cycle is push → deploy (reusing the existing deployment ID) → call
  `system.selfTest` over HTTP. `system.selfTest` is now gated behind the `AllowSelfTest`
  setting (Phase 1's final fix) — it's currently `'true'` in production; leave it that way
  during this phase's development, and note in the dev-log that Admin should be able to flip
  it off later once a settings UI exists.
- **Hard lesson from Phase 1: implement exactly what each task specifies, nothing more.**
  Phase 1's Task 3 took 3 fix-rounds because an implementer added unrequested "extra
  protection" that caused a real production data-loss incident (a test helper wired into the
  public `system.selfTest` suite that wiped `DriveRootFolderId`). Every test this phase adds
  must use the same scoped, self-cleaning pattern already established in
  `backend/Tests.gs` — create one uniquely-named row, assert, delete it in a `finally` block,
  never touch any row your test didn't create.

---

## File structure this phase touches

```
/backend
  Auth.gs         Modify — add requireRole_
  Main.gs         Modify — register 3 new actions, gate 3 existing bootstrap actions
  Tests.gs        Modify — add test cases for all of the above
/frontend
  js/app.js       Modify — Admin role gets a real "Users" screen instead of the placeholder
  js/users.js     Create — Admin Users screen logic (list/create/toggle), kept separate from
                  app.js so app.js doesn't grow into a dump of every role's future screens
  index.html      Modify — include the new script
  css/app.css     Modify — minimal additions for the Users table/form (reuse existing classes
                  where possible, don't introduce a component framework)
/docs
  superpowers/dev-log.md   Modify — append a Phase 2 entry
```

---

### Task 1: `requireRole_` authorization helper

**Files:**
- Modify: `backend/Auth.gs` (append)
- Modify: `backend/Tests.gs` (add test case)

**Interfaces:**
- Consumes: `apiError_` (Main.gs, Phase 1), `ROLES` (Constants.gs, Phase 1).
- Produces: `requireRole_(session, allowedRoles)` — `session` is the object `requireSession_`
  already returns (`{userId, role, sessionId}`); `allowedRoles` is an array of role strings.
  Throws `apiError_('FORBIDDEN', ...)` if `session.role` is not in `allowedRoles`. Returns
  `session` unchanged on success (so call sites can chain: `const session =
  requireRole_(requireSession_(sessionId), [ROLES.ADMIN]);`).

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES` in `backend/Tests.gs`: `{ name: 'auth_requireRole', fn: test_auth_requireRole }`

- [ ] **Step 2: Push, deploy, verify it fails**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Phase 2 - requireRole (red)"
```

Then call `system.selfTest` (see Global Constraints for the curl pattern) and confirm the new
test fails with `requireRole_ is not defined`.

- [ ] **Step 3: Implement `requireRole_` — append to `backend/Auth.gs`**

```javascript
function requireRole_(session, allowedRoles) {
  if (allowedRoles.indexOf(session.role) === -1) {
    throw apiError_('FORBIDDEN', 'Your role does not have access to this action.');
  }
  return session;
}
```

- [ ] **Step 4: Push, deploy, verify it passes**

Confirm `system.selfTest` now shows this test passing alongside the 6 pre-existing ones
(7/7 total).

- [ ] **Step 5: Commit**

```bash
git add backend/Auth.gs backend/Tests.gs
git commit -m "Phase 2: requireRole_ authorization helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 2: `admin.users.create` action

**Files:**
- Modify: `backend/Auth.gs` (append `createUser_`)
- Modify: `backend/Main.gs` (register the action)
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `requireSession_`, `hashPassword_`, `generateSalt_` (Auth.gs),
  `appendRow_`, `rowsToObjects_` (SheetHelpers.gs), `nextId_` (IdGenerator.gs), `ROLES`
  (Constants.gs).
- Produces: `createUser_(actorSession, name, role, loginId, email, password)` — validates
  `role` is one of `ROLES.*`; for `role === ROLES.ADMIN` requires a non-empty `email` and
  leaves `loginId` blank; for the other three roles requires a non-empty `loginId` and leaves
  `email` optional; rejects if the chosen `loginId`/`email` is already used by ANY existing
  user row (active or not — prevents a re-enabled old account colliding with a new one);
  hashes the password; appends the row with `Active: 'true'`; writes an `AUDIT_LOG` entry;
  returns `{userId, name, role, loginId, email}` (never the hash/salt/password). Registered
  as action `admin.users.create`, gated to `[ROLES.ADMIN]`.

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'auth_createUser_validationAndUniqueness', fn: test_auth_createUser_validationAndUniqueness }`

- [ ] **Step 2: Push, deploy, verify it fails** (expect `createUser_ is not defined`).

- [ ] **Step 3: Implement `createUser_` — append to `backend/Auth.gs`**

```javascript
function createUser_(actorSession, name, role, loginId, email, password) {
  requireRole_(actorSession, [ROLES.ADMIN]);

  if (!ROLES.hasOwnProperty(role)) {
    throw apiError_('INVALID_ROLE', 'Role must be one of: ' + Object.keys(ROLES).join(', '));
  }
  if (role === ROLES.ADMIN) {
    if (!email) throw apiError_('VALIDATION_ERROR', 'Admin accounts require an email address.');
  } else {
    if (!loginId) throw apiError_('VALIDATION_ERROR', 'Non-admin accounts require a Login ID.');
  }

  const existing = rowsToObjects_('USERS');
  const identifierTaken = existing.some(function (u) {
    return (loginId && u.LoginId === loginId) || (email && u.Email === email);
  });
  if (identifierTaken) {
    throw apiError_('DUPLICATE_IDENTIFIER', 'That Login ID or email is already in use.');
  }

  const salt = generateSalt_();
  const userId = nextId_('USR', 4);
  const now = new Date().toISOString();
  appendRow_('USERS', {
    UserId: userId, Name: name, Email: email || '', LoginId: loginId || '', Role: role,
    PasswordHash: hashPassword_(password, salt), PasswordSalt: salt, Active: 'true',
    CreatedDate: now, LastLoginAt: '', CreatedBy: actorSession.userId, CreatedAt: now,
    UpdatedBy: actorSession.userId, UpdatedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'CREATE_USER', Entity: 'USER', EntityId: userId, PreviousState: '', NewState: role
  });
  return { userId: userId, name: name, role: role, loginId: loginId || '', email: email || '' };
}
```

- [ ] **Step 4: Register the action in `backend/Main.gs`**

Add to the `ACTIONS` object:

```javascript
  'admin.users.create': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createUser_(session, payload.name, payload.role, payload.loginId, payload.email, payload.password);
  },
```

- [ ] **Step 5: Push, deploy, verify it passes** (8/8 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/Auth.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 2: admin.users.create action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 3: `admin.users.list` action

**Files:**
- Modify: `backend/Auth.gs` (append `listUsers_`)
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `rowsToObjects_`, `ROLES`.
- Produces: `listUsers_(actorSession)` — gated to `[ROLES.ADMIN]`, returns an array of every
  USERS row with `PasswordHash`/`PasswordSalt` stripped:
  `{userId, name, email, loginId, role, active, createdDate, lastLoginAt}`. Registered as
  `admin.users.list`.

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'auth_listUsers_excludesSecretsAndGatesRole', fn: test_auth_listUsers_excludesSecretsAndGatesRole }`

- [ ] **Step 2: Push, deploy, verify it fails.**

- [ ] **Step 3: Implement `listUsers_` — append to `backend/Auth.gs`**

```javascript
function listUsers_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  return rowsToObjects_('USERS').map(function (u) {
    return {
      userId: u.UserId, name: u.Name, email: u.Email, loginId: u.LoginId, role: u.Role,
      active: _isActiveFlag_(u.Active), createdDate: u.CreatedDate, lastLoginAt: u.LastLoginAt
    };
  });
}
```

- [ ] **Step 4: Register in `backend/Main.gs`**

```javascript
  'admin.users.list': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { users: listUsers_(session) };
  },
```

- [ ] **Step 5: Push, deploy, verify it passes** (9/9 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/Auth.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 2: admin.users.list action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 4: `admin.users.setActive` action (with last-admin lockout guard)

**Files:**
- Modify: `backend/Auth.gs` (append `setUserActive_`)
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireRole_`, `rowsToObjects_`, `findRowById_`, `updateRowById_`, `ROLES`.
- Produces: `setUserActive_(actorSession, userId, active)` — gated to `[ROLES.ADMIN]`;
  `active` is a real JS boolean at the function boundary but is written to the sheet as the
  string `'true'`/`'false'` (never a raw boolean, per Global Constraints); if the target user
  is `Role === ROLES.ADMIN` and `active === false`, first counts other rows with
  `Role === ROLES.ADMIN && _isActiveFlag_(Active) && UserId !== userId` — if that count is 0,
  throws `apiError_('LAST_ADMIN', 'Cannot disable the only active Admin account.')` instead of
  proceeding. Writes an `AUDIT_LOG` entry on success. Returns `{userId, active}`.

- [ ] **Step 1: Add the failing test**

```javascript
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
```

Add to `TEST_CASES`: `{ name: 'auth_setUserActive_togglesAndGuardsLastAdmin', fn: test_auth_setUserActive_togglesAndGuardsLastAdmin }`

- [ ] **Step 2: Push, deploy, verify it fails.**

- [ ] **Step 3: Implement `setUserActive_` — append to `backend/Auth.gs`**

```javascript
function setUserActive_(actorSession, userId, active) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const target = findRowById_('USERS', 'UserId', userId);
  if (!target) throw apiError_('NOT_FOUND', 'No such user: ' + userId);

  if (target.values.Role === ROLES.ADMIN && active === false) {
    const otherActiveAdmins = rowsToObjects_('USERS').filter(function (u) {
      return u.Role === ROLES.ADMIN && _isActiveFlag_(u.Active) && u.UserId !== userId;
    });
    if (otherActiveAdmins.length === 0) {
      throw apiError_('LAST_ADMIN', 'Cannot disable the only active Admin account.');
    }
  }

  const now = new Date().toISOString();
  updateRowById_('USERS', 'UserId', userId, {
    Active: active ? 'true' : 'false', UpdatedBy: actorSession.userId, UpdatedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: active ? 'ENABLE_USER' : 'DISABLE_USER', Entity: 'USER', EntityId: userId,
    PreviousState: '', NewState: active ? 'true' : 'false'
  });
  return { userId: userId, active: active };
}
```

- [ ] **Step 4: Register in `backend/Main.gs`**

```javascript
  'admin.users.setActive': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return setUserActive_(session, payload.userId, !!payload.active);
  },
```

- [ ] **Step 5: Push, deploy, verify it passes** (10/10 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/Auth.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 2: admin.users.setActive action with last-admin guard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 5: Gate the bootstrap actions behind ADMIN role

**Files:**
- Modify: `backend/Main.gs`
- Modify: `backend/Tests.gs`

**Interfaces:**
- Consumes: `requireSession_`, `requireRole_`, `ROLES`.
- Produces: no new functions — `admin.bootstrap.setupSchema`, `admin.bootstrap.seedSettings`,
  and `admin.bootstrap.setupDriveFolders` now require an authenticated ADMIN session.
  `admin.bootstrap.seedFirstAdmin` stays exactly as-is (unauthenticated, self-limiting to
  "only when zero admins exist") — do not touch it, gating it would make it impossible to
  ever seed the very first admin.

This was flagged explicitly in Phase 1's final review and ledger as deferred to this phase:
these three actions were left reachable by anyone with the deployment URL because no
role-checking mechanism existed yet. It exists now (Task 1) — close this out.

- [ ] **Step 1: Add the failing test**

```javascript
function test_bootstrap_actionsRequireAdmin() {
  const messSession = { userId: 'USR-0001', role: ROLES.MESS, sessionId: 'y' };
  ['setupSchema_', 'seedSettings_', 'setupDriveFolders_'].forEach(function () {}); // (no-op, just documents intent)

  let threw1 = false;
  try { requireRole_(messSession, [ROLES.ADMIN]); } catch (err) { threw1 = true; assertEqual_(err.code, 'FORBIDDEN', 'requireRole_ gate check'); }
  assertTrue_(threw1, 'requireRole_ sanity check failed');
}
```

This test is intentionally light — Task 1's `test_auth_requireRole` already thoroughly covers
`requireRole_` itself; this task is about wiring it into three existing action handlers in
`Main.gs`, which is better verified with a real end-to-end HTTP check (Step 5 below) than a
unit test, since the thing that could actually be wrong is the *wiring*, not the helper.

Add to `TEST_CASES`: `{ name: 'bootstrap_actionsRequireAdmin', fn: test_bootstrap_actionsRequireAdmin }`

- [ ] **Step 2: Push, deploy, verify this trivial test passes** (it doesn't depend on the
  wiring change, so it should pass immediately — that's fine, the real verification is Step 5).

- [ ] **Step 3: Update `backend/Main.gs`'s three bootstrap action handlers**

Change:
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
to:
```javascript
  'admin.bootstrap.setupSchema': function (payload, sessionId) {
    requireRole_(requireSession_(sessionId), [ROLES.ADMIN]);
    return { sheetsEnsured: setupSchema_() };
  },
  'admin.bootstrap.seedSettings': function (payload, sessionId) {
    requireRole_(requireSession_(sessionId), [ROLES.ADMIN]);
    return { keysSeeded: seedSettings_() };
  },
  'admin.bootstrap.setupDriveFolders': function (payload, sessionId) {
    requireRole_(requireSession_(sessionId), [ROLES.ADMIN]);
    return setupDriveFolders_();
  },
```
Leave `admin.bootstrap.seedFirstAdmin` untouched.

- [ ] **Step 4: Push and deploy.**

- [ ] **Step 5: Real end-to-end verification — the actual point of this task**

```bash
URL="https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec"
```

Confirm calling `admin.bootstrap.setupSchema` **without** a `sessionId` now returns
`{"ok":false,"error":{"code":"UNAUTHORIZED",...}}` (not the old idempotent success response).
Then log in as the real Admin (credentials known to the human, do not hardcode/log the
password — see Task 7 for the login pattern) and confirm calling it **with** a valid Admin
`sessionId` still succeeds (idempotent — safe to actually run against production, it just
re-ensures the 25 sheets already there).

- [ ] **Step 6: Commit**

```bash
git add backend/Main.gs backend/Tests.gs
git commit -m "Phase 2: gate admin.bootstrap.* actions behind ADMIN role

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 6: Admin "Users" frontend screen

**Files:**
- Create: `frontend/js/users.js`
- Modify: `frontend/index.html` (include the new script)
- Modify: `frontend/js/app.js` (Admin's landing renders the Users screen instead of the
  Phase-1 placeholder; other roles' landing is unchanged)
- Modify: `frontend/css/app.css` (minimal additions for a table and a form — reuse the
  existing `form input`/`button` rules from Phase 1 where possible)

**Interfaces:**
- Consumes: `apiCall` (`frontend/js/api-client.js`, Phase 1) for `admin.users.list`,
  `admin.users.create`, `admin.users.setActive`.
- Produces: `renderUsersScreen(root, user)` (in `users.js`) — renders a table of existing
  users (Name, Login ID/Email, Role, Active, Created) with an Enable/Disable button per row,
  and an "+ Add User" form (Name, Role select, Login ID input — hidden/not required when Role
  is Admin, Email input — required when Role is Admin, Password input). On successful create,
  re-fetches and re-renders the list. Errors from `apiCall` are shown inline, not thrown to
  the console.

- [ ] **Step 1: Write `frontend/js/users.js`**

```javascript
// users.js — Admin's user management screen. Only reachable when the logged-in role is ADMIN
// (server-side enforced regardless — see backend/Auth.gs's requireRole_ on every action here).

async function renderUsersScreen(root, user) {
  root.innerHTML =
    '<div class="users-card">' +
      '<h1>Users</h1>' +
      '<p class="subtitle">Signed in as ' + user.name + ' (Admin)</p>' +
      '<div id="users-error" class="error" style="display:none"></div>' +
      '<table id="users-table"><thead><tr>' +
        '<th>Name</th><th>Login ID / Email</th><th>Role</th><th>Active</th><th></th>' +
      '</tr></thead><tbody id="users-tbody"></tbody></table>' +
      '<h2>Add User</h2>' +
      '<form id="add-user-form">' +
        '<label>Name<input type="text" id="new-name" required></label>' +
        '<label>Role<select id="new-role">' +
          '<option value="REGISTRATION">Registration</option>' +
          '<option value="MESS">Mess</option>' +
          '<option value="ACCOMMODATION">Accommodation</option>' +
          '<option value="ADMIN">Admin</option>' +
        '</select></label>' +
        '<label id="loginid-label">Login ID<input type="text" id="new-loginid"></label>' +
        '<label id="email-label" style="display:none">Email<input type="email" id="new-email"></label>' +
        '<label>Password<input type="password" id="new-password" required></label>' +
        '<button type="submit">Add User</button>' +
      '</form>' +
      '<button id="back-btn" style="margin-top:16px">Back</button>' +
    '</div>';

  const roleSelect = document.getElementById('new-role');
  roleSelect.addEventListener('change', function () {
    const isAdmin = roleSelect.value === 'ADMIN';
    document.getElementById('loginid-label').style.display = isAdmin ? 'none' : 'block';
    document.getElementById('email-label').style.display = isAdmin ? 'block' : 'none';
  });

  async function refreshList() {
    const data = await apiCall('admin.users.list', {});
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = data.users.map(function (u) {
      return '<tr>' +
        '<td>' + u.name + '</td>' +
        '<td>' + (u.loginId || u.email) + '</td>' +
        '<td>' + u.role + '</td>' +
        '<td>' + (u.active ? 'Active' : 'Disabled') + '</td>' +
        '<td><button data-userid="' + u.userId + '" data-active="' + u.active + '" class="toggle-btn">' +
          (u.active ? 'Disable' : 'Enable') + '</button></td>' +
      '</tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.toggle-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('users-error');
        errEl.style.display = 'none';
        try {
          await apiCall('admin.users.setActive', {
            userId: btn.getAttribute('data-userid'),
            active: btn.getAttribute('data-active') !== 'true'
          });
          await refreshList();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });
  }

  document.getElementById('add-user-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const errEl = document.getElementById('users-error');
    errEl.style.display = 'none';
    const role = roleSelect.value;
    try {
      await apiCall('admin.users.create', {
        name: document.getElementById('new-name').value.trim(),
        role: role,
        loginId: document.getElementById('new-loginid').value.trim(),
        email: document.getElementById('new-email').value.trim(),
        password: document.getElementById('new-password').value
      });
      document.getElementById('add-user-form').reset();
      await refreshList();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  document.getElementById('back-btn').addEventListener('click', function () {
    renderLanding(root, user);
  });

  await refreshList();
}
```

- [ ] **Step 2: Wire it into `frontend/js/app.js`'s `renderLanding`**

`frontend/js/app.js` currently has this `renderLanding` function (Phase 1, unchanged since):

```javascript
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
```

Replace it with:

```javascript
function renderLanding(root, user) {
  const isAdmin = user.role === 'ADMIN';
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

The only changes: an `isAdmin` flag, a conditional subtitle paragraph, a conditional "Manage
Users" button (Admin only) wired to `renderUsersScreen` from `users.js`, and the existing
Log Out button/handler untouched. The other three roles render exactly as Phase 1 left them.

- [ ] **Step 3: Include `users.js` in `frontend/index.html`**

Add `<script src="js/users.js"></script>` before `<script src="js/app.js"></script>` (users.js
defines `renderUsersScreen`, which `app.js` calls — load order matters for plain `<script>`
tags without modules).

- [ ] **Step 4: Add minimal CSS for the table — append to `frontend/css/app.css`**

```css
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.85rem; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
.users-card { background: var(--card-bg); border-radius: 12px; padding: 24px; max-width: 600px; width: 100%; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.toggle-btn { width: auto; margin: 0; padding: 4px 10px; font-size: 0.8rem; }
```

- [ ] **Step 5: Test locally**

```bash
cd "C:\Users\princ\Downloads\HPUICK\frontend"
npx --yes http-server -p 5544 -c-1
```

Ask the human to open `http://localhost:5544/index.html`, log in as Admin, click "Manage
Users", confirm the existing admin account appears in the table, create a new test user
(any role), confirm it appears, click Disable/Enable and confirm the state updates, click
Back and confirm it returns to the landing screen. Do NOT skip this — it's the only real test
of the frontend logic.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/users.js frontend/js/app.js frontend/index.html frontend/css/app.css
git commit -m "Phase 2: Admin Users management screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 7: Live access-restriction verification (the actual point of "Users & Roles")

**Files:** none created — this task is pure verification against the real production system,
matching Phase 1's rigor of proving things work end-to-end, not just in unit tests.

- [ ] **Step 1: Create a real MESS test account via the live Admin UI or curl**

Either through the Task 6 UI (if deployed to GitHub Pages already) or via curl as the
Admin session, create a user: Name "Test Mess Access Check", Role MESS, Login ID e.g.
`MESSCHECK1`, a password you choose for this check (not a real operational account — this can
be disabled again afterward, or left as the first real Mess account if the human wants to
keep it).

- [ ] **Step 2: Log in as that MESS account and confirm the landing screen has no "Manage
  Users" button** (client-side check — quick, but not the real security boundary).

- [ ] **Step 3: The real check — attempt `admin.users.list` and `admin.bootstrap.setupSchema`
  using the MESS session's `sessionId`, via curl, bypassing the frontend entirely**

```bash
curl -s -i -X POST -H "Content-Type: text/plain" \
  --data-raw '{"action":"admin.users.list","sessionId":"<the MESS session id>"}' \
  "$URL" > hop1.txt
# follow redirect per the established pattern, confirm the response is:
# {"ok":false,"error":{"code":"FORBIDDEN",...}}
```

Do the same for `admin.bootstrap.setupSchema`. Both must return `FORBIDDEN`, not succeed and
not `UNAUTHORIZED` (a MESS session IS valid/authenticated — the point is it's the wrong role,
which is a distinct failure mode from "not logged in").

- [ ] **Step 4: Confirm the MESS account CAN still do what Phase 1 already proved any
  authenticated user can do** — `auth.whoami` with its session should succeed and correctly
  report `role: "MESS"`.

- [ ] **Step 5: Report the actual curl output for all of the above** in the task's report —
  this is the evidence that role-gating genuinely works end-to-end, not just in a unit test
  that constructs a fake session object.

- [ ] **Step 6: No commit for this task** (no files change) — the SDD process's task-reviewer
  can review the report itself in place of a diff.

---

### Task 8: Documentation

**Files:**
- Modify: `docs/superpowers/dev-log.md`

- [ ] **Step 1: Append a Phase 2 entry**

```markdown
## 2026-08-1X — Phase 2 (Users & Roles) complete

- Backend: `requireRole_` authorization helper; `admin.users.create/list/setActive` actions,
  all gated to ADMIN; last-active-admin lockout guard (can't disable the only admin account);
  duplicate Login ID/email rejected; `admin.bootstrap.setupSchema/seedSettings/
  setupDriveFolders` retrofitted with the same ADMIN gate (closing out the item deferred from
  Phase 1's final review) — `admin.bootstrap.seedFirstAdmin` deliberately left unauthenticated
  since it must work before any admin exists, protected instead by its own self-limiting guard.
- Frontend: Admin gets a real "Users" screen (list/create/enable/disable) on top of the
  Phase 1 shell; Registration/Mess/Accommodation still see the Phase 1 placeholder landing —
  their real screens are Phases 3, 5, 6.
- Verified live against production: a real MESS-role test account correctly receives
  `FORBIDDEN` when attempting `admin.users.list` and `admin.bootstrap.setupSchema` via direct
  API calls (not just blocked by the UI), while its own `auth.whoami` still succeeds — proving
  the authorization boundary is server-side and role-specific, not just "logged in or not."
- Explicitly NOT built yet (later phases): password reset, Admin settings screen (rates/meal
  timings — still only editable via the raw Sheet or the bootstrap reseed), registration,
  coupons/QR, mess scanning, accommodation, refunds, documents, reports.
```

(Fill in the real date and any specifics that changed during implementation.)

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/dev-log.md
git commit -m "Phase 2: dev log entry

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011xyFscpKoxcqgodxutrHFv"
```

---

### Task 9: Deploy frontend to GitHub Pages

**Files:** none created.

- [ ] **Step 1: Push the updated frontend via git subtree**

```bash
cd "C:\Users\princ\Downloads\HPUICK"
git subtree push --prefix=frontend frontend-origin main
```

(The `frontend-origin` remote already exists from Phase 1 — no token/credential setup should
be needed this time unless the credential-manager conflict from Phase 1 recurs, in which case
use the same fix: `TOKEN=$(gh auth token)` and push to
`https://x-access-token:${TOKEN}@github.com/gcbhoranj/ickpwa.git` directly, never logging the
token.)

- [ ] **Step 2: Ask the human to verify the live Users screen** at
  `https://gcbhoranj.github.io/ickpwa/` — same checks as Task 6 Step 5, but on the real public
  URL this time, matching Phase 1's pattern of a final live-site check catching anything
  localhost testing might miss.

---

## Phase 2 acceptance checklist

- [ ] `requireRole_` exists and is used by every new action in this phase.
- [ ] Admin can create a user of each of the 4 roles via the live UI.
- [ ] Duplicate Login ID/email is rejected with a clear error.
- [ ] Admin can disable and re-enable a non-admin user via the live UI.
- [ ] Attempting to disable the only active Admin account is rejected.
- [ ] A real non-admin session gets `FORBIDDEN` (not `UNAUTHORIZED`) from `admin.users.*` and
      `admin.bootstrap.*` actions, verified via direct curl, not just UI absence.
- [ ] `admin.bootstrap.seedFirstAdmin` still works unauthenticated (still self-limiting) —
      confirm this wasn't accidentally broken by the Task 5 gating change.
- [ ] `system.selfTest` reports all tests passing (10+/10+, exact count depends on final task
      order).
- [ ] No password, hash, or salt ever appears in an API response, a report file, or a commit.
- [ ] Nothing from Phases 3-10 (registration, coupons, mess, rooms, refunds, documents,
      reports) has been built yet.
