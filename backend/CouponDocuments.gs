// CouponDocuments.gs — digital coupon PDF (one QR-bearing document) and printed-coupon A4
// sheet PDF (a grid of 3"×2" physical coupons, all sharing the package's one QR/token) for
// FoodPackages.gs. Same pattern as Receipts.gs: a persistent template file holds the
// one-time-manually-resized physical page size (Slides/Advanced Slides API don't honor a
// requested page size — confirmed live during Phase 3, and re-confirmed 2026-08-19 while
// chasing a landscape/portrait bug report: basic SlidesApp.create() always produces the
// 720x405pt default and has no setPageSize method; the Advanced Slides Service's
// Presentations.create() *documents* a pageSize request field but empirically ignores it —
// two independent live calls both returned the untouched 720x405pt default despite an
// explicit A4-portrait request; the Slides REST API also has no batchUpdate request that
// resizes an existing presentation. There is genuinely no programmatic path here, only the
// UI one), content is built fresh per generation with real values via `_clearSlide_`/text
// boxes, never `replaceAllText` tokens — a static template can't render a variable-length
// coupon grid, and per this session's Phase 3.5 receipt-overlap bug, SlidesApp.Table's row/
// column sizing APIs are unreliable — this uses plain text boxes throughout, no Table.
//
// **Physical sizing not yet done**: like the temporary receipt before its one manual A5
// resize, these templates ship at Slides' default size until an Admin resizes them once via
// the Slides UI (File > Page setup > Custom size) — Digital Coupon Template to a reasonable
// portrait size, Printed Coupon Sheet Template to A4 (8.27"×11.69"). Document *content* is
// correct and complete regardless; physical print sizing is a one-time manual step, per the
// same accepted trade-off Phase 3 made for the temporary receipt.

const COUPON_QR_MODULE_PT_DIGITAL = 4.2;
const COUPON_QR_MODULE_PT_PRINTED = 2;
const PRINTED_COUPONS_PER_ROW = 2;
const PRINTED_COUPONS_PER_COL = 5;
const PRINTED_COUPONS_PER_PAGE = PRINTED_COUPONS_PER_ROW * PRINTED_COUPONS_PER_COL;

function _ensureBlankTemplate_(name) {
  const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
  const existing = templatesFolder.getFilesByName(name);
  if (existing.hasNext()) return existing.next();
  const pres = SlidesApp.create(name);
  DriveApp.getFileById(pres.getId()).moveTo(templatesFolder);
  return DriveApp.getFileById(pres.getId());
}

// Colors match the reference design supplied for this document
// (HPUICK_Meal_Coupon_Design.pdf): deep green brand bars, a gold accent/badge color, a light
// neutral panel behind the QR, muted gray field labels, dark green bold field values.
const COUPON_COLOR_GREEN = '#1B4332';
const COUPON_COLOR_GOLD = '#C9A227';
const COUPON_COLOR_PANEL = '#F1F3F1';
const COUPON_COLOR_LABEL = '#6B7280';

function _couponRect_(slide, left, top, width, height, fillHex, opts) {
  const shape = slide.insertShape(
    (opts && opts.rounded) ? SlidesApp.ShapeType.ROUND_RECTANGLE : SlidesApp.ShapeType.RECTANGLE,
    left, top, width, height
  );
  if (fillHex) shape.getFill().setSolidFill(fillHex); else shape.getFill().setTransparent();
  shape.getBorder().setTransparent();
  return shape;
}

function _couponText_(slide, text, left, top, width, height, fontSize, colorHex, opts) {
  const box = slide.insertTextBox(text, left, top, width, height);
  const style = box.getText().getTextStyle().setFontSize(fontSize).setForegroundColor(colorHex);
  if (opts && opts.bold) style.setBold(true);
  box.getText().getParagraphStyle().setParagraphAlignment(
    opts && opts.center ? SlidesApp.ParagraphAlignment.CENTER : SlidesApp.ParagraphAlignment.START
  );
  return box;
}

