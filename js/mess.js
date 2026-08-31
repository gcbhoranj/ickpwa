// mess.js — Mess Committee panel (Phase 5). Current Meal (order-status control), Scan
// (Task 7), Today's Summary, and Teams (reuses registration.js's renderTeamsList/
// renderTeamDetail + packages.js's renderPackagesScreen — no separate Mess-specific team
// screens needed, spec §20's package-sales parity). renderFoodRefundScreen (correction
// 2026-08-20) is the one Mess-specific team screen: refund authority for unused meal coupons
// belongs to Mess, not Registration, reached from Team Detail's "Food Refund" button.

async function renderMessDashboard(root, user) {
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">Mess Committee</p>' +
      '<button id="current-meal-btn">Current Meal</button>' +
      '<button id="scan-btn">Scan</button>' +
      '<button id="summary-btn">Today\'s Summary</button>' +
      '<button id="teams-btn">Teams (Sell Package)</button>' +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  document.getElementById('current-meal-btn').addEventListener('click', function () { navigateTo(renderCurrentMealScreen, root, user); });
  document.getElementById('scan-btn').addEventListener('click', function () { navigateTo(renderScanScreen, root, user); });
  document.getElementById('summary-btn').addEventListener('click', function () { navigateTo(renderTodaysSummaryScreen, root, user); });
  document.getElementById('teams-btn').addEventListener('click', function () { navigateTo(renderTeamsList, root, user); });
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    resetNavigation(renderLogin, root, null);
  });
}

async function renderCurrentMealScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Current Meal</h1><p>Loading…</p></div>';
  await refresh();

  async function refresh() {
    const data = await apiCall('mess.currentMeal', {});
    const rows = data.orderStatuses.map(function (o) {
      const isCurrent = o.meal === data.currentMeal;
      return '<tr' + (isCurrent ? ' style="font-weight:bold"' : '') + '>' +
        '<td>' + o.meal + (isCurrent ? ' (current)' : '') + '</td><td>' + o.status + '</td>' +
        '<td>' +
          '<button class="order-btn" data-meal="' + o.meal + '" data-status="ORDERED">Mark ORDERED</button> ' +
          '<button class="order-btn" data-meal="' + o.meal + '" data-status="CLOSED">Mark CLOSED</button>' +
        '</td></tr>';
    }).join('');
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Current Meal</h1>' +
        '<p class="subtitle">' + data.date + '</p>' +
        '<p>' + (data.currentMeal
          ? 'Currently serving: <strong>' + data.currentMeal + '</strong> (' + data.windowStart + '–' + data.windowEnd + ')'
          : 'No meal is currently within its serving window.') + '</p>' +
        '<div id="mess-error" class="error" style="display:none"></div>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>Meal</th><th>Order Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<button id="back-btn" style="margin-top:16px">Back</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.order-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('mess-error');
        errEl.style.display = 'none';
        try {
          const status = btn.getAttribute('data-status');
          await apiCall('mess.setMealOrderStatus', { date: data.date, meal: btn.getAttribute('data-meal'), status: status });
          showToast(btn.getAttribute('data-meal') + ' marked ' + status);
          await refresh();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}

async function renderTodaysSummaryScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Today\'s Summary</h1><p>Loading…</p></div>';
  const data = await apiCall('mess.todaysSummary', {});
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>Today\'s Summary</h1>' +
      '<p class="subtitle">' + data.date + (data.meal ? ' — ' + data.meal : ' — no meal currently active') + '</p>' +
      (data.rows.length === 0
        ? '<p>No teams have an entitlement for the current meal.</p>'
        : '<div style="overflow-x:auto"><table><thead><tr><th>College</th><th>Eligible</th><th>Served</th><th>Remaining</th></tr></thead><tbody>' +
            data.rows.map(function (r) {
              return '<tr><td>' + r.collegeName + '</td><td>' + r.eligiblePersons + '</td><td>' + r.servedPersons + '</td><td>' + r.remainingPersons + '</td></tr>';
            }).join('') +
          '</tbody></table></div>') +
      '<button id="back-btn" style="margin-top:16px">Back</button>' +
    '</div>';
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}

