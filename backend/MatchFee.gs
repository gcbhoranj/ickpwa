// MatchFee.gs — Match Fee Collection: match identity, per-team payment transactions, their
// receipts, resend, and void. Completely separate financial stream from Registration/Dari/
// Security/Food — never enters SETTLEMENTS or RECEIPTS(Type=FINAL).
// Spec: docs/superpowers/specs/2026-08-21-match-fee-collection-design.md

function createMatch_(actorSession, team1Id, team2Id, matchDate) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!team1Id || !team2Id) throw apiError_('VALIDATION_ERROR', 'Both teams are required.');
  if (team1Id === team2Id) throw apiError_('VALIDATION_ERROR', 'Team 1 and Team 2 must be different teams.');
  const team1 = findRowById_('TEAMS', 'TeamId', team1Id);
  if (!team1) throw apiError_('NOT_FOUND', 'No such team: ' + team1Id);
  const team2 = findRowById_('TEAMS', 'TeamId', team2Id);
  if (!team2) throw apiError_('NOT_FOUND', 'No such team: ' + team2Id);
  if (!matchDate) throw apiError_('VALIDATION_ERROR', 'Match date is required.');

  const matchId = nextId_('MATCH', 4);
  const matchNumber = nextDocumentNumber_('Match');
  const now = new Date().toISOString();
  appendRow_('MATCHES', {
    MatchId: matchId, MatchNumber: matchNumber, MatchDate: matchDate, Team1Id: team1Id, Team2Id: team2Id,
    Status: 'SCHEDULED', CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'CREATE_MATCH', Entity: 'MATCH', EntityId: matchId, PreviousState: '', NewState: 'SCHEDULED'
  });
  return { matchId: matchId, matchNumber: matchNumber, matchDate: matchDate, team1Id: team1Id, team2Id: team2Id };
}

// Live-computed team-side status for one match — never cached on MATCHES (spec §2.1: avoids
// a second place this could drift from MATCH_FEE_TRANSACTIONS, the source of truth). "Has
// this team paid" always means "does an ACTIVE row exist for (matchId, teamId)" — the same
// invariant collectMatchFee_ enforces at write time.
function _matchTeamSideStatus_(matchId, teamId) {
  const active = findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId)
    .filter(function (t) { return t.TeamId === teamId && t.Status === 'ACTIVE'; })[0] || null;
  return {
    status: active ? 'PAID' : 'PENDING',
    transactionId: active ? active.TransactionId : null,
    receiptNumber: active ? active.ReceiptNumber : null,
    receiptPdfFileId: active ? active.ReceiptPdfFileId : null,
    paymentMethod: active ? active.PaymentMethod : null,
    paidAt: active ? active.PaidAt : null,
    amount: active ? Number(active.Amount) : null,
    emailStatus: active ? active.EmailStatus : null
  };
}

function _matchSummary_(m) {
  const team1 = findRowById_('TEAMS', 'TeamId', m.Team1Id);
  const team2 = findRowById_('TEAMS', 'TeamId', m.Team2Id);
  return {
    matchId: m.MatchId, matchNumber: m.MatchNumber, matchDate: m.MatchDate, status: m.Status,
    team1: { teamId: m.Team1Id, collegeName: team1 ? team1.values.CollegeName : '(team removed)' },
    team2: { teamId: m.Team2Id, collegeName: team2 ? team2.values.CollegeName : '(team removed)' },
    team1Status: _matchTeamSideStatus_(m.MatchId, m.Team1Id),
    team2Status: _matchTeamSideStatus_(m.MatchId, m.Team2Id),
    matchFeeRate: Number(getSetting_('MatchFeeRate', '0'))
  };
}

function listMatches_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  return rowsToObjects_('MATCHES').map(_matchSummary_);
}

function getMatchDetail_(actorSession, matchId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const match = findRowById_('MATCHES', 'MatchId', matchId);
  if (!match) throw apiError_('NOT_FOUND', 'No such match: ' + matchId);
  return _matchSummary_(match.values);
}

