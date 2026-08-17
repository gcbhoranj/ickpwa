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
