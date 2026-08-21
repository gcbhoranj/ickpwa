// Departure.gs — Phase 7: departure-lock lifecycle, food refund, security refund.
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §22.
// No SETTLEMENTS row here — that's Phase 8's job (final receipt generation).

function _requireDepartureLockHeldByCaller_(actorSession, team) {
  _requireDepartureInitiated_(team);
  if (team.values.DepartureLockedBy !== actorSession.userId && actorSession.role !== ROLES.ADMIN) {
    throw apiError_('DEPARTURE_LOCKED', 'Departure processing is already in progress by ' + team.values.DepartureLockedBy + '.');
  }
}

// Weaker than _requireDepartureLockHeldByCaller_ -- just "departure is underway", not "you're
// the one who started it." Used by recordFoodRefund_: the Mess Committee (spec correction
// 2026-08-20 -- refund authority is Mess's, not Registration's) never calls
// initiateDeparture_, so it can never satisfy the same-locking-user check, but the refund
// should still only be enterable once Registration has actually started that team's
// departure.
function _requireDepartureInitiated_(team) {
  if (!team.values.DepartureLockedBy) {
    throw apiError_('DEPARTURE_NOT_INITIATED', 'Departure has not been initiated for this team yet.');
  }
}

function initiateDeparture_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    if (team.values.DepartureLockedBy && team.values.DepartureLockedBy !== actorSession.userId) {
      throw apiError_('DEPARTURE_LOCKED', 'Departure processing is already in progress by ' + team.values.DepartureLockedBy + '.');
    }
    if (team.values.DepartureLockedBy === actorSession.userId) {
      return { teamId: teamId, departureLockedBy: actorSession.userId, resumed: true };
    }
    const now = new Date().toISOString();
    updateRowById_('TEAMS', 'TeamId', teamId, { DepartureLockedBy: actorSession.userId, DepartureLockedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'INITIATE_DEPARTURE', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: 'DEPARTURE_INITIATED'
    });
    return { teamId: teamId, departureLockedBy: actorSession.userId, resumed: false };
  } finally {
    lock.releaseLock();
  }
}

function cancelDeparture_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    if (!team.values.DepartureLockedBy) {
      return { teamId: teamId, cancelled: true }; // idempotent: nothing to cancel
    }
    if (team.values.DepartureLockedBy !== actorSession.userId && actorSession.role !== ROLES.ADMIN) {
      throw apiError_('FORBIDDEN', 'Only ' + team.values.DepartureLockedBy + ' or an Admin can cancel this departure.');
    }
    const now = new Date().toISOString();
    updateRowById_('TEAMS', 'TeamId', teamId, { DepartureLockedBy: '', DepartureLockedAt: '', UpdatedBy: actorSession.userId, UpdatedAt: now });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'CANCEL_DEPARTURE', Entity: 'TEAM', EntityId: teamId, PreviousState: 'DEPARTURE_INITIATED', NewState: ''
    });
    return { teamId: teamId, cancelled: true };
  } finally {
    lock.releaseLock();
  }
}

// Shared by getDepartureOverview_ (Registration/Admin) and getFoodRefundOverview_ (Mess/Admin)
// so the Eligible/Served/Remaining/suggestedRefund view can never drift between the two roles
// who both need to look at the same entitlement rows.
function _mapEntitlementsForOverview_(teamId) {
  const refunds = findRowsByField_('REFUNDS', 'TeamId', teamId);
  const refundedEntitlementIds = {};
  refunds.forEach(function (r) { refundedEntitlementIds[r.EntitlementId] = true; });
  const entitlements = findRowsByField_('MEAL_ENTITLEMENTS', 'TeamId', teamId).map(function (e) {
    const alreadyRefunded = !!refundedEntitlementIds[e.EntitlementId];
    return {
      entitlementId: e.EntitlementId, meal: e.Meal, date: e.Date, rate: Number(e.Rate),
      eligiblePersons: Number(e.EligiblePersons), servedPersons: Number(e.ServedPersons),
      remainingPersons: Number(e.RemainingPersons), mealOrderStatus: e.MealOrderStatus,
      alreadyRefunded: alreadyRefunded,
      // A hint only, never written anywhere or auto-applied — refund amount stays the Mess
      // Convener's manual judgment call per the Phase 7 decision (spec §22, authority
      // corrected 2026-08-20 to actually match that decision — see recordFoodRefund_). Lets
      // the operator see what "fully unused" would amount to instead of guessing from the raw
      // Eligible/Served/Remaining columns.
      suggestedRefund: alreadyRefunded ? 0 : Number(e.RemainingPersons) * Number(e.Rate)
    };
  });
  return { entitlements: entitlements, refunds: refunds };
}

