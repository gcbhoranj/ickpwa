// Receipts.gs — temporary receipt template setup and generation (Google Slides → PDF).
// Slides mechanics verified live before this task was written: SlidesApp.create/
// replaceAllText/getAs('application/pdf') all work reliably; custom page sizing does not —
// neither SlidesApp nor the Advanced Slides API's presentations.create({pageSize}) honors a
// requested size (confirmed via a live spike, not assumed). That is a platform limitation,
// not something this code can route around: the one working mechanism is a ONE-TIME manual
// resize of the TEMPLATE file itself via the Slides UI (File > Page setup > Custom size) —
// done once for this project, A5 portrait (14.8cm x 21.0cm). Every future makeCopy() of the
// template inherits that page size. `createTemporaryReceiptTemplate_`'s rebuild path (force)
// therefore clears and repopulates the EXISTING template file in place rather than deleting
// and recreating it — recreating would throw away the manual resize and put a fresh
// default-landscape presentation back in its place. Content layout below reads the page's
// actual width/height at generation time (getPageWidth/getPageHeight) rather than hardcoding
// pixel positions, so it reflows correctly whatever physical size the template has.

function _getRootFolder_() {
  const rootId = getSetting_('DriveRootFolderId', null);
  if (!rootId) throw apiError_('NOT_FOUND', 'Drive root folder not set up yet — run admin.bootstrap.setupDriveFolders first.');
  return DriveApp.getFolderById(rootId);
}

function _clearSlide_(slide) {
  slide.getShapes().forEach(function (shape) { shape.remove(); });
  slide.getTables().forEach(function (table) { table.remove(); });
}

// Builds the one-page receipt layout onto slide 1 of `pres`, sized to whatever the
// presentation's current page dimensions are (default landscape, or A5 portrait once the
// template file has been manually resized — see file header). Kept as one simple vertical
// stack, one field per line, so it reflows safely on a narrow portrait page without relying
// on wide side-by-side strings that wrap unpredictably.
function _buildReceiptLayout_(pres) {
  const slide = pres.getSlides()[0];
  _clearSlide_(slide);

  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();
  const margin = pageWidth * 0.08;
  const contentWidth = pageWidth - margin * 2;
  let y = pageHeight * 0.03;

  function addLine(text, heightFraction, fontSize, opts) {
    const box = slide.insertTextBox(text, margin, y, contentWidth, pageHeight * heightFraction);
    const style = box.getText().getTextStyle().setFontSize(fontSize);
    if (opts && opts.bold) style.setBold(true);
    if (opts && opts.italic) style.setItalic(true);
    if (!opts || opts.center !== false) {
      box.getText().getParagraphStyle().setParagraphAlignment(
        opts && opts.left ? SlidesApp.ParagraphAlignment.START : SlidesApp.ParagraphAlignment.CENTER
      );
    }
    y += pageHeight * heightFraction;
    return box;
  }

  addLine('{{TOURNAMENT_NAME}}', 0.045, 11, { bold: true });
  addLine('{{ORGANIZER}}', 0.03, 9, {});
  addLine('{{DISTRICT_ADDRESS}}', 0.035, 8, {});
  y += pageHeight * 0.015;
  addLine('TEMPORARY RECEIPT', 0.05, 14, { bold: true });
  y += pageHeight * 0.02;

  addLine('Registration No: {{REGISTRATION_NUMBER}}', 0.03, 9, { left: true });
  addLine('Date: {{DATE}}', 0.03, 9, { left: true });
  y += pageHeight * 0.015;

  addLine('Received from: {{INCHARGE_NAMES}}', 0.05, 9, { left: true });
  addLine('College: {{COLLEGE_NAME}}', 0.035, 9, { left: true });
  addLine('District: {{DISTRICT_NAME}}', 0.035, 9, { left: true });
  addLine('Team Members: {{TEAM_MEMBERS}}   Incharges: {{INCHARGES_COUNT}}   Total Contingent: {{TOTAL_CONTINGENT}}', 0.045, 8.5, { left: true });
  y += pageHeight * 0.02;

  const tableHeight = pageHeight * 0.16;
  const table = slide.insertTable(4, 2, margin, y, contentWidth, tableHeight);
  table.getCell(0, 0).getText().setText('Description');
  table.getCell(0, 1).getText().setText('Amount (Rs)');
  table.getCell(1, 0).getText().setText('Dari Charges ({{TEAM_MEMBERS}} x Rs {{DARI_RATE}})');
  table.getCell(1, 1).getText().setText('{{DARI_CHARGES}}');
  table.getCell(2, 0).getText().setText('Grand Total (charges)');
  table.getCell(2, 1).getText().setText('{{DARI_CHARGES}}');
  table.getCell(3, 0).getText().setText('Security (refundable, not a charge)');
  table.getCell(3, 1).getText().setText('{{SECURITY_AMOUNT}}');
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 2; c++) {
      table.getCell(r, c).getText().getTextStyle().setFontSize(8);
    }
  }
  y += tableHeight + pageHeight * 0.025;

  addLine('Total Amount Received (Mode: {{PAYMENT_MODE}}): Rs {{TOTAL_RECEIVED}}', 0.06, 10, { bold: true, left: true });
  y += pageHeight * 0.02;

  addLine(
    'This is a temporary receipt acknowledging the initial transaction. A final settlement ' +
    'receipt will be issued at departure.',
    0.09, 7.5, { italic: true, left: true }
  );
  y += pageHeight * 0.04;
  addLine('________________________', 0.03, 9, { left: true });
  addLine('Signature, Registration Committee Convener', 0.035, 8, { left: true });

  return slide;
}

