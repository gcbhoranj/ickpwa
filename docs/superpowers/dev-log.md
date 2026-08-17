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