// Matches the reference design (HPUICK_Meal_Coupon_Design.pdf): a dark-green header bar with
// a gold "PACKAGE N" badge, a light QR panel on the left, labeled team/incharge fields on the
// right, and a dark-green footer bar with the meal window. Built with plain shapes/text boxes
// (no Table — see file header) so it's not dependent on the page's exact aspect ratio: every
// position is a fraction of the current pageWidth/pageHeight, matching this project's other
// document layouts.
function _buildDigitalCouponLayout_(pres, data) {
  const slide = pres.getSlides()[0];
  _clearSlide_(slide);

  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();
  const margin = pageWidth * 0.03;

  // Header bar + title + package badge.
  const headerHeight = pageHeight * 0.22;
  _couponRect_(slide, 0, 0, pageWidth, headerHeight, COUPON_COLOR_GREEN);
  _couponText_(slide, data.tournamentName.toUpperCase(), margin, headerHeight * 0.14, pageWidth * 0.6, headerHeight * 0.3, 12, '#FFFFFF', { bold: true });
  _couponText_(slide, 'MEAL COUPON', margin, headerHeight * 0.48, pageWidth * 0.55, headerHeight * 0.45, 20, '#FFFFFF', { bold: true });
  const badgeW = pageWidth * 0.18, badgeH = headerHeight * 0.4;
  _couponRect_(slide, pageWidth - margin - badgeW, headerHeight * 0.3, badgeW, badgeH, COUPON_COLOR_GOLD, { rounded: true });
  _couponText_(slide, 'PACKAGE ' + data.packageNumber, pageWidth - margin - badgeW, headerHeight * 0.3, badgeW, badgeH, 10, '#FFFFFF', { bold: true, center: true });

  // Gold divider.
  _couponRect_(slide, 0, headerHeight, pageWidth, pageHeight * 0.012, COUPON_COLOR_GOLD);

  const bodyTop = headerHeight + pageHeight * 0.03;
  const footerHeight = pageHeight * 0.16;
  const bodyHeight = pageHeight - footerHeight - bodyTop - pageHeight * 0.02;

  // Left panel: QR + coupon id.
  const panelWidth = pageWidth * 0.32;
  _couponRect_(slide, margin, bodyTop, panelWidth, bodyHeight, COUPON_COLOR_PANEL, { rounded: true });
  _couponText_(slide, 'SCAN TO VERIFY', margin, bodyTop + bodyHeight * 0.05, panelWidth, bodyHeight * 0.08, 9, COUPON_COLOR_GREEN, { bold: true, center: true });

  const qr = qrEncode_(data.qrToken);
  const quietZoneModules = 3;
  const qrTotalPt = (qr.size + quietZoneModules * 2) * COUPON_QR_MODULE_PT_DIGITAL;
  const qrLeft = margin + (panelWidth - qrTotalPt) / 2;
  const qrTop = bodyTop + bodyHeight * 0.16;
  qrDrawOnSlide_(slide, qr, qrLeft, qrTop, COUPON_QR_MODULE_PT_DIGITAL);

  const afterQrY = qrTop + qrTotalPt + bodyHeight * 0.04;
  _couponText_(slide, 'Unique digital meal record', margin, afterQrY, panelWidth, bodyHeight * 0.08, 7.5, COUPON_COLOR_LABEL, { center: true });
  _couponText_(slide, 'Coupon ID: ' + data.couponId, margin, afterQrY + bodyHeight * 0.09, panelWidth, bodyHeight * 0.08, 9, COUPON_COLOR_GREEN, { bold: true, center: true });

  // Right column: labeled fields, matching the reference's stacked-field layout.
  const rightLeft = margin + panelWidth + pageWidth * 0.04;
  const rightWidth = pageWidth - rightLeft - margin;
  let fy = bodyTop;

  function field(label, value, width) {
    // insertTextBox('', ...) creates a text box with no text run at all — styling it (font
    // size, color) then throws "The object (...) has no text", live-confirmed via
    // system.selfTestSplit against a team whose incharge had no designation on file. Every
    // value here can legitimately be blank (an optional incharge field, an unnamed primary
    // incharge on an edge-case team), so this always falls back to a placeholder.
    const safeValue = (value === null || value === undefined || value === '') ? '—' : String(value);
    _couponText_(slide, label.toUpperCase(), rightLeft + (field._xOffset || 0), fy, width, bodyHeight * 0.06, 8, COUPON_COLOR_LABEL, { bold: true });
    _couponText_(slide, safeValue, rightLeft + (field._xOffset || 0), fy + bodyHeight * 0.065, width, bodyHeight * 0.09, 12, COUPON_COLOR_GREEN, { bold: true });
  }

  field('Name of the Team', data.collegeName, rightWidth);
  fy += bodyHeight * 0.19;
  field('Name of Contingent Incharge', data.inchargeName, rightWidth);
  fy += bodyHeight * 0.19;

  const halfWidth = rightWidth * 0.46;
  field._xOffset = 0;
  field('Designation', data.inchargeDesignation, halfWidth);
  field._xOffset = rightWidth * 0.54;
  field('No. of Team Members', data.teamMembers, halfWidth);
  field._xOffset = 0;
  fy += bodyHeight * 0.19;
  field('WhatsApp Number', data.inchargeWhatsapp || '—', halfWidth);
  field._xOffset = rightWidth * 0.54;
  field('Email', data.inchargeEmail || '—', halfWidth);
  field._xOffset = 0;

  // Footer bar: package badge + meal-window validity, matching the reference's bottom band.
  const footerTop = pageHeight - footerHeight;
  _couponRect_(slide, 0, footerTop, pageWidth, footerHeight, COUPON_COLOR_GREEN);
  const footerBadgeW = pageWidth * 0.22;
  _couponRect_(slide, margin, footerTop + footerHeight * 0.15, footerBadgeW, footerHeight * 0.7, COUPON_COLOR_GOLD, { rounded: true });
  _couponText_(slide, 'PACKAGE NO.', margin, footerTop + footerHeight * 0.2, footerBadgeW, footerHeight * 0.25, 7.5, '#FFFFFF', { bold: true, center: true });
  _couponText_(slide, 'PACKAGE ' + data.packageNumber, margin, footerTop + footerHeight * 0.42, footerBadgeW, footerHeight * 0.35, 11, '#FFFFFF', { bold: true, center: true });

  const footerTextLeft = margin + footerBadgeW + pageWidth * 0.03;
  _couponText_(slide, 'SCAN QR AT MEAL COUNTER', footerTextLeft, footerTop + footerHeight * 0.18, pageWidth - footerTextLeft - margin, footerHeight * 0.3, 10, '#FFFFFF', { bold: true });
  _couponText_(
    slide, 'VALID FOR MEAL SERVICE — ' + data.mealWindowLabel,
    footerTextLeft, footerTop + footerHeight * 0.5, pageWidth - footerTextLeft - margin, footerHeight * 0.4, 8.5, '#FFFFFF', {}
  );

  return slide;
}

