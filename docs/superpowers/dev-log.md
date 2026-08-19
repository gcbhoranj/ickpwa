# Development Log

## 2026-08-17 — Phase 1 (Foundation) complete

- Backend: standalone Apps Script project, deployed as a Web App
  (`https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`). 25-tab Sheet schema created in the real production Sheet.
  Drive folder structure created under "HPU Inter College Kabaddi Tournament 2026".
  SETTINGS seeded with defaults (rates, blank meal timings, numbering prefixes) —
  Admin still needs to review/lock these before registration opens (Phase 3).
- Auth: password hashing (SHA-256 + per-user salt), opaque server-side sessions
  (SESSIONS sheet, 12h expiry), auth.login/auth.logout/auth.whoami actions. First
  real Admin account seeded. Session credential confirmed working as a body field,
  not a header, per the connectivity POC.
- Frontend: installable PWA shell (manifest, service worker caching the app shell
  only, never API calls), login screen, minimal per-role landing placeholder.
  Deployed to GitHub Pages at `https://gcbhoranj.github.io/ickpwa/`, tested end-to-end from a real
  device against the real backend.
- Explicitly NOT built yet (later phases): Admin user management UI, per-role
  dashboards, registration, coupons/QR, mess scanning, accommodation, refunds,
  document generation, reports. See spec §17 for the full phase order.
- Known follow-up for Phase 2 hardening: the `admin.bootstrap.*` actions are
  currently reachable by anyone who has the Web App URL. `setupSchema`/
  `seedSettings`/`setupDriveFolders` are idempotent and harmless to leave open;
  `seedFirstAdmin` self-locks once an admin exists. No change needed unless this
  assessment turns out wrong in practice.

### Bug fixed during Phase 1: Production login boolean/string coercion

During live deployment testing (Task 8), a production login bug was discovered: the admin account's `Active` flag in the USERS sheet silently flipped from a JS boolean to the string `"true"` after the first `updateRowById_` write to that row (Google Sheets coerces a raw boolean written into an already plain-text-formatted cell into its string form). This broke every login after the very first one. Root cause was found using a temporary, fully-removed diagnostic action (not guessed), and fixed with a minimal read-side `_isActiveFlag_` helper in `backend/Auth.gs` that accepts both boolean and string-"true" forms — no write-path changes. Verified against two consecutive real production logins. The same underlying Sheets behavior may affect other boolean-ish columns (e.g. `CONTINGENT_INCHARGES.Active`/`IsPrimary`) once later phases start writing them — noted for future attention, not fixed now since nothing reads them yet.

## 2026-08-17 — Phase 2 (Users & Roles) complete

