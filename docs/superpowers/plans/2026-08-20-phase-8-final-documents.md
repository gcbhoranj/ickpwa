# Phase 8: Settlement, Final Receipt, Relieving Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One "Finalize & Send" action that computes the settlement, generates the Final
Receipt and Relieving Order PDFs, emails both, releases the departure lock, and marks the team
RELIEVED — closing the departure workflow Phase 7 started.

**Architecture:** New `FinalDocuments.gs` (settlement math, both Slides layouts, the composite
finalize action) + a small extension to `Departure.gs`'s `getDepartureOverview_` (adds a
settlement preview) + frontend extension to the existing `departure.js`. No new sheets/columns
— `SETTLEMENTS`, `RECEIPTS`, `RELIEVING`, `DOCUMENTS`, `EMAIL_LOG` were all fully specified and
created by earlier `setupSchema` runs.

**Tech Stack:** Same as every prior phase — Apps Script (V8), vanilla JS PWA.

**Spec:** `docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md` §23.

## Global Constraints

- Deployment ID: `AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI`. Web
  App URL: `https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec`.
- **This deployment is pinned by version, not `@HEAD`**: `clasp push` alone does not reach the
  live Web App URL — always follow with `clasp deploy -i <id>` before verifying.
- **curl gotcha: never use `-L` with POST.**
  ```bash
  URL="https://script.google.com/macros/s/AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI/exec"
  call_action() {
    curl -s -D /tmp/hpuick_headers.txt -o /tmp/hpuick_body.json -X POST -H "Content-Type: text/plain" --data-raw "$1" "$URL"
    LOCATION=$(grep -i '^location:' /tmp/hpuick_headers.txt | sed 's/^[Ll]ocation: //' | tr -d '\r')
    if [ -n "$LOCATION" ]; then curl -s "$LOCATION"; else cat /tmp/hpuick_body.json; fi
  }
  ```
- **Role gating**: `[ROLES.ADMIN, ROLES.REGISTRATION]` only, matching Phase 7 exactly.
- **Idempotency**: `finalizeDepartureAndGenerateDocuments_` checks for an existing `RECEIPTS`
  row with `Type: FINAL` for the team BOTH before and after acquiring the lock (the pre-lock
  check is a fast-path/UX check; the post-lock check is the authoritative one, matching every
  other locked handler in this codebase) — a repeat call returns the existing receipt/relieving
  IDs without regenerating PDFs or re-sending email.
- **One-time Admin setup needed before the PDF-generating test can pass**:
  `admin.bootstrap.createRelievingTemplate` (new — mirrors `createNocTemplate_`). Reuse the
  same admin-login approach as Phase 6 if credentials are available in this session; otherwise
  ask the human partner to run it (same pattern as Phase 6).
- **Testing**: a pure-function test for `_numberToWordsIndian_` joins `fast`. The full
  finalize-flow test does real Slides/Drive PDF generation (two PDFs) — joins `pdf2`.

---

## Task 1: `FinalDocuments.gs` — settlement, both PDFs, the composite finalize action

**Files:**
- Create: `backend/FinalDocuments.gs`
- Modify: `backend/Departure.gs` (`getDepartureOverview_` gains a `settlementPreview` field)
- Modify: `backend/Main.gs` (register two actions)
- Modify: `backend/Tests.gs` (two new tests, registered in `TEST_CASES`)