// Camera decode uses the browser's native BarcodeDetector Shape Detection API — no vendored
// library, no network call, same self-contained principle as QrEncoder.gs's encoder. Where
// unsupported (desktop Firefox/Safari, or a damaged/unscannable QR), the manual token field
// below is always available as a full fallback, never just a secondary option.
async function renderScanScreen(root, user) {
  let stream = null;
  let detectTimer = null;

  function stopCamera() {
    if (detectTimer) { clearInterval(detectTimer); detectTimer = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  function renderIdle(errorMessage) {
    stopCamera();
    const supportsCamera = 'BarcodeDetector' in window;
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Scan</h1>' +
        (errorMessage ? '<div class="error">' + errorMessage + '</div>' : '') +
        (supportsCamera
          ? '<video id="scan-video" autoplay playsinline muted style="width:100%;max-width:360px;background:#000"></video>' +
            '<p id="camera-status" style="color:#666;font-size:0.9em"></p>'
          : '<p>Camera scanning is not supported in this browser — use manual entry below.</p>') +
        '<h2>Manual Entry</h2>' +
        '<label>QR Token<input type="text" id="manual-token"></label>' +
        '<button id="lookup-token-btn">Look Up by QR Token</button>' +
        '<label style="margin-top:8px">Coupon ID (lost/damaged coupon)<input type="text" id="manual-coupon-id"></label>' +
        '<button id="lookup-coupon-btn">Look Up by Coupon ID</button>' +
        '<button id="back-btn" style="margin-top:16px;background:#999">Back</button>' +
      '</div>';

    document.getElementById('lookup-token-btn').addEventListener('click', function () {
      const token = document.getElementById('manual-token').value.trim();
      if (token) resolveAndShow('mess.resolveToken', { qrToken: token });
    });
    document.getElementById('lookup-coupon-btn').addEventListener('click', function () {
      const couponId = document.getElementById('manual-coupon-id').value.trim();
      if (couponId) resolveAndShow('mess.searchByCouponId', { couponId: couponId });
    });
    document.getElementById('back-btn').addEventListener('click', function () { stopCamera(); goBack(); });

    if (supportsCamera) startCamera();
  }

  function setCameraStatus(text) {
    const el = document.getElementById('camera-status');
    if (el) el.textContent = text;
  }

  async function startCamera() {
    // BarcodeDetector existing on `window` does not mean QR detection actually works — some
    // browsers expose the constructor but have no working native backend for it (a real,
    // known gap outside Android Chrome). Both checks below fail silently by default; surface
    // a clear status instead so a mess operator knows to use manual entry rather than stand
    // there wondering why nothing is happening.
    let detector;
    try {
      if (BarcodeDetector.getSupportedFormats) {
        const supported = await BarcodeDetector.getSupportedFormats();
        if (supported.indexOf('qr_code') === -1) {
          setCameraStatus('This browser\'s camera cannot read QR codes — use manual entry below.');
          return;
        }
      }
      detector = new BarcodeDetector({ formats: ['qr_code'] });
    } catch (err) {
      setCameraStatus('Camera QR detection is not available in this browser (' + err.message + ') — use manual entry below.');
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
      setCameraStatus('Camera unavailable (' + err.message + ') — use manual entry below.');
      return;
    }
    const video = document.getElementById('scan-video');
    if (!video) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
    video.srcObject = stream;
    setCameraStatus('Point the camera at the coupon\'s QR code.');
    detectTimer = setInterval(async function () {
      if (!video.videoWidth) return;
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          resolveAndShow('mess.resolveToken', { qrToken: barcodes[0].rawValue });
        }
      } catch (err) { /* transient decode failure — keep polling */ }
    }, 350);
  }

  async function resolveAndShow(action, payload) {
    stopCamera();
    root.innerHTML = '<div class="wizard-card"><h1>Scan</h1><p>Looking up…</p></div>';
    let resolved;
    try {
      resolved = await apiCall(action, payload);
    } catch (err) {
      renderIdle(err.message);
      return;
    }
    renderConfirm(resolved);
  }

  function renderConfirm(resolved) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Scan</h1>' +
        '<p class="subtitle">' + resolved.collegeName + ' — Package ' + resolved.packageNumber + '</p>' +
        '<p>' + resolved.meal + ' (' + resolved.date + ')</p>' +
        '<div style="overflow-x:auto"><table><tbody>' +
          '<tr><th>Eligible</th><td>' + resolved.eligiblePersons + '</td></tr>' +
          '<tr><th>Already Served</th><td>' + resolved.servedPersons + '</td></tr>' +
          '<tr><th>Remaining</th><td>' + resolved.remainingPersons + '</td></tr>' +
        '</tbody></table></div>' +
        '<div id="scan-error" class="error" style="display:none"></div>' +
        '<label>How many are eating right now?<input type="number" id="claim-count" min="1" value="' + resolved.remainingPersons + '"></label>' +
        '<button id="confirm-btn">Confirm</button>' +
        '<button id="deny-btn" style="background:#999">Deny / Scan Next</button>' +
      '</div>';

    document.getElementById('confirm-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('scan-error');
      errEl.style.display = 'none';
      const count = parseInt(document.getElementById('claim-count').value, 10);
      try {
        const result = await apiCall('mess.recordUsage', { qrToken: resolved.qrToken, count: count });
        if (!result.replay) showToast(result.collegeName + ' — ' + result.meal + ' served');
        renderSuccess(result);
      } catch (err) {
        errEl.textContent = err.message; // the eligible/served/remaining/requested numbers are already visible above
        errEl.style.display = 'block';
      }
    });
    document.getElementById('deny-btn').addEventListener('click', function () { renderIdle(null); });
  }

  function renderSuccess(result) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Scan</h1>' +
        '<p>' + result.collegeName + ' — ' + result.meal + ': served, remaining now ' + result.remainingPersons + '.' + (result.replay ? ' (duplicate submission, no change made)' : '') + '</p>' +
        '<button id="scan-next-btn">Scan Next</button>' +
        '<button id="back-btn" style="background:#999">Back to Dashboard</button>' +
      '</div>';
    document.getElementById('scan-next-btn').addEventListener('click', function () { renderIdle(null); });
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }

  renderIdle(null);
}

