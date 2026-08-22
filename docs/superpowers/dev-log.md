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

## 2026-08-19 — Phase 4 (Food Packages & Coupons) complete

Built directly from the committed spec (§7, §10, §14, §8) at the human's explicit direction —
no separate brainstorming/plan-approval round this phase, implemented straight through with
live verification at each step, same rigor as every other phase.

- **Package purchase** (`FoodPackages.gs`): mandatory Package 1, rolling Package 2/3+, each a
  fixed Dinner + next-day Breakfast + next-day Lunch window. Package 1 defaults to today
  (clamped into the tournament date range); Package N>1 defaults to the day after Package
  N-1's Dinner date, so coverage rolls forward with no gaps unless the operator explicitly
  overrides the date. `EligiblePersons` is a per-package snapshot — team members, plus
  incharges only if the operator opts in for that specific package — and `Amount` is the
  three-meal rate sum × EligiblePersons. One `FOOD_COUPONS` row (one QR token) is issued per
  package, one `PRINTED_COUPONS` row per eligible person, three `MEAL_ENTITLEMENTS` rows
  (Dinner/Breakfast/Lunch), and one `PAYMENTS` row (`Purpose: ADDITIONAL_PACKAGE`) — all in
  the same action, matching the spec's single-step "purchase" framing (unlike registration's
  separate charge/pay steps). **Resend** re-sends the existing digital coupon PDF, never a
  new row. **Reprint** starts a new `PrintBatchId` for the same `CouponId`/QR, never a new
  package/coupon/QR (recommendation §11).
