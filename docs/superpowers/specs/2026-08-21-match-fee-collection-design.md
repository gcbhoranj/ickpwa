# Match Fee Collection — Design Spec

Status: Approved (2026-08-21)
Parent system: [2026-08-17-hpuick-tournament-system-design.md](2026-08-17-hpuick-tournament-system-design.md)
Adds to: Registration Committee portal, Admin Financial Settings, Admin Reports/Dashboard

This document specs a new, self-contained module — **Match Fee Collection** — bolted onto
the existing HPUICK system via its existing patterns (numbering, financial-lock, PDF
generation, email, audit log, roles). It changes no existing sheet, screen, or document.
Where this spec says "reuse," it means the literal existing function/mechanism named, not a
new mechanism that behaves similarly.

## 1. Purpose & scope

Every match has two participating teams, each independently liable for a Match Fee. One
match therefore produces **up to two independent payments and up to two independent
receipts** — never a combined receipt, never a shared payment record. Either team may pay
first; one team may be paid while the other remains pending indefinitely.

Match Fee is a wholly separate financial stream from registration/Dari/security/food. It
never contributes to `SETTLEMENTS`, `RECEIPTS` (Type=FINAL), or any figure on the existing
Final Receipt — this is an invariant, not a preference (§9).

Out of scope (matches the parent spec's scope discipline, §1 there): match
fixtures/scheduling/scoring, brackets, live results. This module tracks only the financial
transaction tied to a match, identified by two teams and a date — it is not a tournament
draw/scheduling tool.

## 2. Data model

Two new sheets, added to `SHEET_SCHEMAS` in `Constants.gs` alongside the existing 22.
Neither duplicates team names — both reference `TEAMS` by `TeamId`, exactly like
`CONTINGENT_INCHARGES`/`CHARGES`/`PAYMENTS` already do.

### 2.1 `MATCHES` — match identity only

| Column | Notes |
|---|---|
| `MatchId` | Internal id, `nextId_('MATCH', 4)` → `MATCH-0001` |
| `MatchNumber` | Human-facing, `nextDocumentNumber_('Match')` → `M-001`, `M-002`, … (§4) |
| `MatchDate` | `yyyy-MM-dd` |
| `Team1Id`, `Team2Id` | FKs into `TEAMS`; must reference two distinct, existing, registered teams (§3) |
| `Status` | `SCHEDULED` or `VOID` (§7) |
| `CreatedBy`, `CreatedAt`, `UpdatedBy`, `UpdatedAt` | Standard audit columns, matching every other sheet |

`MATCHES` deliberately does **not** store per-team payment status, transaction id, or
receipt number. Storing that here would create a second place those facts could drift from
`MATCH_FEE_TRANSACTIONS` (the source of truth) under concurrent writes — the same reason
`TEAMS` doesn't cache its own `CHARGES`/`PAYMENTS`/`RECEIPTS`. Every read that needs "has
Team 1 paid, and what's the receipt number" computes it live from `MATCH_FEE_TRANSACTIONS`,
the same way `getTeamDetail_` computes a team's payments/receipts live today.

### 2.2 `MATCH_FEE_TRANSACTIONS` — one row per team-payment

| Column | Notes |
|---|---|
| `TransactionId` | `nextId_('MFTX', 5)` |
| `MatchId`, `TeamId`, `OpponentTeamId` | FKs; `OpponentTeamId` is a denormalized convenience for the receipt (avoids a second `MATCHES` lookup at receipt-render time) |
| `Amount` | Amount actually charged — always equals `RateSnapshot` (§6 — no operator override) |
| `RateSnapshot` | `MatchFeeRate` setting value **at the moment this transaction was created** (§5) |
| `PaymentMethod` | `Cash` / `Online` / `Cheque` — the existing three values (§6) |
| `PaidAt` | ISO timestamp |
| `CollectedBy` | `actorSession.userId` |
| `ReceiptNumber` | `nextDocumentNumber_('MatchFee')` → `GCB/HPUICK-2026/MF/00001` (§4) |
| `ReceiptPdfFileId` | Drive file id of this transaction's own receipt PDF |
| `EmailStatus` | `SENT` / `FAILED` / `NOT_SENT` — canonical values, matching `FOOD_PACKAGES.EmailStatus`'s existing vocabulary exactly (§8) |
| `Status` | `ACTIVE` or `VOID` (§7) |
| `VoidReason`, `VoidedBy`, `VoidedAt` | Populated only when `Status = VOID` |
| `ClientRequestId` | Idempotency key, same mechanism as `FOOD_PACKAGES.ClientRequestId` (§6) |
| `CreatedBy`, `CreatedAt` | Standard |

**Invariant (enforced server-side, not just hidden in the UI):** at most one row with
`Status = ACTIVE` may exist for a given `(MatchId, TeamId)` pair, at any time. This is what
"has this team paid for this match" means throughout the module — never a boolean flag,
always this query. A transaction is never updated or deleted in place; voiding appends a
status change to the *same* row (§7), matching this codebase's append-only convention for
every other transactional sheet (`SheetHelpers.gs`'s `deleteRowById_` is explicitly
test-fixture-only, never called from production handlers).

`ID_PREFIXES` gains `MATCHES: 'MATCH', MATCH_FEE_TRANSACTIONS: 'MFTX'`.

## 3. Team selection

Both `Team1Id` and `Team2Id` are chosen from the existing `registration.teams.list` action
(unchanged, already permitted for `REGISTRATION`) — never free text. `matchfee.match.create`
validates both ids resolve via `findRowById_('TEAMS', …)` and rejects `Team1Id === Team2Id`.

No uniqueness constraint exists on the `(Team1Id, Team2Id)` pair — the same two teams may
play more than once, on the same or different dates. `MatchId` is the only thing that must
be unique; this satisfies the "legitimate repeat fixture" requirement without any date-range
or pair-based collision check that could wrongly reject it.

## 4. Numbering — reusing `nextDocumentNumber_` exactly

Two new counters, seeded in `seedSettings_` (`Setup.gs`) alongside the six existing
`Numbering_*` triples:

```
Numbering_Match_Prefix:    'M-'                          Numbering_Match_Padding: '3'
Numbering_MatchFee_Prefix: 'GCB/HPUICK-2026/MF/'          Numbering_MatchFee_Padding: '5'
Numbering_Match_Next: '1'                                 Numbering_MatchFee_Next: '1'
```

`nextDocumentNumber_('Match')` and `nextDocumentNumber_('MatchFee')` are the **existing,
unmodified** function from `IdGenerator.gs` — same `LockService.getScriptLock()` critical
section every other document number already goes through, which is this codebase's actual
mechanism for "transaction-safe, no duplicate numbers under concurrent operators" (Google
Sheets has no native unique-index constraint; the lock + monotonic counter *is* the
database-level protection this app has always used, for Registration/Receipt/Coupon/Refund/
Relieving/Accommodation numbers alike).

Receipt numbers are sequential across the whole tournament — never per-match, per-team,
per-day, or per-operator — because the counter is one global `SETTINGS` row, exactly like
every other numbering counter in this app.

`resetTournamentData_` (`Setup.gs`) is extended to clear `MATCHES`/`MATCH_FEE_TRANSACTIONS`
and reset `Numbering_Match_Next`/`Numbering_MatchFee_Next` to `1`, alongside the sheets and
counters it already resets — kept consistent with every other transactional sheet, not a
special case.

## 5. Financial settings & lock — reusing `updateRates_` exactly

`MatchFeeRate` (default `'500'`) is seeded in `seedSettings_` and added as a sixth field —
alongside breakfast/lunch/dinner/dari/security — inside the **same** `updateRates_`
function, `getRegistrationInfo_` read, `FinancialSettingsLocked` gate, and `UPDATE_RATES`
audit action. There is no second lock, no second "financial settings" concept: Match Fee is
locked/unlocked in the exact same operation as every other rate, by the exact same Admin
action. `settings.js`'s existing Rates form gains one more `<input>`, disabled under `locked`
identically to the other five.

When a Match Fee transaction is created, `RateSnapshot` captures `MatchFeeRate` at that
instant (§2.2) — later Admin rate changes never alter an existing transaction's `Amount` or
an already-generated receipt PDF, matching the rate-locking behavior `CHARGES` already has
for Dari/security (`RateDariSnapshot`, `SecurityAmountSnapshot`).

## 6. Collection workflow

`matchfee.pay(matchId, teamId, mode, recipientEmails, clientRequestId)` —
`ADMIN`/`REGISTRATION` only. Mirrors `purchasePackage_` (`FoodPackages.gs`) structurally:

1. Reject if `MatchFeeRate` is unset or `0` (`VALIDATION_ERROR`), or if `teamId` is not
   `Team1Id`/`Team2Id` of `matchId` (`VALIDATION_ERROR`), or if the match's `Status = VOID`.
2. **Idempotency fast path** (pre-lock): if `clientRequestId` matches an existing
   `MATCH_FEE_TRANSACTIONS.ClientRequestId`, return that row's result unchanged — a replayed
   request (double-click, network retry, `api-client.js`'s automatic retry-on-bad-response)
   never creates a second transaction or a second receipt number.
3. Acquire `LockService.getScriptLock()`. Inside the lock:
   a. Re-check the idempotency key (authoritative check, closes the race the pre-lock check
      can't).
   b. **Re-check the one-ACTIVE-transaction-per-(MatchId,TeamId) invariant.** If an `ACTIVE`
      row already exists, throw `ALREADY_PAID` carrying that row's `ReceiptNumber` — the
      frontend renders exactly the §13 message ("Match Fee already paid for this team for
      Match No. M-001. Receipt No.: GCB/HPUICK-2026/MF/00001") with **View Receipt** /
      **Resend Receipt** actions and no second Pay control. This is the concurrent-operator/
      double-tab/repeated-click protection: two simultaneous requests for the same
      `(MatchId, TeamId)` both reach this check serialized by the lock; exactly one creates
      the row, the other throws `ALREADY_PAID` against it.
   c. Snapshot `MatchFeeRate` → `RateSnapshot`/`Amount`; allocate `TransactionId` and
      `ReceiptNumber`; write the `MATCH_FEE_TRANSACTIONS` row with `Status = ACTIVE`.
4. Release the lock (matches `purchasePackage_`'s comment: the lock covers only the
   decide-and-write critical section, not the PDF/email that follows — no reason to stall
   other concurrent operators for tens of seconds of Slides/Gmail work).
5. Generate the receipt PDF (§8) against the now-durably-written transaction row and update
   `ReceiptPdfFileId`. **The financial transaction already exists and is fully valid even if
   this step fails** — a caught PDF-generation error leaves `ReceiptPdfFileId` empty and
   `EmailStatus = NOT_SENT`; the payment is never lost or "untraceable" (§25's sequencing
   requirement). An operator can regenerate/resend once the underlying issue is fixed,
   without creating a new transaction — same recovery shape `resendCoupon_`/
   `resendFinalDocuments_` already provide for their document types.
6. Email the PDF to the paying team's incharges (§8); write `EMAIL_LOG`.
7. Write `AUDIT_LOG` (`Action: COLLECT_MATCH_FEE`, `Entity: MATCH_FEE_TRANSACTION`).

`matchfee.match.create(team1Id, team2Id, matchDate)` — `ADMIN`/`REGISTRATION`. Straight
`appendRow_` after the §3 validation; audited (`Action: CREATE_MATCH`).

## 7. Void / re-collection workflow

`matchfee.transaction.void(transactionId, reason)` — **`ADMIN` only.**

- Requires a non-empty `reason`.
- Only an `ACTIVE` transaction can be voided (`NOT_FOUND`/`ALREADY_VOID` otherwise — no-op
  protection against a double-void).
- Sets `Status = VOID`, `VoidReason = reason`, `VoidedBy = actorSession.userId`,
  `VoidedAt = now` **on the same row** — the row is never deleted, its `ReceiptNumber` is
  never blanked, and it remains permanently visible in Match Fee history and the Audit Log,
  exactly as originally issued.
- **The voided receipt number is never reused.** The global `Numbering_MatchFee_Next`
  counter is untouched by a void — it only ever advances forward via `nextDocumentNumber_`,
  never rewound.
- Once voided, the `(MatchId, TeamId)` pair has **zero** `ACTIVE` transactions again, so the
  one-ACTIVE-per-pair invariant (§2.2) is satisfied and `matchfee.pay` becomes callable for
  that team again. A subsequent legitimate collection runs the full §6 workflow from
  scratch: new `TransactionId`, new `RateSnapshot` (the *current* rate, not the voided one),
  new `ReceiptNumber` (the next number in the sequence — never the voided one, never a
  re-derivation of it), new PDF, new email. The voided transaction and the new transaction
  both remain in history as two separate, fully distinct rows.
- Audited (`Action: VOID_MATCH_FEE_TRANSACTION`, `PreviousState: ACTIVE`, `NewState: VOID`,
  with the reason recorded).

A `MATCHES` row itself may be voided the same way (`Status = VOID`) only when it has no
`ACTIVE` transactions — this exists purely to correct a match created in error before any
money changed hands; it is not a substitute for transaction-level void.

## 8. Receipt PDF & email — reusing the Slides/Drive/Gmail pipeline exactly

**Template & layout** (`MatchFee.gs`, new): `_buildMatchFeeReceiptLayout_` follows
`_buildReceiptLayout_`/`_buildFinalReceiptLayout_` line-for-line — a persistent
"Match Fee Receipt Template" Slides file (A5 portrait, one-time manual resize via the Slides
UI, same accepted trade-off already documented in `Receipts.gs`'s file header), content built
fresh per receipt with real values (never `replaceAllText` tokens), then exported to PDF and
stored in a new `Match Fee Receipts` Drive subfolder (`_ensureSubfolder_`, extending
`setupDriveFolders_`'s existing structure map).

Content, per §10 of the original request:

```
MATCH FEE RECEIPT

Receipt No.: GCB/HPUICK-2026/MF/00001

Received a sum of Rs. <Amount>
(Rupees <_numberToWordsIndian_(Amount)> in words)

from: <paying team's CollegeName>

as Match Fee for the match between
<Team1 CollegeName> and <Team2 CollegeName>
on <MatchDate>

................................
Signature, Registration Committee Convener   [_drawSignatureOrLine_, 'RegistrationInchargeSignatureFileId']
```

`_numberToWordsIndian_` and `_drawSignatureOrLine_` are called as-is from `FinalDocuments.gs`
— Apps Script's single global namespace means no import/duplication is needed; this is literal
reuse, not a re-implementation. Exactly one receipt is generated per call, for one
transaction — the generator's signature takes a single `MATCH_FEE_TRANSACTIONS` row, so a
combined two-team receipt is structurally impossible, not merely disallowed by convention.

**Email** (`_sendMatchFeeReceiptEmail_`, mirrors `_sendFinalDocumentsEmail_`): recipients
default to the **paying team's** `CONTINGENT_INCHARGES.EmailAddress` list (never the
opponent's — there is no code path in this function that reads the opponent team's
incharges at all). One PDF attachment. Writes `EMAIL_LOG`
(`DocumentId` = the `MATCH_FEE_TRANSACTIONS.TransactionId`). Returns/stores one of the three
canonical values already used by `FOOD_PACKAGES.EmailStatus` — **`SENT` / `FAILED` /
`NOT_SENT`** (no incharge email on file) — kept identical to the existing vocabulary rather
than inventing a fourth `PENDING` value server-side; the frontend may label `NOT_SENT` as
"Pending" for the operator (§12's requirement is about what the *screen* shows, not the
stored enum), the same cosmetic latitude `packages.js` already takes with other status
values.

`matchfee.receipt.resend(transactionId, recipientEmails)` — `ADMIN`/`REGISTRATION`. Re-sends
the **existing** `ReceiptPdfFileId` via `_sendMatchFeeReceiptEmail_`; never regenerates the
PDF, never allocates a new `ReceiptNumber`, never creates a new transaction — mirrors
`resendFinalDocuments_`/`resendCoupon_` exactly. Viewing/downloading/printing a receipt is
just opening its stored Drive PDF URL (`ReceiptPdfFileId`), identical to how every other
receipt/coupon/relieving-order link already works in this app — no dedicated action needed
beyond returning the URL from `matchfee.match.detail`.

## 9. Final Receipt isolation (hard invariant)

`FinalDocuments.gs` (`_buildFinalReceiptLayout_`, `_computeSettlementPreview_`,
`finalizeDepartureAndGenerateDocuments_`) and the `SETTLEMENTS`/`RECEIPTS`(Type=FINAL) sheets
are **not modified by this feature in any way**. No function added by this module writes to
those sheets or is called from `FinalDocuments.gs`; no function in `FinalDocuments.gs` reads
`MATCH_FEE_TRANSACTIONS` or `MATCHES`. Concretely:

- `grossMealCharges`, `grossDariCharges`, `netCharges`, `foodRefund`, `securityRefunded`,
  `FinalBalance` — every one of these continues to be computed exactly as today, from
  `FOOD_PACKAGES`, `CHARGES`, `REFUNDS`, `SECURITY_REFUNDS` only.
- The existing Final Receipt PDF layout, its fields, and its wording are untouched.
- Match Fee has its own report (§10) and its own receipts; it is never mentioned on, or
  summed into, the Final Receipt or Relieving Order.

## 10. Frontend

New `frontend/js/matchfee.js`, registered in `index.html` after `packages.js`. Follows the
existing render-function-overwrites-`#app-root` / `navigateTo`/`goBack` / `apiCall` pattern
throughout — no new frontend architecture.

- `renderRegistrationDashboard` (existing, `registration.js`) gains one more button,
  **Match Fee Collection**, alongside "Register New Team"/"Teams".
- `renderMatchFeeList` — table: Match No. / Date / Team 1 (+status+receipt) / Team 2
  (+status+receipt) / rate. Click a row → detail. This single screen satisfies both the §5
  "select an existing match" list and the §16 "Match Fee History" screen — they are the same
  data (`matchfee.match.list`), so one screen avoids a second, driftable query path. A
  **Create Match** button opens the create form.
- `renderCreateMatchForm` — two `<select>` populated from the existing
  `registration.teams.list` action; picking a team in one selector removes it from the
  other's options (client-side only — the server-side distinctness check in
  `matchfee.match.create` is the real enforcement, per this app's "the frontend hiding a
  control is never the enforcement point" convention already stated in `Reports.gs`); a date
  input.
- `renderMatchDetail` — the two-team-card layout from the original request's §6 mockup:
  each side shows **PAID**/**PENDING** in bold (matching this app's existing bold-status
  convention), the rate, and either a **Collect Match Fee** control (payment-mode `<select>`
  reusing the identical `Cash`/`Online`/`Cheque` `<option>` markup already in
  `registration.js`/`packages.js`) or **View Receipt** / **Resend Receipt** once paid. An
  `ALREADY_PAID` error from a race renders the exact §13 message with those same two actions
  and no Pay control.
- Admin gets a **Void** control on a paid transaction (visible only to `ADMIN`, a
  confirmation + mandatory reason field), calling `matchfee.transaction.void`.

## 11. Admin reports & dashboard

- `reports.js`'s existing tab list (`financial`/`food`/`accommodation`/`departure`/`final`)
  gains a sixth tab, **Match Fee**, computed inside `getReportsBundle_` from
  `MATCH_FEE_TRANSACTIONS` (never merged into `collegeWiseFinalStatement` or `financial` —
  §9's isolation requirement applies to reporting too). Columns: Match No. / Date / Paying
  Team / Opponent / Amount / Receipt No. / Payment Method / Payment Date / Collected By /
  Status. Summary: total collected, matches count, team-payments count, pending count, and a
  per-method breakdown (Cash/Online/Cheque) — mirrors the existing dashboard's
  `totalDariCharges`/`totalSecurityCollected` summation style exactly.
  Filterable by match/team/date/status/method on the client side over the one fetched bundle
  (same "tab-switched over one already-fetched bundle, no extra round trip" pattern
  `reports.js` already uses).
- Admin Dashboard (`renderAdminDashboard`) gains four more `<p>` lines under the existing
  summary block — Total Collected, Pending, Team Payments, Receipts Generated — same markup
  style as the existing lines, no new visual component, no dashboard redesign.

## 12. Roles & permissions

| Action | ADMIN | REGISTRATION | MESS | ACCOMMODATION |
|---|---|---|---|---|
| `matchfee.match.create` / `.list` / `.detail` | ✓ | ✓ | ✗ | ✗ |
| `matchfee.pay` | ✓ | ✓ | ✗ | ✗ |
| `matchfee.receipt.resend` | ✓ | ✓ | ✗ | ✗ |
| `matchfee.transaction.void` | ✓ | ✗ | ✗ | ✗ |
| `admin.settings.updateRates` (incl. `matchFee`) | ✓ | ✗ | ✗ | ✗ |
| `admin.settings.setFinancialLock` | ✓ | ✗ | ✗ | ✗ |
| Match Fee report tab / dashboard summary | ✓ | ✗ | ✗ | ✗ |

Every handler enforces its own row via `requireRole_` (never relies on the frontend hiding a
button — this app's stated convention, `Reports.gs`), and every action requires a valid
session via `requireSession_` first, matching every existing `ACTIONS` entry.

## 13. Audit log

Every state-changing action appends one `AUDIT_LOG` row via the existing `appendRow_`/
`nextId_('AUD', 7)` pattern — no new audit mechanism:

| Action | Entity | EntityId |
|---|---|---|
| `CREATE_MATCH` | `MATCH` | `MatchId` |
| `COLLECT_MATCH_FEE` | `MATCH_FEE_TRANSACTION` | `TransactionId` |
| `RESEND_MATCH_FEE_RECEIPT` | `MATCH_FEE_TRANSACTION` | `TransactionId` |
| `VOID_MATCH_FEE_TRANSACTION` | `MATCH_FEE_TRANSACTION` | `TransactionId` |
| `VOID_MATCH` | `MATCH` | `MatchId` |
| `UPDATE_RATES` (existing action, unchanged) | `SETTINGS` | `RATES` |

Viewing/downloading a receipt is a plain Drive link open (§8) and, matching every other
document link in this app (temporary/final receipts, coupons, NOC), is not separately
audited — consistent with, not a gap relative to, the existing system.

## 14. Concurrency & error handling summary

| Scenario | Mechanism |
|---|---|
| Two operators pay the same team for the same match simultaneously | `LockService` serializes; the loser hits the §2.2 invariant check inside the lock → `ALREADY_PAID` |
| Double-click / accidental resubmit | `ClientRequestId` replay returns the original transaction, no new row |
| Browser refresh mid-request / `api-client.js`'s bad-response retry | Same `ClientRequestId` replay path — the retry is a fresh script execution with the same request id |
| PDF generation fails after payment recorded | Transaction row already committed (`Status=ACTIVE`, `ReceiptPdfFileId=''`); recoverable, not lost — resend/regenerate path picks it up |
| Email fails | `EmailStatus=FAILED`; payment and receipt both stand; `matchfee.receipt.resend` retries the email only |
| Financial settings locked | `matchfee.pay` still works (locking only blocks *rate changes*, per §5 — matches how `updateRates_`'s lock has always worked); only `admin.settings.updateRates` is blocked |
| `MatchFeeRate` unset/zero | `matchfee.pay` throws `VALIDATION_ERROR` before any row is written |
| Unauthorized role / direct API call | `requireRole_`/`requireSession_` reject before any handler logic runs, same as every existing action |
| Repeat legitimate fixture (same two teams again) | No pair-uniqueness check exists (§3) — allowed by design |
| Duplicate voided-then-repaid transaction | New transaction gets a new `TransactionId`/`ReceiptNumber`; old row stays `VOID` permanently (§7) |

## 15. Testing plan (maps to the original request's §27)

Implemented as new `TEST_CASES` entries in `Tests.gs`, run via `system.selfTestSplit`
(existing harness, tiered the same way other document-generation tests are — see that
file's header comment on the 6-minute execution ceiling):

- A–E: both-orders-of-payment, one-team-only, both-teams-paid.
- F–H: `ALREADY_PAID` on a direct repeat call, on a same-`ClientRequestId` replay, and on two
  sessions racing the same `(MatchId, TeamId)` under the lock.
- I–J: simulated by asserting the `ClientRequestId` replay path returns the original row
  unchanged (the actual browser-refresh/network-retry behavior is `api-client.js`'s existing,
  unmodified retry logic — already covered by that file's own tests).
- K–N: email success, forced email failure (invalid recipient), resend, and confirming resend
  reuses `ReceiptPdfFileId`/`ReceiptNumber` unchanged.
- O–P: receipt URL resolves to the stored `ReceiptPdfFileId`.
- Q–R: pay at rate X, change `MatchFeeRate` to Y via `updateRates_`, assert the original
  transaction's `RateSnapshot`/`Amount` and its already-generated PDF are unchanged, and a
  *new* payment uses Y.
- S: `admin.settings.updateRates` rejected while locked; `matchfee.pay` still succeeds while
  locked.
- T: non-`REGISTRATION`/`ADMIN` role (e.g. `MESS`) rejected by `requireRole_` on every
  `matchfee.*` action; unauthenticated call rejected by `requireSession_`.
- U: two matches with the same team pair, different dates, both succeed.
- V–W: `ReceiptNumber` sequence is strictly increasing and never repeats across multiple
  matches/teams/operators in one test run.
- X: `_numberToWordsIndian_(500)` → `"Five Hundred Rupees Only"` (existing function, exact
  wording already covered by its own behavior, asserted here for the Match Fee amount).
- Y: `finalizeDepartureAndGenerateDocuments_` output (Final Receipt fields) is asserted
  unchanged before/after Match Fee transactions exist for the same team — the concrete
  regression test for §9's isolation invariant.
- Z: void a paid transaction, assert `Status=VOID`/reason/voider recorded, receipt number
  unchanged and un-reused, a subsequent legitimate payment for the same `(MatchId, TeamId)`
  succeeds with a new `TransactionId`/`ReceiptNumber`, and both rows remain visible in
  history.

## 16. Files touched

| File | Change |
|---|---|
| `backend/Constants.gs` | Add `MATCHES`, `MATCH_FEE_TRANSACTIONS` to `SHEET_SCHEMAS`; add their `ID_PREFIXES` |
| `backend/Setup.gs` | Seed `MatchFeeRate`, `Numbering_Match_*`, `Numbering_MatchFee_*`; extend `resetTournamentData_`'s sheet list; extend `setupDriveFolders_`'s folder map |
| `backend/Settings.gs` | Extend `updateRates_`/`getRegistrationInfo_` with `matchFee` |
| `backend/MatchFee.gs` (new) | All match/transaction/void logic, receipt layout, email |
| `backend/Main.gs` | New `matchfee.*` entries in `ACTIONS` |
| `backend/Tests.gs` | New test cases per §15 |
| `frontend/js/matchfee.js` (new) | All new screens |
| `frontend/index.html` | Script tag for `matchfee.js` |
| `frontend/js/registration.js` | One new button on the dashboard |
| `frontend/js/settings.js` | One new rate field |
| `frontend/js/reports.js` | One new tab; four new dashboard lines |

**Not touched:** `FinalDocuments.gs`, `Receipts.gs`, `CouponDocuments.gs`, `Departure.gs`,
`Registration.gs`, `Mess.gs`, `Accommodation.gs`, `Noc.gs`, `Rooms.gs`, `QrEncoder.gs`, and
every existing sheet other than `SETTINGS` (additive keys only).