function _generateDigitalCouponPdf_(actorSession, packageId, data) {
  const templateFile = _ensureBlankTemplate_('Digital Coupon Template');
  const digitalFolder = _ensureSubfolder_(_ensureSubfolder_(_getRootFolder_(), 'Food Coupons'), 'Digital');
  const copyFile = templateFile.makeCopy('Digital Coupon - ' + data.registrationNumber + ' - Package ' + data.packageNumber, digitalFolder);
  const copyId = copyFile.getId();
  const pres = SlidesApp.openById(copyId);
  _buildDigitalCouponLayout_(pres, data);
  pres.saveAndClose();

  const pdfBlob = DriveApp.getFileById(copyId).getAs('application/pdf');
  const pdfFile = digitalFolder.createFile(pdfBlob).setName('Digital Coupon - ' + data.registrationNumber + ' - Package ' + data.packageNumber + '.pdf');
  DriveApp.getFileById(copyId).setTrashed(true);

  appendRow_('DOCUMENTS', {
    DocumentId: nextId_('DOC', 4), Type: 'DIGITAL_COUPON', TeamId: '', RelatedId: packageId,
    DriveFileId: pdfFile.getId(), GeneratedAt: new Date().toISOString(), GeneratedBy: actorSession.userId
  });

  return { fileId: pdfFile.getId(), pdfUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view' };
}

// One page per PRINTED_COUPONS_PER_PAGE coupons, a 2×5 grid of 3"×2" cells with a cut-guide
// border, blank space left on the final page rather than stretching coupons to fill it
// (spec §8/§36). `printBatchId` is stamped on each cell so a reprint sheet is visually
// distinguishable from the original.
function _buildPrintedCouponSheetLayout_(pres, data, printBatchId) {
  const totalCoupons = data.eligiblePersons;
  const pageCount = Math.max(1, Math.ceil(totalCoupons / PRINTED_COUPONS_PER_PAGE));
  const pageWidth = pres.getPageWidth();
  const pageHeight = pres.getPageHeight();

  const slides = pres.getSlides();
  for (let i = slides.length; i < pageCount; i++) pres.appendSlide(pres.getSlides()[0]);
  while (pres.getSlides().length > pageCount) pres.getSlides()[pres.getSlides().length - 1].remove();

  const cellWidth = 3 * 72; // 3in in points — physical coupon size is exact regardless of page size
  const cellHeight = 2 * 72;
  const gridWidth = cellWidth * PRINTED_COUPONS_PER_ROW;
  const gridHeight = cellHeight * PRINTED_COUPONS_PER_COL;
  const gridLeft = Math.max(0, (pageWidth - gridWidth) / 2);
  const gridTop = Math.max(0, (pageHeight - gridHeight) / 2);

  // Every coupon on this sheet shares the same QR token (one QR per package, spec §14) —
  // encode it once, not once per cell (see QrEncoder.gs's qrDrawOnSlide_ header for why this
  // draws via the basic SlidesApp service rather than a batched Advanced-API call).
  const qr = qrEncode_(data.qrToken);
  const quietZoneModules = 2;
  const qrTotalPt = (qr.size + quietZoneModules * 2) * COUPON_QR_MODULE_PT_PRINTED;

  let seq = 1;
  for (let p = 0; p < pageCount; p++) {
    const slide = pres.getSlides()[p];
    _clearSlide_(slide);
    for (let cell = 0; cell < PRINTED_COUPONS_PER_PAGE && seq <= totalCoupons; cell++, seq++) {
      const row = Math.floor(cell / PRINTED_COUPONS_PER_ROW);
      const col = cell % PRINTED_COUPONS_PER_ROW;
      const left = gridLeft + col * cellWidth;
      const top = gridTop + row * cellHeight;

      const border = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, left, top, cellWidth, cellHeight);
      border.getFill().setTransparent();
      border.getBorder().getLineFill().setSolidFill('#999999');
      border.getBorder().setDashStyle(SlidesApp.DashStyle.DASH);
      border.getBorder().setWeight(0.5);

      const textLeft = left + 6;
      const textBox = slide.insertTextBox(
        data.registrationNumber + '\n' + data.collegeName + '\nPkg ' + data.packageNumber +
        '   ' + String(seq).padStart(2, '0') + '/' + String(totalCoupons).padStart(2, '0') +
        (printBatchId > 1 ? '\nReprint (batch ' + printBatchId + ')' : ''),
        textLeft, top + 4, cellWidth - 12, cellHeight * 0.42
      );
      textBox.getText().getTextStyle().setFontSize(6.5);

      const qrLeft = left + (cellWidth - qrTotalPt) / 2;
      const qrTop = top + cellHeight * 0.48;
      qrDrawOnSlide_(slide, qr, qrLeft, qrTop, COUPON_QR_MODULE_PT_PRINTED);
    }
  }
}

