# HPU Inter-College Kabaddi (Men) Tournament 2026 — Management System

Tournament management PWA for Government College Bhoranj (Tarkwari), 21–25 Sep 2026.

- **Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md`
- **Plans:** `docs/superpowers/plans/`
- **Backend** (`/backend`): Google Apps Script, managed with `clasp`. Push with
  `cd backend && npx @google/clasp push`, deploy with
  `npx @google/clasp deploy -i <DEPLOYMENT_ID> -d "<description>"`.
- **Frontend** (`/frontend`): static PWA, no build step. Run locally with
  `cd frontend && npx http-server -p 5544 -c-1`. Deployed to GitHub Pages at
  `https://gcbhoranj.github.io/ickpwa/`.
- **Database:** Google Sheet `HPU Inter-College Kabaddi`
  (`1eJpS9npNxcTQNTC9bfxnVOmJ74tv4dLiET6Xj6XcSyI`), owned by `gcbhoranj@gmail.com`.
- **Backend Web App URL:** `https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`

See the spec for full architecture, schema, and business rules; see
`docs/superpowers/dev-log.md` for what's actually been built so far.

## Known Gotchas

- **Manual OAuth re-authorization.** Whenever new Apps Script code starts using a Google
  service scope for the first time (e.g. `DriveApp`, `GmailApp`, `SlidesApp` in later phases)
  that the deployed Web App hasn't used before, Google requires a one-time manual
  authorization: open the script editor
  (`https://script.google.com/d/1TFgSbzpfbKuvgtyPwrfB5Rui4Cvrs3n5DnzirXy1vwMLC6meHJRove4f/edit`)
  as the script owner, run any function that touches the new scope, and click through the
  consent dialog. This happened twice during Phase 1 (once for Sheets, once for Drive) and
  will likely happen again when Phase 4 adds Gmail/Slides.
- **Service worker cache versioning.** `frontend/service-worker.js`'s `CACHE_NAME` constant
  must be bumped (e.g. `hpuick-shell-v2`, `v3`, ...) whenever any cached frontend file
  changes, or returning users will keep serving a stale cached app shell indefinitely — the
  service worker only re-fetches when browsers detect `service-worker.js` itself changed.
