// FoodPackages.gs — Phase 4: food package purchase (mandatory Package 1, rolling Package
// 2/3+), coupon+QR issuance, digital coupon PDF, printed-coupon A4 sheet PDF, email/resend/
// reprint. Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md
// §7 (rates/packages/rolling logic), §10 (QR architecture), §14 (coupon flow), §8 (documents).
//
// Each package is a fixed 3-meal window — Dinner, then next-day Breakfast, next-day Lunch
// (never a variable set) — "one new coupon+QR per package, never extending an old one".
// Team members are unconditionally eligible for every meal; incharges are opted in per
// individual, per meal (most teams stay at a hotel for breakfast/dinner and only join mess
// for lunch — decided with the human 2026-08-19), so `MEAL_ENTITLEMENTS.EligiblePersons` can
// genuinely differ across a package's three meals. `FOOD_PACKAGES.EligiblePersons` stays a
// single package-level number — the physical coupon pool size (team members + incharges
// included in at least one meal, counted once each) — since coupons aren't meal-specific;
// any valid copy of the package's single QR covers any group size up to whichever meal's
// remaining balance is being scanned right now (group mess entry, built in Phase 5).

// Fields shown on the digital/printed coupon documents (CouponDocuments.gs), matching the
// reference design: team name, the PRIMARY contingent incharge's name/designation/contact
// (not a list of every incharge — the card has room for one), team roster size, package
// number, meal window, and the QR token itself.
// mealWindowLabel (optional, only meaningful for the digital coupon's footer text — the
// printed sheet doesn't use it): describes exactly which meals this package covers, since a
// meal-excluded package (spec §20-late-arrival amendment) must never claim a meal it doesn't
// actually entitle. Reprint reconstructs coupon data for an existing package and doesn't pass
// one — falls back to the always-correct-in-that-context original full-window phrasing.
function _buildCouponDisplayData_(team, packageNumber, eligiblePersons, startDate, endDate, couponId, qrToken, mealWindowLabel) {
  const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', team.TeamId);
  const primary = incharges.filter(function (i) { return i.IsPrimary === 'true'; })[0] || incharges[0] || {};
  return {
    tournamentName: getSetting_('TournamentName', ''), collegeName: team.CollegeName,
    registrationNumber: team.RegistrationNumber, packageNumber: packageNumber,
    eligiblePersons: eligiblePersons, teamMembers: Number(team.NumberOfTeamMembers),
    startDate: startDate, endDate: endDate, couponId: couponId, qrToken: qrToken,
    mealWindowLabel: mealWindowLabel || ('Dinner ' + startDate + ' · Breakfast & Lunch ' + endDate),
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

// Team members are unconditionally in every meal (unchanged from before). Incharges are
// per-meal, per-individual (each incharge picks their own Breakfast/Lunch/Dinner — most
// teams stay at a hotel for breakfast/dinner and only join the mess for lunch, so a single
// "include incharges" flag applying to all three meals uniformly was wrong). Physical coupon
// pool counts an incharge once if they opted into ANY meal, not once per meal — coupons
// aren't meal-specific (spec §14/§20: "operational labels, not separate balances").
function _resolveInchargeMealSelections_(incharges, inchargeMealSelections) {
  const byInchargeId = {};
  (inchargeMealSelections || []).forEach(function (s) { byInchargeId[s.inchargeId] = s; });
  return incharges.map(function (inc) {
    const sel = byInchargeId[inc.InchargeId] || {};
    return {
      inchargeId: inc.InchargeId, inchargeName: inc.Name,
      breakfast: !!sel.breakfast, lunch: !!sel.lunch, dinner: !!sel.dinner
    };
  });
}

// Reconstructs purchasePackage_'s response shape from an already-existing FOOD_PACKAGES row
// — used both for an idempotent replay (isReplay=true) and could be reused anywhere else a
// package needs to be described in this shape.
function _packageResponseFromExistingRow_(pkgRow, isReplay) {
  const team = findRowById_('TEAMS', 'TeamId', pkgRow.TeamId);
  return {
    packageId: pkgRow.PackageId, packageNumber: Number(pkgRow.PackageNumber), couponId: pkgRow.CouponId,
    eligiblePersons: Number(pkgRow.EligiblePersons), amount: Number(pkgRow.Amount),
    startMeal: pkgRow.StartMeal, endMeal: pkgRow.EndMeal, collegeName: team ? team.values.CollegeName : '',
    digitalCouponUrl: pkgRow.DigitalCouponPdfFileId ? 'https://drive.google.com/file/d/' + pkgRow.DigitalCouponPdfFileId + '/view' : '',
    printedCouponUrl: pkgRow.PrintedCouponPdfFileId ? 'https://drive.google.com/file/d/' + pkgRow.PrintedCouponPdfFileId + '/view' : '',
    emailStatus: pkgRow.EmailStatus, digitalCouponFileId: pkgRow.DigitalCouponPdfFileId, printedCouponFileId: pkgRow.PrintedCouponPdfFileId,
    replay: !!isReplay
  };
}

// mealInclusion (optional): {dinner, breakfast, lunch} booleans, each defaulting to true when
// omitted or when mealInclusion itself is omitted — the normal case where a package covers
// all three meals. Lets a package deliberately exclude a meal a team was never present for —
// e.g. a team registering the morning after arriving late at night never had that first
// Dinner, so their Package 1 should cover only Breakfast+Lunch (decided with the human
// 2026-08-20). An excluded meal gets no MEAL_ENTITLEMENTS row at all (not a zeroed one) —
// a scan attempt against it is simply "not valid for this coupon," and it contributes
// nothing to Amount.
function _resolveMealInclusion_(mealInclusion) {
  function included(key) { return !mealInclusion || mealInclusion[key] !== false; }
  return { dinner: included('dinner'), breakfast: included('breakfast'), lunch: included('lunch') };
}

// Coupon footer text describing which meals this specific package actually covers — must
// reflect real inclusions/exclusions, not always assume all three (a printed/digital coupon
// claiming "Dinner" for a package that excludes it would be actively misleading to both the
// team and Mess).
function _mealWindowLabel_(mealInclusion, startDate, endDate) {
  const parts = [];
  if (mealInclusion.dinner) parts.push('Dinner ' + startDate);
  if (mealInclusion.breakfast && mealInclusion.lunch) parts.push('Breakfast & Lunch ' + endDate);
  else if (mealInclusion.breakfast) parts.push('Breakfast ' + endDate);
  else if (mealInclusion.lunch) parts.push('Lunch ' + endDate);
  return parts.join(' · ');
}

// clientRequestId (optional): closes a real, live-confirmed bug (2026-08-20) — the frontend's
// documented retry-on-transient-glitch behavior (api-client.js) re-sends the exact same
// request body, including the same requestId, if Apps Script's response redirect isn't ready
// yet; without a guard here that silently created a second real package (own coupon/QR/
// charge) for one purchase. A repeated clientRequestId returns the ORIGINAL package instead —
// this alone is what closes the gap, since a date-overlap check can't: the retry's own
// rolling default-date computation sees the just-created package and picks the NEXT
// (non-overlapping) date, not the same one. The separate overlap check below catches the
// different case of a genuinely duplicate sale attempt (different requestId).
function purchasePackage_(actorSession, teamId, inchargeMealSelections, mealInclusion, dinnerDate, mode, recipientEmails, clientRequestId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  if (!mode) throw apiError_('VALIDATION_ERROR', 'Payment mode is required.');

  if (clientRequestId) {
    const existingByRequestId = findRowsByField_('FOOD_PACKAGES', 'ClientRequestId', clientRequestId)[0];
    if (existingByRequestId) return _packageResponseFromExistingRow_(existingByRequestId, true);
  }

  const included = _resolveMealInclusion_(mealInclusion);
  if (!included.dinner && !included.breakfast && !included.lunch) {
    throw apiError_('VALIDATION_ERROR', 'At least one meal must be included in the package.');
  }

  const teamMembers = Number(team.values.NumberOfTeamMembers);
  const incharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId);
  const resolvedSelections = _resolveInchargeMealSelections_(incharges, inchargeMealSelections);

  const dinnerIncharges = resolvedSelections.filter(function (s) { return s.dinner; });
  const breakfastIncharges = resolvedSelections.filter(function (s) { return s.breakfast; });
  const lunchIncharges = resolvedSelections.filter(function (s) { return s.lunch; });
  const dinnerEligible = teamMembers + dinnerIncharges.length;
  const breakfastEligible = teamMembers + breakfastIncharges.length;
  const lunchEligible = teamMembers + lunchIncharges.length;

  // Physical coupon pool + FOOD_PACKAGES.EligiblePersons: team members + incharges included
  // in at least one meal (counted once each, regardless of how many meals they checked).
  const includedIncharges = resolvedSelections.filter(function (s) { return s.breakfast || s.lunch || s.dinner; });
  const eligiblePersons = teamMembers + includedIncharges.length;
  if (eligiblePersons < 1) throw apiError_('VALIDATION_ERROR', 'Eligible persons must be at least 1.');

  const rateBreakfast = Number(getSetting_('RateBreakfast', '0'));
  const rateLunch = Number(getSetting_('RateLunch', '0'));
  const rateDinner = Number(getSetting_('RateDinner', '0'));

  // The lock covers only the decide-and-write critical section (packageNumber assignment,
  // the overlap check, and every row write below) — NOT the PDF generation/email that
  // follows, which takes tens of seconds and doesn't touch any shared counter, so holding a
  // script-wide lock across it would needlessly stall every other concurrent purchase.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let packageId, couponId, qrToken, now, packageNumber, startDate, endDate, meals, amount;
  try {
    if (clientRequestId) {
      const existingByRequestId2 = findRowsByField_('FOOD_PACKAGES', 'ClientRequestId', clientRequestId)[0];
      if (existingByRequestId2) return _packageResponseFromExistingRow_(existingByRequestId2, true);
    }

    const existingPackages = findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId);
    packageNumber = existingPackages.length + 1;
    startDate = _defaultPackageDinnerDate_(teamId, dinnerDate);
    endDate = _addDays_(startDate, 1);

    meals = [];
    if (included.dinner) meals.push({ meal: 'DINNER', date: startDate, rate: rateDinner, eligiblePersons: dinnerEligible });
    if (included.breakfast) meals.push({ meal: 'BREAKFAST', date: endDate, rate: rateBreakfast, eligiblePersons: breakfastEligible });
    if (included.lunch) meals.push({ meal: 'LUNCH', date: endDate, rate: rateLunch, eligiblePersons: lunchEligible });
    amount = meals.reduce(function (sum, m) { return sum + m.rate * m.eligiblePersons; }, 0);

    // Reject a genuine duplicate sale: does this team already have an ACTIVE entitlement for
    // any of the exact (date, meal) slots this purchase would create? Checked directly
    // against MEAL_ENTITLEMENTS (the source of truth for what's actually covered) rather than
    // FOOD_PACKAGES' StartMeal/EndMeal window — a plain date-range check would wrongly flag
    // the legitimate rolling case (Package 2's Dinner lands the same calendar day as Package
    // 1's Breakfast/Lunch — different meals, same date; "rolling coverage continuous with no
    // gaps" is the whole point) as a false positive, caught live by this file's own
    // regression test before shipping (see dev-log). Comparing actual (date, meal) slots
    // handles that correctly AND correctly handles meal-excluded packages, where a package's
    // StartMeal/EndMeal window no longer corresponds 1:1 with what it actually entitles.
    const teamEntitlements = findRowsByField_('MEAL_ENTITLEMENTS', 'TeamId', teamId).filter(function (e) { return e.Status === 'ACTIVE'; });
    const collision = meals.map(function (m) {
      return teamEntitlements.filter(function (e) { return e.Date === m.date && e.Meal === m.meal; })[0];
    }).filter(function (e) { return !!e; })[0];
    if (collision) {
      const collisionPkg = findRowById_('FOOD_PACKAGES', 'PackageId', collision.PackageId);
      throw apiError_('DUPLICATE_PACKAGE',
        'This package has already been sold to ' + team.values.CollegeName + ' — ' + collision.Meal + ' ' + collision.Date +
        ' is already covered by Package ' + (collisionPkg ? collisionPkg.values.PackageNumber : collision.PackageId) + '.');
    }

    packageId = nextId_('PKG', 4);
    couponId = nextId_('CPN', 4);
    // Opaque, unguessable, but deliberately shorter than a full UUID (36 chars): QR module
    // count grows with encoded data length, and a full UUID pushed every coupon's QR into a
    // version with ~840 modules — hundreds of individual shapes, a measured, live-confirmed
    // contributor to slow document generation (see this file's header note). 12 hex
    // characters (48 bits, ~2.8×10^14 possibilities) is still astronomically unguessable at
    // the scale of a few hundred coupons for one tournament, and fits the smallest QR version.
    qrToken = Utilities.getUuid().replace(/-/g, '').substring(0, 12);
    now = new Date().toISOString();

    appendRow_('FOOD_PACKAGES', {
      PackageId: packageId, TeamId: teamId, PackageNumber: packageNumber, CouponId: couponId,
      IncludeInchargesInEntitlement: includedIncharges.length > 0 ? 'true' : 'false', EligiblePersons: eligiblePersons,
      PurchaseDateTime: now, Amount: amount, RateBreakfastSnapshot: rateBreakfast, RateLunchSnapshot: rateLunch,
      RateDinnerSnapshot: rateDinner, StartMeal: startDate, EndMeal: endDate, Status: 'ACTIVE', QrToken: qrToken,
      DigitalCouponPdfFileId: '', PrintedCouponPdfFileId: '', EmailStatus: 'NOT_SENT', ClientRequestId: clientRequestId || '',
      CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
    });

    appendRow_('FOOD_COUPONS', {
      CouponId: couponId, PackageId: packageId, TeamId: teamId, QrToken: qrToken, Status: 'ACTIVE', IssuedAt: now
    });

    // One row per incharge on the team (not just the included ones) — a complete record of
    // who was asked and what they chose, per package.
    if (incharges.length > 0) {
      const pimIds = nextIdBatch_('PIM', resolvedSelections.length, 4);
      appendRows_('PACKAGE_INCHARGE_MEALS', resolvedSelections.map(function (s, i) {
        return {
          PackageInchargeMealId: pimIds[i], PackageId: packageId, InchargeId: s.inchargeId, InchargeName: s.inchargeName,
          IncludeBreakfast: s.breakfast ? 'true' : 'false', IncludeLunch: s.lunch ? 'true' : 'false',
          IncludeDinner: s.dinner ? 'true' : 'false', CreatedBy: actorSession.userId, CreatedAt: now
        };
      }));
    }

    const entitlementIds = nextIdBatch_('ENT', meals.length, 4);
    appendRows_('MEAL_ENTITLEMENTS', meals.map(function (m, i) {
      return {
        EntitlementId: entitlementIds[i], PackageId: packageId, TeamId: teamId, Date: m.date, Meal: m.meal,
        Rate: m.rate, EligiblePersons: m.eligiblePersons, ServedPersons: 0, RemainingPersons: m.eligiblePersons,
        RefundablePersons: '', RefundableAmount: '', MealOrderStatus: 'NOT_ORDERED',
        ValidFrom: m.date, ValidUntil: m.date, Status: 'ACTIVE'
      };
    }));

    // One printed coupon per eligible person — a real college contingent can run 15-25+
    // people, so this is built as ONE bulk id-allocation + ONE bulk row-write (not N of
    // each); see nextIdBatch_/appendRows_ headers for why that matters at this scale.
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
  } finally {
    lock.releaseLock();
  }

  const mealWindowLabel = _mealWindowLabel_(included, startDate, endDate);
  const couponData = _buildCouponDisplayData_(team.values, packageNumber, eligiblePersons, startDate, endDate, couponId, qrToken, mealWindowLabel);
  const digitalPdf = _generateDigitalCouponPdf_(actorSession, packageId, couponData);
  const printedPdf = _generatePrintedCouponSheet_(actorSession, packageId, couponData, 1);

  updateRowById_('FOOD_PACKAGES', 'PackageId', packageId, {
    DigitalCouponPdfFileId: digitalPdf.fileId, PrintedCouponPdfFileId: printedPdf.fileId,
    UpdatedBy: actorSession.userId, UpdatedAt: new Date().toISOString()
  });

  const emailResult = _sendCouponEmail_(actorSession, packageId, teamId, [digitalPdf.fileId], recipientEmails, 'purchased');

  return {
    packageId: packageId, packageNumber: packageNumber, couponId: couponId, eligiblePersons: eligiblePersons,
    amount: amount, startMeal: startDate, endMeal: endDate, collegeName: team.values.CollegeName,
    mealsIncluded: included, mealWindowLabel: mealWindowLabel,
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
