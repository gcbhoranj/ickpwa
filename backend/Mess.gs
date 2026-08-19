// Mess.gs — Phase 5: Mess Committee panel. Scan/resolve a coupon's QR (or Coupon ID),
// enforce the 10-point scan validity check (spec §20), record group meal consumption under
// a lock, control today's meal-order status, and summarize today's meal by team.
// Spec: docs/superpowers/specs/2026-08-17-hpuick-tournament-system-design.md §20.
//
// All times below are IST (Asia/Kolkata, matching appsscript.json's timeZone) via
// Utilities.formatDate — never .toISOString(), which is UTC and would be off by 5:30.

function _timeToMinutes_(hhmm) {
  const parts = hhmm.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function _isWithinWindow_(timeHHMM, startHHMM, endHHMM, graceMinutes) {
  const t = _timeToMinutes_(timeHHMM);
  const start = _timeToMinutes_(startHHMM) - graceMinutes;
  const end = _timeToMinutes_(endHHMM) + graceMinutes;
  return t >= start && t <= end;
}

// nowOverride lets tests pin a specific IST moment; production callers omit it (real "now").
function _currentMeal_(nowOverride) {
  const now = nowOverride || new Date();
  const date = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
  const time = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm');
  const timings = getMealTimings_(null);
  const grace = parseInt(timings.graceMinutes, 10) || 0;
  const candidates = [
    { meal: 'BREAKFAST', start: timings.breakfastStart, end: timings.breakfastEnd },
    { meal: 'LUNCH', start: timings.lunchStart, end: timings.lunchEnd },
    { meal: 'DINNER', start: timings.dinnerStart, end: timings.dinnerEnd }
  ];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c.start || !c.end) continue; // meal timings not configured yet
    if (_isWithinWindow_(time, c.start, c.end, grace)) {
      return { meal: c.meal, date: date, windowStart: c.start, windowEnd: c.end };
    }
  }
  return null;
}

// Points 2-8 of the 10-point validity check (spec §20) — point 1 (role) is enforced by the
// caller via requireRole_ before this runs; point 9 (count <= remaining) is write-path only,
// checked by recordMealUsage_; point 10 (idempotent replay) is also recordMealUsage_'s job.
// Shared by both entry points (QR token, Coupon ID) so a lost/damaged-coupon lookup goes
// through identically strict validation, never a shortcut.
function _resolveCoupon_(coupon, nowOverride) {
  if (coupon.Status !== 'ACTIVE') throw apiError_('COUPON_INACTIVE', 'This coupon is not active (status: ' + coupon.Status + ').');

  const pkg = findRowById_('FOOD_PACKAGES', 'PackageId', coupon.PackageId);
  if (!pkg || pkg.values.Status !== 'ACTIVE') {
    throw apiError_('PACKAGE_INACTIVE', 'This package is not active (status: ' + (pkg ? pkg.values.Status : 'MISSING') + ').');
  }

  const team = findRowById_('TEAMS', 'TeamId', coupon.TeamId);
  if (!team) throw apiError_('NOT_FOUND', 'Team not found for this coupon.');
  if (team.values.Status === 'LOST' || team.values.Status === 'RELIEVED') {
    throw apiError_('TEAM_NOT_ACTIVE', 'This team\'s status is ' + team.values.Status + ' — not eligible for meals.');
  }

  const current = _currentMeal_(nowOverride);
  if (!current) throw apiError_('NO_ACTIVE_MEAL_WINDOW', 'No meal is currently within its serving window.');

  const entitlement = findRowsByField_('MEAL_ENTITLEMENTS', 'PackageId', coupon.PackageId)
    .filter(function (e) { return e.Meal === current.meal && e.Date === current.date; })[0];
  if (!entitlement) {
    throw apiError_('NOT_VALID_FOR_CURRENT_MEAL',
      'This coupon (Package ' + pkg.values.PackageNumber + ') does not cover today\'s ' + current.meal + ' (' + current.date + ').');
  }
  if (entitlement.Status !== 'ACTIVE') {
    throw apiError_('ENTITLEMENT_INACTIVE', 'This meal entitlement is ' + entitlement.Status + ', not ACTIVE.');
  }

  return {
    couponId: coupon.CouponId, packageId: pkg.values.PackageId, packageNumber: Number(pkg.values.PackageNumber),
    teamId: team.values.TeamId, collegeName: team.values.CollegeName, entitlementId: entitlement.EntitlementId,
    meal: entitlement.Meal, date: entitlement.Date, rate: Number(entitlement.Rate),
    eligiblePersons: Number(entitlement.EligiblePersons), servedPersons: Number(entitlement.ServedPersons),
    qrToken: coupon.QrToken
  };
}

