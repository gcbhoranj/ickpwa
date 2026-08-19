// FoodPackages.gs — Phase 4: food package purchase (mandatory Package 1, rolling Package
// 2/3+), coupon+QR issuance, digital coupon PDF, printed-coupon A4 sheet PDF, email/resend/
// reprint. Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md
// §7 (rates/packages/rolling logic), §10 (QR architecture), §14 (coupon flow), §8 (documents).
//
// Each package is a fixed 3-meal window — Dinner, then next-day Breakfast, next-day Lunch
// (never a variable set) — "one new coupon+QR per package, never extending an old one".
// EligiblePersons is a per-package snapshot (team members, plus incharges if the operator
// includes them for that specific package) — any valid copy of the package's single QR
// covers any group size up to the remaining balance (group mess entry, built in Phase 5).

// Fields shown on the digital/printed coupon documents (CouponDocuments.gs), matching the
// reference design: team name, the PRIMARY contingent incharge's name/designation/contact
// (not a list of every incharge — the card has room for one), team roster size, package
// number, meal window, and the QR token itself.
function _buildCouponDisplayData_(team, packageNumber, eligiblePersons, startDate, endDate, couponId, qrToken) {
  const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', team.TeamId);
  const primary = incharges.filter(function (i) { return i.IsPrimary === 'true'; })[0] || incharges[0] || {};
  return {
    tournamentName: getSetting_('TournamentName', ''), collegeName: team.CollegeName,
    registrationNumber: team.RegistrationNumber, packageNumber: packageNumber,
    eligiblePersons: eligiblePersons, teamMembers: Number(team.NumberOfTeamMembers),
    startDate: startDate, endDate: endDate, couponId: couponId, qrToken: qrToken,
    inchargeName: primary.Name || '', inchargeDesignation: primary.Designation || '',
    inchargeWhatsapp: primary.WhatsAppNumber || '', inchargeEmail: primary.EmailAddress || ''
  };
}

// Package N's Dinner date: for Package 1, the operator-supplied date defaulting to today
// (clamped into the tournament window so a late/early purchase doesn't produce a nonsense
// date); for Package N>1, the day after the previous package's Dinner date — i.e. right
// where the previous package's Lunch left off, keeping rolling coverage continuous with no
// gaps. The operator can always override with an explicit date.
function _defaultPackageDinnerDate_(teamId, requestedDate) {
  if (requestedDate) return requestedDate;
  const existing = findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId);
  if (existing.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    const start = getSetting_('TournamentStartDate', today);
    const end = getSetting_('TournamentEndDate', today);
    if (today < start) return start;
    if (today > end) return end;
    return today;
  }
  const latestStart = existing.reduce(function (max, p) { return p.StartMeal > max ? p.StartMeal : max; }, existing[0].StartMeal);
  return _addDays_(latestStart, 1);
}