// `force`: when true, clears and rebuilds the layout on the EXISTING template file in place
// (preserves any manual page-size resize done via the Slides UI — see file header). Default
// (false/omitted) stays idempotent: returns the existing template untouched. When no template
// exists yet, always creates one (default landscape size, until manually resized once).
function createTemporaryReceiptTemplate_(actorSession, force) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const existing = templatesFolder.getFilesByName('Temporary Receipt Template');

  if (existing.hasNext()) {
    const existingFile = existing.next();
    if (!force) {
      return { templateId: existingFile.getId(), created: false };
    }
    const pres = SlidesApp.openById(existingFile.getId());
    _buildReceiptLayout_(pres);
    pres.saveAndClose();
    return { templateId: existingFile.getId(), created: false };
  }

  const pres = SlidesApp.create('Temporary Receipt Template');
  const fileId = pres.getId();
  DriveApp.getFileById(fileId).moveTo(templatesFolder);
  _buildReceiptLayout_(pres);
  pres.saveAndClose();
  return { templateId: fileId, created: true };
}

function generateTemporaryReceipt_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);

  const charges = findRowsByField_('CHARGES', 'TeamId', teamId);
  if (charges.length === 0) throw apiError_('NOT_FOUND', 'No charges calculated yet for this team.');
  const charge = charges[0];

  const payments = findRowsByField_('PAYMENTS', 'TeamId', teamId).filter(function (p) { return p.Purpose === 'REGISTRATION_CHARGES'; });
  if (payments.length === 0) throw apiError_('NOT_FOUND', 'Payment not recorded yet for this team.');

  const existingReceipts = findRowsByField_('RECEIPTS', 'TeamId', teamId).filter(function (r) { return r.Type === 'TEMPORARY'; });
  if (existingReceipts.length > 0) {
    throw apiError_('ALREADY_GENERATED', 'A temporary receipt already exists for this team.');
  }

  const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId);
  const inchargeNames = incharges.map(function (i) { return i.Name; }).join(', ');

  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const templateFileIter = templatesFolder.getFilesByName('Temporary Receipt Template');
  if (!templateFileIter.hasNext()) {
    throw apiError_('NOT_FOUND', 'Temporary receipt template not set up — run admin.bootstrap.createReceiptTemplate first.');
  }
  const templateFile = templateFileIter.next();

  const receiptsFolder = _ensureSubfolder_(_ensureSubfolder_(_getRootFolder_(), 'Registration'), 'Temporary Receipts');
  const now = new Date();
  const receiptNumber = nextDocumentNumber_('Receipt');

  const copyFile = templateFile.makeCopy('Temp Receipt - ' + team.values.RegistrationNumber, receiptsFolder);
  const copyId = copyFile.getId();
  const pres = SlidesApp.openById(copyId);
  const totalReceived = Number(charge.DariCharges) + Number(charge.SecurityCharges);
  const replacements = {
    '{{TOURNAMENT_NAME}}': getSetting_('TournamentName', ''),
    '{{ORGANIZER}}': getSetting_('OrganizerName', ''),
    '{{DISTRICT_ADDRESS}}': getSetting_('DistrictAddress', ''),
    '{{REGISTRATION_NUMBER}}': team.values.RegistrationNumber,
    '{{DATE}}': now.toISOString().slice(0, 10),
    '{{INCHARGE_NAMES}}': inchargeNames,
    '{{COLLEGE_NAME}}': team.values.CollegeName,
    '{{DISTRICT_NAME}}': team.values.DistrictName,
    '{{TEAM_MEMBERS}}': String(team.values.NumberOfTeamMembers),
    '{{INCHARGES_COUNT}}': String(team.values.NumberOfContingentIncharges),
    '{{TOTAL_CONTINGENT}}': String(team.values.TotalContingentPersons),
    '{{DARI_RATE}}': String(charge.RateDariSnapshot),
    '{{DARI_CHARGES}}': String(charge.DariCharges),
    '{{SECURITY_AMOUNT}}': String(charge.SecurityCharges),
    '{{PAYMENT_MODE}}': payments[0].Mode,
    '{{TOTAL_RECEIVED}}': String(totalReceived)
  };
  Object.keys(replacements).forEach(function (token) {
    pres.replaceAllText(token, replacements[token]);
  });
  pres.saveAndClose();

  const pdfBlob = DriveApp.getFileById(copyId).getAs('application/pdf');
  const pdfFile = receiptsFolder.createFile(pdfBlob).setName('Receipt-' + receiptNumber.replace(/\//g, '-') + '.pdf');
  DriveApp.getFileById(copyId).setTrashed(true); // keep only the final PDF, not the intermediate Slides copy

  const receiptId = nextId_('RCT', 4);
  appendRow_('RECEIPTS', {
    ReceiptId: receiptId, ReceiptNumber: receiptNumber, Type: 'TEMPORARY', TeamId: teamId,
    SettlementId: '', GrossMealCharges: 0, GrossDariCharges: charge.DariCharges,
    GrandTotal: charge.DariCharges, FoodRefundTotal: '', NetAmount: '', AmountInWords: '',
    GeneratedAt: now.toISOString(), GeneratedBy: actorSession.userId, PdfFileId: pdfFile.getId()
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now.toISOString(), UserId: actorSession.userId, Role: actorSession.role,
    Action: 'GENERATE_TEMP_RECEIPT', Entity: 'RECEIPT', EntityId: receiptId, PreviousState: '', NewState: ''
  });

  return {
    receiptId: receiptId, receiptNumber: receiptNumber, pdfFileId: pdfFile.getId(),
    pdfUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view'
  };
}
