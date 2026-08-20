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
  y += pageHeight * 0.01;
  addLine('Net Amount for Meal/Dari Charges: Rs ' + data.netCharges, 0.045, 10, { bold: true, left: true });
  y += pageHeight * 0.015;
  addLine('Amount in Words: ' + data.amountInWords, 0.045, 8.5, { left: true });
  y += pageHeight * 0.03;

  addLine(
    'This is the final settlement receipt for this team\'s Meal and Dari (players\') charges only. ' +
    'The security deposit, if any, has been settled and refunded separately at departure and is ' +
    'not included in this figure.',
    0.08, 7.5, { left: true }
  );
  y += pageHeight * 0.03;

  _drawSignatureOrLine_(slide, margin, y, contentWidth * 0.30, 'Signature, Registration Committee Convener', 'RegistrationInchargeSignatureFileId');
  _drawSignatureOrLine_(slide, margin + contentWidth * 0.35, y, contentWidth * 0.30, 'Signature, Principal', 'PrincipalSignatureFileId');
  _drawSignatureOrLine_(slide, margin + contentWidth * 0.70, y, contentWidth * 0.30, 'Principal\'s Seal', 'PrincipalSealFileId');

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

  _drawSignatureOrLine_(slide, margin, y, contentWidth * 0.30, 'Signature, Registration Committee Convener', 'RegistrationInchargeSignatureFileId');
  _drawSignatureOrLine_(slide, margin + contentWidth * 0.35, y, contentWidth * 0.30, 'Signature, Principal', 'PrincipalSignatureFileId');
  _drawSignatureOrLine_(slide, margin + contentWidth * 0.70, y, contentWidth * 0.30, 'Principal\'s Seal', 'PrincipalSealFileId');

  return slide;
}

// Sends (or re-sends) the Final Receipt + Relieving Order PDFs together as attachments.
// Mirrors FoodPackages.gs's _sendCouponEmail_ exactly (same default-recipients rule, same
// capture-the-real-error-on-failure fix) so both finalizeDepartureAndGenerateDocuments_ and
// resendFinalDocuments_ share one code path and can never drift apart again.
function _sendFinalDocumentsEmail_(actorSession, teamId, receiptId, receiptPdfFileId, relievingPdfFileId, recipientEmails, verb) {
  let recipients = recipientEmails;
  if (!recipients || recipients.length === 0) {
    recipients = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId)
      .map(function (i) { return i.EmailAddress; }).filter(function (e) { return !!e; });
  }
  if (recipients.length === 0) return { status: 'NOT_SENT', recipients: [] };

  const team = findRowById_('TEAMS', 'TeamId', teamId);
  const subject = 'Final Documents — ' + (team ? team.values.RegistrationNumber : teamId);
  const body = 'Please find attached your Final Receipt and Relieving Order' + (verb === 'resent' ? ' (resent).' : '.');
  let status = 'SENT';
  let errorMessage = '';
  try {
    GmailApp.sendEmail(recipients.join(','), subject, body, {
      attachments: [DriveApp.getFileById(receiptPdfFileId).getBlob(), DriveApp.getFileById(relievingPdfFileId).getBlob()],
      name: getSetting_('OrganizerName', '')
    });
  } catch (err) {
    status = 'FAILED';
    errorMessage = err.message;
  }
  appendRow_('EMAIL_LOG', {
    EmailId: nextId_('EML', 4), DocumentId: receiptId, Recipient: recipients.join(','), Subject: subject,
    SentAt: new Date().toISOString(), User: actorSession.userId, Status: status, ErrorMessage: errorMessage
  });
  return { status: status, recipients: recipients };
}