function resolveMealToken_(actorSession, qrToken, nowOverride) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  if (!qrToken) throw apiError_('VALIDATION_ERROR', 'QR token is required.');
  const coupon = findRowsByField_('FOOD_COUPONS', 'QrToken', qrToken)[0];
  if (!coupon) throw apiError_('NOT_FOUND', 'No coupon found for this QR code.');
  const resolved = _resolveCoupon_(coupon, nowOverride);
  resolved.remainingPersons = resolved.eligiblePersons - resolved.servedPersons;
  return resolved;
}

function resolveMealByCouponId_(actorSession, couponId, nowOverride) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  if (!couponId) throw apiError_('VALIDATION_ERROR', 'Coupon ID is required.');
  const found = findRowById_('FOOD_COUPONS', 'CouponId', couponId);
  if (!found) throw apiError_('NOT_FOUND', 'No such coupon: ' + couponId);
  const resolved = _resolveCoupon_(found.values, nowOverride);
  resolved.remainingPersons = resolved.eligiblePersons - resolved.servedPersons;
  return resolved;
}

function getMessCurrentMealView_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const current = _currentMeal_();
  const date = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const orderStatuses = ['BREAKFAST', 'LUNCH', 'DINNER'].map(function (meal) {
    const row = findRowsByField_('MEAL_ORDER_STATUS', 'Date', date).filter(function (r) { return r.Meal === meal; })[0];
    return { meal: meal, status: row ? row.Status : 'NOT_ORDERED' };
  });
  return {
    date: date, currentMeal: current ? current.meal : null,
    windowStart: current ? current.windowStart : null, windowEnd: current ? current.windowEnd : null,
    orderStatuses: orderStatuses
  };
}

// The locked check-and-commit — recordUsage's own idempotency (spec §20 point 10, §47/§48):
// a repeated clientRequestId returns the ORIGINAL result without touching Served/Remaining
// again, protecting against the frontend's documented retry-on-parse-error behavior
// (api-client.js) re-submitting the exact same claim.
function recordMealUsage_(actorSession, qrToken, count, clientRequestId, nowOverride) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.MESS]);
  if (!qrToken) throw apiError_('VALIDATION_ERROR', 'QR token is required.');
  const requestedCount = parseInt(count, 10);
  if (!requestedCount || requestedCount < 1) throw apiError_('VALIDATION_ERROR', 'Count must be at least 1.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (clientRequestId) {
      const dup = findRowsByField_('MEAL_USAGE', 'ClientRequestId', clientRequestId)[0];
      if (dup) {
        return {
          usageId: dup.UsageId, collegeName: findRowById_('TEAMS', 'TeamId', dup.TeamId).values.CollegeName,
          packageNumber: Number(findRowById_('FOOD_PACKAGES', 'PackageId', dup.PackageId).values.PackageNumber),
          meal: dup.Meal, date: dup.Date, eligiblePersons: Number(dup.NewServedTotal) + Number(dup.RemainingAfter),
          servedPersons: Number(dup.NewServedTotal), remainingPersons: Number(dup.RemainingAfter), replay: true
        };
      }
    }

    const coupon = findRowsByField_('FOOD_COUPONS', 'QrToken', qrToken)[0];
    if (!coupon) throw apiError_('NOT_FOUND', 'No coupon found for this QR code.');
    const resolved = _resolveCoupon_(coupon, nowOverride);
    const remaining = resolved.eligiblePersons - resolved.servedPersons;
    if (requestedCount > remaining) {
      throw apiError_('EXCEEDS_REMAINING',
        'Requested ' + requestedCount + ' exceeds remaining ' + remaining + ' (eligible ' +
        resolved.eligiblePersons + ', already served ' + resolved.servedPersons + ') for ' + resolved.collegeName + '.');
    }

    const newServedTotal = resolved.servedPersons + requestedCount;
    const remainingAfter = resolved.eligiblePersons - newServedTotal;
    const usageId = nextId_('USG', 7);
    const now = new Date().toISOString();
    appendRow_('MEAL_USAGE', {
      UsageId: usageId, CouponId: resolved.couponId, PackageId: resolved.packageId, TeamId: resolved.teamId,
      EntitlementId: resolved.entitlementId, Date: resolved.date, Meal: resolved.meal,
      PreviousServedCount: resolved.servedPersons, ClaimAmount: resolved.rate * requestedCount,
      NewServedTotal: newServedTotal, RemainingAfter: remainingAfter, MessUser: actorSession.userId,
      Timestamp: now, ClientRequestId: clientRequestId || ''
    });
    updateRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', resolved.entitlementId, {
      ServedPersons: newServedTotal, RemainingPersons: remainingAfter
    });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'RECORD_MEAL_USAGE', Entity: 'ENTITLEMENT', EntityId: resolved.entitlementId,
      PreviousState: String(resolved.servedPersons), NewState: String(newServedTotal)
    });

    return {
      usageId: usageId, collegeName: resolved.collegeName, packageNumber: resolved.packageNumber,
      meal: resolved.meal, date: resolved.date, eligiblePersons: resolved.eligiblePersons,
      servedPersons: newServedTotal, remainingPersons: remainingAfter
    };
  } finally {
    lock.releaseLock();
  }
}

