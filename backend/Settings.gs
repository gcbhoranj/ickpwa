// Settings.gs — rate/financial-lock management and the public registration-info read.

// Takes actorSession for signature consistency with the rest of this file, but does not
// itself call requireRole_/requireSession_ — the caller (the settings.getRegistrationInfo
// action in Main.gs) is responsible for calling requireSession_ before invoking this, the
// same pattern auth.whoami already uses (any authenticated role, no specific role gate).
function getRegistrationInfo_(actorSession) {
  return {
    rateBreakfast: getSetting_('RateBreakfast', '0'),
    rateLunch: getSetting_('RateLunch', '0'),
    rateDinner: getSetting_('RateDinner', '0'),
    rateDari: getSetting_('RateDari', '0'),
    securityAmount: getSetting_('SecurityAmount', '0'),
    matchFeeRate: getSetting_('MatchFeeRate', '0'),
    financialSettingsLocked: getSetting_('FinancialSettingsLocked', 'false')
  };
}

function updateRates_(actorSession, rates) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (getSetting_('FinancialSettingsLocked', 'false') === 'true') {
    throw apiError_('SETTINGS_LOCKED', 'Financial settings are locked. Unlock before changing rates.');
  }
  ['breakfast', 'lunch', 'dinner', 'dari', 'security', 'matchFee'].forEach(function (key) {
    if (rates[key] === undefined || rates[key] === null || isNaN(Number(rates[key])) || Number(rates[key]) < 0) {
      throw apiError_('VALIDATION_ERROR', 'Rate "' + key + '" must be a non-negative number.');
    }
  });
  const now = new Date().toISOString();
  setSetting_('RateBreakfast', String(rates.breakfast), actorSession.userId);
  setSetting_('RateLunch', String(rates.lunch), actorSession.userId);
  setSetting_('RateDinner', String(rates.dinner), actorSession.userId);
  setSetting_('RateDari', String(rates.dari), actorSession.userId);
  setSetting_('SecurityAmount', String(rates.security), actorSession.userId);
  setSetting_('MatchFeeRate', String(rates.matchFee), actorSession.userId);
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'UPDATE_RATES', Entity: 'SETTINGS', EntityId: 'RATES', PreviousState: '', NewState: JSON.stringify(rates)
  });
  return getRegistrationInfo_(actorSession);
}

// Meal timing windows — set by Admin here so the future Mess scanning utility (Phase 5) can
// tell which meal a scan belongs to. `graceMinutes` is a single tolerance applied on both
// sides of every window (e.g. Breakfast 07:30-09:30 with a 10-minute grace accepts a scan
// from 07:20 to 09:40) — the actual accept/reject check itself is Phase 5's job; this phase
// only makes the windows configurable and stored, not yet enforced anywhere.
function getMealTimings_(actorSession) {
  return {
    breakfastStart: getSetting_('MealTimingBreakfastStart', ''), breakfastEnd: getSetting_('MealTimingBreakfastEnd', ''),
    lunchStart: getSetting_('MealTimingLunchStart', ''), lunchEnd: getSetting_('MealTimingLunchEnd', ''),
    dinnerStart: getSetting_('MealTimingDinnerStart', ''), dinnerEnd: getSetting_('MealTimingDinnerEnd', ''),
    graceMinutes: getSetting_('MealTimingGraceMinutes', '10')
  };
}

function _validateTimeOfDay_(value, label) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw apiError_('VALIDATION_ERROR', label + ' must be a 24-hour HH:MM time.');
  }
}

function updateMealTimings_(actorSession, timings) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const pairs = [
    ['breakfastStart', 'breakfastEnd', 'Breakfast'], ['lunchStart', 'lunchEnd', 'Lunch'], ['dinnerStart', 'dinnerEnd', 'Dinner']
  ];
  pairs.forEach(function (p) {
    _validateTimeOfDay_(timings[p[0]], p[2] + ' start');
    _validateTimeOfDay_(timings[p[1]], p[2] + ' end');
    if (timings[p[0]] >= timings[p[1]]) {
      throw apiError_('VALIDATION_ERROR', p[2] + ' start must be before ' + p[2].toLowerCase() + ' end.');
    }
  });
  const grace = parseInt(timings.graceMinutes, 10);
  if (isNaN(grace) || grace < 0) {
    throw apiError_('VALIDATION_ERROR', 'Grace minutes must be a non-negative number.');
  }

  const now = new Date().toISOString();
  setSetting_('MealTimingBreakfastStart', timings.breakfastStart, actorSession.userId);
  setSetting_('MealTimingBreakfastEnd', timings.breakfastEnd, actorSession.userId);
  setSetting_('MealTimingLunchStart', timings.lunchStart, actorSession.userId);
  setSetting_('MealTimingLunchEnd', timings.lunchEnd, actorSession.userId);
  setSetting_('MealTimingDinnerStart', timings.dinnerStart, actorSession.userId);
  setSetting_('MealTimingDinnerEnd', timings.dinnerEnd, actorSession.userId);
  setSetting_('MealTimingGraceMinutes', String(grace), actorSession.userId);
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'UPDATE_MEAL_TIMINGS', Entity: 'SETTINGS', EntityId: 'MEAL_TIMINGS', PreviousState: '', NewState: JSON.stringify(timings)
  });
  return getMealTimings_(actorSession);
}

