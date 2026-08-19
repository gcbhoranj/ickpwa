// Receipts.gs — temporary receipt generation (Google Slides → PDF).
// Slides mechanics verified live before this task was written: SlidesApp.create/
// getAs('application/pdf') work reliably; custom page sizing does not — neither SlidesApp
// nor the Advanced Slides API's presentations.create({pageSize}) honors a requested size
// (confirmed via a live spike, not assumed). That is a platform limitation, not something
// this code can route around: the one working mechanism is a ONE-TIME manual resize of the
// TEMPLATE file itself via the Slides UI (File > Page setup > Custom size) — done once for
// this project, A5 portrait (14.8cm x 21.0cm). Every future makeCopy() of the template
// inherits that page size.
//
// The layout is built fresh, with real values, directly onto each receipt's own copy at
// generation time (`_buildReceiptLayout_`) rather than pre-built once into the template and
// text-replaced per receipt — replaceAllText tokens can't conditionally omit a line, and the
// Registration operator needs to be able to leave Dari Charges and/or Security unticked (not
// applicable for this team) so that line is simply absent from the receipt, not printed as
// "0". `createTemporaryReceiptTemplate_` therefore only exists to hold the one-time page-size
// resize; it keeps the template file's slide blank rather than pre-populating it.

function _getRootFolder_() {
  const rootId = getSetting_('DriveRootFolderId', null);
  if (!rootId) throw apiError_('NOT_FOUND', 'Drive root folder not set up yet — run admin.bootstrap.setupDriveFolders first.');
  return DriveApp.getFolderById(rootId);
}

function _clearSlide_(slide) {
  slide.getShapes().forEach(function (shape) { shape.remove(); });
  slide.getTables().forEach(function (table) { table.remove(); });
}

// Builds the one-page receipt onto slide 1 of `pres` with real values from `data`, sized to
// whatever the presentation's current page dimensions are (default landscape, or A5 portrait
// once the template file has been manually resized — see file header). One field per line,
// so it reflows safely on a narrow portrait page without relying on wide side-by-side
// strings that wrap unpredictably.
//
// `data.lineItems`: ordered array of { label, amount } — only items the operator ticked at
// charge-calculation time end up here (Registration.gs's calculateCharges_ already zeroes
// out anything left unticked), so an unticked item is simply never in this array and never
// appears on the receipt, rather than printing as "Rs 0".
function _buildReceiptLayout_(pres, data) {
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
    if (opts && opts.italic) style.setItalic(true);
    if (!opts || opts.center !== false) {
      box.getText().getParagraphStyle().setParagraphAlignment(
        opts && opts.left ? SlidesApp.ParagraphAlignment.START : SlidesApp.ParagraphAlignment.CENTER
      );
    }
    y += pageHeight * heightFraction;
    return box;
  }

  addLine(data.tournamentName, 0.045, 11, { bold: true });
  addLine(data.organizer, 0.03, 9, {});
  addLine(data.districtAddress, 0.035, 8, {});
  y += pageHeight * 0.015;
  addLine('TEMPORARY RECEIPT', 0.05, 14, { bold: true });
  y += pageHeight * 0.02;

  addLine('Registration No: ' + data.registrationNumber, 0.03, 9, { left: true });
  addLine('Date: ' + data.date, 0.03, 9, { left: true });
  y += pageHeight * 0.015;

  addLine('Received from: ' + data.inchargeNames, 0.05, 9, { left: true });
  addLine('College: ' + data.collegeName, 0.035, 9, { left: true });
  addLine('District: ' + data.districtName, 0.035, 9, { left: true });
  addLine('Team Members: ' + data.teamMembers + '   Incharges: ' + data.inchargesCount + '   Total Contingent: ' + data.totalContingent, 0.045, 8.5, { left: true });
  y += pageHeight * 0.02;

  // The charges block was originally a SlidesApp.Table, which turned out to be a dead end:
  // its row height auto-grows to a Slides-enforced minimum well beyond the small height we
  // requested, but that growth is never reflected back into the script's object model —
  // Table.getHeight() kept reporting the small requested height, not the real rendered one,
  // so the next element's y-advance undershot and overlapped the table (confirmed against a
  // real generated PDF). Table.setColumnWidth()/TableColumn.setWidth() also don't exist on
  // this API (both threw "is not a function" live). This block is plain text-box rows using
  // the same `addLine` mechanics already proven correct for every other line in this layout —
  // no Table involved, so no auto-grow-vs-measurement mismatch is possible, and rows can be
  // omitted per receipt (see `data.lineItems` above), which a static Table template couldn't do.
  const amountColWidth = contentWidth * 0.28;
  const labelColWidth = contentWidth - amountColWidth;

  function addChargeRow(label, amount, opts) {
    const rowHeightFraction = 0.038;
    const labelBox = slide.insertTextBox(label, margin, y, labelColWidth, pageHeight * rowHeightFraction);
    const labelStyle = labelBox.getText().getTextStyle().setFontSize(8.5);
    if (opts && opts.bold) labelStyle.setBold(true);
    labelBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.START);

    const amountBox = slide.insertTextBox(amount, margin + labelColWidth, y, amountColWidth, pageHeight * rowHeightFraction);
    const amountStyle = amountBox.getText().getTextStyle().setFontSize(8.5);
    if (opts && opts.bold) amountStyle.setBold(true);
    amountBox.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.END);

    y += pageHeight * rowHeightFraction;
  }

  const boxTop = y;
  addChargeRow('Description', 'Amount (Rs)', { bold: true });
  data.lineItems.forEach(function (item) { addChargeRow(item.label, String(item.amount)); });
  addChargeRow('Grand Total (charges)', String(data.grandTotalCharges));
  const boxBottom = y;

  // Purely decorative border around the rows above, drawn last (after the row text boxes —
  // safe to overlap since it's transparent-filled) so the receipt keeps its boxed/table look
  // without an actual Table. A couple points of padding above/below so the border doesn't sit
  // right on the first/last row's text baseline (looked like a strike-through otherwise).
  const borderPad = pageHeight * 0.004;
  const borderRect = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, margin, boxTop - borderPad, contentWidth, (boxBottom - boxTop) + borderPad * 2);
  borderRect.getFill().setTransparent();
  borderRect.getBorder().getLineFill().setSolidFill('#999999');
  borderRect.getBorder().setWeight(0.75);

  y += pageHeight * 0.025;

  addLine('Total Amount Received (Mode: ' + data.paymentMode + '): Rs ' + data.totalReceived, 0.06, 10, { bold: true, left: true });
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

