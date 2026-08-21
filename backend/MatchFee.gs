// MatchFee.gs — Match Fee Collection: match identity, per-team payment transactions, their
// receipts, resend, and void. Completely separate financial stream from Registration/Dari/
// Security/Food — never enters SETTLEMENTS or RECEIPTS(Type=FINAL).
// Spec: docs/superpowers/specs/2026-08-21-match-fee-collection-design.md

function createMatch_(actorSession, team1Id, team2Id, matchDate) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  if (!team1Id || !team2Id) throw apiError_('VALIDATION_ERROR', 'Both teams are required.');
  if (team1Id === team2Id) throw apiError_('VALIDATION_ERROR', 'Team 1 and Team 2 must be different teams.');
  const team1 = findRowById_('TEAMS', 'TeamId', team1Id);
  if (!team1) throw apiError_('NOT_FOUND', 'No such team: ' + team1Id);
  const team2 = findRowById_('TEAMS', 'TeamId', team2Id);
  if (!team2) throw apiError_('NOT_FOUND', 'No such team: ' + team2Id);
  if (!matchDate) throw apiError_('VALIDATION_ERROR', 'Match date is required.');

  const matchId = nextId_('MATCH', 4);
  const matchNumber = nextDocumentNumber_('Match');
  const now = new Date().toISOString();
  appendRow_('MATCHES', {
    MatchId: matchId, MatchNumber: matchNumber, MatchDate: matchDate, Team1Id: team1Id, Team2Id: team2Id,
    Status: 'SCHEDULED', CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });
  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'CREATE_MATCH', Entity: 'MATCH', EntityId: matchId, PreviousState: '', NewState: 'SCHEDULED'
  });
  return { matchId: matchId, matchNumber: matchNumber, matchDate: matchDate, team1Id: team1Id, team2Id: team2Id };
}

// Live-computed team-side status for one match — never cached on MATCHES (spec §2.1: avoids
// a second place this could drift from MATCH_FEE_TRANSACTIONS, the source of truth). "Has
// this team paid" always means "does an ACTIVE row exist for (matchId, teamId)" — the same
// invariant collectMatchFee_ enforces at write time.
function _matchTeamSideStatus_(matchId, teamId) {
  const active = findRowsByField_('MATCH_FEE_TRANSACTIONS', 'MatchId', matchId)
    .filter(function (t) { return t.TeamId === teamId && t.Status === 'ACTIVE'; })[0] || null;
  return {
    status: active ? 'PAID' : 'PENDING',
    transactionId: active ? active.TransactionId : null,
    receiptNumber: active ? active.ReceiptNumber : null,
    receiptPdfFileId: active ? active.ReceiptPdfFileId : null,
    paymentMethod: active ? active.PaymentMethod : null,
    paidAt: active ? active.PaidAt : null,
    amount: active ? Number(active.Amount) : null,
    emailStatus: active ? active.EmailStatus : null
  };
}

function _matchSummary_(m) {
  const team1 = findRowById_('TEAMS', 'TeamId', m.Team1Id);
  const team2 = findRowById_('TEAMS', 'TeamId', m.Team2Id);
  return {
    matchId: m.MatchId, matchNumber: m.MatchNumber, matchDate: m.MatchDate, status: m.Status,
    team1: { teamId: m.Team1Id, collegeName: team1 ? team1.values.CollegeName : '(team removed)' },
    team2: { teamId: m.Team2Id, collegeName: team2 ? team2.values.CollegeName : '(team removed)' },
    team1Status: _matchTeamSideStatus_(m.MatchId, m.Team1Id),
    team2Status: _matchTeamSideStatus_(m.MatchId, m.Team2Id),
    matchFeeRate: Number(getSetting_('MatchFeeRate', '0'))
  };
}

function listMatches_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  return rowsToObjects_('MATCHES').map(_matchSummary_);
}

function getMatchDetail_(actorSession, matchId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const match = findRowById_('MATCHES', 'MatchId', matchId);
  if (!match) throw apiError_('NOT_FOUND', 'No such match: ' + matchId);
  return _matchSummary_(match.values);
}