function _generatePrintedCouponSheet_(actorSession, packageId, data, printBatchId) {
  const templateFile = _ensureBlankTemplate_('Printed Coupon Sheet Template');
  const printedFolder = _ensureSubfolder_(_ensureSubfolder_(_getRootFolder_(), 'Food Coupons'), 'Printed');
  const name = 'Printed Coupons - ' + data.registrationNumber + ' - Package ' + data.packageNumber + ' - Batch ' + printBatchId;
  const copyFile = templateFile.makeCopy(name, printedFolder);
  const copyId = copyFile.getId();
  const pres = SlidesApp.openById(copyId);
  _buildPrintedCouponSheetLayout_(pres, data, printBatchId);
  pres.saveAndClose();

  const pdfBlob = DriveApp.getFileById(copyId).getAs('application/pdf');
  const pdfFile = printedFolder.createFile(pdfBlob).setName(name + '.pdf');
  DriveApp.getFileById(copyId).setTrashed(true);

  appendRow_('DOCUMENTS', {
    DocumentId: nextId_('DOC', 4), Type: 'PRINTED_COUPON_SHEET', TeamId: '', RelatedId: packageId,
    DriveFileId: pdfFile.getId(), GeneratedAt: new Date().toISOString(), GeneratedBy: actorSession.userId
  });

  return { fileId: pdfFile.getId(), pdfUrl: 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view' };
}