**Interfaces:**
- Produces (consumed by Task 2's frontend):
  - `_numberToWordsIndian_(amount): string`
  - `createRelievingTemplate_(actorSession, force): {templateId, created}`
  - `finalizeDepartureAndGenerateDocuments_(actorSession, teamId, otherAdjustments,
    relievingSession, relievingDate, recipientEmails): {teamId, receiptId, receiptPdfFileId,
    relievingId, relievingPdfFileId, emailStatus, alreadyFinalized}`
  - `getDepartureOverview_`'s response gains `settlementPreview: {grossMealCharges,
    grossDariCharges, grossCharges, foodRefund, netCharges, securityCollected,
    securityRefunded}` (excludes `otherAdjustments`/`finalBalance` — the frontend computes
    those live from its own input field, no round trip needed).

- [ ] **Step 1: Write the failing tests**

In `backend/Tests.gs`, add after `test_departure_fullRefundFlow`:

```javascript
function test_finalDocuments_numberToWordsIndian() {
  assertEqual_(_numberToWordsIndian_(0), 'Zero Rupees Only', 'zero should read as Zero Rupees Only');
  assertEqual_(_numberToWordsIndian_(5), 'Five Rupees Only', 'single digit wrong');
  assertEqual_(_numberToWordsIndian_(19), 'Nineteen Rupees Only', 'teen wrong');
  assertEqual_(_numberToWordsIndian_(42), 'Forty Two Rupees Only', 'tens+ones wrong');
  assertEqual_(_numberToWordsIndian_(100), 'One Hundred Rupees Only', 'flat hundred wrong');
  assertEqual_(_numberToWordsIndian_(1234), 'One Thousand Two Hundred Thirty Four Rupees Only', 'thousands wrong');
  assertEqual_(_numberToWordsIndian_(100000), 'One Lakh Rupees Only', 'flat lakh wrong');
  assertEqual_(_numberToWordsIndian_(1234567), 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only', 'lakh+thousand+hundred combo wrong');
  assertEqual_(_numberToWordsIndian_(10000000), 'One Crore Rupees Only', 'flat crore wrong');
}

function test_departure_finalizeGeneratesDocumentsAndReliefsTeam() {
  const regSession = { userId: 'USR-0001', role: ROLES.REGISTRATION, sessionId: 'x' };
  const accSession = { userId: 'USR-0003', role: ROLES.ACCOMMODATION, sessionId: 'z' };
  let fixture = null;
  let createdTeamId = null;
  const trashFileIds = [];
  try {
    fixture = _makeMessTestFixture_('2026-08-19', '2026-08-20', 4);
    createdTeamId = fixture.teamId;

    initiateDeparture_(regSession, createdTeamId);
    recordFoodRefund_(regSession, createdTeamId, [{ entitlementId: fixture.entitlementIds[0], amount: 40 }]);

    let threwNoNoc = false;
    try {
      finalizeDepartureAndGenerateDocuments_(regSession, createdTeamId, 0, 'FN', '2026-08-20', ['not-a-real-inbox@example.invalid']);
    } catch (err) { threwNoNoc = true; assertEqual_(err.code, 'SECURITY_GATED_ON_NOC', 'wrong code before NOC is granted'); }
    assertTrue_(threwNoNoc, 'finalize should require NOC before proceeding');

    appendRow_('ACCOMMODATION_NOC', {
      NocId: nextId_('NOC', 4), TeamId: createdTeamId, Status: 'NOC_GRANTED',
      IssuedBy: accSession.userId, IssuedAt: new Date().toISOString(), Notes: '', PdfFileId: 'test-fixture-no-real-pdf'
    });
    // No security refund recorded on purpose — this fixture has no security charge, so
    // finalize should proceed fine with SecurityRefunded = 0 (no SECURITY_REFUNDS row at all).

    const preview = getDepartureOverview_(regSession, createdTeamId).settlementPreview;
    assertEqual_(preview.foodRefund, 40, 'settlement preview should reflect the food refund already recorded');
    assertEqual_(preview.securityRefunded, 0, 'settlement preview should show 0 security refunded (none recorded)');

    const finalized = finalizeDepartureAndGenerateDocuments_(regSession, createdTeamId, 0, 'FN', '2026-08-20', ['not-a-real-inbox@example.invalid']);
    trashFileIds.push(finalized.receiptPdfFileId, finalized.relievingPdfFileId);
    assertTrue_(!!finalized.receiptPdfFileId, 'finalize should generate a real Final Receipt PDF');
    assertTrue_(!!finalized.relievingPdfFileId, 'finalize should generate a real Relieving Order PDF');
    assertEqual_(finalized.alreadyFinalized, false, 'first finalize call should not report alreadyFinalized');

    const settlement = findRowsByField_('SETTLEMENTS', 'TeamId', createdTeamId)[0];
    assertEqual_(Number(settlement.FoodRefund), 40, 'SETTLEMENTS.FoodRefund should match the recorded refund');
    assertEqual_(settlement.Status, 'FINALIZED', 'SETTLEMENTS row should be FINALIZED');

    const teamAfter = findRowById_('TEAMS', 'TeamId', createdTeamId);
    assertEqual_(teamAfter.values.Status, 'RELIEVED', 'team status should flip to RELIEVED');
    assertEqual_(teamAfter.values.DepartureLockedBy, '', 'departure lock should be released');

    const repeat = finalizeDepartureAndGenerateDocuments_(regSession, createdTeamId, 0, 'FN', '2026-08-20', ['not-a-real-inbox@example.invalid']);
    assertEqual_(repeat.receiptId, finalized.receiptId, 'a repeat finalize call should return the SAME receipt, not generate a new one');
    assertTrue_(repeat.alreadyFinalized, 'a repeat finalize call should report alreadyFinalized');
    assertEqual_(findRowsByField_('RECEIPTS', 'TeamId', createdTeamId).filter(function (r) { return r.Type === 'FINAL'; }).length, 1, 'a repeat finalize call must not create a second FINAL receipt');
  } finally {
    trashFileIds.forEach(function (id) { if (id) DriveApp.getFileById(id).setTrashed(true); });
    if (createdTeamId) {
      findRowsByField_('SETTLEMENTS', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('SETTLEMENTS', 'SettlementId', r.SettlementId); });
      findRowsByField_('RECEIPTS', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('RECEIPTS', 'ReceiptId', r.ReceiptId); });
      findRowsByField_('RELIEVING', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('RELIEVING', 'RelievingId', r.RelievingId); });
      findRowsByField_('DOCUMENTS', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('DOCUMENTS', 'DocumentId', r.DocumentId); });
      findRowsByField_('REFUNDS', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('REFUNDS', 'RefundId', r.RefundId); });
      findRowsByField_('SECURITY_REFUNDS', 'TeamId', createdTeamId).forEach(function (r) { deleteRowById_('SECURITY_REFUNDS', 'SecurityRefundId', r.SecurityRefundId); });
      findRowsByField_('ACCOMMODATION_NOC', 'TeamId', createdTeamId).forEach(function (n) { deleteRowById_('ACCOMMODATION_NOC', 'NocId', n.NocId); });
    }
    if (fixture) _cleanupMessTestFixture_(fixture);
  }
}
```

Register in `TEST_CASES` (after `departure_fullRefundFlow`):

```javascript
  { name: 'finalDocuments_numberToWordsIndian', fn: test_finalDocuments_numberToWordsIndian },
  { name: 'departure_finalizeGeneratesDocumentsAndReliefsTeam', fn: test_departure_finalizeGeneratesDocumentsAndReliefsTeam, tier: 'pdf2' },