function setMealOrderStatus_(actorSession, date, meal, status) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.MESS]);
  if (!date) throw apiError_('VALIDATION_ERROR', 'Date is required.');
  if (['BREAKFAST', 'LUNCH', 'DINNER'].indexOf(meal) === -1) throw apiError_('VALIDATION_ERROR', 'Meal must be BREAKFAST, LUNCH, or DINNER.');
  if (['NOT_ORDERED', 'ORDERED', 'CLOSED'].indexOf(status) === -1) throw apiError_('VALIDATION_ERROR', 'Status must be NOT_ORDERED, ORDERED, or CLOSED.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date().toISOString();
    const existing = findRowsByField_('MEAL_ORDER_STATUS', 'Date', date).filter(function (r) { return r.Meal === meal; })[0];
    if (existing) {
      updateRowById_('MEAL_ORDER_STATUS', 'StatusId', existing.StatusId, { Status: status, SetBy: actorSession.userId, SetAt: now });
    } else {
      appendRow_('MEAL_ORDER_STATUS', { StatusId: nextId_('STA', 4), Date: date, Meal: meal, Status: status, SetBy: actorSession.userId, SetAt: now });
    }
    // Mirror onto every matching entitlement row (schema's documented intent: MEAL_ENTITLEMENTS.
    // MealOrderStatus "mirrors MEAL_ORDER_STATUS for that date+meal") — the future refund rule
    // reads it directly off the entitlement row rather than cross-referencing this sheet.
    findRowsByField_('MEAL_ENTITLEMENTS', 'Date', date).filter(function (e) { return e.Meal === meal; })
      .forEach(function (e) { updateRowById_('MEAL_ENTITLEMENTS', 'EntitlementId', e.EntitlementId, { MealOrderStatus: status }); });
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
      Action: 'SET_MEAL_ORDER_STATUS', Entity: 'MEAL_ORDER_STATUS', EntityId: date + '/' + meal,
      PreviousState: existing ? existing.Status : '', NewState: status
    });
    return { date: date, meal: meal, status: status };
  } finally {
    lock.releaseLock();
  }
}

function getTodaysMessSummary_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.MESS]);
  const current = _currentMeal_();
  const date = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  if (!current) return { date: date, meal: null, rows: [] };
  const rows = findRowsByField_('MEAL_ENTITLEMENTS', 'Date', current.date)
    .filter(function (e) { return e.Meal === current.meal; })
    .map(function (e) {
      const team = findRowById_('TEAMS', 'TeamId', e.TeamId);
      return {
        teamId: e.TeamId, collegeName: team ? team.values.CollegeName : e.TeamId,
        eligiblePersons: Number(e.EligiblePersons), servedPersons: Number(e.ServedPersons), remainingPersons: Number(e.RemainingPersons)
      };
    });
  return { date: current.date, meal: current.meal, rows: rows };
}