function getDepartureOverview_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const mapped = _mapEntitlementsForOverview_(teamId);
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId)[0] || null;
  const nocStatus = getNocStatus_(actorSession, teamId);

  return {
    team: team.values,
    incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
    packages: findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId),
    entitlements: mapped.entitlements,
    securityCharged: charges ? Number(charges.SecurityCharges) : 0,
    refunds: mapped.refunds,
    securityRefunds: findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId),
    nocStatus: nocStatus.status,
    departureLockedBy: team.values.DepartureLockedBy || null,
    settlementPreview: _computeSettlementPreview_(teamId)
  };
}

// Mess Committee's own read path to the entitlement/refund data they now act on (correction
// 2026-08-20 — see recordFoodRefund_). Deliberately narrower than getDepartureOverview_: no
// charges/security/settlement preview, matching the redaction philosophy already established
// for MESS in getTeamDetail_ (spec §20/§21) — Mess needs Eligible/Served/Remaining and
// what's already been refunded, nothing about money it has no say over.
function getFoodRefundOverview_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.MESS]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const mapped = _mapEntitlementsForOverview_(teamId);

  return {
    team: { TeamId: team.values.TeamId, RegistrationNumber: team.values.RegistrationNumber, CollegeName: team.values.CollegeName, Status: team.values.Status },
    departureLockedBy: team.values.DepartureLockedBy || null,
    entitlements: mapped.entitlements,
    refunds: mapped.refunds
  };
}

// Nights THIS TEAM actually stayed — registration date to relieving date, not the tournament's
// fixed dates (correction 2026-08-21: a team that registers 21 Sep and is relieved 23 Sep owes
// Dari for 2 nights, regardless of the tournament's own 21-25 Sep span, whether it stays the
// full event or leaves early after a loss). `relievingDateOverride` is the operator-entered
// 'yyyy-MM-dd' from the finalize form when it's known (finalizeDepartureAndGenerateDocuments_);
// omitted for the live pre-finalize preview (getDepartureOverview_), which estimates using
// today's date instead — the finalize form's own Relieving Date field also defaults to today,
// so this matches in the common same-day case and only goes stale if the operator picks a
// different date, same as every other "hint" this screen already shows.
function _teamStayNights_(team, relievingDateOverride) {
  const regDateStr = Utilities.formatDate(new Date(team.values.RegistrationDateTime), 'Asia/Kolkata', 'yyyy-MM-dd');
  const relieveDateStr = relievingDateOverride || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const nights = Math.round((new Date(relieveDateStr + 'T00:00:00Z') - new Date(regDateStr + 'T00:00:00Z')) / 86400000);
  return nights > 0 ? nights : 0;
}

// Shared by getDepartureOverview_ (live preview, no persistence, no relievingDate yet) and
// finalizeDepartureAndGenerateDocuments_ (FinalDocuments.gs, same math, persisted, passes the
// real operator-entered relievingDate) — kept in one place so the preview the operator sees
// can never drift from what finalize actually computes.
function _computeSettlementPreview_(teamId, relievingDateOverride) {
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId)[0] || null;
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  const packages = findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId);
  const grossMealCharges = packages.reduce(function (sum, p) { return sum + Number(p.Amount); }, 0);
  // Dari Charges are always included in the final settlement regardless of whether they were
  // ticked at registration (correction 2026-08-20) — auto-calculated as rate x team members x
  // nights THIS TEAM stayed (correction 2026-08-21 — see _teamStayNights_), using the rate
  // snapshotted at registration (rate-locking, spec §19) if this team has a CHARGES row, else
  // the live RateDari setting as a fallback for a team whose charges haven't been calculated
  // yet.
  const rateDari = charges ? Number(charges.RateDariSnapshot) : Number(getSetting_('RateDari', '0'));
  const numberOfTeamMembers = team ? Number(team.values.NumberOfTeamMembers) : 0;
  const nights = team ? _teamStayNights_(team, relievingDateOverride) : 0;
  const grossDariCharges = rateDari * numberOfTeamMembers * nights;
  const foodRefund = findRowsByField_('REFUNDS', 'TeamId', teamId).reduce(function (sum, r) { return sum + Number(r.RefundAmount); }, 0);
  const securityCollected = charges ? Number(charges.SecurityCharges) : 0;
  const securityRefundRow = findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId)[0];
  const securityRefunded = securityRefundRow ? Number(securityRefundRow.Amount) : 0;
  const grossCharges = grossMealCharges + grossDariCharges;
  return {
    grossMealCharges: grossMealCharges, grossDariCharges: grossDariCharges, grossCharges: grossCharges,
    foodRefund: foodRefund, netCharges: grossCharges - foodRefund,
    securityCollected: securityCollected, securityRefunded: securityRefunded
  };
}