```

- [ ] **Step 2: Push and verify both fail**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
```

```bash
call_action '{"action":"system.selfTestSplit","payload":{"name":"finalDocuments_numberToWordsIndian"}}'
```

Expected: FAILs — `_numberToWordsIndian_ is not defined` (deploy in Step 5 is what actually
reaches the live Web App; this failure is expected either way).

- [ ] **Step 3: Extend `getDepartureOverview_` in `backend/Departure.gs`**

Change:

```javascript
    securityCharged: charges ? Number(charges.SecurityCharges) : 0,
    refunds: refunds,
    securityRefunds: findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId),
    nocStatus: nocStatus.status,
    departureLockedBy: team.values.DepartureLockedBy || null
  };
}
```

to:

```javascript
    securityCharged: charges ? Number(charges.SecurityCharges) : 0,
    refunds: refunds,
    securityRefunds: findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId),
    nocStatus: nocStatus.status,
    departureLockedBy: team.values.DepartureLockedBy || null,
    settlementPreview: _computeSettlementPreview_(teamId)
  };
}

// Shared by getDepartureOverview_ (live preview, no persistence) and
// finalizeDepartureAndGenerateDocuments_ (FinalDocuments.gs, same math, persisted) — kept in
// one place so the preview the operator sees can never drift from what finalize actually
// computes.
function _computeSettlementPreview_(teamId) {
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId)[0] || null;
  const packages = findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId);
  const grossMealCharges = packages.reduce(function (sum, p) { return sum + Number(p.Amount); }, 0);
  const grossDariCharges = charges ? Number(charges.DariCharges) : 0;
  const foodRefund = findRowsByField_('REFUNDS', 'TeamId', teamId).reduce(function (sum, r) { return sum + Number(r.RefundAmount); }, 0);
  const securityCollected = charges ? Number(charges.SecurityCharges) : 0;
  const securityRefundRow = findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId)[0];
  const securityRefunded = securityRefundRow ? Number(securityRefundRow.Amount) : 0;
  const grossCharges = grossMealCharges + grossDariCharges;
  return {
    grossMealCharges: grossMealCharges, grossDariCharges: grossDariCharges, grossCharges: grossCharges,
    foodRefund: foodRefund, netCharges: grossCharges - foodRefund,
    securityCollected: securityCollected, securityRefunded: securityRefunded
  };
}
```

- [ ] **Step 4: Create `backend/FinalDocuments.gs`**