// Own template file, own layout — never shares the Temporary/Final Receipt template (spec
// §8/§10: title MATCH FEE RECEIPT, one receipt per team-payment, never combined). A5 portrait
// like Receipts.gs's Temporary Receipt Template — same one-time-manual-resize trade-off
// documented in that file's header (Slides/Advanced Slides API don't honor a requested page
// size programmatically).
function _buildMatchFeeReceiptLayout_(pres, data) {
  const slide = pres.getSlides()[0];
  _clearSlide_(slide);
  if (!data) return slide; // template-setup call: leave the page blank, just holding its size

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
  addLine('MATCH FEE RECEIPT', 0.045, 13, { bold: true });
  y += pageHeight * 0.02;

  addLine('Receipt No: ' + data.receiptNumber, 0.03, 9, { left: true });
  addLine('Date: ' + data.date, 0.03, 9, { left: true });
  y += pageHeight * 0.02;

  addLine('Received a sum of Rs. ' + data.amount, 0.04, 10, { left: true });
  addLine('(Rupees ' + data.amountInWords + ')', 0.045, 9, { left: true });
  y += pageHeight * 0.015;
  addLine('from: ' + data.payingTeamName, 0.04, 10, { left: true, bold: true });
  y += pageHeight * 0.015;
  addLine('as Match Fee for the match between', 0.035, 9, { left: true });
  addLine(data.team1Name + ' and ' + data.team2Name, 0.04, 10, { left: true, bold: true });
  addLine('on ' + data.matchDate, 0.035, 9, { left: true });
  y += pageHeight * 0.05;

  _drawSignatureOrLine_(slide, margin, y, contentWidth * 0.45, 'Signature, Registration Committee Convener', 'RegistrationInchargeSignatureFileId');

  return slide;
}

function createMatchFeeReceiptTemplate_(actorSession, force) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const existing = templatesFolder.getFilesByName('Match Fee Receipt Template');

  if (existing.hasNext()) {
    const existingFile = existing.next();
    if (!force) return { templateId: existingFile.getId(), created: false };
    const pres = SlidesApp.openById(existingFile.getId());
    _buildMatchFeeReceiptLayout_(pres, null);
    pres.saveAndClose();
    return { templateId: existingFile.getId(), created: false };
  }

  const pres = SlidesApp.create('Match Fee Receipt Template');
  const fileId = pres.getId();
  DriveApp.getFileById(fileId).moveTo(templatesFolder);
  _buildMatchFeeReceiptLayout_(pres, null);
  pres.saveAndClose();
  return { templateId: fileId, created: true };
}

// Mirrors _sendFinalDocumentsEmail_ (FinalDocuments.gs) exactly, but scoped to the PAYING
// team's own incharges only — the opponent's incharges are never read here, so a combined or
// cross-team send is structurally impossible, not merely disallowed by convention.
function _sendMatchFeeReceiptEmail_(actorSession, transactionId, teamId, pdfFileId, recipientEmails, verb) {
  let recipients = recipientEmails;
  if (!recipients || recipients.length === 0) {
    recipients = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId)
      .map(function (i) { return i.EmailAddress; }).filter(function (e) { return !!e; });
  }
  if (recipients.length === 0) {
    appendRow_('EMAIL_LOG', {
      EmailId: nextId_('EML', 4), DocumentId: transactionId, Recipient: '', Subject: '',
      SentAt: new Date().toISOString(), User: actorSession.userId, Status: 'NOT_SENT', ErrorMessage: 'No incharge email on file.'
    });
    return { status: 'NOT_SENT', recipients: [] };
  }

  const team = findRowById_('TEAMS', 'TeamId', teamId);
  const subject = 'Match Fee Receipt — ' + (team ? team.values.RegistrationNumber : teamId);
  const body = 'Please find attached your Match Fee Receipt' + (verb === 'resent' ? ' (resent).' : '.');
  let status = 'SENT';
  let errorMessage = '';
  try {
    GmailApp.sendEmail(recipients.join(','), subject, body, {
      attachments: [DriveApp.getFileById(pdfFileId).getBlob()],
      name: getSetting_('OrganizerName', '')
    });
  } catch (err) {
    status = 'FAILED';
    errorMessage = err.message;
  }
  appendRow_('EMAIL_LOG', {
    EmailId: nextId_('EML', 4), DocumentId: transactionId, Recipient: recipients.join(','), Subject: subject,
    SentAt: new Date().toISOString(), User: actorSession.userId, Status: status, ErrorMessage: errorMessage
  });
  return { status: status, recipients: recipients };
}

function _matchFeeTransactionResponse_(tx, isReplay) {
  return {
    transactionId: tx.TransactionId, matchId: tx.MatchId, teamId: tx.TeamId, amount: Number(tx.Amount),
    rateSnapshot: Number(tx.RateSnapshot), paymentMethod: tx.PaymentMethod, paidAt: tx.PaidAt,
    receiptNumber: tx.ReceiptNumber, receiptPdfFileId: tx.ReceiptPdfFileId,
    receiptPdfUrl: tx.ReceiptPdfFileId ? 'https://drive.google.com/file/d/' + tx.ReceiptPdfFileId + '/view' : '',
    emailStatus: tx.EmailStatus, status: tx.Status, replay: !!isReplay
  };
}

