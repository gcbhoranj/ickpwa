// Main.gs — single HTTP entry point, response envelope, action table.

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function parseBody_(e) {
  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (parseErr) {
      throw apiError_('BAD_REQUEST', 'Request body is not valid JSON.');
    }
  }
  return { action: (e.parameter && e.parameter.action) || 'system.ping', payload: {} };
}

// action -> handler(payload, session). session is null for public actions.
const ACTIONS = {
  'system.ping': function () {
    return { pong: true, serverTime: new Date().toISOString() };
  },
  // Read-only diagnostic, kept permanently — reads the live coupon templates' actual current
  // page size without modifying anything. Useful for confirming the one-time manual Slides
  // UI resize (File > Page setup > Custom size) documented in CouponDocuments.gs actually
  // took effect on the live templates, since there is no programmatic way to check or set
  // this (confirmed live 2026-08-19 — see that file's header comment).
  'system.diagQrMatrix': function (payload) {
    const token = (payload && payload.token) || 'DIAGTEST12AB';
    const qr = qrEncode_(token);
    return { token: token, size: qr.size, matrix: qr.matrix };
  },
  // Read-only diagnostic for the reported "coupon emails aren't reaching incharges" issue —
  // no session needed (same convention as the other system.diag* actions), reads real
  // EMAIL_LOG rows so the actual Status/ErrorMessage from a real send attempt is visible
  // without needing to log in as a committee user. `payload.limit` caps how many of the most
  // recent rows come back (default 20).
  'system.diagEmailLog': function (payload) {
    const rows = rowsToObjects_('EMAIL_LOG');
    const limit = (payload && payload.limit) || 20;
    const recent = rows.slice(Math.max(0, rows.length - limit));
    const byStatus = {};
    rows.forEach(function (r) { byStatus[r.Status] = (byStatus[r.Status] || 0) + 1; });
    return { totalRows: rows.length, countsByStatus: byStatus, recent: recent };
  },
  'system.diagCouponTemplateSizes': function () {
    const templatesFolder = _ensureSubfolder_(_getRootFolder_(), 'Templates');
    function sizeOf(name) {
      const it = templatesFolder.getFilesByName(name);
      if (!it.hasNext()) return { name: name, found: false };
      const file = it.next();
      const pres = SlidesApp.openById(file.getId());
      return { name: name, found: true, widthPt: pres.getPageWidth(), heightPt: pres.getPageHeight() };
    }
    return {
      digital: sizeOf('Digital Coupon Template'),
      printed: sizeOf('Printed Coupon Sheet Template')
    };
  },
  'system.selfTest': function () {
    if (getSetting_('AllowSelfTest', 'false') !== 'true') {
      throw apiError_('FORBIDDEN', 'Self-test is disabled.');
    }
    return runAllTests_();
  },
  // Since Phase 4, the full test suite no longer reliably completes inside one Apps Script
  // execution (see dev-log). Tests are grouped by TEST_CASES' `tier` property into buckets
  // sized to comfortably clear the 6-minute ceiling on their own: default/omitted ("fast")
  // for ordinary tests, 'pdf1'/'pdf2' for real Slides/Drive document generation (~30-40s
  // each — split across two tiers, 'pdf' alone already outgrew the ceiling once), 'mess' for
  // Sheets-only fixture-heavy tests (several sequential API round trips, no PDF). payload.only
  // selects a tier; omit it for the fast tier. This has already needed rebalancing four times
  // as the suite grew (see dev-log) — payload.name runs exactly one named test regardless of
  // tier, a permanent escape hatch for verifying a single test (or a tier that's grown past
  // the ceiling again) without another rebalance. Same AllowSelfTest gate and non-production
  // intent as system.selfTest.
  'system.selfTestSplit': function (payload) {
    if (getSetting_('AllowSelfTest', 'false') !== 'true') {
      throw apiError_('FORBIDDEN', 'Self-test is disabled.');
    }
    let cases;
    if (payload && payload.name) {
      cases = TEST_CASES.filter(function (tc) { return tc.name === payload.name; });
      if (cases.length === 0) throw apiError_('NOT_FOUND', 'No such test: ' + payload.name);
    } else {
      const wantTier = (payload && payload.only) || 'fast';
      cases = TEST_CASES.filter(function (tc) { return (tc.tier || 'fast') === wantTier; });
    }
    const results = cases.map(function (testCase) {
      try {
        testCase.fn();
        return { name: testCase.name, status: 'PASS' };
      } catch (err) {
        return { name: testCase.name, status: 'FAIL', error: err.message };
      }
    });
    const passCount = results.filter(function (r) { return r.status === 'PASS'; }).length;
    return { summary: passCount + '/' + results.length + ' passed', results: results };
  },
  'admin.bootstrap.setupSchema': function (payload, sessionId) {
    requireRole_(requireSession_(sessionId), [ROLES.ADMIN]);
    return { sheetsEnsured: setupSchema_() };
  },
  'admin.bootstrap.seedSettings': function (payload, sessionId) {
    requireRole_(requireSession_(sessionId), [ROLES.ADMIN]);
    return { keysSeeded: seedSettings_() };
  },
  'admin.bootstrap.setupDriveFolders': function (payload, sessionId) {
    requireRole_(requireSession_(sessionId), [ROLES.ADMIN]);
    return setupDriveFolders_();
  },
  'admin.bootstrap.seedFirstAdmin': function (payload) {
    return seedFirstAdmin_(payload.name, payload.email, payload.password);
  },
  'auth.login': function (payload) {
    return handleLogin_(payload.identifier, payload.password);
  },
  // Public (no session) — the login screen needs the live tournament name/dates before a user
  // has authenticated. See getPublicTournamentInfo_'s header comment for why this is safe.
  'public.getTournamentInfo': function () {
    return getPublicTournamentInfo_();
  },
  'auth.logout': function (payload, sessionId) {
    requireSession_(sessionId);
    revokeSession_(sessionId);
    return { loggedOut: true };
  },
  'auth.whoami': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    const user = findRowById_('USERS', 'UserId', session.userId).values;
    return { userId: user.UserId, name: user.Name, role: user.Role, email: user.Email, loginId: user.LoginId };
  },
  'admin.users.create': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createUser_(session, payload.name, payload.role, payload.loginId, payload.email, payload.password);
  },
  'admin.users.list': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { users: listUsers_(session) };
  },
  'admin.users.setActive': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return setUserActive_(session, payload.userId, !!payload.active);
  },
  'admin.settings.updateRates': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return updateRates_(session, payload);
  },
  'admin.settings.setFinancialLock': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return setFinancialLock_(session, !!payload.locked);
  },
  'admin.settings.uploadSignature': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return uploadSignature_(session, payload.key, payload.base64Data, payload.mimeType);
  },
  'admin.settings.getSignatures': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getSignatures_(session);
  },
  'settings.getRegistrationInfo': function (payload, sessionId) {
    requireSession_(sessionId);
    return getRegistrationInfo_(null);
  },
  'admin.settings.getMealTimings': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getMealTimings_(session);
  },
  'admin.settings.updateMealTimings': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return updateMealTimings_(session, payload);
  },
  'matchfee.match.create': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createMatch_(session, payload.team1Id, payload.team2Id, payload.matchDate);
  },
  'matchfee.match.list': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { matches: listMatches_(session) };
  },
  'matchfee.match.detail': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getMatchDetail_(session, payload.matchId);
  },
  'registration.team.create': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return registerTeam_(session, payload.collegeName, payload.districtName, payload.numberOfTeamMembers, payload.incharges || []);
  },
  'registration.charges.calculate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return calculateCharges_(session, payload.teamId, payload.includeDari, payload.includeSecurity);
  },
  'registration.payment.record': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return recordPayment_(session, payload.teamId, payload.mode);
  },
  'admin.bootstrap.createReceiptTemplate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createTemporaryReceiptTemplate_(session, !!(payload && payload.force));
  },
  'registration.receipt.generateTemporary': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return generateTemporaryReceipt_(session, payload.teamId);
  },
  'registration.teams.list': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { teams: listTeams_(session) };
  },
  'registration.teams.detail': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getTeamDetail_(session, payload.teamId);
  },
  'admin.rooms.create': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createRoom_(session, payload.roomNumber, payload.building, payload.floor, payload.capacity, payload.roomType);
  },
  'rooms.list': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { rooms: listRooms_(session) };
  },
  'accommodation.listPending': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { teams: listPendingAccommodation_(session, payload.kind) };
  },
  'accommodation.allocateRoom': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return allocateRoom_(session, payload.teamId, payload.roomId, payload.personsAllocated, payload.kind);
  },
  'registration.package.purchase': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return purchasePackage_(session, payload.teamId, payload.inchargeMealSelections, payload.mealInclusion, payload.dinnerDate, payload.mode, payload.recipientEmails, requestId);
  },
  'registration.package.list': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { packages: listPackages_(session, payload.teamId) };
  },
  'registration.package.resend': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resendCoupon_(session, payload.packageId, payload.recipientEmails);
  },
  'registration.package.reprint': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return reprintCoupon_(session, payload.packageId);
  },
  'mess.currentMeal': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getMessCurrentMealView_(session);
  },
  'mess.resolveToken': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resolveMealToken_(session, payload.qrToken);
  },
  'mess.searchByCouponId': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resolveMealByCouponId_(session, payload.couponId);
  },
  'mess.recordUsage': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return recordMealUsage_(session, payload.qrToken, payload.count, requestId);
  },
  'mess.setMealOrderStatus': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return setMealOrderStatus_(session, payload.date, payload.meal, payload.status);
  },
  'mess.todaysSummary': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getTodaysMessSummary_(session);
  },
  // Correction 2026-08-20: refund authority for unused meal coupons belongs to the Mess
  // Committee, not Registration — see recordFoodRefund_'s updated role gate (Departure.gs).
  'mess.foodRefund.overview': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getFoodRefundOverview_(session, payload.teamId);
  },
  'accommodation.listActive': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { allocations: listActiveAccommodation_(session, payload.kind) };
  },
  'accommodation.vacateRoom': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return vacateRoom_(session, payload.allocationId);
  },
  'accommodation.reallocateRoom': function (payload, sessionId, requestId) {
    const session = requireSession_(sessionId);
    return reallocateRoom_(session, payload.allocationId, payload.newRoomId, requestId);
  },
  'admin.bootstrap.createNocTemplate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createNocTemplate_(session, !!(payload && payload.force));
  },
  'accommodation.noc.status': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getNocStatus_(session, payload.teamId);
  },
  'accommodation.noc.issue': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return issueNoc_(session, payload.teamId);
  },
  'accommodation.noc.decline': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return declineNoc_(session, payload.teamId, payload.remarks);
  },
  'departure.initiate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return initiateDeparture_(session, payload.teamId);
  },
  'departure.cancel': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return cancelDeparture_(session, payload.teamId);
  },
  'departure.overview': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getDepartureOverview_(session, payload.teamId);
  },
  'departure.recordFoodRefund': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return recordFoodRefund_(session, payload.teamId, payload.entries || []);
  },
  'departure.recordSecurityRefund': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return recordSecurityRefund_(session, payload.teamId, payload.amount);
  },
  'admin.bootstrap.createRelievingTemplate': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return createRelievingTemplate_(session, !!(payload && payload.force));
  },
  'departure.finalize': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return finalizeDepartureAndGenerateDocuments_(session, payload.teamId, payload.otherAdjustments, payload.relievingSession, payload.relievingDate, payload.recipientEmails);
  },
  'departure.resendFinalDocuments': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resendFinalDocuments_(session, payload.teamId, payload.recipientEmails);
  },
  'reports.getAll': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getReportsBundle_(session);
  },
  'reports.auditLog': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return { entries: getAuditLog_(session, payload.limit) };
  },
  'admin.settings.getTournamentInfo': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return getTournamentInfo_(session);
  },
  'admin.settings.updateTournamentInfo': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return updateTournamentInfo_(session, payload);
  },
  'admin.bootstrap.resetTournamentData': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return resetTournamentData_(session, payload && payload.confirm);
  }
};

function handleRequest_(e) {
  try {
    const body = parseBody_(e);
    const action = body.action;
    const handler = ACTIONS[action];
    if (!handler) {
      throw apiError_('UNKNOWN_ACTION', 'No such action: ' + action);
    }
    const data = handler(body.payload || {}, body.sessionId || null, body.requestId || null);
    return jsonOutput_({ ok: true, data: data });
  } catch (err) {
    return jsonOutput_({
      ok: false,
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message }
    });
  }
}
