// mess.js — Mess Committee panel (Phase 5). Current Meal (order-status control), Scan
// (Task 7), Today's Summary, and Teams (reuses registration.js's renderTeamsList/
// renderTeamDetail + packages.js's renderPackagesScreen — no separate Mess-specific team
// screens needed, spec §20's package-sales parity).

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
        '<table><thead><tr><th>Meal</th><th>Order Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<button id="back-btn" style="margin-top:16px">Back</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.order-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('mess-error');
        errEl.style.display = 'none';
        try {
          await apiCall('mess.setMealOrderStatus', { date: data.date, meal: btn.getAttribute('data-meal'), status: btn.getAttribute('data-status') });
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
        : '<table><thead><tr><th>College</th><th>Eligible</th><th>Served</th><th>Remaining</th></tr></thead><tbody>' +
            data.rows.map(function (r) {
              return '<tr><td>' + r.collegeName + '</td><td>' + r.eligiblePersons + '</td><td>' + r.servedPersons + '</td><td>' + r.remainingPersons + '</td></tr>';
            }).join('') +
          '</tbody></table>') +
      '<button id="back-btn" style="margin-top:16px">Back</button>' +
    '</div>';
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}
