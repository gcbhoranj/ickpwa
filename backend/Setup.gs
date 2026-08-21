// Setup.gs — one-time, idempotent bootstrap actions. Safe to call repeatedly.

function setupSchema_() {
  return Object.keys(SHEET_SCHEMAS).map(function (name) {
    ensureSheet_(name);
    return name;
  });
}

function seedSettings_() {
  const defaults = {
    TournamentName: 'HPU Inter-College Kabaddi (Men) Tournament 2026',
    OrganizerName: 'Government College Bhoranj (Tarkwari)',
    DistrictAddress: 'District Hamirpur, Himachal Pradesh 177025',
    Timezone: 'Asia/Kolkata',
    TournamentStartDate: '2026-09-21',
    TournamentEndDate: '2026-09-25',
    RateBreakfast: '50',
    RateLunch: '100',
    RateDinner: '100',
    RateDari: '100',
    SecurityAmount: '0',
    FinancialSettingsLocked: 'false',
    MealTimingBreakfastStart: '07:30',
    MealTimingBreakfastEnd: '09:30',
    MealTimingLunchStart: '12:30',
    MealTimingLunchEnd: '14:30',
    MealTimingDinnerStart: '19:30',
    MealTimingDinnerEnd: '21:00',
    MealTimingGraceMinutes: '10',
    Numbering_Registration_Prefix: 'GCB/HPUICK/REG-',
    Numbering_Registration_Next: '1',
    Numbering_Registration_Padding: '3',
    Numbering_Receipt_Prefix: 'GCB/HPUICK/Receipt-',
    Numbering_Receipt_Next: '1',
    Numbering_Receipt_Padding: '3',
    Numbering_Coupon_Prefix: 'GCB/HPUICK/Coupon-',
    Numbering_Coupon_Next: '1',
    Numbering_Coupon_Padding: '3',
    Numbering_Refund_Prefix: 'GCB/HPUICK/Refund-',
    Numbering_Refund_Next: '1',
    Numbering_Refund_Padding: '3',
    Numbering_Relieving_Prefix: 'GCB/HPUICK/Relieving-',
    Numbering_Relieving_Next: '1',
    Numbering_Relieving_Padding: '3',
    Numbering_Accommodation_Prefix: 'GCB/HPUICK/Room-',
    Numbering_Accommodation_Next: '1',
    Numbering_Accommodation_Padding: '3',
    MatchFeeRate: '500',
    Numbering_Match_Prefix: 'M-',
    Numbering_Match_Next: '1',
    Numbering_Match_Padding: '3',
    Numbering_MatchFee_Prefix: 'GCB/HPUICK-2026/MF/',
    Numbering_MatchFee_Next: '1',
    Numbering_MatchFee_Padding: '5',
    PrincipalSignatureFileId: '',
    RegistrationInchargeSignatureFileId: '',
    PrincipalSealFileId: '',
    AccommodationConvenerSignatureFileId: '',
    AllowSelfTest: 'true'
  };
  return Object.keys(defaults).map(function (key) {
    if (getSetting_(key, null) === null) {
      setSetting_(key, defaults[key], 'setup');
    }
    return key;
  });
}