// Mirrors purchasePackage_'s idempotency/locking shape (FoodPackages.gs) and
// finalizeDepartureAndGenerateDocuments_'s fast-path-then-generate shape (FinalDocuments.gs):
// the financial transaction is durably written and the lock released BEFORE the PDF/email
// work, so a PDF or email failure can never leave a payment unrecorded or untraceable (spec
// §25). Enforces the one-ACTIVE-transaction-per-(MatchId,TeamId) invariant (spec §2.2) inside
// the lock — the actual duplicate/concurrent-payment protection.
function collectMatchFee_(actorSession, matchId, teamId, mode, recipientEmails, clientRequestId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!mode) throw apiError_('VALIDATION_ERROR', 'Payment mode is required.');
  const match = findRowById_('MATCHES', 'MatchId', matchId);
  if (!match) throw apiError_('NOT_FOUND', 'No such match: ' + matchId);
  if (match.values.Status === 'VOID') throw apiError_('MATCH_VOID', 'This match has been voided.');
  if (teamId !== match.values.Team1Id && teamId !== match.values.Team2Id) {
    throw apiError_('VALIDATION_ERROR', 'That team is not part of this match.');
  }
  const opponentTeamId = teamId === match.values.Team1Id ? match.values.Team2Id : match.values.Team1Id;
  const matchFeeRate = Number(getSetting_('MatchFeeRate', '0'));
  if (!matchFeeRate || matchFeeRate <= 0) {
    throw apiError_('VALIDATION_ERROR', 'Match Fee rate is not configured. Ask Admin to set it in Financial Settings.');
  }

  function replayResult() {
    if (!clientRequestId) return null;
    const byRequestId = findRowsByField_('MATCH_FEE_TRANSACTIONS', 'ClientRequestId', clientRequestId)[0];
    return byRequestId ? _matchFeeTransactionResponse_(byRequestId, true) : null;
  }

  const fastReplay = replayResult();
  if (fastReplay) return fastReplay;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let txRow;
  try {
    const authoritativeReplay = replayResult();
    if (authoritativeReplay) return authoritativeReplay;

    const alreadyPaid = findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId)
      .filter(function (t) { return t.TeamId === teamId && t.Status === 'ACTIVE'; })[0] || null;
    if (alreadyPaid) {
      const err = apiError_('ALREADY_PAID', 'Match Fee already paid for this team for Match No. ' + match.values.MatchNumber + '. Receipt No.: ' + alreadyPaid.ReceiptNumber);
      err.receiptNumber = alreadyPaid.ReceiptNumber;
      err.transactionId = alreadyPaid.TransactionId;
      throw err;
    }

    const transactionId = nextId_('MFTX', 5);
    const receiptNumber = nextDocumentNumber_('MatchFee');
    const now = new Date().toISOString();
    txRow = {
      TransactionId: transactionId, MatchId: matchId, TeamId: teamId, OpponentTeamId: opponentTeamId,
      Amount: matchFeeRate, RateSnapshot: matchFeeRate, PaymentMethod: mode, PaidAt: now,
      CollectedBy: actorSession.userId, ReceiptNumber: receiptNumber, ReceiptPdfFileId: '',
      EmailStatus: 'NOT_SENT', Status: 'ACTIVE', VoidReason: '', VoidedBy: '', VoidedAt: '',
      ClientRequestId: clientRequestId || '', CreatedBy: actorSession.userId, CreatedAt: now
    };
    appendRow_('MATCH_FEE_TRANSACTIONS', txRow);
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'COLLECT_MATCH_FEE', Entity: 'MATCH_FEE_TRANSACTION', EntityId: transactionId, PreviousState: '', NewState: 'ACTIVE'
    });
  } finally {
    lock.releaseLock();
  }

  // --- PDF + email, outside the lock (purchasePackage_'s comment applies identically here):
  // the transaction row above is already durable even if either step below fails.
  const payingTeam = findRowById_('TEAMS', 'TeamId', teamId).values;
  const opponentTeam = findRowById_('TEAMS', 'TeamId', opponentTeamId).values;
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const templateFileIter = templatesFolder.getFilesByName('Match Fee Receipt Template');
  if (!templateFileIter.hasNext()) {
    throw apiError_('NOT_FOUND', 'Match Fee Receipt template not set up — run admin.bootstrap.createMatchFeeReceiptTemplate first. Payment was recorded (Receipt No. ' + txRow.ReceiptNumber + ') and is not lost.');
  }
  const templateFile = templateFileIter.next();
  const receiptsFolder = _ensureSubfolder_(_getRootFolder_(), 'Match Fee Receipts');
  const now2 = new Date();
  const amountInWords = _numberToWordsIndian_(matchFeeRate);

  const copyFile = templateFile.makeCopy('Match Fee Receipt - ' + txRow.ReceiptNumber.replace(/\//g, '-'), receiptsFolder);
  const pres = SlidesApp.openById(copyFile.getId());
  _buildMatchFeeReceiptLayout_(pres, {
    tournamentName: getSetting_('TournamentName', ''), organizer: getSetting_('OrganizerName', ''),
    districtAddress: getSetting_('DistrictAddress', ''), receiptNumber: txRow.ReceiptNumber,
    date: Utilities.formatDate(now2, 'Asia/Kolkata', 'yyyy-MM-dd'), amount: matchFeeRate, amountInWords: amountInWords,
    payingTeamName: payingTeam.CollegeName,
    team1Name: teamId === match.values.Team1Id ? payingTeam.CollegeName : opponentTeam.CollegeName,
    team2Name: teamId === match.values.Team2Id ? payingTeam.CollegeName : opponentTeam.CollegeName,
    matchDate: match.values.MatchDate
  });
  pres.saveAndClose();
  const pdfBlob = DriveApp.getFileById(copyFile.getId()).getAs('application/pdf');
  const pdfFile = receiptsFolder.createFile(pdfBlob).setName('Match-Fee-Receipt-' + txRow.ReceiptNumber.replace(/\//g, '-') + '.pdf');
  DriveApp.getFileById(copyFile.getId()).setTrashed(true);
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  updateRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', txRow.TransactionId, { ReceiptPdfFileId: pdfFile.getId() });

  const emailResult = _sendMatchFeeReceiptEmail_(actorSession, txRow.TransactionId, teamId, pdfFile.getId(), recipientEmails, 'sent');
  updateRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', txRow.TransactionId, { EmailStatus: emailResult.status });

  return _matchFeeTransactionResponse_(findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', txRow.TransactionId).values, false);
}

// Re-sends the EXISTING receipt PDF — never regenerates it, never allocates a new receipt
// number, never creates a new transaction. Mirrors resendFinalDocuments_/resendCoupon_.
function resendMatchFeeReceipt_(actorSession, transactionId, recipientEmails) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const tx = findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId);
  if (!tx) throw apiError_('NOT_FOUND', 'No such Match Fee transaction: ' + transactionId);
  if (!tx.values.ReceiptPdfFileId) throw apiError_('NOT_FOUND', 'No receipt PDF has been generated for this transaction yet.');

  const result = _sendMatchFeeReceiptEmail_(actorSession, transactionId, tx.values.TeamId, tx.values.ReceiptPdfFileId, recipientEmails, 'resent');
  updateRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId, { EmailStatus: result.status });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: new Date().toISOString(), UserId: actorSession.userId, Role: actorSession.role,
    Action: 'RESEND_MATCH_FEE_RECEIPT', Entity: 'MATCH_FEE_TRANSACTION', EntityId: transactionId, PreviousState: '', NewState: result.status
  });
  return _matchFeeTransactionResponse_(findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId).values, false);
}

