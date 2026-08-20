// Noc.gs — Phase 6: Accommodation NOC (No Objection Certificate) status + generation.
// ACCOMMODATION_NOC (spec §5) was reserved since Phase 1 but never populated until now — its
// Status (PENDING/NOC_GRANTED) is what Phase 7's security refund will gate on; granting it
// also produces a one-page PDF certificate via the same Slides-copy-and-render pattern
// Receipts.gs uses for the temporary receipt (_ensureSubfolder_/_getRootFolder_/_clearSlide_
// are that file's, already global in Apps Script's single-namespace model).
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §21.

function _buildNocLayout_(pres, data) {
  const slide = pres.getSlides()[0];
  _clearSlide_(slide);
  if (!data) return slide; // template-setup call: leave the page blank, just holding its size

  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();
  const margin = pageWidth * 0.08;
  const contentWidth = pageWidth - margin * 2;
  let y = pageHeight * 0.05;

  function addLine(text, heightFraction, fontSize, opts) {
    const box = slide.insertTextBox(text, margin, y, contentWidth, pageHeight * heightFraction);
    const style = box.getText().getTextStyle().setFontSize(fontSize);
    if (opts && opts.bold) style.setBold(true);
    box.getText().getParagraphStyle().setParagraphAlignment(
      opts && opts.left ? SlidesApp.ParagraphAlignment.START : SlidesApp.ParagraphAlignment.CENTER
    );
    y += pageHeight * heightFraction;
    return box;
  }

  addLine(data.tournamentName, 0.05, 12, { bold: true });
  addLine(data.organizer, 0.03, 9, {});
  y += pageHeight * 0.03;
  addLine('NO OBJECTION CERTIFICATE', 0.06, 14, { bold: true });
  y += pageHeight * 0.03;
  addLine('NOC No: ' + data.nocNumber, 0.03, 9, { left: true });
  addLine('Date: ' + data.date, 0.03, 9, { left: true });
  y += pageHeight * 0.02;
  // Deliberately does not assert the rooms have been physically vacated — Phase 6 issues NOC
  // independent of the departure workflow (not yet built), so the wording only certifies the
  // Accommodation Committee's own clearance, not a fact this code cannot yet verify.
  addLine(
    'This is to certify that the Accommodation Committee has no objection to the departure of ' +
    'the team of ' + data.collegeName + ' (Registration No: ' + data.registrationNumber + ') ' +
    'from the tournament accommodation.',
    0.14, 10, { left: true }
  );
  y += pageHeight * 0.05;
  addLine('________________________', 0.03, 9, { left: true });
  addLine('Signature, Accommodation Committee', 0.035, 8, { left: true });

  return slide;
}

// `force`: mirrors createTemporaryReceiptTemplate_ exactly — clears the EXISTING template's
// slide back to blank in place (preserving any manual page-size resize) rather than
// delete/recreate. Default stays idempotent: returns the existing template untouched.
function createNocTemplate_(actorSession, force) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const existing = templatesFolder.getFilesByName('NOC Certificate Template');

  if (existing.hasNext()) {
    const existingFile = existing.next();
    if (!force) return { templateId: existingFile.getId(), created: false };
    const pres = SlidesApp.openById(existingFile.getId());
    _buildNocLayout_(pres, null);
    pres.saveAndClose();
    return { templateId: existingFile.getId(), created: false };
  }

  const pres = SlidesApp.create('NOC Certificate Template');
  const fileId = pres.getId();
  DriveApp.getFileById(fileId).moveTo(templatesFolder);
  _buildNocLayout_(pres, null);
  pres.saveAndClose();
  return { templateId: fileId, created: true };
}

function getNocStatus_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.ACCOMMODATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const row = findRowsByField_('ACCOMMODATION_NOC', 'TeamId', teamId)[0];
  if (!row) return { teamId: teamId, status: 'PENDING', pdfFileId: null, pdfUrl: null, issuedBy: null, issuedAt: null, notes: '' };
  return {
    teamId: teamId, status: row.Status, pdfFileId: row.PdfFileId || null,
    pdfUrl: row.PdfFileId ? 'https://drive.google.com/file/d/' + row.PdfFileId + '/view' : null,
    issuedBy: row.IssuedBy || null, issuedAt: row.IssuedAt || null, notes: row.Notes || ''
  };
}