// `force`: when true, clears the EXISTING template file's slide back to blank in place
// (preserves any manual page-size resize done via the Slides UI — see file header, and does
// NOT delete/recreate the file, which would lose that resize). Default (false/omitted) stays
// idempotent: returns the existing template untouched. When no template exists yet, always
// creates one (default landscape size, until manually resized once).
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
    _buildReceiptLayout_(pres, null);
    pres.saveAndClose();
    return { templateId: existingFile.getId(), created: false };
  }

  const pres = SlidesApp.create('Temporary Receipt Template');
  const fileId = pres.getId();
  DriveApp.getFileById(fileId).moveTo(templatesFolder);
  _buildReceiptLayout_(pres, null);
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

  // Only items the Registration operator ticked (calculateCharges_ zeroes anything left
  // unticked) get a line on the receipt — an unticked item is absent, not "Rs 0".
  const lineItems = [];
  const dariCharges = Number(charge.DariCharges);
  const securityCharges = Number(charge.SecurityCharges);
  if (dariCharges > 0) {
    lineItems.push({ label: 'Dari Charges (' + team.values.NumberOfTeamMembers + ' x Rs ' + charge.RateDariSnapshot + ')', amount: dariCharges });
  }
  if (securityCharges > 0) {
    lineItems.push({ label: 'Security (refundable)', amount: securityCharges });
  }
  const totalReceived = dariCharges + securityCharges;

  const copyFile = templateFile.makeCopy('Temp Receipt - ' + team.values.RegistrationNumber, receiptsFolder);
  const copyId = copyFile.getId();
  const pres = SlidesApp.openById(copyId);
  _buildReceiptLayout_(pres, {
    tournamentName: getSetting_('TournamentName', ''),
    organizer: getSetting_('OrganizerName', ''),
    districtAddress: getSetting_('DistrictAddress', ''),
    registrationNumber: team.values.RegistrationNumber,
    date: now.toISOString().slice(0, 10),
    inchargeNames: inchargeNames,
    collegeName: team.values.CollegeName,
    districtName: team.values.DistrictName,
    teamMembers: team.values.NumberOfTeamMembers,
    inchargesCount: team.values.NumberOfContingentIncharges,
    totalContingent: team.values.TotalContingentPersons,
    lineItems: lineItems,
    grandTotalCharges: dariCharges, // charges only, never security — matches RECEIPTS.GrandTotal below
    paymentMode: payments[0].Mode,
    totalReceived: totalReceived
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
