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
  // execution (see dev-log). payload.only: 'slow' runs just the tests known to take real
  // time — PDF/Slides document generation, or several sequential Sheets API round trips per
  // test (flagged 'slow: true' in TEST_CASES); omit it to run everything else. Same
  // AllowSelfTest gate and non-production intent as system.selfTest.
  'system.selfTestSplit': function (payload) {
    if (getSetting_('AllowSelfTest', 'false') !== 'true') {
      throw apiError_('FORBIDDEN', 'Self-test is disabled.');
    }
    const wantSlow = payload && payload.only === 'slow';
    const cases = TEST_CASES.filter(function (tc) { return !!tc.slow === wantSlow; });
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
  'registration.package.purchase': function (payload, sessionId) {
    const session = requireSession_(sessionId);
    return purchasePackage_(session, payload.teamId, payload.includeIncharges, payload.dinnerDate, payload.mode, payload.recipientEmails);
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