// Tournament Name/Organizer/District Address/dates — seeded once by seedSettings_ (Phase 1),
// but until now had no update action at all: only editable via a raw Sheet edit or a reseed
// (which never overwrites an already-set value). Flagged as a gap during Phase 10 QA.
function getTournamentInfo_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  return {
    tournamentName: getSetting_('TournamentName', ''), organizerName: getSetting_('OrganizerName', ''),
    districtAddress: getSetting_('DistrictAddress', ''),
    tournamentStartDate: getSetting_('TournamentStartDate', ''), tournamentEndDate: getSetting_('TournamentEndDate', '')
  };
}

// No actorSession/role gate — deliberately callable before login (the login screen needs the
// live tournament name/dates, same info this app already shows unauthenticated). Mirrors
// getTournamentInfo_'s shape exactly but omits anything financial, so it's safe to expose with
// no session at all — see Main.gs's `public.*` action-naming convention for other pre-auth reads.
function getPublicTournamentInfo_() {
  return {
    tournamentName: getSetting_('TournamentName', ''), organizerName: getSetting_('OrganizerName', ''),
    districtAddress: getSetting_('DistrictAddress', ''),
    tournamentStartDate: getSetting_('TournamentStartDate', ''), tournamentEndDate: getSetting_('TournamentEndDate', '')
  };
}

function updateTournamentInfo_(actorSession, info) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (!info || !info.tournamentName) throw apiError_('VALIDATION_ERROR', 'Tournament name is required.');
  if (!info.organizerName) throw apiError_('VALIDATION_ERROR', 'Organizer/College name is required.');
  if (!info.districtAddress) throw apiError_('VALIDATION_ERROR', 'District address is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(info.tournamentStartDate || '')) throw apiError_('VALIDATION_ERROR', 'Tournament start date must be YYYY-MM-DD.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(info.tournamentEndDate || '')) throw apiError_('VALIDATION_ERROR', 'Tournament end date must be YYYY-MM-DD.');
  if (info.tournamentStartDate > info.tournamentEndDate) throw apiError_('VALIDATION_ERROR', 'Tournament start date must be on or before the end date.');

  setSetting_('TournamentName', info.tournamentName, actorSession.userId);
  setSetting_('OrganizerName', info.organizerName, actorSession.userId);
  setSetting_('DistrictAddress', info.districtAddress, actorSession.userId);
  setSetting_('TournamentStartDate', info.tournamentStartDate, actorSession.userId);
  setSetting_('TournamentEndDate', info.tournamentEndDate, actorSession.userId);
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: new Date().toISOString(), UserId: actorSession.userId, Role: actorSession.role,
    Action: 'UPDATE_TOURNAMENT_INFO', Entity: 'SETTINGS', EntityId: 'TOURNAMENT_INFO', PreviousState: '', NewState: JSON.stringify(info)
  });
  return getTournamentInfo_(actorSession);
}

// Signature/seal images used on generated documents — Admin uploads once, every future
// document draws it automatically (_drawSignatureOrLine_, already built in Phase 8 but never
// fed a real image until now). `key` is checked against the fixed SIGNATURE_SETTING_KEYS
// allowlist (Constants.gs) — this must never be able to write an arbitrary Settings key just
// because the caller supplied one. The previous file for a slot (if any) is trashed on
// re-upload so re-doing a signature doesn't silently accumulate orphaned Drive files forever.
function uploadSignature_(actorSession, key, base64Data, mimeType) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (!SIGNATURE_SETTING_KEYS.hasOwnProperty(key)) {
    throw apiError_('VALIDATION_ERROR', 'Unknown signature slot: ' + key);
  }
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
    throw apiError_('VALIDATION_ERROR', 'Signature image must be PNG or JPEG.');
  }
  if (!base64Data) throw apiError_('VALIDATION_ERROR', 'No image data received.');

  const decoded = Utilities.base64Decode(base64Data);
  const extension = mimeType === 'image/png' ? 'png' : 'jpg';
  const blob = Utilities.newBlob(decoded, mimeType, key + '.' + extension);

  const signaturesFolder = _ensureSubfolder_(_getRootFolder_(), 'Signatures');
  const file = signaturesFolder.createFile(blob);

  const previousFileId = getSetting_(key, '');
  setSetting_(key, file.getId(), actorSession.userId);
  if (previousFileId) {
    try { DriveApp.getFileById(previousFileId).setTrashed(true); } catch (err) { /* already gone — nothing to clean up */ }
  }

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: new Date().toISOString(), UserId: actorSession.userId, Role: actorSession.role,
    Action: 'UPLOAD_SIGNATURE', Entity: 'SETTINGS', EntityId: key, PreviousState: previousFileId, NewState: file.getId()
  });

  return { key: key, fileId: file.getId(), url: 'https://drive.google.com/file/d/' + file.getId() + '/view' };
}

function getSignatures_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const result = {};
  Object.keys(SIGNATURE_SETTING_KEYS).forEach(function (key) {
    const fileId = getSetting_(key, '');
    result[key] = {
      label: SIGNATURE_SETTING_KEYS[key], fileId: fileId || null,
      url: fileId ? 'https://drive.google.com/file/d/' + fileId + '/view' : null
    };
  });
  return result;
}

function setFinancialLock_(actorSession, locked) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const now = new Date().toISOString();
  setSetting_('FinancialSettingsLocked', locked ? 'true' : 'false', actorSession.userId);
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: locked ? 'LOCK_FINANCIAL_SETTINGS' : 'UNLOCK_FINANCIAL_SETTINGS', Entity: 'SETTINGS',
    EntityId: 'FinancialSettingsLocked', PreviousState: '', NewState: locked ? 'true' : 'false'
  });
  return { financialSettingsLocked: locked };
}
