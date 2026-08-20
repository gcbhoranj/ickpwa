// Registration.gs — team + contingent incharges registration.

function registerTeam_(actorSession, collegeName, districtName, numberOfTeamMembers, incharges) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!collegeName) throw apiError_('VALIDATION_ERROR', 'College name is required.');
  if (!districtName) throw apiError_('VALIDATION_ERROR', 'District name is required.');
  const members = parseInt(numberOfTeamMembers, 10);
  if (!members || members < 1) throw apiError_('VALIDATION_ERROR', 'Number of team members must be at least 1.');
  if (!incharges || incharges.length === 0) throw apiError_('VALIDATION_ERROR', 'At least one contingent incharge is required.');
  incharges.forEach(function (inc) {
    if (!inc.name) throw apiError_('VALIDATION_ERROR', 'Every incharge needs a name.');
  });

  const hasPrimary = incharges.some(function (inc) { return !!inc.isPrimary; });
  const totalContingent = members + incharges.length;
  const teamId = nextId_('TEAM', 4);
  const registrationNumber = nextDocumentNumber_('Registration');
  const now = new Date().toISOString();

  appendRow_('TEAMS', {
    TeamId: teamId, RegistrationNumber: registrationNumber, CollegeName: collegeName, DistrictName: districtName,
    NumberOfTeamMembers: members, NumberOfContingentIncharges: incharges.length, TotalContingentPersons: totalContingent,
    RegistrationDateTime: now, Status: 'REGISTERED', DepartureLockedBy: '', DepartureLockedAt: '',
    CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });

  incharges.forEach(function (inc, i) {
    appendRow_('CONTINGENT_INCHARGES', {
      InchargeId: nextId_('INC', 4), TeamId: teamId, Name: inc.name, Designation: inc.designation || '',
      WhatsAppNumber: inc.whatsapp || '', EmailAddress: inc.email || '',
      IsPrimary: (hasPrimary ? !!inc.isPrimary : i === 0) ? 'true' : 'false', Active: 'true',
      NeedsAccommodation: inc.needsAccommodation ? 'true' : 'false',
      CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
    });
  });

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'REGISTER_TEAM', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: 'REGISTERED'
  });

  return { teamId: teamId, registrationNumber: registrationNumber, totalContingentPersons: totalContingent };
}

// `includeDari`/`includeSecurity`: the Registration operator's checkboxes for this team —
// default to included (`!== false`) so existing callers that don't pass them (older frontend
// builds, existing tests) keep the original always-charge behavior. An item left unticked is
// calculated as 0, which Receipts.gs's generateTemporaryReceipt_ then reads as "leave this
// line off the receipt entirely" rather than printing it as "Rs 0".
function calculateCharges_(actorSession, teamId, includeDari, includeSecurity) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  const existing = findRowsByField_('CHARGES', 'TeamId', teamId);
  if (existing.length > 0) {
    throw apiError_('ALREADY_CALCULATED', 'Charges have already been calculated for this team.');
  }

  const rateDari = Number(getSetting_('RateDari', '0'));
  const rateBreakfast = Number(getSetting_('RateBreakfast', '0'));
  const rateLunch = Number(getSetting_('RateLunch', '0'));
  const rateDinner = Number(getSetting_('RateDinner', '0'));
  const securityAmount = Number(getSetting_('SecurityAmount', '0'));

  const dariCharges = includeDari !== false ? rateDari * Number(team.values.NumberOfTeamMembers) : 0;
  const securityCharges = includeSecurity !== false ? securityAmount : 0;
  const totalPayable = dariCharges + securityCharges;
  const chargeId = nextId_('CHG', 4);
  const now = new Date().toISOString();

  appendRow_('CHARGES', {
    ChargeId: chargeId, TeamId: teamId, RateBreakfastSnapshot: rateBreakfast, RateLunchSnapshot: rateLunch,
    RateDinnerSnapshot: rateDinner, RateDariSnapshot: rateDari, SecurityAmountSnapshot: securityAmount,
    DariCharges: dariCharges, MealCharges: 0, SecurityCharges: securityCharges, TotalPayable: totalPayable,
    CalculatedAt: now, CreatedBy: actorSession.userId
  });

  return {
    chargeId: chargeId, dariCharges: dariCharges, securityCharges: securityCharges, totalPayable: totalPayable,
    totalContingentPersons: Number(team.values.TotalContingentPersons)
  };
}

function recordPayment_(actorSession, teamId, mode) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!mode) throw apiError_('VALIDATION_ERROR', 'Payment mode is required.');
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId);
  if (charges.length === 0) throw apiError_('NOT_FOUND', 'Charges have not been calculated yet for this team.');
  const charge = charges[0];

  const existingPayments = findRowsByField_('PAYMENTS', 'TeamId', teamId).filter(function (p) { return p.Purpose === 'REGISTRATION_CHARGES'; });
  if (existingPayments.length > 0) {
    throw apiError_('ALREADY_PAID', 'Registration payment has already been recorded for this team.');
  }

  const now = new Date().toISOString();
  const dariPaymentId = nextId_('PAY', 4);
  appendRow_('PAYMENTS', {
    PaymentId: dariPaymentId, TeamId: teamId, Amount: charge.DariCharges, Mode: mode, ReceivedAt: now,
    Purpose: 'REGISTRATION_CHARGES', ReversalOf: '', CreatedBy: actorSession.userId, CreatedAt: now
  });
  const securityPaymentId = nextId_('PAY', 4);
  appendRow_('PAYMENTS', {
    PaymentId: securityPaymentId, TeamId: teamId, Amount: charge.SecurityCharges, Mode: mode, ReceivedAt: now,
    Purpose: 'SECURITY', ReversalOf: '', CreatedBy: actorSession.userId, CreatedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'RECORD_PAYMENT', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: mode
  });

  return {
    dariPaymentId: dariPaymentId, securityPaymentId: securityPaymentId,
    totalReceived: Number(charge.DariCharges) + Number(charge.SecurityCharges)
  };
}

function listTeams_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS, ROLES.ACCOMMODATION]);
  return rowsToObjects_('TEAMS').map(function (t) {
    return {
      teamId: t.TeamId, registrationNumber: t.RegistrationNumber, collegeName: t.CollegeName,
      districtName: t.DistrictName, totalContingentPersons: t.TotalContingentPersons, status: t.Status,
      registrationDateTime: t.RegistrationDateTime
    };
  });
}

function getTeamDetail_(actorSession, teamId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS, ROLES.ACCOMMODATION]);
  const team = findRowById_('TEAMS', 'TeamId', teamId);
  if (!team) throw apiError_('NOT_FOUND', 'No such team: ' + teamId);
  // Mess sells packages, Accommodation searches teams to grant NOC — both need team
  // identity/incharges but never Dari/security/total-payable figures or the temporary
  // receipt (spec §20/§21, narrowing the shared read endpoint's field visibility rather
  // than duplicating the handler).
  if (actorSession.role === ROLES.MESS || actorSession.role === ROLES.ACCOMMODATION) {
    return {
      team: team.values,
      incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
      charges: null, payments: [], receipts: []
    };
  }
  const charges = findRowsByField_('CHARGES', 'TeamId', teamId);
  return {
    team: team.values,
    incharges: findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId),
    charges: charges.length > 0 ? charges[0] : null,
    payments: findRowsByField_('PAYMENTS', 'TeamId', teamId),
    receipts: findRowsByField_('RECEIPTS', 'TeamId', teamId)
  };
}