- Backend: `requireRole_` authorization helper; `admin.users.create/list/setActive` actions,
  all gated to ADMIN; last-active-admin lockout guard (can't disable the only admin account);
  duplicate Login ID/email rejected; `admin.bootstrap.setupSchema/seedSettings/
  setupDriveFolders` retrofitted with the same ADMIN gate (closing out the item deferred from
  Phase 1's final review) — `admin.bootstrap.seedFirstAdmin` deliberately left unauthenticated
  since it must work before any admin exists, protected instead by its own self-limiting guard.
  All writes to `Active` continue to use the string `'true'`/`'false'` form, never a raw
  boolean, per Phase 1's incident above.
- Frontend: Admin gets a real "Users" screen (list/create/enable/disable) on top of the
  Phase 1 shell; Registration/Mess/Accommodation still see the Phase 1 placeholder landing —
  their real screens are Phases 3, 5, 6.
- Verified live against production: a real MESS-role test account correctly received
  `FORBIDDEN` when attempting `admin.users.list` and `admin.bootstrap.setupSchema` via direct
  API calls (not just blocked by the UI), while its own `auth.whoami` still succeeded — proving
  the authorization boundary is server-side and role-specific, not just "logged in or not."
  The throwaway test account was disabled again afterward.
- Explicitly NOT built yet (later phases): password reset, Admin settings screen (rates/meal
  timings — still only editable via the raw Sheet or the bootstrap reseed), registration,
  coupons/QR, mess scanning, accommodation, refunds, documents, reports.
- Operational note: while testing the live Users screen, real committee-sounding test
  accounts (Ravi/Mess, prince/Accommodation, pawan/Registration) were created via the UI by
  the human during verification — left as-is (disable/re-enable/repurpose via the Users
  screen whenever convenient; nothing about them is fake or broken, they're just early
  manual-test data).

### Bug fixed during Phase 2: stale service worker cache on redeploy

Live verification of the Task 9 deploy initially failed — the human logged into the real
public URL and saw the old Phase 1 landing screen with no "Manage Users" button, even though
the server was confirmed (via direct curl) to be serving the correct Phase 2 files. Root
cause: this is exactly the "Known Gotchas" item documented in `README.md` after Phase 1 —
`service-worker.js`'s `CACHE_NAME` must be bumped on every deploy that changes any cached
file, because the browser only re-runs the service worker's install/cache-refresh cycle when
`service-worker.js`'s own bytes change. This Task 9 deploy changed `index.html`, `app.js`,
`css/app.css`, and added `js/users.js` without touching `service-worker.js`, so browsers with
the Phase 1 worker already installed (anyone who'd visited the site before) kept serving the
stale cached shell indefinitely. Fixed by bumping `CACHE_NAME` to `'hpuick-shell-v2'` and
adding `js/users.js` to the precached `SHELL_FILES` list, then redeploying. Verified fixed on
the real live URL after a reload. **Lesson reinforced, now written twice:** bumping
`CACHE_NAME` needs to become a standard step of every frontend deploy, not just a documented
warning — worth adding a pre-deploy checklist item or an automated version stamp in a later
phase so this can't be forgotten a third time.

## 2026-08-18 — Phase 3 (Registration) complete

- Backend: `findRowsByField_` (one-to-many sheet lookups) and `nextDocumentNumber_` (the
  second, human-facing ID family — Admin-configurable prefix/next/padding, distinct from
  internal record IDs) laid the foundation. `admin.settings.updateRates` /
  `setFinancialLock` / public `registration.getInfo` manage the rate card and its lock.
  `registration.registerTeam` creates a team plus its contingent incharges (primary
  auto-assigned when none is specified). `registration.calculateCharges` computes Dari
  Charges (rate × total contingent headcount, members + incharges) and Security (a flat
  `SETTINGS.SecurityAmount`, not per-person) and guards against recalculation for the same
  team. `registration.recordPayment` writes exactly two PAYMENTS rows in one action
  (`REGISTRATION_CHARGES` + `SECURITY`) for the calculated total, no operator-supplied
  amount, and guards against double recording. `registration.listTeams` /
  `registration.getTeamDetail` round out the read side. All ten new actions gated to
  `[ADMIN, REGISTRATION]`.
- Document generation: `receipts.generateTemporaryReceipt` — the project's first real
  document pipeline, using `SlidesApp` as a template engine (`replaceAllText` +
  `getAs('application/pdf')`), no Advanced Service manifest entry needed. A live spike
  during planning found neither `SlidesApp` nor the raw Advanced Slides API can set a
  custom page size (both produced the default 720×405pt page regardless of requested
  size) — a genuine platform limitation. Decision: ship the receipt at the default page
  size now: the spec explicitly defers exact physical dimensions ("format will be
  supplied later"), so document *accuracy* is this phase's job and physical *sizing* is a
  one-time manual resize in the Slides UI whenever a real format arrives, not code this
  phase needs to handle. `RECEIPTS.GrandTotal` holds charges only (Dari, later meal),
  never Security, matching how the Phase 8 Final Receipt must present them; the temp
  receipt template shows Security as a separate non-charge line plus a computed
  "Total Amount Received." `AmountInWords` stays blank for temporary receipts —
  number-to-words is Phase 8's job.
- Scope decision (made explicit before writing the plan): this phase is **food-free**.
  Meal charges/food packages, described in the original prompt as bundled into
  registration, were moved entirely to Phase 4 per the approved design spec — `CHARGES.
  MealCharges` stays 0 and unused until then, not removed from the schema.
  `FinancialSettingsLocked` blocks rate *updates* while locked but is not a gate on charge
  *calculation* — matches the spec's description of locking as an operational safety
  practice, not a technical precondition.
- Frontend: Registration Dashboard (nav for the REGISTRATION role, replacing the Phase 1
  placeholder), the registration wizard (team + incharges → charges → payment →
  receipt), and Teams list/detail. `CACHE_NAME` bumped to `v3`/`v4`/`v5` across the three
  frontend tasks, each with its new file added to `SHELL_FILES` — no repeat of the Phase 2
  stale-cache incident.
- **No Admin Settings frontend screen yet** — Task 2's rate/lock actions are real and
  tested, but Admin still sets real rates via curl for now (Phase 1's placeholder rates,
  e.g. `SecurityAmount: '0'`, need to be set to real values before real registrations
  begin). A Settings screen is a reasonable candidate for a later phase, not built here.
- Verified live end-to-end on `https://gcbhoranj.github.io/ickpwa/` (not just localhost):
  a real team was registered with a contingent incharge, charges calculated correctly,
  payment recorded, and the generated temporary receipt PDF opened with correct data and
  no unreplaced `{{...}}` tokens — confirmed directly by the human. `system.selfTest`
  reports 19/19 passing against the live backend, including all Phase 3 cases.
- Explicitly NOT built yet (later phases): food packages/meal charges/coupons (Phase 4),
  mess scanning, accommodation, refunds, the Final Receipt and its amount-in-words
  conversion, reports, and the Admin Settings frontend screen noted above.

## 2026-08-19 — Phase 3.5 (Admin Settings, Dari Correction & Accommodation) complete

- **Dari charge correction**: `registration.calculateCharges` now charges Dari on team
  members only (`rate × NumberOfTeamMembers`), not the total contingent — incharges get a
  real room via Accommodation, not a dari/mat, so charging them for one was wrong. This
  supersedes Phase 3's original formula.
- **Admin Settings screen** (frontend): closes the gap Phase 3 explicitly deferred — Admin
  can now view/update all five rates and the financial lock through a real screen instead of
  curl.
- **Room Master, pulled forward from the real future Phase 6**: every room is one of two
  types (`ROOM_TYPES.TEAM` / `INCHARGE`), added mid-phase after live feedback — the original
  plan had one undifferentiated room pool. Team rooms are on-campus and Accommodation-
  allocated; incharge rooms are rest houses/hotels, created by Admin via Room Master (same
  allocation flow, per the human's explicit call after considering an informational-only
  alternative). A room only ever accepts allocations of its own type
  (`ROOM_TYPE_MISMATCH` guard). Capacity/remaining is always computed live from ACCOMMODATION
  rows, never stored, so it can't drift.
- **Accommodation, also widened after live feedback**: the original plan only covered
  incharges (opt-in via `CONTINGENT_INCHARGES.NeedsAccommodation`, flagged at registration).
  Team-member accommodation was added as a second, independent kind — every registered
  team's own members (`TEAMS.NumberOfTeamMembers`), unconditional, no opt-in flag needed.
  `ACCOMMODATION` gained a `SubjectType` (`TEAM` / `INCHARGE`) so a team's member-allocation
  and incharge-allocation progress track independently; a partial allocation (e.g. 13 of a
  30-capacity room) correctly leaves the room open for another team. Still deliberately
  narrow: allocate only — no reallocate/vacate/NOC, which depend on the departure workflow
  and stay in the real future Phase 6.
- **Per-item charge checkboxes**, added after live feedback: the Registration operator ticks
  which charges apply (Dari, Security) before calculating — an unticked item is charged as 0
  and left off the printed receipt entirely, not shown as "Rs 0". `calculateCharges_` takes
  `includeDari`/`includeSecurity` (default true, so pre-existing callers/tests are
  unaffected).
- **Receipt generation redesigned**, also after live feedback: previously a template file
  was pre-built once and reused per receipt via `replaceAllText({{TOKEN}})` — a static
  template can't conditionally omit a line, which the checkbox feature above needed. Receipts
  are now built fresh per team with real values directly (`_buildReceiptLayout_(pres, data)`);
  `createTemporaryReceiptTemplate_` now only exists to hold the one-time A5 page-size resize
  and leaves the template's slide blank.
- **Receipt overlap bug, root-caused and fixed**: the charges block was originally a
  `SlidesApp.Table`. Its row height silently grows past whatever height is requested (a
  Slides platform behavior), but that growth is never reflected back into the script's
  object model — `Table.getHeight()` kept reporting the small requested height, so the next
  line's position undershot and overlapped the table. Two follow-up attempts to fix it via
  column widths (`TableColumn.setWidth()`, then `Table.setColumnWidth()`) both don't exist on
  this API and threw `is not a function` live — confirmed, not guessed, against the real
  deployed script both times. Replaced the Table entirely with plain text-box rows (the same
  mechanics already used for every other line in the layout) plus a decorative border sized
  from a height the code controls directly, removing the whole class of bug. Verified by
  temporarily adding a diagnostic action (fully removed once confirmed, same technique as
  Phase 2's Active-flag bug) that rebuilt the live template, generated a real receipt PDF, and
  downloaded it for direct visual inspection — three iterations, catching a second smaller
  issue (the border line sitting on the last row's text baseline) before it was shown to the
  human again.
- **In-app navigation history** (frontend): every screen was a function overwriting
  `#app-root`'s innerHTML with no browser History API involvement, so the physical/hardware
  back button (or an edge-swipe gesture) had nothing of the app's to step back into — it
  exited the page outright, closing an installed/kiosk PWA entirely. Added
  `navigateTo`/`navigateReplace`/`resetNavigation`/`goBack` in `app.js`: `navigateTo` pushes
  one history entry per screen change and keeps its own `{fn, args}` stack; a `popstate`
  re-renders the previous screen instead of leaving the app. Every screen's own "Back" button
  now calls `goBack()` too, so the on-screen button and the physical button stay in sync
  automatically. Multi-step flows (the registration wizard, the accommodation allocate-room
  form) count as one stack entry each — going back from inside one returns to the dashboard
  that opened it, rather than trying to undo already-applied side effects (a created team, a
  recorded payment) step by step.
- Verified live end-to-end on `https://gcbhoranj.github.io/ickpwa/` across several rounds of
  human feedback, not just the automated suite: Admin rate/lock updates, Room Master (both
  room types), a full registration with a flagged incharge and the Dari/Security checkboxes,
  partial team-room allocation (13 of 30 correctly leaving 17 remaining and re-allocatable),
  incharge-room allocation, and the corrected receipt PDF (no overlap, correct Dari basis,
  signature line). `system.selfTest` reports 23/25 against the live backend — the 2 failures
  are pre-existing and environmental (the financial lock currently left `true` from the
  human's own live testing), not code defects.
- Explicitly NOT built yet (later phases): reallocation, vacating, NOC issuance, and
  per-team-member (as opposed to per-team) room allocation — all remain in the real future
  Phase 6; food packages/meal charges/coupons/QR remain Phase 4; mess scanning, refunds, the
  Final Receipt and its amount-in-words conversion, and reports remain later phases.

### Bug found and fixed during Phase 3.5: transient "Unexpected token '<'" on API calls

The human reported an occasional `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
error from the live app. Reproduced directly (not guessed) by hitting the deployed Web App
URL repeatedly with curl: Apps Script's response is itself a redirect to a one-time
`script.googleusercontent.com/macros/echo?...` content URL, and that URL occasionally isn't
ready the instant the script finishes — Google Drive serves its own "Sorry, unable to open
the file at present" HTML page instead of the real JSON. A bare retry succeeded immediately
every time; this is a transient Google-infrastructure timing issue, not a bug in this
project's code. Fixed defensively in `frontend/js/api-client.js`: `apiCall` now retries once
if parsing the response throws a `SyntaxError`. The retry re-runs the action from scratch
(a fresh script execution, not a re-fetch of the same result), which is only safe for write
actions because every write handler already guards against being called twice for the same
thing (`ALREADY_CALCULATED` / `ALREADY_PAID` / `ALREADY_GENERATED` / `DUPLICATE`, etc.) — in
the rare case the original call had actually already succeeded server-side, the retry
surfaces one of those clear "already done" errors instead of silently duplicating data,
a large improvement over the unhandled crash it replaces.