// ADMIN only (spec §18/§19). The row is updated in place, never deleted — its ReceiptNumber
// is retained and never reused; the global Numbering_MatchFee_Next counter is untouched by a
// void, so it only ever advances forward. Once VOID, the (MatchId, TeamId) pair has zero
// ACTIVE transactions again, so collectMatchFee_'s invariant check allows a fresh, fully
// independent re-collection — new TransactionId, new RateSnapshot (the current rate), new
// ReceiptNumber, new PDF, new email (spec §7).
function voidMatchFeeTransaction_(actorSession, transactionId, reason) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (!reason) throw apiError_('VALIDATION_ERROR', 'A reason is required to void a Match Fee transaction.');
  const tx = findRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId);
  if (!tx) throw apiError_('NOT_FOUND', 'No such Match Fee transaction: ' + transactionId);
  if (tx.values.Status === 'VOID') throw apiError_('ALREADY_VOID', 'This transaction has already been voided.');

  const now = new Date().toISOString();
  updateRowById_('MATCH_FEE_TRANSACTIONS', 'TransactionId', transactionId, {
    Status: 'VOID', VoidReason: reason, VoidedBy: actorSession.userId, VoidedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'VOID_MATCH_FEE_TRANSACTION', Entity: 'MATCH_FEE_TRANSACTION', EntityId: transactionId, PreviousState: 'ACTIVE', NewState: 'VOID'
  });
  return { transactionId: transactionId, status: 'VOID', receiptNumber: tx.values.ReceiptNumber };
}
