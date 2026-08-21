// Reports.gs — Phase 9: Admin dashboard, financial/food/accommodation/departure reports,
// college-wise final statement, and the audit log view. Read-only; no new sheets/columns.
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §24.

function getReportsBundle_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN]);

  const teams = rowsToObjects_('TEAMS');
  const charges = rowsToObjects_('CHARGES');
  const packages = rowsToObjects_('FOOD_PACKAGES');
  const entitlements = rowsToObjects_('MEAL_ENTITLEMENTS');
  const refunds = rowsToObjects_('REFUNDS');
  const securityRefunds = rowsToObjects_('SECURITY_REFUNDS');
  const rooms = rowsToObjects_('ROOMS');
  const allocations = rowsToObjects_('ACCOMMODATION').filter(function (a) { return a.Status === 'ALLOCATED'; });
  const nocRows = rowsToObjects_('ACCOMMODATION_NOC');
  const settlements = rowsToObjects_('SETTLEMENTS');
  const finalReceipts = rowsToObjects_('RECEIPTS').filter(function (r) { return r.Type === 'FINAL'; });
  const relieving = rowsToObjects_('RELIEVING');

  function byTeam(rows) {
    const map = {};
    rows.forEach(function (r) { (map[r.TeamId] = map[r.TeamId] || []).push(r); });
    return map;
  }
  function firstByTeam(rows) {
    const map = {};
    rows.forEach(function (r) { if (!map[r.TeamId]) map[r.TeamId] = r; });
    return map;
  }
  function sum(rows, field) { return rows.reduce(function (s, r) { return s + Number(r[field] || 0); }, 0); }

  const chargesByTeam = firstByTeam(charges);
  const packagesByTeam = byTeam(packages);
  const entitlementsByTeam = byTeam(entitlements);
  const refundsByTeam = byTeam(refunds);
  const securityRefundsByTeam = byTeam(securityRefunds);
  const allocationsByTeam = byTeam(allocations);
  const nocByTeam = firstByTeam(nocRows);
  const settlementByTeam = firstByTeam(settlements);
  const receiptByTeam = firstByTeam(finalReceipts);
  const relievingByTeam = firstByTeam(relieving);

  // --- Dashboard ---
  const teamsByStatus = {};
  teams.forEach(function (t) { teamsByStatus[t.Status] = (teamsByStatus[t.Status] || 0) + 1; });
  const teamRooms = rooms.filter(function (r) { return (r.RoomType || 'TEAM') === 'TEAM'; });
  const inchargeRooms = rooms.filter(function (r) { return r.RoomType === 'INCHARGE'; });
  function roomTotals(roomList) {
    const capacity = sum(roomList, 'Capacity');
    const roomIds = {};
    roomList.forEach(function (r) { roomIds[r.RoomId] = true; });
    const allocated = allocations.filter(function (a) { return roomIds[a.RoomId]; }).reduce(function (s, a) { return s + Number(a.PersonsAllocated); }, 0);
    return { capacity: capacity, allocated: allocated, remaining: capacity - allocated };
  }
  const nocGrantedCount = nocRows.filter(function (n) { return n.Status === 'NOC_GRANTED'; }).length;

  const dashboard = {
    totalTeams: teams.length, totalContingentPersons: sum(teams, 'TotalContingentPersons'),
    teamsByStatus: teamsByStatus, totalPackagesSold: packages.length, totalPackageRevenue: sum(packages, 'Amount'),
    totalDariCharges: sum(charges, 'DariCharges'), totalSecurityCollected: sum(charges, 'SecurityCharges'),
    totalFoodRefunds: sum(refunds, 'RefundAmount'), totalSecurityRefunds: sum(securityRefunds, 'Amount'),
    roomsTeam: roomTotals(teamRooms), roomsIncharge: roomTotals(inchargeRooms),
    nocGrantedCount: nocGrantedCount, nocPendingCount: teams.length - nocGrantedCount
  };

  // --- Financial (per team, every team, live) ---
  const financial = teams.map(function (t) {
    const c = chargesByTeam[t.TeamId] || null;
    const settlement = settlementByTeam[t.TeamId] || null;
    return {
      teamId: t.TeamId, registrationNumber: t.RegistrationNumber, collegeName: t.CollegeName,
      dariCharges: c ? Number(c.DariCharges) : 0, securityCharges: c ? Number(c.SecurityCharges) : 0,
      packageRevenue: sum(packagesByTeam[t.TeamId] || [], 'Amount'),
      foodRefund: sum(refundsByTeam[t.TeamId] || [], 'RefundAmount'),
      securityRefunded: sum(securityRefundsByTeam[t.TeamId] || [], 'Amount'),
      settled: !!settlement, finalBalance: settlement ? Number(settlement.FinalBalance) : null
    };
  });

  // --- Food (per team, MEAL_ENTITLEMENTS aggregated) ---
  const food = teams.map(function (t) {
    const ents = entitlementsByTeam[t.TeamId] || [];
    return {
      teamId: t.TeamId, registrationNumber: t.RegistrationNumber, collegeName: t.CollegeName,
      packagesCount: (packagesByTeam[t.TeamId] || []).length, packageRevenue: sum(packagesByTeam[t.TeamId] || [], 'Amount'),
      totalEligible: sum(ents, 'EligiblePersons'), totalServed: sum(ents, 'ServedPersons'),
      totalRemaining: sum(ents, 'RemainingPersons'), totalFoodRefund: sum(refundsByTeam[t.TeamId] || [], 'RefundAmount')
    };
  });

  // --- Accommodation (room list + per-team status) ---
  const accommodation = {
    rooms: rooms.map(function (r) {
      const roomAllocated = allocations.filter(function (a) { return a.RoomId === r.RoomId; }).reduce(function (s, a) { return s + Number(a.PersonsAllocated); }, 0);
      return {
        roomId: r.RoomId, roomNumber: r.RoomNumber, building: r.Building, roomType: r.RoomType || 'TEAM',
        capacity: Number(r.Capacity), allocated: roomAllocated, remaining: Number(r.Capacity) - roomAllocated, status: r.Status
      };
    }),
    teams: teams.map(function (t) {
      const teamAllocs = allocationsByTeam[t.TeamId] || [];
      const noc = nocByTeam[t.TeamId];
      return {
        teamId: t.TeamId, registrationNumber: t.RegistrationNumber, collegeName: t.CollegeName,
        teamMembersAllocated: teamAllocs.filter(function (a) { return a.SubjectType === 'TEAM'; }).reduce(function (s, a) { return s + Number(a.PersonsAllocated); }, 0),
        teamMembersNeeded: Number(t.NumberOfTeamMembers),
        inchargesAllocated: teamAllocs.filter(function (a) { return a.SubjectType === 'INCHARGE'; }).reduce(function (s, a) { return s + Number(a.PersonsAllocated); }, 0),
        nocStatus: noc ? noc.Status : 'PENDING'
      };
    })
  };

  // --- Departure pipeline ---
  const departure = teams.map(function (t) {
    return {
      teamId: t.TeamId, registrationNumber: t.RegistrationNumber, collegeName: t.CollegeName,
      status: t.Status, departureLockedBy: t.DepartureLockedBy || null
    };
  });

  // --- College-wise Final Statement (finalized settlements only) ---
  const collegeWiseFinalStatement = teams
    .filter(function (t) { return !!settlementByTeam[t.TeamId]; })
    .map(function (t) {
      const s = settlementByTeam[t.TeamId];
      const receipt = receiptByTeam[t.TeamId];
      const rel = relievingByTeam[t.TeamId];
      return {
        teamId: t.TeamId, registrationNumber: t.RegistrationNumber, collegeName: t.CollegeName,
        grossCharges: Number(s.GrossCharges), foodRefund: Number(s.FoodRefund), netCharges: Number(s.NetCharges),
        securityCollected: Number(s.SecurityCollected), securityRefunded: Number(s.SecurityRefunded),
        otherAdjustments: Number(s.OtherAdjustments), finalBalance: Number(s.FinalBalance), settledAt: s.SettledAt,
        receiptPdfUrl: receipt ? 'https://drive.google.com/file/d/' + receipt.PdfFileId + '/view' : null,
        relievingPdfUrl: rel ? 'https://drive.google.com/file/d/' + rel.PdfFileId + '/view' : null
      };
    });

  // --- Match Fee (spec §20/§9 — a separate stream, never merged into financial/
  // collegeWiseFinalStatement) ---
  const matchFeeTransactions = rowsToObjects_('MATCH_FEE_TRANSACTIONS');
  const matches = rowsToObjects_('MATCHES');
  const matchesById = {};
  matches.forEach(function (m) { matchesById[m.MatchId] = m; });
  const teamsById = {};
  teams.forEach(function (t) { teamsById[t.TeamId] = t; });

  const activeMatchFeeTx = matchFeeTransactions.filter(function (t) { return t.Status === 'ACTIVE'; });
  const matchFeeByMethod = { Cash: 0, Online: 0, Cheque: 0 };
  activeMatchFeeTx.forEach(function (t) { matchFeeByMethod[t.PaymentMethod] = (matchFeeByMethod[t.PaymentMethod] || 0) + Number(t.Amount); });

  let matchFeePendingCount = 0;
  matches.forEach(function (m) {
    [m.Team1Id, m.Team2Id].forEach(function (teamId) {
      const paid = activeMatchFeeTx.some(function (t) { return t.MatchId === m.MatchId && t.TeamId === teamId; });
      if (!paid) matchFeePendingCount++;
    });
  });

  const matchFee = {
    transactions: matchFeeTransactions.map(function (t) {
      const m = matchesById[t.MatchId];
      const payingTeam = teamsById[t.TeamId];
      const opponentTeam = teamsById[t.OpponentTeamId];
      return {
        transactionId: t.TransactionId, matchId: t.MatchId, matchNumber: m ? m.MatchNumber : '',
        matchDate: m ? m.MatchDate : '', payingTeam: payingTeam ? payingTeam.CollegeName : '',
        opponent: opponentTeam ? opponentTeam.CollegeName : '', amount: Number(t.Amount),
        receiptNumber: t.ReceiptNumber, paymentMethod: t.PaymentMethod, paidAt: t.PaidAt,
        collectedBy: t.CollectedBy, status: t.Status, emailStatus: t.EmailStatus
      };
    }),
    summary: {
      totalCollected: sum(activeMatchFeeTx, 'Amount'), matchesCount: matches.length,
      teamPaymentsCount: activeMatchFeeTx.length, pendingCount: matchFeePendingCount,
      cashCollected: matchFeeByMethod.Cash, onlineCollected: matchFeeByMethod.Online, chequeCollected: matchFeeByMethod.Cheque
    }
  };
  dashboard.matchFeeCollected = matchFee.summary.totalCollected;
  dashboard.matchFeePending = matchFee.summary.pendingCount;
  dashboard.matchFeeTeamPayments = matchFee.summary.teamPaymentsCount;
  dashboard.matchFeeReceiptsGenerated = activeMatchFeeTx.filter(function (t) { return !!t.ReceiptPdfFileId; }).length;

  return {
    dashboard: dashboard, financial: financial, food: food, accommodation: accommodation,
    departure: departure, collegeWiseFinalStatement: collegeWiseFinalStatement, matchFee: matchFee
  };
}

// Admin sees every row; any other role is scoped to their own UserId (spec §12's "own actions
// only" row) — enforced here even though no other role's nav currently reaches an Audit Log
// screen, matching this project's "the frontend hiding a button is never the enforcement
// point" convention (spec §6).
function getAuditLog_(actorSession, limit) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS, ROLES.ACCOMMODATION]);
  const cap = Math.min(parseInt(limit, 10) || 200, 500);
  let rows = rowsToObjects_('AUDIT_LOG');
  if (actorSession.role !== ROLES.ADMIN) {
    rows = rows.filter(function (r) { return r.UserId === actorSession.userId; });
  }
  rows.sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return rows.slice(0, cap);
}
