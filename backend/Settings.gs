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
    financialSettingsLocked: getSetting_('FinancialSettingsLocked', 'false')
  };
}

function updateRates_(actorSession, rates) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (getSetting_('FinancialSettingsLocked', 'false') === 'true') {
    throw apiError_('SETTINGS_LOCKED', 'Financial settings are locked. Unlock before changing rates.');
  }
  ['breakfast', 'lunch', 'dinner', 'dari', 'security'].forEach(function (key) {
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
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'UPDATE_RATES', Entity: 'SETTINGS', EntityId: 'RATES', PreviousState: '', NewState: JSON.stringify(rates)
  });
  return getRegistrationInfo_(actorSession);
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