- **QR token shortened** from a full UUID (36 chars) to 12 hex characters (~2.8×10^14
  possibilities — still astronomically unguessable at this project's scale) — smaller QR
  version, fewer modules, meaningfully faster document generation.
- **Digital coupon & printed-coupon A4 sheet** (`CouponDocuments.gs`): same template-holds-
  page-size pattern as the temporary receipt (Phase 3.5), content built fresh per generation
  with real values via text boxes/shapes, never `SlidesApp.Table` or `replaceAllText` tokens.
  The printed sheet is a 2×5 grid of 3"×2" cells with cut-guide borders, computing how many
  A4 pages a package's eligible-person count needs and leaving blank space on the final page
  rather than stretching (spec §36). Digital coupon layout was redesigned mid-phase to match
  a reference design the human supplied (`HPUICK_Meal_Coupon_Design.pdf`): dark-green header/
  footer bars, a gold "PACKAGE N" badge, a light QR panel, and labeled team/incharge fields —
  verified by generating a real PDF and reading it back, not just trusting the code.
- **Meal timing settings**, added at the human's explicit request mid-phase: Admin now sets
  Breakfast/Lunch/Dinner start/end times plus a grace-minutes tolerance (defaults 07:30-09:30,
  12:30-14:30, 19:30-21:00, ±10 min, matching the values the human specified) through a real
  Settings screen. Stored and validated now; actually *enforcing* a scan-time window against
  these is Phase 5's job (the Mess scanning utility) — this phase only makes them
  configurable and visible to that future validity check.
- **Two real bugs found and fixed live, not guessed**, both by generating a real PDF/timing a
  real call and inspecting the actual result:
  - A single `slide.insertTextBox('', ...)` (an incharge with a blank designation on file)
    then styling that empty text box threw `"The object (...) has no text"` — every coupon
    field can legitimately be blank, so the field-rendering helper now falls back to "—" for
    any null/undefined/empty value, not just the ones that happened to get tested first.
  - `updateMealTimings_`'s own test tried to restore the settings to their pre-test values in
    a `finally` block — but meal timings had never been configured through the app before
    this phase (blank since Phase 1's seed), so "restore to original" meant restoring to
    blank, which fails the same validation the update itself enforces. Fixed by not
    restoring: the real requested default values are the correct end state, not a side
    effect to undo — this also happens to be how the live Sheet's meal timings got populated
    with real values for the first time.
- **Performance investigation, resolved twice**: purchasing a package for as few as 3 people
  initially measured ~48-55 seconds — traced live (via a temporary, fully-removed timing
  diagnostic, same technique as Phase 3.5's receipt-fix investigation) to two causes: (1)
  `nextId_`/`appendRow_` calls one-per-row for meal entitlements and printed coupons, each a
  separate Sheets API round trip that scales with team size — fixed with bulk
  `nextIdBatch_`/`appendRows_` helpers (`IdGenerator.gs`/`SheetHelpers.gs`) that allocate N
  ids and write N rows in one call each; (2) `qrDrawOnSlide_` drawing a QR as hundreds of
  individual `SlidesApp.insertShape()` calls, ~12s/QR. A second attempt at (2) — batching all
  of a QR's shapes into one Advanced Slides API `Presentations.batchUpdate` call — measured
  much faster but proved *unreliable* live: intermittent `"the page could not be found"`
  errors partway through an otherwise-successful request array, at a different position each
  time, surviving a same-chunk retry. Reverted that specific optimization back to the
  basic-service approach (reliable, ~12s/QR) rather than accept a correctness risk in a
  document coupons and future mess-scanning depend on — the original *actual* problem
  (avoiding Apps Script's 6-minute execution limit) is fully solved by the id/row batching
  above (individual purchases now complete in ~30s, safely under the limit) without needing
  the risky QR optimization at all.
- **`system.selfTestSplit`, new permanent capability**: the test suite has permanently
  outgrown one Apps Script execution (the two PDF-heavy food-package tests alone run
  ~130-150s, on top of ~180-195s for everything else — close enough to the 6-minute ceiling
  to occasionally not return at all). `system.selfTest` is unchanged for whenever the full
  suite does fit; `system.selfTestSplit` (same `AllowSelfTest` gate) runs either the slow
  tests or everything else, so both halves can be verified reliably. All 28 tests pass
  (26 + 2) verified this way.
- Frontend: Team Detail gains a "Food Packages" screen (`packages.js`) — list existing
  packages with links to the digital/printed coupon PDFs, Resend/Reprint buttons, and a
  purchase form (include-incharges checkbox, optional Dinner-date override, payment mode).
  Settings screen gains the meal-timing form described above.
- Explicitly NOT built yet (Phase 5): the Mess QR scanner itself, the 10-point scan validity
  check (including the meal-timing grace window this phase only stored), group mess entry,
  excess-claim prevention, and meal order status.

## 2026-08-19 — Phase 5 (Mess Committee panel: scanning + package sales) complete

Built from a committed spec amendment (§20) after a short brainstorming round — the
10-point validity check, QR-input approach, and MealOrderStatus/scan-gating relationship
weren't fully pinned down anywhere in the repo, so those got nailed down with the human
before writing the plan, along with a scope addition decided mid-round: Mess also sells food
packages at the counter, not just Registration.

- **New `Mess.gs` module.** `_currentMeal_` determines which meal (if any) is currently
  within its configured timing window ± grace, entirely in IST (`Utilities.formatDate` with
  `Asia/Kolkata` — existing code's `.toISOString()` pattern is UTC and would have been off by
  5:30, a real bug caught before it shipped). `_resolveCoupon_` is the shared 10-point
  validity resolver (points 2-8; point 1 is the caller's `requireRole_`, points 9-10 are
  write-path only) used identically whether a coupon is found by QR token or by Coupon ID
  (`mess.searchByCouponId` — a lost/damaged-coupon lookup goes through the same strict
  validation, never a shortcut). `mess.recordUsage` is the locked check-and-commit: re-runs
  the full validity check inside the script lock, rejects with the eligible/served/remaining/
  requested numbers embedded in the error message if the claimed count exceeds remaining
  (matching the human's own worked example — a 13-person team served in visits of 6, 6, 1,
  with a 4th over-claim denied), and is idempotent on `ClientRequestId` so a retried request
  (including the frontend's documented retry-on-parse-error behavior) replays the original
  result instead of double-serving. `mess.setMealOrderStatus`/`mess.todaysSummary` round out
  the panel — order status is purely informational (mirrored onto `MEAL_ENTITLEMENTS` for a
  future refund rule) and never gates a scan, confirmed by a test that scans successfully
  against a `CLOSED` meal.
- **Denied scans are never persisted**, by design — a validation failure throws and writes
  nothing; the on-screen rejection is itself the mess operator's cue to deny entry, keeping
  `MEAL_USAGE` a clean ledger of actual consumption only.
- **Package sales — Mess gets purchase/resend/reprint parity with Registration.** A role-
  permission widening, not new backend logic: `FoodPackages.gs`'s four package actions and
  `Registration.gs`'s `listTeams_`/`getTeamDetail_` now also allow `ROLES.MESS`.
  `getTeamDetail_` redacts `charges`/`payments`/`receipts` to `null`/`[]`/`[]` for that role
  (Mess needs team identity/incharges to sell a package, never Dari/security/total-payable or
  the temp receipt) — narrowing the existing "Mess never receives payment amounts" rule to
  exclude the Packages screen specifically, where Mess does need to see the package amount to
  collect the right cash at the counter.
- **QR input: camera scan with a manual-entry fallback**, both always on the Scan screen.
  Camera decode uses the browser's native `BarcodeDetector` Shape Detection API — no vendored
  library, no network call, matching `QrEncoder.gs`'s self-contained-encoding philosophy from
  the other direction (decoding this time). The manual token/Coupon-ID fields are a full
  fallback, not a secondary option, for unsupported browsers or a damaged QR either way.
  Manual verification only (no browser extension available in this session to click through a
  real login) — syntax-checked and confirmed served correctly, but a real device/browser
  click-through of Scan and Current Meal is still worth the human doing once.
- **A real, live bug found while verifying, not guessed**: the fast test bucket grew to 36
  tests across this phase's five backend tasks and started intermittently returning Apps
  Script's "Exceeded maximum execution time" (3 consecutive failures, not a one-off) — the
  same 6-minute-ceiling problem Phase 4's two PDF-heavy tests caused originally, this time
  from accumulated Sheets API round-trip cost instead of PDF generation. Fixed the same way:
  the 7 Mess tests that build a real team+package+coupon+entitlement fixture are now flagged
  `slow: true` too (fast bucket 29/29, slow bucket 10/10, both comfortably clear of the
  ceiling) — and `system.selfTestSplit`'s own generalization (Task 1 of this phase, done
  *before* this problem reappeared) meant fixing it was a one-line flag change per test, not
  another string-matching hack.
- All 39 tests pass (29 fast + 10 slow), verified against the live deployed Web App
  (`@104`), not just pushed source.

## 2026-08-19 — Post-Phase-5 bug reports: printed-coupon orientation and QR encoding

Two live bug reports from the human, investigated with `superpowers:systematic-debugging`
(root cause before any fix, in both cases confirmed via live, external evidence — never
guessed) plus one small feature request.

- **Printed coupons landscape instead of portrait — root cause confirmed, fix blocked on a
  manual step.** `SlidesApp.create()` (basic service) always produces the 720x405pt default
  landscape size and has no `setPageSize` method; tried the Advanced Slides Service's
  `Presentations.create()` (which *documents* a `pageSize` request field) and confirmed live,
  twice, that it silently ignores the requested size and returns the untouched default
  anyway; the Slides REST API also has no `batchUpdate` request that resizes an existing
  presentation. There is genuinely no programmatic fix — reconfirms the original Phase 3
  finding. `CouponDocuments.gs`'s `_ensureBlankTemplate_` is unchanged; a permanent read-only
  diagnostic (`system.diagCouponTemplateSizes`) was added so the one-time manual Slides UI
  resize (File > Page setup > Custom, 8.27"×11.69" A4) can be verified once actually done.
  Tracing the printed-coupon grid layout math found this bug was very likely *also* the
  primary cause of the second report below for printed coupons specifically: the 2×5 grid of
  3"×2" cells is 10in tall, taller than the current wrong 5.625in-tall page, so rows 2+ (any
  team beyond ~4-5 people) were being clipped out of the exported PDF entirely.

- **QR codes not recognized by any scanner — root cause confirmed, and it was never the
  scanner.** Chased through several rounds: hardened the Scan screen's camera error handling
  first (BarcodeDetector existing on `window` doesn't mean detection actually works; the code
  now surfaces a clear status either way instead of silently doing nothing), then the human
  reported the *digital* coupon (unaffected by the layout-clipping bug above, since it uses
  relative positioning) also produced zero response on Android Chrome — the best-case
  platform for BarcodeDetector — with the camera preview and status line both confirmed
  working. That ruled out both the printed-coupon clipping theory and a device/browser gap.
  Final test: dumped `QrEncoder.gs`'s raw matrix via a new diagnostic action
  (`system.diagQrMatrix`) and fed it to `jsQR` — a real, independent, third-party decoder —
  through a rendering harness first validated with a known-good reference encoder (a control
  test: same harness, `qrcode` npm package's output, decoded perfectly). Against that same
  harness, this project's own encoder's output **did not decode at all**, confirming the QR
  codes were never actually scannable by anything, on any device — the encoder's own
  structural test (finder/timing patterns present) never verified real decodability, and the
  file's own header had flagged exactly this risk since Phase 4 ("not yet verified against a
  real QR scanner"). Manually diffing against the reference implementation found a concrete,
  named bug: `_qrPlaceFormatInfo_`'s cell-index mapping had rows and columns transposed for
  part of the format-info placement versus ISO/IEC 18004 — exactly the kind of
  easy-to-transcribe-wrong error the original file's own header had worried about in the
  abstract.
  - **Fix: full rewrite, not a patch.** Given a hand-rolled attempt had already failed once,
    patching the specific transposition bug risked missing another one just like it
    elsewhere. `QrEncoder.gs` is now a faithful, line-for-line-close port of the `qrcode` npm
    package's core algorithm (MIT licensed, itself based on Kazuhiko Arase's public-domain
    "QRCode for JavaScript") — same design principles as before (Byte mode, error-correction
    level M, GF(256) tables computed at runtime not hardcoded, no external network call) but
    kept structurally close to the verified reference instead of reorganized, and widened
    from the old versions-1-6-only cap to the full versions-1-40 range (no reason to keep the
    artificial limit once the algorithm is general). `qrDrawOnSlide_` (the Slides-drawing
    function) was untouched — only matrix *generation* was ever wrong, not rendering.
  - **Verified against jsQR before being committed** (not just re-running the existing
    structural test, which would have passed on the broken version too): three tokens working
    end-to-end through the live deployed encoder — a short hex token, a real-format 12-char
    token, and an 86-character token that forces a multi-block (version 5, 2 EC blocks)
    Reed-Solomon interleaving path — all decoded back to their exact original text.
  - The structural test's "reject an over-length token" assertion needed updating (199
    characters no longer exceeds capacity now that versions 7-40 are supported; changed to
    2501 characters, safely past even version 40's ~2331-byte level-M ceiling).
  - **Residual risk, explicitly flagged**: existing already-purchased packages' *digital*
    coupon PDFs still have the old broken QR baked in — `resendCoupon_` deliberately reuses
    the existing file rather than regenerating it. Confirmed with the human that no real
    purchases existed yet (test data only), so no regeneration action was needed this round;
    would need a new "regenerate digital coupon" action if this is ever hit against real data.
    `Reprint` (printed coupons) *does* regenerate fresh from current code, so printed coupons
    self-heal once the manual page-size fix above is done.

- **Feature**: purchasing a package now shows a confirmation banner on the Packages screen —
  "Meal Package No. `<N>` Sold to Team of `<College>`" — `purchasePackage_`'s response gained
  a `collegeName` field for this; the frontend keeps it across the post-purchase `refresh()`
  re-render via a closure variable rather than losing it. New `.success`/`--success` CSS
  token added alongside the existing `.error` pattern.

## 2026-08-20 — Per-incharge, per-meal food package entitlement

Feature request from the human: incharges mostly stay at a hotel for breakfast/dinner and
only join mess for lunch, so the single "include incharges" checkbox (applying uniformly to
all three meals) didn't match reality. Classified bounded (existing flow), short design
presented and approved in chat, no separate plan doc.

- **New sheet `PACKAGE_INCHARGE_MEALS`**: one row per incharge per package purchase
  (`IncludeBreakfast`/`IncludeLunch`/`IncludeDinner` booleans), written for every incharge on
  the team regardless of whether they opted into anything — a complete audit trail of who was
  asked and what they chose, not just who ended up included.
- **`purchasePackage_` reworked**: team members stay unconditionally eligible for every meal;
  each of the three meals' eligible count is now team members + however many incharges
  checked *that specific meal* — `MEAL_ENTITLEMENTS.EligiblePersons` can genuinely differ
  across a package's Dinner/Breakfast/Lunch for the first time, and `Amount` is a sum of
  `rate × that meal's own eligible count` instead of one flat rate-sum × one count. The
  physical coupon pool (and `FOOD_PACKAGES.EligiblePersons`) is unchanged in meaning — team
  members + incharges included in *at least one* meal, counted once each — since printed
  coupons aren't meal-specific.
- **Frontend**: Team Detail's already-fetched incharges list is threaded straight into the
  Packages purchase form (no extra API call) — the single checkbox is replaced with a table,
  one row per incharge, three checkboxes each, all starting unchecked.
- **Test bucket split again**: adding the new PDF-generating test alongside the existing
  seven Sheets-heavy Mess fixture tests in one "slow" bucket hit Apps Script's 6-minute
  ceiling a second time (3 consecutive live failures, not guessed) — the two kinds of
  "expensive" test don't scale the same way. Replaced the boolean `slow` flag with a `tier`
  property (`'pdf'` vs `'mess'`, default/omitted = fast) and a matching three-way
  `payload.only` on `system.selfTestSplit`. 40/40 tests passing across all three tiers (29
  fast + 7 mess + 4 pdf), verified against the live deployed Web App.

## 2026-08-20 — Management feedback batch: duplicate purchases, meal exclusion, payment confirmation

Four items from one management feedback message, triaged and handled separately (one real
bug via `superpowers:systematic-debugging`, one feature via a short bounded design, one small
UI addition, one requirement recorded for a not-yet-built future phase).

- **Bug: a package could be sold to the same team more than once.** Root cause (confirmed
  live, not guessed): `purchasePackage_` had zero idempotency guard and no lock — unlike
  every other write handler's `ALREADY_CALCULATED`/`ALREADY_PAID`-style pattern — despite
  `api-client.js`'s documented retry-on-transient-glitch behavior re-sending the exact same
  request body (same `requestId`) on a Google-side redirect hiccup. Fixed with two
  independent checks: a `ClientRequestId` replay guard (new `FOOD_PACKAGES` column) that
  closes the automatic-retry case — a date-only check can't, since the retry's own rolling
  default-date computation lands on a *different*, non-overlapping date, not the same one —
  and a genuine-duplicate-sale rejection comparing actual `MEAL_ENTITLEMENTS` (date, meal)
  slots directly, not `FOOD_PACKAGES`' `StartMeal`/`EndMeal` window. The first attempt at the
  second check used a naive date-range overlap and immediately broke the *legitimate* rolling
  case (Package 2's Dinner always lands the same calendar date as Package 1's Breakfast/Lunch
  by design) — caught live by the existing purchase regression test before shipping, fixed to
  compare exact (date, meal) tuples instead.
- **Feature: a package can exclude individual meals.** The scenario driving it: a team
  registering the morning after arriving too late for the previous night's Dinner should have
  Package 1 cover only Breakfast+Lunch, not a meal they were never present for. New
  `mealInclusion: {dinner, breakfast, lunch}` parameter (all default true); an excluded meal
  gets no `MEAL_ENTITLEMENTS` row at all (clean "not valid" on a scan attempt, not a zeroed
  row) and contributes nothing to `Amount`. The digital coupon's footer text and
  `listPackages_`'s new `mealsLabel` field both now describe exactly which meals a package
  covers, computed from real entitlement rows — a coupon claiming "Dinner" for a package that
  excludes it would have been actively misleading to the team and to Mess. Frontend:
  Dinner/Breakfast/Lunch checkboxes (default checked) on the purchase form, with the
  applicable date next to each updating live as the operator types a Dinner Date (mirroring
  the backend's own day-add logic client-side, no round trip needed).
- **UI: the sold-confirmation banner now states amount, payment mode, and which meals** —
  "Meal Package No. X Sold to Team of `<College>` (Breakfast + Lunch) — Rs Y received via
  Cash." — since the seller collects payment at the point of sale and this is the on-screen
  record of it.
- **Recorded, not built**: the human partner also described a requirement for the (not yet
  built) Departure/Final-Receipt phase — the final settlement receipt an incharge takes away
  must reflect only payments made for team members, not for the incharge's own charges, and
  is generated only after food/security refunds and the relieving order are finalized. Noted
  here for when that phase is actually scoped; nothing to implement yet since final-receipt
  generation doesn't exist in the system at all.
- Test suite growth pattern continued: adding this phase's two new tests pushed `pdf` (now 6
  tests) past the ceiling a fourth time (3 consecutive live failures). Rather than rebalance
  again by hand, added `system.selfTestSplit`'s `payload.name` — a permanent way to run one
  named test regardless of tier, useful both for isolating a single test and for future
  rebalances — and split `pdf` into `pdf1`/`pdf2`. 42/42 tests passing across five tiers.

## 2026-08-20 — Phase 6 (Accommodation): reallocate, vacate, NOC issuance

Closes out the scope Phase 3.5 deliberately narrowed to allocate-only (§19). Short design
recorded as spec §21 (decided with the human partner: allocation stays per-team/per-incharge,
not per-team-member — YAGNI, nothing so far has needed individual student-level tracking; NOC
issuance is both the schema's `PENDING`/`NOC_GRANTED` status flip and a generated PDF
certificate), then a lean implementation plan
(`docs/superpowers/plans/2026-08-20-phase-6-accommodation.md`), executed inline task-by-task.

- **`Accommodation.gs` gains `vacateRoom_`/`reallocateRoom_`/`listActiveAccommodation_`**
  alongside the existing `allocateRoom_`. Idempotency decided per-action by actual risk, not
  applied uniformly: `vacateRoom_` is naturally idempotent (capacity is always summed live
  from currently-`ALLOCATED` rows, so flipping an already-`VACATED` row again is a harmless
  no-op — no `ClientRequestId` needed). `reallocateRoom_` creates a **new** allocation row
  (composed as vacate + allocate under one lock), so it genuinely risks the same
  double-write-on-retry bug class the 2026-08-20 duplicate-purchase fix addressed for
  `FOOD_PACKAGES` — given a `ClientRequestId` guard (new `ACCOMMODATION` column) proactively,
  rather than waiting to rediscover the bug live.
- **New `Noc.gs`**: `ACCOMMODATION_NOC` (spec §5, reserved since Phase 1, never populated
  until now) gets `getNocStatus_`/`issueNoc_`/`createNocTemplate_`. Certificate generation
  reuses `Receipts.gs`'s Slides-copy-and-render pattern exactly (`_ensureSubfolder_`,
  `_getRootFolder_`, `_clearSlide_`), stored under a new `Accommodation/NOC Certificates`
  Drive subfolder, numbered via `nextDocumentNumber_('Accommodation')` (the
  `Numbering_Accommodation_*` settings had been seeded since Phase 1 but never consumed).
  `issueNoc_` is idempotent by finds-or-creates-the-one-row design — granting an
  already-`NOC_GRANTED` team returns the existing certificate rather than regenerating or
  erroring; no `ClientRequestId` needed since there's no financial harm in a repeat grant,
  unlike a package purchase. The certificate wording deliberately doesn't assert the rooms
  have been physically vacated, since Phase 6 issues NOC independent of the not-yet-built
  departure workflow.
- **`Registration.gs`'s `listTeams_`/`getTeamDetail_` widened to `ACCOMMODATION`**, with the
  same charges/payments/receipts redaction Phase 5 gave `MESS` — Accommodation needed a way to
  search/select a team to grant its NOC, reusing the shared Teams/Team-Detail screens exactly
  as Phase 5 did for Mess rather than building a parallel search screen.
- **Frontend**: `accommodation.js`'s dashboard gains active-allocation sections (Reallocate/
  Vacate buttons) alongside the existing pending-allocation sections, plus a Teams nav button;
  a new `renderNocScreen` (reached from Team Detail's new "Accommodation NOC" button, ACCOMMODATION-only) shows status and a Grant NOC action with a link to the generated PDF once
  granted. `registration.js`'s `renderTeamDetail` hides the Packages button and extends its
  charges-redaction condition for the ACCOMMODATION role. Service worker bumped to v21.
- **Verified live against the real deployed backend** (a fresh versioned deploy was required
  mid-task — this deployment is pinned by version, not `@HEAD`, so `clasp push` alone doesn't
  reach the live Web App URL, only `clasp deploy -i <id>` does): `fast` tier 29/31 (2 failures
  pre-existing/environmental, both in `calculateCharges_`/receipt tests this phase never
  touched — matches the dev-log's own prior note about live-Sheet test-data pollution), `mess`
  tier 7/7, `pdf1` tier 3/3 (one transient `Service Spreadsheets failed` Google-edge error,
  passed clean on retry — the same known flakiness class documented earlier in this log),
  `pdf2` tier 4/4 including the new `accommodation_issueNoc` test. One-time Admin setup
  (`admin.bootstrap.setupSchema`/`setupDriveFolders`/`createNocTemplate`) run against the live
  production Sheet with real Admin credentials supplied by the human partner.

## 2026-08-20 — Phase 7: departure lock, food refund, security refund

§17's Phase 7 cited "the dinner-ordered logic" from an original-prompt section number that was
never saved into this repo — the exact refund formula was genuinely unrecoverable. Rather than
invent a financial rule (the spec's own §105 binding constraint), this was raised with the
human partner directly, who clarified the real answer: **refund amounts are the Mess Committee
Convener's discretion, not a fixed formula.** A short follow-up question settled how the
software should support that discretion (manual per-meal entry, no calculated suggestion).
Recorded as spec §22, scoped narrower than a literal reading of §17 item 7 — no `SETTLEMENTS`
row here, that stays Phase 8 (final receipt) since Phase 7's own listed scope never mentions it.

- **New `Departure.gs`**: `initiateDeparture_`/`cancelDeparture_` implement the departure-lock
  check-and-set spec §6 point 4a already specified (`TEAMS.DepartureLockedBy/At`) — rejects a
  different user with the holder's name, idempotent-resume for the same caller, cancel by the
  holder or Admin only and never touches refunds already recorded (append-only, same
  philosophy as every other transactional tab). `recordFoodRefund_` takes
  `[{entitlementId, amount}]` — the Departure screen shows Eligible/Served/Remaining/
  MealOrderStatus per entitlement purely as reference data, the operator enters the actual
  amount per row after consulting the Convener off-system; each entitlement refundable once
  (`ALREADY_REFUNDED` on a repeat — the same double-write-on-retry guard class Phase 6 applied
  to `reallocateRoom_`, since `REFUNDS` is append-only). `recordSecurityRefund_` is gated on
  `ACCOMMODATION_NOC.Status === 'NOC_GRANTED'` (reuses Phase 6's `getNocStatus_`), amount also
  manual (charged amount shown as reference only, not prefilled — damage deductions are a real
  possibility the spec never enumerates), one per team.
- **No schema changes needed at all** — `TEAMS.DepartureLockedBy/At`, `REFUNDS`, and
  `SECURITY_REFUNDS` were already fully specified and created by earlier phases' `setupSchema`
  runs, just never populated until now.
- **Role gating narrower than Phase 6**: all `departure.*` actions are
  `[ROLES.ADMIN, ROLES.REGISTRATION]` only, per the spec's own role matrix — MESS and
  ACCOMMODATION get no access here at all, unlike the Teams-list widening Phase 6 gave them.
- **Frontend**: new `departure.js`, reached from Team Detail's new "Process Departure" button
  (REGISTRATION role only). Service worker bumped to v22.
- **Testing**: reused Phase 5's `_makeMessTestFixture_`/`_cleanupMessTestFixture_` helpers for
  a team+entitlements fixture, and wrote directly into `ACCOMMODATION_NOC` for the NOC-gating
  test rather than calling the real `issueNoc_` — that function's PDF generation is already
  covered by Phase 6's own test, so this avoided a second real Slides/Drive round trip. Both
  new tests joined `fast` (no PDF generation involved). Verified live: `fast` tier 33/33 — the
  2 tests that had failed transiently during the Phase 6 run passed clean this time, confirming
  they were environmental as suspected, not real defects.

## 2026-08-20 — Phase 8: settlement, final receipt, relieving order

Closes the departure workflow Phase 7 started. Unlike Phase 7's refund amount,
`SETTLEMENTS`' fields turned out fully derivable from data already in the sheets — a
bookkeeping rollup, not a business-judgment call — so concrete formulas were proposed to the
human partner and approved rather than left unrecoverable: `GrossMealCharges` = sum of the
team's `FOOD_PACKAGES.Amount` (confirmed live that `calculateCharges_` always writes
`CHARGES.MealCharges: 0` — food charges live entirely in packages from Phase 4 onward, not in
registration-time `CHARGES`), `GrossDariCharges` = `CHARGES.DariCharges`, `FoodRefund`/
`SecurityRefunded` sum the Phase 7 refund tables, `OtherAdjustments` is a manual optional entry
(same discretion pattern as Phase 7), `FinalBalance = FoodRefund + SecurityRefunded −
OtherAdjustments`.

- **One composite action, not a multi-step wizard** — the human partner explicitly asked for
  a speedy app flow, so `finalizeDepartureAndGenerateDocuments_` computes and persists the
  `SETTLEMENTS` row, generates the Final Receipt PDF, generates the Relieving Order PDF,
  emails both together, releases the departure lock, and sets `TEAMS.Status → RELIEVED` — all
  inside one locked server call instead of five round trips. Gated on NOC granted (hard
  precondition, matches §14's departure-workflow ordering) and the caller holding the
  departure lock. **Idempotent**: an existing `Type: FINAL` `RECEIPTS` row for the team
  short-circuits the whole call (checked both before and inside the lock) — returns the
  existing receipt/relieving IDs without regenerating PDFs or re-sending email, since a
  financial document and an email send are exactly the kind of side effect that must never
  double-fire on a retry.
- **Final Receipt reuses the existing "Temporary Receipt Template" file** (already
  manually resized to A5 portrait back in Phase 3.5) rather than creating a second template —
  `Type: FINAL` on the same `RECEIPTS` sheet. New `AmountInWords` conversion
  (`_numberToWordsIndian_`, Indian numbering, Lakh/Crore-capable — a well-defined algorithmic
  task, no ambiguity, unit-tested directly).
- **Relieving Order gets its own new template**, deliberately left at Slides' default
  landscape size — the layout is proportional (`getPageWidth()/getPageHeight()`-relative
  throughout, same technique every prior Slides layout in this codebase uses), so it renders
  correctly regardless of actual page size; only the printed-coupon grid ever genuinely needed
  the one-time A4 portrait fix, since it alone targets a fixed physical size (3"×2" cells). No
  manual resize step needed this time.
- **Signatures/seal** (explicitly Phase 8 scope, seeded since Phase 1, never consumed by any
  earlier phase): a shared `_drawSignatureOrLine_` helper draws the real image if
  `PrincipalSignatureFileId`/`RegistrationInchargeSignatureFileId`/`CollegeSealFileId` holds a
  populated Drive file ID, else falls back to the existing text-signature-line convention —
  nothing blocks on the human uploading real signature images.
- **Frontend**: `departure.js`'s Departure screen gains a live settlement preview once NOC is
  granted, computed client-side from `getDepartureOverview_`'s new `settlementPreview` field
  (shared `_computeSettlementPreview_` helper on the backend, so the preview can never drift
  from what finalize actually persists) — typing Other Adjustments updates the shown Final
  Balance with no extra round trip, then one "Finalize & Send" button.
- One-time Admin setup (`admin.bootstrap.createRelievingTemplate`) run against the live
  production Sheet. Verified live: `fast` tier 34/34, both new tests (a pure unit test plus a
  full finalize-flow integration test — NOC gating, real PDF generation for both documents,
  RELIEVED status, lock release, and an idempotent-repeat check that confirms a second finalize
  call returns the same receipt rather than creating a duplicate) passed.

## 2026-08-20 — Phase 9: dashboard, reports, audit log

Another "§75 of the original prompt" citation with no recoverable text behind it — but unlike
Phase 7's refund rule, reports are pure read-only aggregation of data that already exists (no
money moves, nothing is decided), so definitions were proposed and approved rather than left
blocking. Admin-only, matching the spec's own screen map (§13) — Reports/Dashboard/Audit Log
were never in Registration/Mess/Accommodation's nav.

- **One combined read action**, `reports.getAll` — the human partner again asked for a speedy
  app flow, so the whole Reports screen (5 tabs) loads from a single round trip: dashboard
  summary, per-team financial/food reports (every team, live), accommodation (room list +
  per-team status), departure pipeline, and a college-wise final statement scoped to teams with
  a finalized settlement only (Phase 8's output) — distinct from the financial report, which
  shows every team's running totals regardless of settlement status.
- `reports.auditLog` kept separate (different data, fetched on demand): most recent 200 rows,
  Admin sees everything, any other role would be scoped to their own `UserId` — enforced
  server-side per this project's established "the frontend hiding a button is never the
  enforcement point" rule, even though no other role's nav currently reaches an Audit Log
  screen at all.
- **Frontend**: replaced `app.js`'s long-standing placeholder Admin landing ("Other screens are
  built in a later phase," present since Phase 1) with a real `renderAdminDashboard` in new
  `reports.js` — fetches the bundle once and passes it straight into a tab-switched Reports
  screen, so switching tabs is instant with no additional network call.
- No new sheets or columns — every report reads sheets every earlier phase already populated.
  Verified live: `fast` tier 36/36, including both new tests (non-Admin `FORBIDDEN` rejection
  plus per-team aggregation correctness for the reports bundle; Admin-vs-scoped-own-rows
  behavior for the audit log).

## 2026-08-20 — Phase 10: Final QA

§17's Phase 10 cites "the original prompt's §93–§104" for its checklist — unrecoverable like
every other original-prompt citation this project has hit, so this phase's actual content was
built from two sources instead: the full regression suite every prior phase already
contributed to, plus a systematic audit of this log's own "explicitly not built yet"/"recorded,
not built" notes across Phases 1–9 to confirm each was actually closed out by a later phase.

- **New `test_e2e_fullTeamLifecycle`** — the one thing no single phase's own tests exercise:
  a continuous run through the REAL handlers (not fixture shortcuts) covering registration →
  charges → payment → temporary receipt → package purchase → three real Mess scans (Dinner/
  Breakfast/Lunch, real 10-point-checked `recordMealUsage_`, one deliberately left un-served to
  exercise the food-refund path) → room allocation → NOC → departure → food refund → finalize
  → RELIEVED → confirmed correct in the Reports bundle. Six real Slides/Drive PDF generations
  in one run; given its own `e2e` tier so it never competes with `pdf1`/`pdf2`'s budget against
  the 6-minute ceiling. **Passed on the first live run.**
- **Full regression, every tier, live against the deployed backend**: `fast` 36/36, `mess`
  7/7, `pdf1` 3/3, `pdf2` 5/5, `e2e` 1/1 — **52/52 total.**
- **Dev-log audit**: every "Explicitly NOT built yet" note from Phases 1–5 was confirmed closed
  by its named later phase (Users UI → Phase 2, Admin Settings screen → Phase 3.5, Mess scanner
  → Phase 5, reallocation/vacating/NOC → Phase 6 — per-team-member allocation was explicitly
  decided *against*, not missed, per Phase 6's own design approval). Three items did NOT
  resolve cleanly and are flagged below rather than silently left or silently patched.

**Findings requiring the human partner's decision — none blocking, none touched without
approval:**

1. **The live production Sheet has accumulated ~44 teams of development/verification data**
   (names like "Task 6 Verification College", "TEST Phase3.5 Verification College", "Live
   Receipt Verification College" mixed with what may be genuine early real registrations like
   "GC Sangrah"/"GC NAHAN") — 38 packages, Rs 65,200 of package revenue, none of it real
   tournament activity. This will skew every report/dashboard number on day one if not cleared
   before the real tournament (21–25 Sep 2026). Needs the human's judgment on what's real vs.
   test — not something to bulk-delete unilaterally.
2. **Any `FOOD_PACKAGES` row purchased before the QR encoder fix** (commit `2d634b6`,
   2026-08-19 23:27 IST) **still has the old, unscannable QR baked into its already-generated
   digital coupon PDF** — this was flagged as a residual risk when the fix shipped, deferred
   because "no real purchases existed yet." That's no longer true (38 real-looking packages now
   exist); some may predate the fix. `resendCoupon_` reuses the existing file rather than
   regenerating it, so this won't self-heal. No "regenerate digital coupon" action exists yet —
   would need one if any pre-fix package turns out to still be in play.
3. **Possible scope gap against a requirement the human explicitly gave in Phase 7**: "the
   final settlement receipt... must reflect only payments made for team members, not for the
   incharge's own charges." Phase 8's Final Receipt shows `GrossMealCharges` as one blended
   total (team members + any incharges who opted into meals) — not decomposed by
   member-vs-incharge. Flagging rather than silently changing a financial document's formula
   without confirmation, per this project's own established discipline (§105, "do not invent
   rules").
4. **"Password reset" was flagged as deferred back in Phase 2 and never revisited** — it was
   never actually in §17's 10-phase list (every other Phase-2-deferred item maps to a named
   later phase; this one doesn't), so no phase silently dropped it, but it's a real operational
   gap: no self-service or Admin-driven password reset action exists anywhere in the codebase
   today. Worth a decision on whether it's needed before the tournament.

## 2026-08-20 — Tournament Info settings, and clearing dev/test data for go-live

Two follow-ups from the Phase 10 findings, done with the human partner's explicit direction on
each rather than assumed.

- **Tournament Info now editable**: `TournamentName`/`OrganizerName`/`DistrictAddress`/
  tournament dates were seeded once in Phase 1 and printed on every generated document since,
  but had no update action — Admin's Settings screen now has a Tournament Info form
  (`admin.settings.getTournamentInfo`/`updateTournamentInfo`, ADMIN only, date-range validated).
- **All accumulated dev/verification data cleared from the live production Sheet.** Listed the
  full 45-team roster for the human partner first (finding #1 from Phase 10): a mix of obvious
  test names and realistic HP-college names that turned out to all be `Status: REGISTERED`
  only, months before the tournament opens — consistent with manual dev testing, not real
  advance registrations. Confirmed explicitly: none of it was real, safe to wipe entirely
  (Room Master included). New `resetTournamentData_` (ADMIN only, requires the literal
  `confirm:"RESET"` string) clears all 22 transactional sheets back to header-only and resets
  the six document-numbering counters to 1 — never touches `USERS`/`SESSIONS`/`LOGIN_LOG` or
  any non-numbering `SETTINGS` value, so committee logins and configured rates/timings survive
  untouched. Executed live; verified after: `reports.getAll` shows zero everywhere, all user
  accounts intact, a spot-check test still passes clean. The production Sheet is now a genuine
  blank slate, ready for real registrations.
- **Not yet addressed** (still open from Phase 10, unchanged): pre-fix-QR coupon risk (moot
  now — the packages that risk applied to no longer exist after the reset above), the
  Final-Receipt team-vs-incharge charge decomposition question, and password reset.

## 2026-08-20 — Post-launch feedback, Group A: quick fixes

Live UAT (a full test-team lifecycle run by the human partner) surfaced nine issues. Too broad
for one change — decomposed into five independent sub-projects (tournament-info sync/receipt-
visibility/NOC-auto-vacate/refund-hint fixes; a shared toast/notification component; coupon-
email delivery investigation; NOC decline+remarks workflow; signature/seal upload). This entry
covers the first, smallest group, approved and built bounded (no spec file).

- **Login screen now shows the live Tournament Name/Organizer/Dates** instead of a hardcoded
  string baked into `app.js` since Phase 1 — new no-session `public.getTournamentInfo` action
  (mirrors `getTournamentInfo_`'s shape, omits anything financial) lets the pre-login screen
  read Settings directly. Caught a real staleness bug in the process: the hardcoded text said
  "21–25 Sep 2026"; the actual configured `TournamentEndDate` is the 24th.
- **Team Detail now surfaces the FINAL receipt and the Relieving Order** once departure has been
  finalized — both were already generated by Phase 8's `finalizeDepartureAndGenerateDocuments_`
  but the frontend's "View Receipt" only ever looked for `Type: TEMPORARY`, and no Relieving
  Order link existed anywhere in the UI at all. `getTeamDetail_` now also returns `relieving`;
  `renderTeamDetail` prefers `FINAL` over `TEMPORARY` and labels which one it's showing.
- **Granting NOC now auto-vacates every ALLOCATED room (TEAM and INCHARGE) for that team** —
  `issueNoc_` previously never touched `ACCOMMODATION` at all, leaving rooms shown as occupied
  after the team had already been cleared to leave. Reuses `vacateRoom_`'s existing per-row
  idempotency, so a re-grant is a safe no-op.
- **Refund entry gets a computed hint, not an auto-filled value.** Investigated the reported
  "gross 3450 / net 3408 didn't add up" confusion: not a bug — Phase 7 deliberately made refund
  amount the Mess Convener's manual judgment call with no suggested figure at all (spec §22).
  Reversing that wasn't this decision to make silently, so this only adds a
  "Unused: N × Rs rate = Rs X" caption next to each entry (new `suggestedRefund` on
  `getDepartureOverview_`'s entitlements, informational only, never written or auto-applied) and
  relabels "Net Charges" to clarify it's food-only, security being a separate line.
- **Testing**: 4 new tests, TDD (watched each fail live against the deployed script — via
  `system.selfTestSplit`'s `payload.name` escape hatch, since the running whole `fast` tier hit
  the documented 6-minute ceiling with 39+3 tests — before implementing), then verified green;
  spot-checked the 7 most closely related existing tests for regressions, all clean. Frontend
  changes have no automated coverage (consistent with this project's existing pattern) — syntax-
  checked and the new backend action exercised directly against the live deployment instead.
  Service worker bumped to v26.
- **Not addressed here, tracked for later groups**: transaction success toasts, coupon email
  delivery (needs its own investigation), NOC decline+remarks+Registration visibility,
  signature/seal upload. Also newly noted: the `fast` test tier is now close enough to the
  6-minute ceiling (42 tests) that the next addition to it will likely need the same tier
  rebalance this project has done before (Phase 5's dev-log) — flagged, not fixed here.

## 2026-08-20 — Post-launch feedback, Group B: transaction toasts

Second of the five sub-projects from the same UAT feedback pass (see Group A above). Frontend
only, no backend changes.

- **New shared `showToast(message)`** (`app.js`) — a fixed-position, auto-dismissing (5s)
  confirmation banner appended to `document.body` rather than `#app-root`, so it survives the
  full-innerHTML screen re-renders every navigation does. Styled from the `.success` CSS
  variables already in `app.css` (Phase 4's inline confirmation used the same palette).
- **Team registration** now fires `showToast('Team from ' + collegeName + ' is Successfully
  Registered')` at the true completion point (after the temporary receipt generates — Step 4)
  — previously no confirmation message existed at all. `renderRegisterWizard`'s state now
  carries `collegeName` through the wizard to get there.
- **Package purchase**: `packages.js` already had an ad-hoc version of this (a `.success` div,
  own wording, plus a `soldConfirmation`/`lastPurchaseResult`-survives-refresh state hack built
  specifically to keep the message alive across `refresh()`'s re-render). Replaced with the
  shared toast (message updated to match: "Meal Package No. N has been offered to X Team...",
  keeping the useful meal-window/amount/payment detail) — the state hack is now unnecessary
  and removed, since a toast outside `#app-root` doesn't get wiped by `refresh()` in the first
  place. The purchased package was already guaranteed onto the panel immediately
  (`_packageRowFromPurchaseResult_`, Phase 4) — untouched.
- **Testing**: frontend-only, no automated coverage (this project's existing convention) —
  syntax-checked, diff-reviewed line by line. Service worker bumped to v27.

## 2026-08-20 — Post-launch feedback, Group C: coupon email investigation

Third sub-project. Diagnosed live (no login credentials available for the reset production
system) via a new read-only `system.diagEmailLog` action — same no-session convention as the
existing `system.diagQrMatrix`/`diagCouponTemplateSizes` — reading real `EMAIL_LOG` rows from
the human partner's own UAT test, which the recent production reset had not yet cleared.

- **Root cause: Gmail OAuth authorization gap, not a code bug, and not coupon-specific** — both
  the coupon email (Phase 4) and the Final Documents email (Phase 8) are failing with `"The
  script does not have permission to perform that action. Required permissions:
  (...gmail.send...)"`. Exactly the scenario this project's own README "Known Gotchas" already
  documents (a new/changed Google service scope needs a one-time manual consent click-through
  by the script owner) — not something fixable in code. Flagged to the human partner directly;
  re-authorization requires `gcbhoranj@gmail.com` access in the Apps Script editor.
- **Separate real bug found and fixed while diagnosing**: `finalizeDepartureAndGenerateDocuments_`
  (`FinalDocuments.gs`) discarded the actual Gmail exception on failure — always wrote
  `EMAIL_LOG.ErrorMessage: ''` — unlike `FoodPackages.gs`'s `_sendCouponEmail_`, which correctly
  captures `err.message`. This is exactly why the coupon failure was diagnosable and the Final
  Documents failure wasn't, side by side in the same sheet. Now captures `err.message` the same
  way. New regression test (`finalDocuments_emailFailureCapturesErrorMessage`) watched fail
  live against the still-broken Gmail auth (a real natural RED, not fabricated), then verified
  green after the fix — confirmed via the diagnostic action itself: pre-fix log rows have a
  blank `ErrorMessage`, post-fix rows show the real permission error.
- **Status at time of writing**: Gmail authorization still not re-granted as of the last check
  — every email send (coupon and Final Documents alike) is still `FAILED`. Needs the human
  partner's one-time consent click-through before this is fully closed.
- **Resolved same day**: the human partner completed the consent click-through directly in the
  Apps Script editor (adding a small throwaway `authorizeGmail()` function to trigger it, per
  this project's own documented process). That editor save clobbered this group's
  `ErrorMessage`-capture fix and its test in the process (whole-file overwrite, no merge — a
  real risk worth remembering for any future editor-side edit). Caught via `clasp pull` +
  diff before assuming anything; reconciled by verifying Gmail actually worked on the clobbered
  code first (a real live send, `SENT` in `EMAIL_LOG`), then restoring the correct local code
  (which also removed the now-unneeded `authorizeGmail()`, satisfying the human partner's own
  "remove after verification" instruction), then re-verifying both the fix and a real send
  again on the fully-restored code. Confirmed live: coupon and Final Documents emails both
  reach `SENT` now.

## 2026-08-20 — Post-launch feedback, Group D: NOC decline + remarks

Fourth sub-project. `ACCOMMODATION_NOC.Notes` was reserved since Phase 1 but never populated —
Status only ever became PENDING/NOC_GRANTED, with no decline path and no remarks anywhere.
Registration also had zero NOC visibility in the UI at all (Departure's overview showed a bare
status string, but only once departure was already in progress).

- **New `declineNoc_`** (`Noc.gs`, ACCOMMODATION only) — upserts the same one-row-per-team
  `ACCOMMODATION_NOC` record `issueNoc_` already does, so a later grant updates it rather than
  duplicating. Requires non-blank remarks. Refuses (`NOC_ALREADY_GRANTED`) to decline a NOC
  that's already been granted — reversing a grant would also need to un-vacate the rooms Group
  A's auto-vacate already freed, a different and riskier operation nobody asked for; decided
  with the human partner rather than assumed.
- **`issueNoc_` now clears `Notes` on grant** — a prior decline's remarks no longer linger and
  read as current once the team is actually cleared. `getNocStatus_` now always returns
  `notes` (previously omitted the field entirely).
- **`getTeamDetail_` gains a `nocStatus` field** for Registration/Admin (status + notes +
  certificate link when granted) — one round trip, matching this project's established
  "combined read" convention, so Registration sees Accommodation's decision (and, if declined,
  why) directly on Team Detail without navigating into Accommodation's own screen.
- **Frontend**: Accommodation's NOC screen gains a remarks textarea + "Decline NOC" button
  alongside "Grant NOC" (previous decline remarks shown read-only if re-visiting a declined
  team); Registration's Team Detail gains an "Accommodation NOC: X — remarks" line.
- **Testing**: TDD, watched fail live — pushed the two new tests alone first (implementation
  temporarily backed out of the working tree, not just untested) against the live deployed
  script to get a genuine RED before restoring the implementation, same discipline as every
  earlier group. Verified green, then regression-checked 5 related existing tests, all clean.
  Service worker bumped to v28.

## 2026-08-20 — Post-launch feedback, Group E: signatures & seals

Fifth and final sub-project. `PrincipalSignatureFileId`/`RegistrationInchargeSignatureFileId`/
`CollegeSealFileId` were reserved since Phase 1, and `_drawSignatureOrLine_` (Phase 8) already
knew how to draw a real image from a Settings file-id key — but nothing in the app could ever
get an image into Drive in the first place, and `PrincipalSignatureFileId` was never actually
wired into any document layout despite being seeded. Confirmed the exact mapping with the human
partner before building (their two decisions): the "Principal's Seal" is the existing College
Seal slot renamed (nothing to migrate — no signature has ever been uploaded in this app's
history), and the NOC Certificate only needs the Accommodation Convener's signature, not the
Principal's too.

- **New `uploadSignature_`** (`Settings.gs`, ADMIN only) — the first file-upload capability
  anywhere in this app. Base64-encoded image comes through the same JSON envelope every other
  action uses (no multipart support in this framework); validated against a fixed
  `SIGNATURE_SETTING_KEYS` allowlist (`Constants.gs`) so a client-supplied `key` can never
  write an arbitrary Settings row, and against a PNG/JPEG mime-type allowlist. Stores into a new
  `Signatures` Drive subfolder, trashes the previous file for that slot on re-upload so
  redoing a signature doesn't accumulate orphaned files, updates the Settings key. New
  `getSignatures_` read action for the Settings screen.
- **Four slots**: `RegistrationInchargeSignatureFileId`, `PrincipalSignatureFileId` (both
  existing keys, the latter newly wired into documents for the first time),
  `PrincipalSealFileId` (renamed from `CollegeSealFileId`), `AccommodationConvenerSignatureFileId`
  (new).
- **Document layouts updated**: Final Receipt and Relieving Order's 2-block signature row
  (Registration Convener | College Seal) becomes 3 blocks (Registration Convener | Principal |
  Principal's Seal). NOC Certificate's plain "Signature, Accommodation Committee" text line
  becomes a real `_drawSignatureOrLine_` image block.
- **Frontend**: new "Signatures & Seals" section on the Admin Settings screen — one upload slot
  per key (PNG/JPEG, 3 MB client-side cap), status + a view link once uploaded, `FileReader` →
  base64 → the existing `apiCall` envelope.
- **Testing**: TDD, watched fail live before implementing (`uploadSignature_`/`getSignatures_`
  role gate, allowlist rejection for both key and mime-type, real Drive file creation, and
  old-file cleanup on re-upload — verified via `DriveApp.getFileById(...).isTrashed()`, not just
  a returned status). Regression-checked all 6 tests touching the three changed document
  layouts (NOC grant/decline/auto-vacate, finalize+email, number-to-words) plus 6 more touching
  Setup/Settings/Constants — all clean **except** two pre-existing failures unrelated to this
  group: `FinancialSettingsLocked` is currently `true` live (real production state, evidenced
  directly in the tests' own error messages — no Group E code touches that setting), flagged to
  the human partner rather than silently unlocked.
- Service worker bumped to v29.

**All five sub-projects from the original UAT feedback pass are now complete**: A (tournament
info sync, receipt/relieving visibility, NOC auto-vacate, refund hint), B (transaction toasts),
C (coupon/Final-Documents email — diagnosed, fixed, and confirmed live-`SENT`), D (NOC decline +
remarks), E (signatures & seals). Deployed to production Apps Script @142.

## 2026-08-20 — Group F: "Final Receipt / Relieving Order aren't generating" (live report)

Sixth sub-project, from a fresh live report: "at departure processing the app is not generating
the Final Receipt nor the Relieving Order." Investigated with the systematic-debugging
discipline (root cause before any fix) using `system.diagEmailLog` (a read-only, no-session
diagnostic already in `Main.gs`, same convention as Group C's) against the real production
`EMAIL_LOG` rows rather than guessing. Finding: **document generation itself was never broken**
— real `RECEIPTS`/`RELIEVING`/`DOCUMENTS` rows and real PDFs already existed in Drive for real
teams (e.g. `RCT-0078`/`REG-002`). Three separate, real gaps made that invisible from the
outside, all fixed:

1. **No resend path.** `departure.finalize`'s idempotent fast-path (spec §23, deliberate) never
   re-attempts the email on a repeat call. A team finalized during Group C's since-resolved
   Gmail-auth gap (`REG-002`, confirmed via the live diagnostic) has no recovery route in the
   app at all. New `resendFinalDocuments_`/`departure.resendFinalDocuments` — re-sends the
   EXISTING PDFs, never regenerates them or touches `SETTLEMENTS` — mirrors
   `FoodPackages.gs`'s established `resendCoupon_`/`registration.package.resend` pattern
   exactly. Refactored the finalize path's inline email code into a shared
   `_sendFinalDocumentsEmail_` so both callers can never drift apart again.
2. **Every generated PDF was Drive-private.** No file/folder this app creates anywhere has ever
   called `.setSharing(...)` — confirmed by grepping the whole backend. Team Detail's "View
   Final Receipt"/"View Relieving Order" links (existing since Group A) pointed straight at
   those private file IDs, so anyone but the script's own execution identity hit Google's
   "Request access" page instead of the PDF — indistinguishable, from the Registration
   Committee's side, from nothing having been generated. Both PDFs now get
   `setSharing(ANYONE_WITH_LINK, VIEW)` right after creation (view-only, matches how they're
   already distributed as email attachments) — the same "View" links now actually open, giving
   in-app preview and print (Drive's own viewer has a print action) with no new UI to build.
3. **Final Receipt content, per the human partner's explicit direction**: the receipt must show
   only players' Meal/Dari charges — security is a separate refundable deposit already settled
   at NOC/departure and must not appear on this document or be netted into its headline figure
   or `AmountInWords`. `_buildFinalReceiptLayout_` no longer prints Security Collected/Refunded
   rows; the headline and `AmountInWords` now derive from `preview.netCharges` (Meal+Dari,
   post-food-refund) instead of `FinalBalance` (which nets in `SecurityRefunded` and
   `OtherAdjustments`). `SETTLEMENTS.FinalBalance` itself is untouched — still the true total
   cash returned, kept for internal bookkeeping/reports (`Reports.gs` reads it unchanged).

- **Frontend**: `departure.js`'s Finalize & Send no longer calls `goBack()` blind on success —
  it renders a confirmation screen with the real email outcome, both "View" links, and a resend
  form. Team Detail (`registration.js`) gains a "Resend Final Documents" button next to the
  existing View links (Registration role only, same gate as "Process Departure"), for when an
  incharge reports non-receipt after the fact rather than mid-workflow.
- **Testing**: TDD, watched fail live against the real deployed script (this project's
  established discipline — no mocking for Google services). Three new regression tests, all
  RED for the expected reason before the fix (`system.selfTestSplit`'s `payload.name` escape
  hatch, one at a time — `pdf2` real PDF/Slides generations run ~30-40s each):
  `finalDocuments_pdfsAreLinkShareable` (`PRIVATE` vs expected `ANYONE_WITH_LINK`),
  `finalDocuments_receiptExcludesSecurityFromContent` (`AmountInWords` was the
  security-inclusive `"Five Hundred Forty..."`, not the Meal/Dari-only
  `"Three Hundred Ten..."`), `finalDocuments_resendDoesNotRegenerateAndLogsNewAttempt`
  (`resendFinalDocuments_` didn't exist). All three green after the fix; regression-checked the
  two pre-existing `FinalDocuments.gs` tests (`departure_finalizeGeneratesDocumentsAndReliefsTeam`,
  `finalDocuments_emailFailureCapturesErrorMessage`) plus
  `registration_getTeamDetail_includesRelievingOrder`, all clean — a full `pdf2`-tier run was
  also attempted but timed out against the live script (the tier has grown past a single HTTP
  round trip again now that it's 3 tests larger, same ceiling this project has already hit and
  split around once before); spot-checks above stand in for it rather than a full-tier
  re-split, which is out of scope here. Service worker bumped to v30.
- Deployed to production Apps Script @144 (intermediate @143 was tests-only, deliberately
  deployed first to capture the live RED before touching implementation).

## 2026-08-20 — Group G: refund authority correction + Dari auto-calculation

Seventh sub-project, two live corrections from the human partner:

1. **Food-refund authority belongs to the Mess Committee, not Registration.** Phase 7 (spec
   §22) had deliberately decided "refund amounts are the Mess Committee Convener's discretion,
   not a fixed formula" — but then gave the actual `recordFoodRefund_` action to
   `[ROLES.ADMIN, ROLES.REGISTRATION]` only, with Registration expected to consult Mess
   off-system and type in whatever Mess told them. Corrected to match the decision that was
   already on record: `recordFoodRefund_` is now `[ROLES.ADMIN, ROLES.MESS]`.
   - Mess never calls `initiateDeparture_` (that stays Registration's job), so it can never
     satisfy the old "same locking user" check. Split `_requireDepartureLockHeldByCaller_` into
     that check plus a new, weaker `_requireDepartureInitiated_` (departure must be underway,
     caller identity doesn't matter) — the latter is what `recordFoodRefund_` uses now; the
     former still guards Registration's own actions (cancel/security-refund/finalize)
     unchanged.
   - New `getFoodRefundOverview_`/`mess.foodRefund.overview` — Mess's own read path to the
     Eligible/Served/Remaining/refund data it now acts on, narrower than
     `getDepartureOverview_` (no charges/security/settlement preview), same redaction
     philosophy already established for MESS in `getTeamDetail_`. Shared entitlement-mapping
     logic factored into `_mapEntitlementsForOverview_` so the two overviews can't drift.
   - Frontend: `departure.js`'s meal-entitlement table is now read-only for Registration
     (shows "Refunded: Rs X" / "Awaiting Mess Committee" per row, entry form removed — the
     backend rejects Registration's attempts regardless, this just stops the UI lying about
     what Registration can do). New `mess.js` `renderFoodRefundScreen` — the actual entry form,
     moved verbatim — reached from a new "Food Refund" button on Team Detail (MESS role).
2. **Dari Charges must always be in the Final Receipt, auto-calculated** — regardless of
   whether they were ticked at registration (`calculateCharges_`'s `includeDari` toggle can
   leave `CHARGES.DariCharges` at 0). Per explicit direction: rate × team members × tournament
   days. New `_tournamentDurationDays_()` (`TournamentEndDate − TournamentStartDate`,
   inclusive of both ends — the README's own "21–25 Sep 2026" reads as a 5-day event).
   `_computeSettlementPreview_`'s `grossDariCharges` no longer reads `CHARGES.DariCharges` at
   all — always `RateDariSnapshot × NumberOfTeamMembers × tournamentDays` (live `RateDari`
   setting as a fallback only when a team has no `CHARGES` row yet), preserving rate-locking
   (spec §19) for teams that do. This flows through the one shared function into both the live
   Departure-screen preview and the persisted `SETTLEMENTS`/Final Receipt — they can't drift
   apart. Deliberately scoped to the settlement/receipt calculation only — `Reports.gs`'s
   collections figures still read the real `CHARGES`/`PAYMENTS` records unchanged, since those
   report what was actually collected, a different question from what the final receipt should
   show.
- **Testing**: TDD, watched fail live (3 new tests RED for the expected reason before
  implementing, GREEN after): `departure_fullRefundFlow` extended in place (Registration now
  gets `FORBIDDEN`; a Mess caller who isn't the lock holder still succeeds),
  `mess_getFoodRefundOverview_roleGateAndContent`,
  `departure_settlementPreview_dariAlwaysAutoCalculated` (reads live
  `TournamentStartDate`/`EndDate`/`RateDari` rather than hardcoding an expected number, this
  project's established convention for settings-dependent tests). Fixed 4 other existing tests
  that called `recordFoodRefund_` as Registration or asserted a stale hardcoded Dari-less
  total once the auto-calc changed the math
  (`test_finalDocuments_receiptExcludesSecurityFromContent`,
  `test_departure_finalizeGeneratesDocumentsAndReliefsTeam`,
  `test_departure_overview_suggestedRefundReflectsUnusedAmount`,
  `test_e2e_fullTeamLifecycle`) — all regression-checked individually and green, including the
  full 6-real-PDF e2e test. A full `fast`-tier run also timed out against the live script (same
  single-HTTP-round-trip ceiling `pdf2` hit in Group F, now hitting `fast` too as the suite
  keeps growing) — targeted spot-checks above cover the actual change surface; a tier re-split
  is its own follow-up, out of scope here.
- Deployed to production Apps Script @147 (@145 tests-only RED, @146 implementation, @147
  fixed the 4 existing tests the auto-calc/authority change broke). Service worker bumped
  to v31.

## 2026-08-21 — Group H: Dari auto-calculation, corrected twice more

Same-day follow-up to Group G's Dari auto-calc, corrected live by the human partner in two
rounds after seeing the real numbers:

1. **"No. of days" is nights stayed, not inclusive calendar days.** The first cut computed
   `TournamentEndDate − TournamentStartDate + 1` (21–25 Sep = 5). Corrected: Dari/bedding is
   charged per night, so it should be non-inclusive (21–25 Sep = 4 nights). Caught immediately
   via a live test run before this even reached the human partner's own review.
2. **"No. of days" is THIS TEAM's actual stay, not the tournament's fixed dates at all** — the
   bigger correction. The human partner's own example made it unambiguous: "if a team
   registers on 21/09/2026 and loses on 23/09/2026 then 2 nights, and if team has 14 members
   then 2800.00" (confirms `RateDari(100) × 14 × 2 = 2800`, live-setting-consistent). A team
   that leaves early after a loss owes Dari for the nights it actually stayed, regardless of
   how long the tournament itself runs — `TournamentStartDate`/`EndDate` never belonged in this
   formula at all.
   - `_tournamentDurationDays_()` replaced with `_teamStayNights_(team, relievingDateOverride)`:
     `TEAMS.RegistrationDateTime` (Asia/Kolkata calendar date) to the relieving date, not
     inclusive. `relievingDateOverride` is the real operator-entered date at finalize time;
     omitted for the live pre-finalize preview, which estimates using today's date instead (the
     finalize form's own Relieving Date field also defaults to today, so this matches in the
     common same-day case). `_computeSettlementPreview_` gained the same optional parameter,
     threaded through from `finalizeDepartureAndGenerateDocuments_`'s already-existing
     `relievingDate` argument.
   - Confirmed with the human partner: this is the exact same `relievingDate` value printed as
     the "Date" on the Relieving Order itself (`_buildRelievingLayout_`) — the date on that
     document and the date driving the Dari-nights count can never disagree, they're the same
     variable.
- **Testing**: TDD both rounds, watched fail live before each fix (test-only deploy first to
  confirm RED against the still-live-wrong implementation, then the implementation deploy to
  go GREEN) — `departure_settlementPreview_dariAlwaysAutoCalculated` rewritten to the
  human partner's own 14-members/2-nights example (matches their 2800 figure against live
  `RateDari` exactly) plus a same-day 0-nights case for the live-preview estimate path;
  `finalDocuments_receiptExcludesSecurityFromContent` updated to a deterministic
  registration+3-days relieving date instead of a hardcoded past date (which would have
  produced a negative/clamped-to-0 night count once nights became registration-relative).
  Both confirmed RED for the right reason, then GREEN. Regression-checked
  `departure_finalizeGeneratesDocumentsAndReliefsTeam`, `e2e_fullTeamLifecycle` (6 real PDFs),
  and `departure_fullRefundFlow` (one transient failure the first time, caused by running it
  concurrently against the same live Sheet while the e2e test was still executing in the
  background — no isolation/mocking in this project by design; passed cleanly on its own on
  retry, not a real regression).
- Deployed to production Apps Script @150 (@149 tests-only RED, @150 implementation). No
  frontend changes this round.

## 2026-08-21 — Match Fee Collection: new module, Registration Committee portal

New module, not a phase correction — a separate financial stream where every match produces
up to two independent per-team payments and receipts. Spec:
`docs/superpowers/specs/2026-08-21-match-fee-collection-design.md`. Plan:
`docs/superpowers/plans/2026-08-21-match-fee-collection.md` (7 tasks). Built entirely by
reusing existing architecture — no new numbering engine, PDF pipeline, email system, or lock
concept.

1. **Two new sheets, no caching of derived state.** `MATCHES` (identity only: MatchId/
   MatchNumber/MatchDate/Team1Id/Team2Id/Status) and `MATCH_FEE_TRANSACTIONS` (one row per
   team-payment). Deliberately does NOT store per-team PAID/PENDING or receipt numbers on
   `MATCHES` — `_matchTeamSideStatus_` always computes "has this team paid" live from
   `MATCH_FEE_TRANSACTIONS` (exactly one `Status=ACTIVE` row per `(MatchId, TeamId)` — the
   core invariant every duplicate-payment/void/re-collect rule is built around), the same
   philosophy `TEAMS` already uses for its own charges/payments/receipts.
2. **Receipt numbering reuses `nextDocumentNumber_` unmodified.** New counters
   `Numbering_Match_Prefix='M-'` (→ `M-001`, `M-002`, …) and
   `Numbering_MatchFee_Prefix='GCB/HPUICK-2026/MF/'`/`Padding='5'` (→ exactly
   `GCB/HPUICK-2026/MF/00001`, the exact format required) — same lock-protected global
   counter every other document number already uses, so "transaction-safe, never duplicated
   under concurrent operators" needed zero new code.
3. **Match Fee rate folded into the existing rates form/lock, not a second lock.**
   `MatchFeeRate` added as a sixth field inside `updateRates_`/`getRegistrationInfo_`,
   gated by the same `FinancialSettingsLocked` flag as breakfast/lunch/dinner/dari/security.
   Each transaction snapshots `MatchFeeRate` into `RateSnapshot` at payment time — a later
   Admin rate change never touches an already-created transaction's `Amount` or PDF
   (mirrors `CHARGES.RateDariSnapshot`'s existing rate-locking pattern exactly).
4. **`collectMatchFee_` mirrors `purchasePackage_`'s idempotency/locking shape** (pre-lock
   `ClientRequestId` fast path, authoritative re-check inside `LockService.getScriptLock()`,
   the one-ACTIVE-per-pair invariant re-checked inside the same lock) **and
   `finalizeDepartureAndGenerateDocuments_`'s fast-path-then-generate shape** (transaction
   row written and lock released BEFORE the PDF/email work, so a PDF or email failure can
   never leave a payment unrecorded). A duplicate attempt throws `ALREADY_PAID` carrying the
   existing receipt number, which the frontend renders as View/Resend with no second Pay
   control.
5. **Void → re-collect, never delete.** `voidMatchFeeTransaction_` (ADMIN only, mandatory
   reason) updates the same row in place (`Status=VOID`, `VoidReason`/`VoidedBy`/`VoidedAt`)
   — the receipt number is retained, never reused, and the global counter is never rewound.
   Once voided, the `(MatchId, TeamId)` pair has zero `ACTIVE` rows again, so a legitimate
   re-collection runs the full payment flow from scratch: new transaction, new rate
   snapshot (the *current* rate), new receipt number, new PDF, new email. Both rows remain
   permanently visible in history.
6. **Own receipt PDF, own template, own Drive folder — never touches the Final Receipt.**
   `_buildMatchFeeReceiptLayout_`/`createMatchFeeReceiptTemplate_` mirror `Receipts.gs`'s
   Temporary Receipt Template exactly (A5 portrait, one-time manual resize, content built
   fresh per receipt, never `replaceAllText`). Title "MATCH FEE RECEIPT"; reuses
   `_numberToWordsIndian_` and `_drawSignatureOrLine_('RegistrationInchargeSignatureFileId')`
   as-is from `FinalDocuments.gs` — no duplication, Apps Script's single global namespace
   made this literal reuse. Email defaults to the *paying* team's incharges only (never the
   opponent's — no code path here even reads the opponent's incharges), status stored as
   `SENT`/`FAILED`/`NOT_SENT`, matching `FOOD_PACKAGES.EmailStatus`'s existing vocabulary
   exactly rather than inventing a new one.
7. **Isolation from Final Receipt/settlement is structural, not just convention.**
   `FinalDocuments.gs`, `_computeSettlementPreview_`, `SETTLEMENTS`, and `RECEIPTS`
   (Type=FINAL) are untouched by this module — nothing added here writes to those sheets or
   is called from that file. `test_matchfee_doesNotAffectFinalReceiptSettlement` is the
   concrete regression test: computes `_computeSettlementPreview_` for a team before and
   after a Match Fee transaction exists and asserts every field identical.
8. **Reports/dashboard get their own separate Match Fee section**, computed in
   `getReportsBundle_` from `MATCHES`/`MATCH_FEE_TRANSACTIONS` only — never merged into
   `financial` or `collegeWiseFinalStatement`. New "Match Fee" tab in `reports.js` (same
   tab-switched-over-one-fetched-bundle pattern), four new lines on the Admin dashboard.
9. **Frontend**: new `matchfee.js` — a Matches list (doubles as the required Match Fee
   history screen, since both need the same `matchfee.match.list` data), Create Match (two
   team `<select>`s from the existing `registration.teams.list` action, never free text —
   picking a team in one selector removes it from the other's options client-side, while
   `matchfee.match.create`'s distinct-teams check is the real enforcement), and Match Detail
   (the two-team-card PAID/PENDING layout from the original request, Collect/View/Resend
   per side, Admin-only inline Void form). One new "Match Fee Collection" button on the
   Registration dashboard; one new rate field in Settings. Service worker bumped to v32.

**A real environmental snag, not a code defect**: `FinancialSettingsLocked` was genuinely
`true` in production when this was built (real Admin prep for the actual tournament) — two
new/modified tests (`settings_updateRatesAndLock`, extended for `matchFee`; and
`matchfee_collectMatchFee_fullPaymentAndProtectionFlow`) originally assumed an unlocked
starting state the way the pre-existing test already (incorrectly) did, and failed live
against real prod state. Fixed by capturing the actual `financialSettingsLocked`/rate values
at test start and restoring them exactly at the end (temporarily unlocking only if the real
state was locked) instead of assuming or hardcoding a state — a correctness fix that also
happens to close a latent bug in the pre-existing test, which used to unconditionally force
the lock to `false` at the end regardless of what it found.

Also confirmed pre-existing and unrelated to this change: `setup_schemaAndSettingsIdempotent`
fails against the current live Sheet because it hardcodes an expectation that
`FinancialSettingsLocked` defaults to `'false'` — `seedSettings_` only sets a key once and
never touches it again, so this is just asserting against the real Admin's current locked
state, not a regression. Left as-is (out of scope for this task); flagged for the human
partner.

**Testing**: TDD throughout — each of the 7 plan tasks written test-first, deployed, and
watched live before/after. All new/modified tests confirmed PASS on the live deployment:
`setup_matchFeeSchemaAndSettingsSeeded`, `idGenerator_matchAndMatchFeeDocumentNumberFormats`,
`settings_updateRatesAndLock`, `matchfee_createMatch_validatesTeamsAndListsDetail` (fast
tier); `matchfee_collectMatchFee_fullPaymentAndProtectionFlow` (both-orders-of-payment,
duplicate-payment rejection with receipt number attached, `ClientRequestId` replay
idempotency, rate-change-after-payment immutability), `matchfee_doesNotAffectFinalReceiptSettlement`,
`matchfee_resendAndVoidThenRecollect` (resend reuses the same receipt, void requires
ADMIN+reason, double-void rejected, re-collection after void gets a new transaction/receipt
number while the voided row stays in history) (`pdf2` tier, real Slides/Drive PDF generation
+ real Gmail sends each run). `reports_getAll_includesMatchFeeSeparately` (fast tier) confirms
the report/dashboard aggregation and that the financial report's Dari/package figures stay at
0 for a Match-Fee-only team. Full `fast` and `pdf2` tier runs now exceed the 6-minute Apps
Script execution ceiling with these additions (same growing-suite issue this log has already
flagged four times) — spot-checked adjacent pre-existing tests instead
(`sheetHelpers_appendFindUpdateDelete`, `idGenerator_sequentialAndUnique`,
`registration_registerTeam_validationAndCreation`, `settings_mealTimingsValidationAndUpdate`,
`reports_getAll_adminOnlyAndAggregatesTeamCorrectly`,
`departure_finalizeGeneratesDocumentsAndReliefsTeam`, `finalDocuments_pdfsAreLinkShareable`,
`accommodation_issueNoc`) — all green, no regressions. A `fast`/`pdf2` tier re-split is its
own follow-up, out of scope here, same as every prior time this has come up.

One-time Admin setup performed live: `admin.bootstrap.setupDriveFolders` (adds the "Match Fee
Receipts" subfolder) and `admin.bootstrap.createMatchFeeReceiptTemplate` (new template file,
A5 default size — needs the same one-time manual Slides UI resize as every other receipt
template before it's used for real).

Deployed to production Apps Script @156 (@151-152 Task 1, @153 Task 2, @154 Task 3, @155
Tasks 4-5, @156 Task 3 test lock-state fix). Frontend (`matchfee.js`, dashboard/settings/
reports wiring, service worker v32) pushed to the `ickpwa` GitHub Pages repo.

## 2026-08-22 — Pre-Registration: Google Form check-in flow

Request: colleges should be able to pre-register their team (same fields as the registration
wizard, plus "Mode of Travelling of Team" — Bus/hired vehicle/College vehicle) well before the
tournament, via a Google Form, so on opening day the Registration Committee just picks the
team from the pre-registration data, verifies/edits it, and proceeds straight to charges →
payment → temporary receipt.

Brainstormed as architectural (new subsystem + touches the registration wizard) — full
design-in-chat, section by section, approved before implementation; the human partner then
asked to skip the written spec/plan docs and build directly, so this entry is the only
record of the design decisions.

1. **Data model**: new `PRE_REGISTRATIONS` sheet, flattened (fixed slots for up to 3
   incharges — Google Forms has no dynamic repeating group) rather than a normalized table.
   `TravelMode` added as a new trailing column on `TEAMS` (same backward-compatible
   schema-extension pattern as `ROOMS.RoomType`).
2. **Form generation**: `admin.bootstrap.setupPreRegistrationForm` builds the Form via
   `FormApp` (College/District/Members/3×Incharge slots/Mode of Travelling dropdown),
   installs an `onFormSubmit` trigger, saves the form URL to Settings. Idempotent without
   `force`; `force` recreates the form and re-points the trigger. Deliberately leaves "allow
   response edits" off — Google's own edit-response link does not re-fire `onFormSubmit`,
   so a resubmission (not an edit) is the supported correction path.
3. **Ingestion**: upsert-by-college — a new submission overwrites the existing `PENDING` row
   for that college; if the only match is already `CONVERTED`, it's left alone and the
   submission becomes a fresh `PENDING` row instead (so a stray resubmission after check-in
   can never un-convert a team). A `PreRegistrationLastSyncedAt` watermark (advanced after
   every successful upsert, from either path) means the "Sync Now" manual-pull fallback never
   re-walks history already folded in by the trigger.
4. **registerTeam_**: gained optional `travelMode`/`preRegId` params (backward-compatible,
   same convention as `calculateCharges_`'s `includeDari`/`includeSecurity`). `preRegId` is
   validated as still `PENDING` before the team is created, then the pre-registration is
   marked `CONVERTED` with a link to the new team — guards a double-click or two operators
   racing the same entry.
5. **Frontend**: new `preregistration.js` (Pre-Registrations list + Sync Now), the existing
   register wizard now takes an optional pre-fill (from `registration.preReg.detail`, fully
   editable) and a new Travel Mode field for every team regardless of source, Settings gets a
   generate/regenerate section for the form link, Team Detail shows travel mode. Service
   worker bumped to v33.
6. **One-time authorization**: Forms/`ScriptApp` trigger installation are new scopes for this
   project — added `authorizeFormsManually` (same run-once-from-the-editor pattern as
   `authorizeDriveManually`/`authorizeGmailManually`). Not yet run — the live Admin still
   needs to do this once, interactively, before `setupPreRegistrationForm_` will work; this
   session had no browser access to click through the consent dialog itself.

**Testing**: 4 new tests (`preRegistration_upsertRow_autoReplacesPendingButPreservesConverted`,
`preRegistration_getPreRegistrationDetail_reshapesInchargesAndGuardsConverted`,
`registration_registerTeam_fromPreRegistration_convertsAndCopiesTravelMode`,
`preRegistration_listPendingPreRegistrations_excludesConverted`) — none touch `FormApp`
directly (matching the existing convention that Forms/Drive/Slides-touching setup functions
aren't in the automated suite), so all 4 ran and passed live without needing the one-time
Forms authorization. Also spot-checked 8 adjacent pre-existing tests for regressions from the
`registerTeam_` signature change and the `TEAMS` schema addition — all green
(`sheetHelpers_appendFindUpdateDelete`, `idGenerator_sequentialAndUnique`,
`registration_registerTeam_needsAccommodationFlag`,
`registration_recordPayment_createsTwoRowsAndGuards`, `registration_listAndDetailTeams`,
`registration_getTeamDetail_includesRelievingOrder`,
`registration_getTeamDetail_includesNocStatus`,
`registration_getTeamDetail_redactsFinancialsForMess`,
`registration_getTeamDetail_redactsFinancialsForAccommodation`,
`reports_getAll_adminOnlyAndAggregatesTeamCorrectly`,
`reports_getAll_includesMatchFeeSeparately`).

Deploy sequence: `clasp push`, then a throwaway test deployment (`@157`) to validate against
without touching the live URL, `admin.bootstrap.setupSchema` run live (ADMIN session
provided by the human partner) to provision `PRE_REGISTRATIONS` and the `TEAMS.TravelMode`
header — confirmed additive-only, no other sheet touched — then all tests above run and
passed against `@157`, then promoted to the production deployment
(`AKfycbySk37loMP...`, now `@158`) and the throwaway deployment deleted. Frontend pushed to
the `ickpwa` GitHub Pages repo via `git subtree push --prefix=frontend frontend-origin main`.

**Still outstanding, needs the human partner**: the one-time Forms/trigger OAuth consent
(`authorizeFormsManually`, run once from the Apps Script editor as the script owner) before
"Generate Pre-Registration Form" in Settings will actually work — this session had no
interactive browser access to click through it.