function _addDays_(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function purchasePackage_(actorSession, teamId, includeInchargesInEntitlement, dinnerDate, mode, recipientEmails) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  if (!mode) throw apiError_('VALIDATION_ERROR', 'Payment mode is required.');

  const includeIncharges = !!includeInchargesInEntitlement;
  const eligiblePersons = Number(team.values.NumberOfTeamMembers) + (includeIncharges ? Number(team.values.NumberOfContingentIncharges) : 0);
  if (eligiblePersons < 1) throw apiError_('VALIDATION_ERROR', 'Eligible persons must be at least 1.');

  const existingPackages = findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId);
  const packageNumber = existingPackages.length + 1;
  const startDate = _defaultPackageDinnerDate_(teamId, dinnerDate);
  const endDate = _addDays_(startDate, 1);

  const rateBreakfast = Number(getSetting_('RateBreakfast', '0'));
  const rateLunch = Number(getSetting_('RateLunch', '0'));
  const rateDinner = Number(getSetting_('RateDinner', '0'));
  const amount = (rateBreakfast + rateLunch + rateDinner) * eligiblePersons;

  const packageId = nextId_('PKG', 4);
  const couponId = nextId_('CPN', 4);
  // Opaque, unguessable, but deliberately shorter than a full UUID (36 chars): QR module
  // count grows with encoded data length, and a full UUID pushed every coupon's QR into a
  // version with ~840 modules — hundreds of individual shapes, a measured, live-confirmed
  // contributor to slow document generation (see this file's header note). 12 hex characters
  // (48 bits, ~2.8×10^14 possibilities) is still astronomically unguessable at the scale of
  // a few hundred coupons for one tournament, and fits the smallest QR version.
  const qrToken = Utilities.getUuid().replace(/-/g, '').substring(0, 12);
  const now = new Date().toISOString();

  appendRow_('FOOD_PACKAGES', {
    PackageId: packageId, TeamId: teamId, PackageNumber: packageNumber, CouponId: couponId,
    IncludeInchargesInEntitlement: includeIncharges ? 'true' : 'false', EligiblePersons: eligiblePersons,
    PurchaseDateTime: now, Amount: amount, RateBreakfastSnapshot: rateBreakfast, RateLunchSnapshot: rateLunch,
    RateDinnerSnapshot: rateDinner, StartMeal: startDate, EndMeal: endDate, Status: 'ACTIVE', QrToken: qrToken,
    DigitalCouponPdfFileId: '', PrintedCouponPdfFileId: '', EmailStatus: 'NOT_SENT',
    CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });

  appendRow_('FOOD_COUPONS', {
    CouponId: couponId, PackageId: packageId, TeamId: teamId, QrToken: qrToken, Status: 'ACTIVE', IssuedAt: now
  });

  const meals = [
    { meal: 'DINNER', date: startDate, rate: rateDinner },
    { meal: 'BREAKFAST', date: endDate, rate: rateBreakfast },
    { meal: 'LUNCH', date: endDate, rate: rateLunch }
  ];
  const entitlementIds = nextIdBatch_('ENT', meals.length, 4);
  appendRows_('MEAL_ENTITLEMENTS', meals.map(function (m, i) {
    return {
      EntitlementId: entitlementIds[i], PackageId: packageId, TeamId: teamId, Date: m.date, Meal: m.meal,
      Rate: m.rate, EligiblePersons: eligiblePersons, ServedPersons: 0, RemainingPersons: eligiblePersons,
      RefundablePersons: '', RefundableAmount: '', MealOrderStatus: 'NOT_ORDERED',
      ValidFrom: m.date, ValidUntil: m.date, Status: 'ACTIVE'
    };
  }));

  // One printed coupon per eligible person — a real college contingent can run 15-25+
  // people, so this is built as ONE bulk id-allocation + ONE bulk row-write (not N of each);
  // see nextIdBatch_/appendRows_ headers for why that matters at this scale.
  const printedCouponIds = nextIdBatch_('PRC', eligiblePersons, 4);
  appendRows_('PRINTED_COUPONS', printedCouponIds.map(function (id, i) {
    const seq = i + 1;
    return {
      PrintedCouponId: id, CouponId: couponId, PackageId: packageId, SequenceNumber: seq,
      TotalCount: String(seq).padStart(2, '0') + '/' + String(eligiblePersons).padStart(2, '0'),
      PrintBatchId: 1, GeneratedAt: now, GeneratedBy: actorSession.userId
    };
  }));

  appendRow_('PAYMENTS', {
    PaymentId: nextId_('PAY', 4), TeamId: teamId, Amount: amount, Mode: mode, ReceivedAt: now,
    Purpose: 'ADDITIONAL_PACKAGE', ReversalOf: '', CreatedBy: actorSession.userId, CreatedAt: now
  });

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'PURCHASE_PACKAGE', Entity: 'PACKAGE', EntityId: packageId, PreviousState: '', NewState: 'ACTIVE'
  });

  const couponData = _buildCouponDisplayData_(team.values, packageNumber, eligiblePersons, startDate, endDate, couponId, qrToken);
  const digitalPdf = _generateDigitalCouponPdf_(actorSession, packageId, couponData);
  const printedPdf = _generatePrintedCouponSheet_(actorSession, packageId, couponData, 1);

  updateRowById_('FOOD_PACKAGES', 'PackageId', packageId, {
    DigitalCouponPdfFileId: digitalPdf.fileId, PrintedCouponPdfFileId: printedPdf.fileId,
    UpdatedBy: actorSession.userId, UpdatedAt: new Date().toISOString()
  });

  const emailResult = _sendCouponEmail_(actorSession, packageId, teamId, [digitalPdf.fileId], recipientEmails, 'purchased');

  return {
    packageId: packageId, packageNumber: packageNumber, couponId: couponId, eligiblePersons: eligiblePersons,
    amount: amount, startMeal: startDate, endMeal: endDate,
    digitalCouponUrl: digitalPdf.pdfUrl, printedCouponUrl: printedPdf.pdfUrl, emailStatus: emailResult.status,
    digitalCouponFileId: digitalPdf.fileId, printedCouponFileId: printedPdf.fileId
  };
}

function listPackages_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  return findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId).map(function (p) {
    return {
      packageId: p.PackageId, packageNumber: Number(p.PackageNumber), eligiblePersons: Number(p.EligiblePersons),
      amount: Number(p.Amount), startMeal: p.StartMeal, endMeal: p.EndMeal, status: p.Status,
      digitalCouponUrl: p.DigitalCouponPdfFileId ? 'https://drive.google.com/file/d/' + p.DigitalCouponPdfFileId + '/view' : '',
      printedCouponUrl: p.PrintedCouponPdfFileId ? 'https://drive.google.com/file/d/' + p.PrintedCouponPdfFileId + '/view' : '',
      emailStatus: p.EmailStatus
    };
  });
}

