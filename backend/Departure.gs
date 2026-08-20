// Departure.gs — Phase 7: departure-lock lifecycle, food refund, security refund.
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §22.
// No SETTLEMENTS row here — that's Phase 8's job (final receipt generation).

function _requireDepartureLockHeldByCaller_(actorSession, team) {
  if (!team.values.DepartureLockedBy) {
    throw apiError_('DEPARTURE_NOT_INITIATED', 'Departure has not been initiated for this team yet.');
  }
  if (team.values.DepartureLockedBy !== actorSession.userId && actorSession.role !== ROLES.ADMIN) {
    throw apiError_('DEPARTURE_LOCKED', 'Departure processing is already in progress by ' + team.values.DepartureLockedBy + '.');
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

function getDepartureOverview_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const refunds = findRowsByField_('REFUNDS', 'TeamId', teamId);
  const refundedEntitlementIds = {};
  refunds.forEach(function (r) { refundedEntitlementIds[r.EntitlementId] = true; });
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId)[0] || null;
  const nocStatus = getNocStatus_(actorSession, teamId);

  return {
    team: team.values,
    incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
    packages: findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId),
    entitlements: findRowsByField_('MEAL_ENTITLEMENTS', 'TeamId', teamId).map(function (e) {
      return {
        entitlementId: e.EntitlementId, meal: e.Meal, date: e.Date, rate: Number(e.Rate),
        eligiblePersons: Number(e.EligiblePersons), servedPersons: Number(e.ServedPersons),
        remainingPersons: Number(e.RemainingPersons), mealOrderStatus: e.MealOrderStatus,
        alreadyRefunded: !!refundedEntitlementIds[e.EntitlementId]
      };
    }),
    securityCharged: charges ? Number(charges.SecurityCharges) : 0,
    refunds: refunds,
    securityRefunds: findRowsByField_('SECURITY_REFUNDS', 'TeamId', teamId),
    nocStatus: nocStatus.status,
    departureLockedBy: team.values.DepartureLockedBy || null,
    settlementPreview: _computeSettlementPreview_(teamId)
  };
}

// Shared by getDepartureOverview_ (live preview, no persistence) and
// finalizeDepartureAndGenerateDocuments_ (FinalDocuments.gs, same math, persisted) — kept in
// one place so the preview the operator sees can never drift from what finalize actually
// computes.
function _computeSettlementPreview_(teamId) {
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId)[0] || null;
  const packages = findRowsByField_('FOOD_PACKAGES', 'TeamId', teamId);
  const grossMealCharges = packages.reduce(function (sum, p) { return sum + Number(p.Amount); }, 0);
  const grossDariCharges = charges ? Number(charges.DariCharges) : 0;
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
function recordFoodRefund_(actorSession, teamId, entries) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!entries || entries.length === 0) throw apiError_('VALIDATION_ERROR', 'At least one refund entry is required.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const team = findRowById_('TEAMS', 'TeamId', teamId);
    if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
    _requireDepartureLockHeldByCaller_(actorSession, team);

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