```javascript
// FinalDocuments.gs — Phase 8: settlement finalization, Final Receipt PDF, Relieving Order
// PDF, both emailed together, departure lock released, team RELIEVED.
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §23.

function _numberToWordsIndian_(amount) {
  const num = Math.round(Number(amount) || 0);
  if (num === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }
  function threeDigits(n) {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    return (hundred ? ones[hundred] + ' Hundred' + (rest ? ' ' : '') : '') + (rest ? twoDigits(rest) : '');
  }

  let n = Math.abs(num);
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundredPart = n;

  const parts = [];
  if (crore) parts.push(threeDigits(crore) + ' Crore');
  if (lakh) parts.push(threeDigits(lakh) + ' Lakh');
  if (thousand) parts.push(threeDigits(thousand) + ' Thousand');
  if (hundredPart) parts.push(threeDigits(hundredPart));

  return (num < 0 ? 'Minus ' : '') + parts.join(' ') + ' Rupees Only';
}

// Draws a signature/seal image if the given SETTINGS key holds a real Drive file ID;
// otherwise falls back to a plain text line (matches the temp receipt's existing convention —
// nothing blocks on the human uploading real signature images).
function _drawSignatureOrLine_(slide, x, y, width, label, fileIdSettingKey) {
  const fileId = getSetting_(fileIdSettingKey, '');
  if (fileId) {
    const imageHeight = width * 0.35;
    const blob = DriveApp.getFileById(fileId).getBlob();
    slide.insertImage(blob, x, y, width, imageHeight);
    const labelBox = slide.insertTextBox(label, x, y + imageHeight, width, imageHeight * 0.3);
    labelBox.getText().getTextStyle().setFontSize(8);
    labelBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    return;
  }
  const lineBox = slide.insertTextBox('________________________', x, y, width, width * 0.08);
  lineBox.getText().getTextStyle().setFontSize(9);
  lineBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  const labelBox = slide.insertTextBox(label, x, y + width * 0.08, width, width * 0.08);
  labelBox.getText().getTextStyle().setFontSize(8);
  labelBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
}

function _buildFinalReceiptLayout_(pres, data) {
  const slide = pres.getSlides()[0];
  _clearSlide_(slide);
  if (!data) return slide;

  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();
  const margin = pageWidth * 0.08;
  const contentWidth = pageWidth - margin * 2;
  let y = pageHeight * 0.03;

  function addLine(text, heightFraction, fontSize, opts) {
    const box = slide.insertTextBox(text, margin, y, contentWidth, pageHeight * heightFraction);
    const style = box.getText().getTextStyle().setFontSize(fontSize);
    if (opts && opts.bold) style.setBold(true);
    box.getText().getParagraphStyle().setParagraphAlignment(
      opts && opts.left ? SlidesApp.ParagraphAlignment.START : SlidesApp.ParagraphAlignment.CENTER
    );
    y += pageHeight * heightFraction;
  }

  addLine(data.tournamentName, 0.04, 11, { bold: true });
  addLine(data.organizer, 0.03, 9, {});
  addLine(data.districtAddress, 0.03, 8, {});
  y += pageHeight * 0.015;
  addLine('FINAL SETTLEMENT RECEIPT', 0.045, 13, { bold: true });
  y += pageHeight * 0.02;

  addLine('Receipt No: ' + data.receiptNumber, 0.03, 9, { left: true });
  addLine('Date: ' + data.date, 0.03, 9, { left: true });
  addLine('Registration No: ' + data.registrationNumber + '   College: ' + data.collegeName, 0.035, 9, { left: true });
  y += pageHeight * 0.015;

  function addRow(label, amount) {
    const rowHeight = 0.032;
    const labelBox = slide.insertTextBox(label, margin, y, contentWidth * 0.72, pageHeight * rowHeight);
    labelBox.getText().getTextStyle().setFontSize(8.5);
    labelBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);
    const amountBox = slide.insertTextBox('Rs ' + amount, margin + contentWidth * 0.72, y, contentWidth * 0.28, pageHeight * rowHeight);
    amountBox.getText().getTextStyle().setFontSize(8.5);
    amountBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);
    y += pageHeight * rowHeight;
  }

  addRow('Gross Food Package Charges', data.grossMealCharges);
  addRow('Gross Dari Charges', data.grossDariCharges);
  addRow('Food Refund', data.foodRefund);
  addRow('Net Charges', data.netCharges);
  addRow('Security Collected', data.securityCollected);
  addRow('Security Refunded', data.securityRefunded);
  y += pageHeight * 0.01;
  addLine('Final Balance (refunded to team): Rs ' + data.finalBalance, 0.045, 10, { bold: true, left: true });
  y += pageHeight * 0.015;
  addLine('Amount in Words: ' + data.amountInWords, 0.045, 8.5, { left: true });
  y += pageHeight * 0.03;

  addLine(
    'This is the final settlement receipt for this team\'s participation. All food, ' +
    'accommodation, and security accounts have been settled as recorded above.',
    0.08, 7.5, { left: true }
  );
  y += pageHeight * 0.03;

  _drawSignatureOrLine_(slide, margin, y, contentWidth * 0.45, 'Signature, Registration Committee Convener', 'RegistrationInchargeSignatureFileId');
  _drawSignatureOrLine_(slide, margin + contentWidth * 0.55, y, contentWidth * 0.45, 'College Seal', 'CollegeSealFileId');

  return slide;
}

function _buildRelievingLayout_(pres, data) {
  const slide = pres.getSlides()[0];
  _clearSlide_(slide);
  if (!data) return slide;

  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();
  const margin = pageWidth * 0.08;
  const contentWidth = pageWidth - margin * 2;
  let y = pageHeight * 0.04;

  function addLine(text, heightFraction, fontSize, opts) {
    const box = slide.insertTextBox(text, margin, y, contentWidth, pageHeight * heightFraction);
    const style = box.getText().getTextStyle().setFontSize(fontSize);
    if (opts && opts.bold) style.setBold(true);
    box.getText().getParagraphStyle().setParagraphAlignment(
      opts && opts.left ? SlidesApp.ParagraphAlignment.START : SlidesApp.ParagraphAlignment.CENTER
    );
    y += pageHeight * heightFraction;
  }

  addLine(data.tournamentName, 0.045, 12, { bold: true });
  addLine(data.organizer, 0.03, 9, {});
  y += pageHeight * 0.025;
  addLine('RELIEVING ORDER', 0.05, 14, { bold: true });
  y += pageHeight * 0.03;

  addLine('Relieving No: ' + data.relievingNumber, 0.03, 9, { left: true });
  addLine('Date: ' + data.relievingDate + '   Session: ' + data.session, 0.03, 9, { left: true });
  y += pageHeight * 0.02;

  const inchargeWord = data.inchargeCount === 1 ? 'Incharge' : 'Incharges';
  addLine(
    'This is to certify that the team of ' + data.collegeName + ' (Registration No: ' + data.registrationNumber + '), ' +
    'comprising ' + data.teamMemberCount + ' team member(s) under the ' + inchargeWord + ' ' + data.inchargeNamesText + ', ' +
    'has completed participation in the tournament and is hereby relieved as of the above date and session.',
    0.16, 10, { left: true }
  );
  y += pageHeight * 0.06;

  _drawSignatureOrLine_(slide, margin, y, contentWidth * 0.45, 'Signature, Registration Committee Convener', 'RegistrationInchargeSignatureFileId');
  _drawSignatureOrLine_(slide, margin + contentWidth * 0.55, y, contentWidth * 0.45, 'College Seal', 'CollegeSealFileId');

  return slide;
}

// Mirrors createNocTemplate_ exactly. Left at Slides' default landscape size deliberately —
// this layout is proportional (getPageWidth/getPageHeight-relative throughout), so it renders
// correctly regardless of actual page size; only the printed-coupon grid genuinely needs a
// fixed physical page size.
function createRelievingTemplate_(actorSession, force) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const existing = templatesFolder.getFilesByName('Relieving Order Template');

  if (existing.hasNext()) {
    const existingFile = existing.next();
    if (!force) return { templateId: existingFile.getId(), created: false };
    const pres = SlidesApp.openById(existingFile.getId());
    _buildRelievingLayout_(pres, null);
    pres.saveAndClose();
    return { templateId: existingFile.getId(), created: false };
  }

  const pres = SlidesApp.create('Relieving Order Template');
  const fileId = pres.getId();
  DriveApp.getFileById(fileId).moveTo(templatesFolder);
  _buildRelievingLayout_(pres, null);
  pres.saveAndClose();
  return { templateId: fileId, created: true };
}

function finalizeDepartureAndGenerateDocuments_(actorSession, teamId, otherAdjustments, relievingSession, relievingDate, recipientEmails) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);

  function existingFinalResult() {
    const existingFinal = findRowsByField_('RECEIPTS', 'TeamId', teamId).filter(function (r) { return r.Type === 'FINAL'; })[0];
    if (!existingFinal) return null;
    const existingRelieving = findRowsByField_('RELIEVING', 'TeamId', teamId)[0];
    return {
      teamId: teamId, receiptId: existingFinal.ReceiptId, receiptPdfFileId: existingFinal.PdfFileId,
      relievingId: existingRelieving ? existingRelieving.RelievingId : null,
      relievingPdfFileId: existingRelieving ? existingRelieving.PdfFileId : null, alreadyFinalized: true
    };
  }
  const fastPathExisting = existingFinalResult();
  if (fastPathExisting) return fastPathExisting;

  if (relievingSession !== 'AN' && relievingSession !== 'FN') {
    throw apiError_('VALIDATION_ERROR', 'Session must be AN or FN.');
  }
  if (!relievingDate) throw apiError_('VALIDATION_ERROR', 'Relieving date is required.');

  const nocStatus = getNocStatus_(actorSession, teamId);
  if (nocStatus.status !== 'NOC_GRANTED') {
    throw apiError_('SECURITY_GATED_ON_NOC', 'Departure cannot be finalized until the Accommodation NOC is granted.');
  }
  _requireDepartureLockHeldByCaller_(actorSession, team);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const authoritativeExisting = existingFinalResult();
    if (authoritativeExisting) return authoritativeExisting;

    const preview = _computeSettlementPreview_(teamId);
    const adjustments = Number(otherAdjustments) || 0;
    const finalBalance = preview.foodRefund + preview.securityRefunded - adjustments;

    const now = new Date();
    const nowIso = now.toISOString();
    const settlementId = nextId_('SETL', 4);
    appendRow_('SETTLEMENTS', {
      SettlementId: settlementId, TeamId: teamId, GrossMealCharges: preview.grossMealCharges,
      GrossDariCharges: preview.grossDariCharges, GrossCharges: preview.grossCharges, FoodRefund: preview.foodRefund,
      OtherAdjustments: adjustments, NetCharges: preview.netCharges, SecurityCollected: preview.securityCollected,
      SecurityRefunded: preview.securityRefunded, FinalBalance: finalBalance,
      SettledAt: nowIso, SettledBy: actorSession.userId, Status: 'FINALIZED'
    });

    // --- Final Receipt PDF (reuses the existing Temporary Receipt Template file/page size) ---
    const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
    const receiptTemplateIter = templatesFolder.getFilesByName('Temporary Receipt Template');
    if (!receiptTemplateIter.hasNext()) {
      throw apiError_('NOT_FOUND', 'Temporary receipt template not set up — run admin.bootstrap.createReceiptTemplate first.');
    }
    const receiptTemplateFile = receiptTemplateIter.next();
    const finalReceiptsFolder = _ensureSubfolder_(_ensureSubfolder_(_getRootFolder_(), 'Registration'), 'Final Receipts');
    const receiptNumber = nextDocumentNumber_('Receipt');
    const amountInWords = _numberToWordsIndian_(Math.abs(finalBalance));

    const receiptCopy = receiptTemplateFile.makeCopy('Final Receipt - ' + team.values.RegistrationNumber, finalReceiptsFolder);
    const receiptPres = SlidesApp.openById(receiptCopy.getId());
    _buildFinalReceiptLayout_(receiptPres, {
      tournamentName: getSetting_('TournamentName', ''), organizer: getSetting_('OrganizerName', ''),
      districtAddress: getSetting_('DistrictAddress', ''), receiptNumber: receiptNumber,
      date: Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd'), registrationNumber: team.values.RegistrationNumber,
      collegeName: team.values.CollegeName, grossMealCharges: preview.grossMealCharges, grossDariCharges: preview.grossDariCharges,
      foodRefund: preview.foodRefund, netCharges: preview.netCharges, securityCollected: preview.securityCollected,
      securityRefunded: preview.securityRefunded, finalBalance: finalBalance, amountInWords: amountInWords
    });
    receiptPres.saveAndClose();
    const receiptPdfBlob = DriveApp.getFileById(receiptCopy.getId()).getAs('application/pdf');
    const receiptPdfFile = finalReceiptsFolder.createFile(receiptPdfBlob).setName('Final-Receipt-' + receiptNumber.replace(/\//g, '-') + '.pdf');
    DriveApp.getFileById(receiptCopy.getId()).setTrashed(true);

    const receiptId = nextId_('RCT', 4);
    appendRow_('RECEIPTS', {
      ReceiptId: receiptId, ReceiptNumber: receiptNumber, Type: 'FINAL', TeamId: teamId, SettlementId: settlementId,
      GrossMealCharges: preview.grossMealCharges, GrossDariCharges: preview.grossDariCharges, GrandTotal: preview.grossCharges,
      FoodRefundTotal: preview.foodRefund, NetAmount: preview.netCharges, AmountInWords: amountInWords,
      GeneratedAt: nowIso, GeneratedBy: actorSession.userId, PdfFileId: receiptPdfFile.getId()
    });

    // --- Relieving Order PDF (its own template) ---
    const relievingTemplateIter = templatesFolder.getFilesByName('Relieving Order Template');
    if (!relievingTemplateIter.hasNext()) {
      throw apiError_('NOT_FOUND', 'Relieving order template not set up — run admin.bootstrap.createRelievingTemplate first.');
    }
    const relievingTemplateFile = relievingTemplateIter.next();
    const relievingFolder = _ensureSubfolder_(_getRootFolder_(), 'Relieving Orders');
    const relievingNumber = nextDocumentNumber_('Relieving');
    const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId);
    const inchargeNamesText = incharges.map(function (i) { return i.Name; }).join(', ');

    const relievingCopy = relievingTemplateFile.makeCopy('Relieving Order - ' + team.values.RegistrationNumber, relievingFolder);
    const relievingPres = SlidesApp.openById(relievingCopy.getId());
    _buildRelievingLayout_(relievingPres, {
      tournamentName: getSetting_('TournamentName', ''), organizer: getSetting_('OrganizerName', ''),
      relievingNumber: relievingNumber, relievingDate: relievingDate,
      session: relievingSession === 'AN' ? 'Afternoon' : 'Forenoon',
      registrationNumber: team.values.RegistrationNumber, collegeName: team.values.CollegeName,
      inchargeNamesText: inchargeNamesText, inchargeCount: incharges.length, teamMemberCount: Number(team.values.NumberOfTeamMembers)
    });
    relievingPres.saveAndClose();
    const relievingPdfBlob = DriveApp.getFileById(relievingCopy.getId()).getAs('application/pdf');
    const relievingPdfFile = relievingFolder.createFile(relievingPdfBlob).setName('Relieving-' + relievingNumber.replace(/\//g, '-') + '.pdf');
    DriveApp.getFileById(relievingCopy.getId()).setTrashed(true);

    const relievingId = nextId_('REL', 4);
    appendRow_('RELIEVING', {
      RelievingId: relievingId, RelievingNumber: relievingNumber, TeamId: teamId, Session: relievingSession,
      RelievingDate: relievingDate, InchargeNamesText: inchargeNamesText, TeamMemberCount: team.values.NumberOfTeamMembers,
      GeneratedAt: nowIso, GeneratedBy: actorSession.userId, PdfFileId: relievingPdfFile.getId()
    });

    appendRow_('DOCUMENTS', {
      DocumentId: nextId_('DOC', 4), Type: 'FINAL_RECEIPT', TeamId: teamId, RelatedId: receiptId,
      DriveFileId: receiptPdfFile.getId(), GeneratedAt: nowIso, GeneratedBy: actorSession.userId
    });
    appendRow_('DOCUMENTS', {
      DocumentId: nextId_('DOC', 4), Type: 'RELIEVING_ORDER', TeamId: teamId, RelatedId: relievingId,
      DriveFileId: relievingPdfFile.getId(), GeneratedAt: nowIso, GeneratedBy: actorSession.userId
    });

    // --- Email both PDFs together, release the lock, RELIEVED ---
    let recipients = recipientEmails;
    if (!recipients || recipients.length === 0) {
      recipients = incharges.map(function (i) { return i.EmailAddress; }).filter(function (e) { return !!e; });
    }
    let emailStatus = 'NOT_SENT';
    if (recipients.length > 0) {
      const subject = 'Final Documents — ' + team.values.RegistrationNumber;
      const body = 'Please find attached your Final Receipt and Relieving Order.';
      try {
        GmailApp.sendEmail(recipients.join(','), subject, body, {
          attachments: [DriveApp.getFileById(receiptPdfFile.getId()).getBlob(), DriveApp.getFileById(relievingPdfFile.getId()).getBlob()],
          name: getSetting_('OrganizerName', '')
        });
        emailStatus = 'SENT';
      } catch (err) {
        emailStatus = 'FAILED';
      }
      appendRow_('EMAIL_LOG', {
        EmailId: nextId_('EML', 4), DocumentId: receiptId, Recipient: recipients.join(','), Subject: subject,
        SentAt: nowIso, User: actorSession.userId, Status: emailStatus, ErrorMessage: ''
      });
    }

    updateRowById_('TEAMS', 'TeamId', teamId, {
      Status: 'RELIEVED', DepartureLockedBy: '', DepartureLockedAt: '', UpdatedBy: actorSession.userId, UpdatedAt: nowIso
    });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: nowIso, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'FINALIZE_DEPARTURE', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: 'RELIEVED'
    });

    return {
      teamId: teamId, receiptId: receiptId, receiptPdfFileId: receiptPdfFile.getId(),
      relievingId: relievingId, relievingPdfFileId: relievingPdfFile.getId(), emailStatus: emailStatus, alreadyFinalized: false
    };
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 5: Register two actions in `backend/Main.gs`'s `ACTIONS` table**

Change the end of the `ACTIONS` object literal from:

```javascript
  'departure.recordSecurityRefund': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return recordSecurityRefund_(session, payload.teamId, payload.amount);
  }
};
```

to:

```javascript
  'departure.recordSecurityRefund': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return recordSecurityRefund_(session, payload.teamId, payload.amount);
  },
  'admin.bootstrap.createRelievingTemplate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createRelievingTemplate_(session, !!(payload && payload.force));
  },
  'departure.finalize': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return finalizeDepartureAndGenerateDocuments_(session, payload.teamId, payload.otherAdjustments, payload.relievingSession, payload.relievingDate, payload.recipientEmails);
  }
};
```

- [ ] **Step 6: Push, deploy, create the Relieving template once, verify both tests pass**

```bash
cd "C:\Users\princ\Downloads\HPUICK\backend"
npx --yes @google/clasp push --force
npx --yes @google/clasp deploy -i AKfycbySk37loMP-Go23y-bTZBeSlsY1Kop96tKg476U16YFlNKYxXAsh0IzmeKMDCrrq6TI -d "Phase 8: settlement, final receipt, relieving order"
```

Create the Relieving template once (requires a real Admin session — log in first if this
session doesn't already have one):

```bash
call_action '{"action":"admin.bootstrap.createRelievingTemplate","payload":{},"sessionId":"<a real admin sessionId>"}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"finalDocuments_numberToWordsIndian"}}'
call_action '{"action":"system.selfTestSplit","payload":{"name":"departure_finalizeGeneratesDocumentsAndReliefsTeam"}}'
call_action '{"action":"system.selfTestSplit","payload":{}}'
call_action '{"action":"system.selfTestSplit","payload":{"only":"pdf2"}}'
```

Expected: both new tests report `"status":"PASS"`; `fast` and `pdf2` tiers report every
previously-passing test still passing, plus these.

- [ ] **Step 7: Commit**

```bash
git add backend/FinalDocuments.gs backend/Departure.gs backend/Main.gs backend/Tests.gs
git commit -m "Phase 8: FinalDocuments.gs - settlement, final receipt, relieving order

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```

---

## Task 2: Frontend — Finalize & Send, then dev-log

**Files:**
- Modify: `frontend/js/departure.js` (settlement preview, Other Adjustments field,
  Session/date picker, Finalize & Send button)
- Modify: `frontend/service-worker.js` (bump `CACHE_NAME` — no new file, `departure.js`
  already in `SHELL_FILES` from Phase 7)
- Modify: `docs/superpowers/dev-log.md`

- [ ] **Step 1: Extend `renderInProgress` in `frontend/js/departure.js`**

Change the `renderInProgress` function's HTML block from (ending at the NOC/security-refund
section, before the Cancel button):

```javascript
        (overview.securityRefunds.length > 0
          ? '<p>Security refund recorded: Rs ' + overview.securityRefunds[0].Amount + '</p>'
          : (overview.nocStatus === 'NOC_GRANTED'
              ? '<label>Amount<input type="number" id="security-refund-amount" min="0" value="' + overview.securityCharged + '"></label><button id="submit-security-refund-btn">Record Security Refund</button>'
              : '<p>NOC not yet granted — security refund unavailable.</p>')) +
        '<button id="cancel-departure-btn" style="margin-top:16px;background:#999">Cancel Departure</button>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';