// entries with a zero/blank amount are silently skipped (the operator simply left that row
// alone), not treated as errors — matches the manual, per-row nature of this action.
// Correction 2026-08-20: refund authority for unused meal coupons belongs to the Mess
// Committee, not Registration -- Registration still initiates/holds the departure lock and
// still sees this data as reference (getDepartureOverview_, unchanged), but only Mess/Admin
// may actually record the amount now.
function recordFoodRefund_(actorSession, teamId, entries) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.MESS]);
  if (!entries || entries.length === 0) throw apiError_('VALIDATION_ERROR', 'At least one refund entry is required.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    _requireDepartureInitiated_(team);

    const created = [];
    const now = new Date().toISOString();
    entries.forEach(function (entry) {
      const amount = Number(entry.amount);
      if (!amount || amount <= 0) return;
      const entitlement = findRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', entry.entitlementId);
      if (!entitlement || entitlement.values.TeamId !== teamId) {
        throw apiError_('NOT_FOUND', 'No such entitlement for this team: ' + entry.entitlementId);
      }
      const existing = findRowsByField_('REFUNDS', 'EntitlementId', entry.entitlementId)[0];
      if (existing) throw apiError_('ALREADY_REFUNDED', 'Entitlement ' + entry.entitlementId + ' has already been refunded.');

      const refundId = nextId_('REF', 5);
      appendRow_('REFUNDS', {
        RefundId: refundId, TeamId: teamId, EntitlementId: entry.entitlementId,
        Meal: entitlement.values.Meal, Date: entitlement.values.Date,
        EligiblePersons: entitlement.values.EligiblePersons, ServedPersons: entitlement.values.ServedPersons,
        MealOrderStatusAtCalc: entitlement.values.MealOrderStatus,
        RefundablePersons: Number(entitlement.values.EligiblePersons) - Number(entitlement.values.ServedPersons),
        RefundAmount: amount, CalculatedAt: now, ProcessedAt: now, ProcessedBy: actorSession.userId
      });
      created.push(refundId);
    });

    if (created.length > 0) {
      updateRowById_('TEAMS', 'TeamId', teamId, { Status: 'REFUND_PROCESSING', UpdatedBy: actorSession.userId, UpdatedAt: now });
      appendRow_('AUDIT_LOG', {
        AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
        Action: 'RECORD_FOOD_REFUND', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: created.join(',')
      });
    }
    return { teamId: teamId, refundIds: created };
  } finally {
    lock.releaseLock();
  }
}

function recordSecurityRefund_(actorSession, teamId, amount) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const refundAmount = Number(amount);
  if (!refundAmount || refundAmount <= 0) throw apiError_('VALIDATION_ERROR', 'Refund amount must be greater than 0.');

  const nocStatus = getNocStatus_(actorSession, teamId);
  if (nocStatus.status !== 'NOC_GRANTED') {
    throw apiError_('SECURITY_GATED_ON_NOC', 'Security refund requires the Accommodation NOC to be granted first.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    _requireDepartureLockHeldByCaller_(actorSession, team);

    const existing = findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId)[0];
    if (existing) throw apiError_('ALREADY_REFUNDED', 'A security refund has already been recorded for this team.');

    const nocRow = findRowsByField_('ACCOMMODATION_NOC', 'TeamId', teamId)[0];
    const securityRefundId = nextId_('SREF', 4);
    const now = new Date().toISOString();
    appendRow_('SECURITY_REFUNDS', {
      SecurityRefundId: securityRefundId, TeamId: teamId, Amount: refundAmount,
      NocId: nocRow ? nocRow.NocId : '', RefundedAt: now, RefundedBy: actorSession.userId, Ticked: 'true'
    });
    updateRowById_('TEAMS', 'TeamId', teamId, { Status: 'REFUND_PROCESSING', UpdatedBy: actorSession.userId, UpdatedAt: now });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'RECORD_SECURITY_REFUND', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: securityRefundId
    });
    return { teamId: teamId, securityRefundId: securityRefundId, amount: refundAmount };
  } finally {
    lock.releaseLock();
  }
}
