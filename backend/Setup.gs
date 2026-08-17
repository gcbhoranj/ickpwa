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
    MealTimingBreakfastStart: '',
    MealTimingBreakfastEnd: '',
    MealTimingLunchStart: '',
    MealTimingLunchEnd: '',
    MealTimingDinnerStart: '',
    MealTimingDinnerEnd: '',
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
    PrincipalSignatureFileId: '',
    RegistrationInchargeSignatureFileId: '',
    CollegeSealFileId: '',
    AllowSelfTest: 'true'
  };
  return Object.keys(defaults).map(function (key) {
    if (getSetting_(key, null) === null) {
      setSetting_(key, defaults[key], 'setup');
    }
    return key;
  });
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
    Templates: _ensureSubfolder_(root, 'Templates'),
    Assets: _ensureSubfolder_(root, 'Assets'),
    Reports: _ensureSubfolder_(root, 'Reports')
  };

  setSetting_('DriveRootFolderId', root.getId(), 'setup');
  const folderIds = {};
  Object.keys(structure).forEach(function (key) { folderIds[key] = structure[key].getId(); });
  return { rootFolderId: root.getId(), folders: folderIds };
}