```

to:

```javascript
        (overview.securityRefunds.length > 0
          ? '<p>Security refund recorded: Rs ' + overview.securityRefunds[0].Amount + '</p>'
          : (overview.nocStatus === 'NOC_GRANTED'
              ? '<label>Amount<input type="number" id="security-refund-amount" min="0" value="' + overview.securityCharged + '"></label><button id="submit-security-refund-btn">Record Security Refund</button>'
              : '<p>NOC not yet granted — security refund unavailable.</p>')) +
        (overview.nocStatus === 'NOC_GRANTED' ? _renderFinalizeSection(overview) : '') +
        '<button id="cancel-departure-btn" style="margin-top:16px;background:#999">Cancel Departure</button>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';
```

Then add `_renderFinalizeSection` and its wiring — insert this new function above
`renderDepartureScreen` (top of the file, after the header comment) and call its wiring at the
end of `renderInProgress` (after the existing `if (document.getElementById('submit-security-refund-btn'))` block):

```javascript
function _renderFinalizeSection(overview) {
  const p = overview.settlementPreview;
  const today = new Date().toISOString().slice(0, 10);
  return (
    '<h2 style="margin-top:16px">Finalize & Send</h2>' +
    '<p>Gross Charges: Rs ' + p.grossCharges + ' &middot; Net Charges: Rs ' + p.netCharges + '</p>' +
    '<label>Other Adjustments<input type="number" id="other-adjustments" value="0"></label>' +
    '<p id="final-balance-preview">Final Balance (refunded to team): Rs ' + (p.foodRefund + p.securityRefunded) + '</p>' +
    '<label>Session<select id="relieving-session"><option value="FN">Forenoon</option><option value="AN">Afternoon</option></select></label>' +
    '<label>Relieving Date<input type="date" id="relieving-date" value="' + today + '"></label>' +
    '<button id="finalize-btn">Finalize &amp; Send</button>'
  );
}
```

```javascript
    if (document.getElementById('other-adjustments')) {
      const preview = overview.settlementPreview;
      document.getElementById('other-adjustments').addEventListener('input', function () {
        const adjustments = Number(document.getElementById('other-adjustments').value) || 0;
        document.getElementById('final-balance-preview').textContent =
          'Final Balance (refunded to team): Rs ' + (preview.foodRefund + preview.securityRefunded - adjustments);
      });
      document.getElementById('finalize-btn').addEventListener('click', async function () {
        const errEl = document.getElementById('departure-error');
        errEl.style.display = 'none';
        try {
          await apiCall('departure.finalize', {
            teamId: teamId,
            otherAdjustments: Number(document.getElementById('other-adjustments').value) || 0,
            relievingSession: document.getElementById('relieving-session').value,
            relievingDate: document.getElementById('relieving-date').value
          });
          goBack();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    }
```

- [ ] **Step 2: Bump the service worker in `frontend/service-worker.js`**

Change `'hpuick-shell-v22'` to `'hpuick-shell-v23'`.

- [ ] **Step 3: Commit and deploy the frontend**

```bash
cd "C:\Users\princ\Downloads\HPUICK"
git add frontend/js/departure.js frontend/service-worker.js
git commit -m "Phase 8: frontend — Finalize & Send (settlement preview, session/date, both PDFs)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
git subtree push --prefix=frontend frontend-origin main
```

- [ ] **Step 4: Dev-log entry**

Append to `docs/superpowers/dev-log.md`: summarize the settlement formulas (bookkeeping, not
business-judgment — derivable and proposed rather than left unrecoverable), the
one-composite-action design chosen for app-flow speed, the idempotent-finalize guard, the
signature/seal fallback, and the actual live test totals from Task 1 Step 6.

```bash
git add docs/superpowers/dev-log.md
git commit -m "Phase 8: dev log entry — settlement, final receipt, relieving order

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Anx37a79MTjJqGdEkEwk3a"
```