// One-time (or whenever-needed) reset: clears every transactional sheet back to just its
// header row and resets the human-facing document-numbering counters to 1. Never touches
// USERS/SESSIONS/LOGIN_LOG or any SETTINGS value other than the Numbering_*_Next counters —
// committee accounts and configured rates/timings/tournament-info are not "tournament data."
// Internal record IDs (TEAM-, AUD-, etc.) are deliberately left counting from wherever they
// were — spec §4 says these are "never shown on documents, never reused," so not resetting
// them is correct, not an oversight. Requires the literal confirmation string "RESET" so this
// can never fire from a stray/retried request.
function resetTournamentData_(actorSession, confirm) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (confirm !== 'RESET') {
    throw apiError_('CONFIRMATION_REQUIRED', 'Pass confirm: "RESET" to proceed — this permanently clears all tournament/team data.');
  }

  const sheetsToClear = [
    'TEAMS', 'CONTINGENT_INCHARGES', 'PAYMENTS', 'CHARGES', 'FOOD_PACKAGES', 'FOOD_COUPONS',
    'PACKAGE_INCHARGE_MEALS', 'PRINTED_COUPONS', 'MEAL_ENTITLEMENTS', 'MEAL_USAGE',
    'MEAL_ORDER_STATUS', 'ROOMS', 'ACCOMMODATION', 'ACCOMMODATION_NOC', 'REFUNDS',
    'SECURITY_REFUNDS', 'SETTLEMENTS', 'RECEIPTS', 'RELIEVING', 'DOCUMENTS', 'EMAIL_LOG', 'AUDIT_LOG',
    'MATCHES', 'MATCH_FEE_TRANSACTIONS'
  ];
  sheetsToClear.forEach(function (name) {
    const sheet = getSheet_(name);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, SHEET_SCHEMAS[name].length).clearContent();
  });

  ['Registration', 'Receipt', 'Coupon', 'Refund', 'Relieving', 'Accommodation', 'Match', 'MatchFee'].forEach(function (type) {
    setSetting_('Numbering_' + type + '_Next', '1', actorSession.userId);
  });

  // AUDIT_LOG was just cleared above — this is deliberately the first fresh row in it,
  // recording the reset itself rather than leaving no trace that it happened.
  const now = new Date().toISOString();
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'RESET_TOURNAMENT_DATA', Entity: 'SYSTEM', EntityId: '', PreviousState: '', NewState: sheetsToClear.join(',')
  });

  return { sheetsCleared: sheetsToClear, numberingReset: true, resetAt: now };
}

function _ensureSubfolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

function setupDriveFolders_() {
  const rootName = 'HPU Inter College Kabaddi Tournament 2026';
  const existingRoots = DriveApp.getFoldersByName(rootName);
  const root = existingRoots.hasNext() ? existingRoots.next() : DriveApp.createFolder(rootName);

  const registration = _ensureSubfolder_(root, 'Registration');
  const coupons = _ensureSubfolder_(root, 'Food Coupons');

  const structure = {
    Database: _ensureSubfolder_(root, 'Database'),
    'Registration/Temporary Receipts': _ensureSubfolder_(registration, 'Temporary Receipts'),
    'Registration/Final Receipts': _ensureSubfolder_(registration, 'Final Receipts'),
    'Food Coupons/Digital': _ensureSubfolder_(coupons, 'Digital'),
    'Food Coupons/Printed': _ensureSubfolder_(coupons, 'Printed'),
    Refunds: _ensureSubfolder_(root, 'Refunds'),
    'Relieving Orders': _ensureSubfolder_(root, 'Relieving Orders'),
    Accommodation: _ensureSubfolder_(root, 'Accommodation'),
    'Accommodation/NOC Certificates': _ensureSubfolder_(_ensureSubfolder_(root, 'Accommodation'), 'NOC Certificates'),
    Templates: _ensureSubfolder_(root, 'Templates'),
    Assets: _ensureSubfolder_(root, 'Assets'),
    Reports: _ensureSubfolder_(root, 'Reports'),
    'Match Fee Receipts': _ensureSubfolder_(root, 'Match Fee Receipts')
  };

  setSetting_('DriveRootFolderId', root.getId(), 'setup');
  const folderIds = {};
  Object.keys(structure).forEach(function (key) { folderIds[key] = structure[key].getId(); });
  return { rootFolderId: root.getId(), folders: folderIds };
}

// Temporary manual-run wrapper so the script owner can trigger the Drive OAuth
// consent screen from the Apps Script editor's Run dropdown. NOT exposed via
// the public web API (not registered in Main.gs's ACTIONS table). Safe to
// remove/disable after the one-time authorization is done.
function authorizeDriveManually() {
  return setupDriveFolders_();
}

// Same pattern, for GmailApp — Phase 4's coupon emails are the first thing in this project
// to use the Gmail scope. Run once from the Apps Script editor's Run dropdown (as the script
// owner, gcbhoranj@gmail.com) to click through the one-time consent dialog; sends a no-op
// email to the account itself so nothing external is touched by the authorization step.
function authorizeGmailManually() {
  GmailApp.sendEmail(Session.getActiveUser().getEmail() || 'gcbhoranj@gmail.com', 'HPUICK Gmail authorization', 'This is a one-time authorization check — safe to ignore.');
  return { authorized: true };
}