// Accommodation's other outcome to issueNoc_'s grant: records why the team isn't cleared yet.
// Upserts the same one-row-per-team ACCOMMODATION_NOC record issueNoc_ does (so a later grant
// finds and updates this row rather than creating a duplicate). Blocked once already
// NOC_GRANTED — reversing a grant is a materially different, riskier operation (it would also
// need to un-vacate the rooms Noc.gs's grant path already auto-vacates) that nobody has asked
// for; a mistaken grant needs a human decision, not a same-shape decline call.
function declineNoc_(actorSession, teamId, remarks) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  if (!remarks || !remarks.trim()) throw apiError_('VALIDATION_ERROR', 'Remarks are required when declining an NOC.');
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);

  const existing = findRowsByField_('ACCOMMODATION_NOC', 'TeamId', teamId)[0];
  if (existing && existing.Status === 'NOC_GRANTED') {
    throw apiError_('NOC_ALREADY_GRANTED', 'This team\'s NOC has already been granted — declining an already-granted NOC is not supported.');
  }

  const now = new Date().toISOString();
  const trimmedRemarks = remarks.trim();
  let nocId;
  if (existing) {
    nocId = existing.NocId;
    updateRowById_('ACCOMMODATION_NOC', 'NocId', nocId, {
      Status: 'DECLINED', IssuedBy: actorSession.userId, IssuedAt: now, Notes: trimmedRemarks
    });
  } else {
    nocId = nextId_('NOC', 4);
    appendRow_('ACCOMMODATION_NOC', {
      NocId: nocId, TeamId: teamId, Status: 'DECLINED', IssuedBy: actorSession.userId,
      IssuedAt: now, Notes: trimmedRemarks, PdfFileId: ''
    });
  }

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'DECLINE_NOC', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: 'DECLINED'
  });

  return { nocId: nocId, teamId: teamId, status: 'DECLINED', notes: trimmedRemarks };
}

// Idempotent by design (see Accommodation.gs's vacateRoom_ comment for the same rationale):
// finds-or-creates the one ACCOMMODATION_NOC row for this team. Granting an already-
// NOC_GRANTED team returns the existing certificate — no financial harm in a repeat grant,
// unlike purchasePackage_, so no ClientRequestId guard is needed.
function issueNoc_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);

  const existing = findRowsByField_('ACCOMMODATION_NOC', 'TeamId', teamId)[0];
  if (existing && existing.Status === 'NOC_GRANTED') {
    return {
      nocId: existing.NocId, teamId: teamId, status: 'NOC_GRANTED', pdfFileId: existing.PdfFileId,
      pdfUrl: 'https://drive.google.com/file/d/' + existing.PdfFileId + '/view', notes: existing.Notes || ''
    };
  }

  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const templateFileIter = templatesFolder.getFilesByName('NOC Certificate Template');
  if (!templateFileIter.hasNext()) {
    throw apiError_('NOT_FOUND', 'NOC certificate template not set up — run admin.bootstrap.createNocTemplate first.');
  }
  const templateFile = templateFileIter.next();

  const nocFolder = _ensureSubfolder_(_ensureSubfolder_(_getRootFolder_(), 'Accommodation'), 'NOC Certificates');
  const now = new Date();
  const nocNumber = nextDocumentNumber_('Accommodation');

  const copyFile = templateFile.makeCopy('NOC - ' + team.values.RegistrationNumber, nocFolder);
  const copyId = copyFile.getId();
  const pres = SlidesApp.openById(copyId);
  _buildNocLayout_(pres, {
    tournamentName: getSetting_('TournamentName', ''),
    organizer: getSetting_('OrganizerName', ''),
    nocNumber: nocNumber,
    date: Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd'),
    collegeName: team.values.CollegeName,
    registrationNumber: team.values.RegistrationNumber
  });
  pres.saveAndClose();

  const pdfBlob = DriveApp.getFileById(copyId).getAs('application/pdf');
  const pdfFile = nocFolder.createFile(pdfBlob).setName('NOC-' + nocNumber.replace(/\//g, '-') + '.pdf');
  DriveApp.getFileById(copyId).setTrashed(true);

  const nowIso = now.toISOString();
  let nocId;
  if (existing) {
    nocId = existing.NocId;
    // Notes explicitly cleared here — a prior decline's remarks (spec: declineNoc_) shouldn't
    // linger and read as still-current once the team has actually been granted.
    updateRowById_('ACCOMMODATION_NOC', 'NocId', nocId, {
      Status: 'NOC_GRANTED', IssuedBy: actorSession.userId, IssuedAt: nowIso, PdfFileId: pdfFile.getId(), Notes: ''
    });
  } else {
    nocId = nextId_('NOC', 4);
    appendRow_('ACCOMMODATION_NOC', {
      NocId: nocId, TeamId: teamId, Status: 'NOC_GRANTED', IssuedBy: actorSession.userId,
      IssuedAt: nowIso, Notes: '', PdfFileId: pdfFile.getId()
    });
  }

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: nowIso, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'ISSUE_NOC', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: 'NOC_GRANTED'
  });

  // Granting NOC means the Accommodation Committee has no objection to the team leaving —
  // physically, that also means whatever rooms they held are free again. Auto-vacate every
  // still-ALLOCATED row for this team (both TEAM and INCHARGE kind) rather than leaving the
  // operator to remember a second manual step. vacateRoom_ is already idempotent per-row, so
  // this is safe to run even on a re-grant that finds nothing left to vacate.
  findRowsByField_('ACCOMMODATION', 'TeamId', teamId)
    .filter(function (a) { return a.Status === 'ALLOCATED'; })
    .forEach(function (a) { vacateRoom_(actorSession, a.AllocationId); });

  return { nocId: nocId, teamId: teamId, status: 'NOC_GRANTED', pdfFileId: pdfFile.getId(), pdfUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view', notes: '' };
}