// Correction 2026-08-20: refund amounts for unused meal coupons are the Mess Committee's
// discretion (spec §22), so Mess needs its own place to enter them — mirrors the entry form
// that used to live on Registration's Departure screen, now backed by the narrower
// mess.foodRefund.overview read and gated server-side to MESS/ADMIN (recordFoodRefund_).
async function renderFoodRefundScreen(root, user, teamId, registrationNumber, collegeName) {
  root.innerHTML = '<div class="wizard-card"><h1>Food Refund</h1><p>Loading…</p></div>';
  let overview = await apiCall('mess.foodRefund.overview', { teamId: teamId });
  render();

  function render() {
    if (!overview.departureLockedBy) {
      root.innerHTML =
        '<div class="wizard-card">' +
          '<h1>Food Refund</h1>' +
          '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + '</p>' +
          '<p>Registration has not initiated departure for this team yet — food refund cannot be recorded until it is.</p>' +
          '<button id="back-btn">Back</button>' +
        '</div>';
      document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
      return;
    }
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Food Refund</h1>' +
        '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + '</p>' +
        '<div id="food-refund-error" class="error" style="display:none"></div>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Meal</th><th>Eligible</th><th>Served</th><th>Remaining</th><th>Order Status</th><th>Refund Amount</th></tr></thead><tbody>' +
          overview.entitlements.map(function (e) {
            return '<tr><td>' + e.date + '</td><td>' + e.meal + '</td><td>' + e.eligiblePersons + '</td><td>' + e.servedPersons + '</td><td>' + e.remainingPersons + '</td><td>' + e.mealOrderStatus + '</td>' +
              '<td>' + (e.alreadyRefunded ? 'Refunded' :
                '<input type="number" min="0" class="food-refund-input" data-entid="' + e.entitlementId + '" value="0">' +
                (e.suggestedRefund > 0 ? '<div class="hint">Unused: ' + e.remainingPersons + ' &times; Rs ' + e.rate + ' = Rs ' + e.suggestedRefund + '</div>' : '')
              ) + '</td></tr>';
          }).join('') +
        '</tbody></table></div>' +
        '<button id="submit-food-refund-btn" style="margin-top:8px">Record Food Refund</button>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';

    document.getElementById('submit-food-refund-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('food-refund-error');
      errEl.style.display = 'none';
      const entries = Array.prototype.map.call(document.querySelectorAll('.food-refund-input'), function (input) {
        return { entitlementId: input.getAttribute('data-entid'), amount: Number(input.value) };
      }).filter(function (e) { return e.amount > 0; });
      if (entries.length === 0) return;
      try {
        await apiCall('departure.recordFoodRefund', { teamId: teamId, entries: entries });
        showToast('Food refund recorded for ' + collegeName);
        overview = await apiCall('mess.foodRefund.overview', { teamId: teamId });
        render();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
