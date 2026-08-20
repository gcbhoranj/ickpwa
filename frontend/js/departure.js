// departure.js — Phase 7: Departure screen (Registration role only). Shows the departure-lock
// state, meal-entitlement reference data (Eligible/Served/Remaining/MealOrderStatus — no
// formula applied, refund amounts are the Mess Convener's discretion per spec §22), a manual
// per-entitlement food-refund entry form, and the NOC-gated security-refund action.

async function renderDepartureScreen(root, user, teamId, registrationNumber, collegeName) {
  root.innerHTML = '<div class="wizard-card"><h1>Process Departure</h1><p>Loading…</p></div>';
  let overview = await apiCall('departure.overview', { teamId: teamId });

  if (!overview.departureLockedBy) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Process Departure</h1>' +
        '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + '</p>' +
        '<div id="departure-error" class="error" style="display:none"></div>' +
        '<button id="initiate-btn">Process Departure</button>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';
    document.getElementById('initiate-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('departure-error');
      errEl.style.display = 'none';
      try {
        await apiCall('departure.initiate', { teamId: teamId });
        overview = await apiCall('departure.overview', { teamId: teamId });
        renderInProgress();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
    return;
  }

  renderInProgress();

  function renderInProgress() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Process Departure</h1>' +
        '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + ' &middot; ' + overview.team.Status + '</p>' +
        '<div id="departure-error" class="error" style="display:none"></div>' +
        '<h2>Meal Entitlements (reference only — refund amount is your judgment call)</h2>' +
        '<table><thead><tr><th>Date</th><th>Meal</th><th>Eligible</th><th>Served</th><th>Remaining</th><th>Order Status</th><th>Refund Amount</th></tr></thead><tbody>' +
          overview.entitlements.map(function (e) {
            return '<tr><td>' + e.date + '</td><td>' + e.meal + '</td><td>' + e.eligiblePersons + '</td><td>' + e.servedPersons + '</td><td>' + e.remainingPersons + '</td><td>' + e.mealOrderStatus + '</td>' +
              '<td>' + (e.alreadyRefunded ? 'Refunded' : '<input type="number" min="0" class="food-refund-input" data-entid="' + e.entitlementId + '" value="0">') + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        '<button id="submit-food-refund-btn" style="margin-top:8px">Record Food Refund</button>' +
        '<h2 style="margin-top:16px">Security Refund</h2>' +
        '<p>Charged: Rs ' + overview.securityCharged + ' &middot; NOC: ' + overview.nocStatus + '</p>' +
        (overview.securityRefunds.length > 0
          ? '<p>Security refund recorded: Rs ' + overview.securityRefunds[0].Amount + '</p>'
          : (overview.nocStatus === 'NOC_GRANTED'
              ? '<label>Amount<input type="number" id="security-refund-amount" min="0" value="' + overview.securityCharged + '"></label><button id="submit-security-refund-btn">Record Security Refund</button>'
              : '<p>NOC not yet granted — security refund unavailable.</p>')) +
        '<button id="cancel-departure-btn" style="margin-top:16px;background:#999">Cancel Departure</button>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';

    document.getElementById('submit-food-refund-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('departure-error');
      errEl.style.display = 'none';
      const entries = Array.prototype.map.call(document.querySelectorAll('.food-refund-input'), function (input) {
        return { entitlementId: input.getAttribute('data-entid'), amount: Number(input.value) };
      }).filter(function (e) { return e.amount > 0; });
      if (entries.length === 0) return;
      try {
        await apiCall('departure.recordFoodRefund', { teamId: teamId, entries: entries });
        overview = await apiCall('departure.overview', { teamId: teamId });
        renderInProgress();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    if (document.getElementById('submit-security-refund-btn')) {
      document.getElementById('submit-security-refund-btn').addEventListener('click', async function () {
        const errEl = document.getElementById('departure-error');
        errEl.style.display = 'none';
        try {
          await apiCall('departure.recordSecurityRefund', { teamId: teamId, amount: Number(document.getElementById('security-refund-amount').value) });
          overview = await apiCall('departure.overview', { teamId: teamId });
          renderInProgress();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    }

    document.getElementById('cancel-departure-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('departure-error');
      errEl.style.display = 'none';
      try {
        await apiCall('departure.cancel', { teamId: teamId });
        goBack();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