// Re-sends the EXISTING Final Receipt + Relieving Order PDFs for an already-finalized
// departure — never regenerates the PDFs or touches the SETTLEMENTS row. Needed because
// departure.finalize's fast-path (spec §23, deliberate) never re-attempts the email on a
// repeat call, so a team finalized while Gmail was mid-authorization-gap (or with a wrong
// incharge email on file) had no recovery path at all until this action existed. Mirrors
// FoodPackages.gs's resendCoupon_/registration.package.resend pattern.
function resendFinalDocuments_(actorSession, teamId, recipientEmails) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const receiptRow = findRowsByField_('RECEIPTS', 'TeamId', teamId).filter(function (r) { return r.Type === 'FINAL'; })[0];
  if (!receiptRow) throw apiError_('NOT_FOUND', 'No Final Receipt has been generated for this team yet.');
  const relievingRow = findRowsByField_('RELIEVING', 'TeamId', teamId)[0];
  if (!relievingRow) throw apiError_('NOT_FOUND', 'No Relieving Order has been generated for this team yet.');

  const result = _sendFinalDocumentsEmail_(
    actorSession, teamId, receiptRow.ReceiptId, receiptRow.PdfFileId, relievingRow.PdfFileId, recipientEmails, 'resent'
  );
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: new Date().toISOString(), UserId: actorSession.userId, Role: actorSession.role,
    Action: 'RESEND_FINAL_DOCUMENTS', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: result.status
  });
  return {
    teamId: teamId, receiptId: receiptRow.ReceiptId, receiptPdfFileId: receiptRow.PdfFileId,
    relievingId: relievingRow.RelievingId, relievingPdfFileId: relievingRow.PdfFileId,
    // `status` for callers that only care about the email outcome (mirrors resendCoupon_'s
    // return shape); `emailStatus` too so the frontend can treat this and finalize's response
    // identically (renderFinalizedConfirmation re-renders itself from either).
    status: result.status, emailStatus: result.status, recipients: result.recipients
  };
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
    // Meal/Dari (players') charges only — the security deposit is always a separate refundable
    // transaction (spec §18) and must never be netted into what this receipt shows or spells
    // out in words, even though SETTLEMENTS.FinalBalance (below) still tracks the true total
    // cash returned for internal bookkeeping.
    const amountInWords = _numberToWordsIndian_(Math.abs(preview.netCharges));

    const receiptCopy = receiptTemplateFile.makeCopy('Final Receipt - ' + team.values.RegistrationNumber, finalReceiptsFolder);
    const receiptPres = SlidesApp.openById(receiptCopy.getId());
    _buildFinalReceiptLayout_(receiptPres, {
      tournamentName: getSetting_('TournamentName', ''), organizer: getSetting_('OrganizerName', ''),
      districtAddress: getSetting_('DistrictAddress', ''), receiptNumber: receiptNumber,
      date: Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd'), registrationNumber: team.values.RegistrationNumber,
      collegeName: team.values.CollegeName, grossMealCharges: preview.grossMealCharges, grossDariCharges: preview.grossDariCharges,
      foodRefund: preview.foodRefund, netCharges: preview.netCharges, amountInWords: amountInWords
    });
    receiptPres.saveAndClose();
    const receiptPdfBlob = DriveApp.getFileById(receiptCopy.getId()).getAs('application/pdf');
    const receiptPdfFile = finalReceiptsFolder.createFile(receiptPdfBlob).setName('Final-Receipt-' + receiptNumber.replace(/\//g, '-') + '.pdf');
    DriveApp.getFileById(receiptCopy.getId()).setTrashed(true);
    // View-only link sharing — every Drive file this app creates otherwise defaults to
    // private-to-script-owner, which made the Team Detail "View Final Receipt" link
    // indistinguishable from the document never having been generated at all for anyone else.
    receiptPdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

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
    relievingPdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

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
    const emailResult = _sendFinalDocumentsEmail_(
      actorSession, teamId, receiptId, receiptPdfFile.getId(), relievingPdfFile.getId(), recipientEmails, 'sent'
    );
    const emailStatus = emailResult.status;

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