// Re-sends the EXISTING digital coupon PDF — no new package, coupon, QR, or PDF (spec §14).
function resendCoupon_(actorSession, packageId, recipientEmails) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const pkg = findRowById_('FOOD_PACKAGES', 'PackageId', packageId);
  if (!pkg) throw apiError_('NOT_FOUND', 'No such package: ' + packageId);
  if (!pkg.values.DigitalCouponPdfFileId) throw apiError_('NOT_FOUND', 'No digital coupon PDF has been generated for this package.');
  const result = _sendCouponEmail_(actorSession, packageId, pkg.values.TeamId, [pkg.values.DigitalCouponPdfFileId], recipientEmails, 'resent');
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: new Date().toISOString(), UserId: actorSession.userId, Role: actorSession.role,
    Action: 'RESEND_COUPON', Entity: 'PACKAGE', EntityId: packageId, PreviousState: '', NewState: ''
  });
  return result;
}

// Generates a NEW printed-coupon A4 sheet for the SAME CouponId/QrToken — a new
// PRINTED_COUPONS batch (new PrintBatchId), never a new package/coupon/QR (spec §14,
// recommendation §11). For a physical reprint, not emailed.
function reprintCoupon_(actorSession, packageId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const pkg = findRowById_('FOOD_PACKAGES', 'PackageId', packageId);
  if (!pkg) throw apiError_('NOT_FOUND', 'No such package: ' + packageId);

  const existingBatches = findRowsByField_('PRINTED_COUPONS', 'PackageId', packageId)
    .reduce(function (max, r) { return Number(r.PrintBatchId) > max ? Number(r.PrintBatchId) : max; }, 0);
  const newBatchId = existingBatches + 1;
  const eligiblePersons = Number(pkg.values.EligiblePersons);
  const now = new Date().toISOString();

  const printedCouponIds = nextIdBatch_('PRC', eligiblePersons, 4);
  appendRows_('PRINTED_COUPONS', printedCouponIds.map(function (id, i) {
    const seq = i + 1;
    return {
      PrintedCouponId: id, CouponId: pkg.values.CouponId, PackageId: packageId, SequenceNumber: seq,
      TotalCount: String(seq).padStart(2, '0') + '/' + String(eligiblePersons).padStart(2, '0'),
      PrintBatchId: newBatchId, GeneratedAt: now, GeneratedBy: actorSession.userId
    };
  }));

  const team = findRowById_('TEAMS', 'TeamId', pkg.values.TeamId);
  const couponData = _buildCouponDisplayData_(
    team.values, Number(pkg.values.PackageNumber), eligiblePersons, pkg.values.StartMeal, pkg.values.EndMeal,
    pkg.values.CouponId, pkg.values.QrToken
  );
  const printedPdf = _generatePrintedCouponSheet_(actorSession, packageId, couponData, newBatchId);

  updateRowById_('FOOD_PACKAGES', 'PackageId', packageId, {
    PrintedCouponPdfFileId: printedPdf.fileId, UpdatedBy: actorSession.userId, UpdatedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'REPRINT_COUPON', Entity: 'PACKAGE', EntityId: packageId, PreviousState: '', NewState: 'batch ' + newBatchId
  });

  return { printBatchId: newBatchId, printedCouponUrl: printedPdf.pdfUrl, printedCouponFileId: printedPdf.fileId };
}

// Defaults to every incharge with a non-blank email address when the caller doesn't specify
// recipients — never blocks the underlying purchase/resend on failure (spec §11).
function _sendCouponEmail_(actorSession, packageId, teamId, driveFileIds, recipientEmails, verb) {
  let recipients = recipientEmails;
  if (!recipients || recipients.length === 0) {
    recipients = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId)
      .map(function (i) { return i.EmailAddress; }).filter(function (e) { return !!e; });
  }
  const now = new Date().toISOString();
  if (recipients.length === 0) {
    updateRowById_('FOOD_PACKAGES', 'PackageId', packageId, { EmailStatus: 'NOT_SENT', UpdatedBy: actorSession.userId, UpdatedAt: now });
    return { status: 'NOT_SENT', recipients: [] };
  }

  const team = findRowById_('TEAMS', 'TeamId', teamId);
  const subject = 'Food Coupon — ' + (team ? team.values.RegistrationNumber : teamId);
  const body = 'Your food coupon has been ' + verb + '. Please find the digital coupon attached — present its QR code at meal times.';
  let status = 'SENT';
  let errorMessage = '';
  try {
    const attachments = driveFileIds.map(function (id) { return DriveApp.getFileById(id).getBlob(); });
    GmailApp.sendEmail(recipients.join(','), subject, body, { attachments: attachments, name: getSetting_('OrganizerName', '') });
  } catch (err) {
    status = 'FAILED';
    errorMessage = err.message;
  }
  updateRowById_('FOOD_PACKAGES', 'PackageId', packageId, { EmailStatus: status, UpdatedBy: actorSession.userId, UpdatedAt: now });
  appendRow_('EMAIL_LOG', {
    EmailId: nextId_('EML', 4), DocumentId: packageId, Recipient: recipients.join(','), Subject: subject,
    SentAt: now, User: actorSession.userId, Status: status, ErrorMessage: errorMessage
  });
  return { status: status, recipients: recipients };
}
