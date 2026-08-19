// settings.js — Admin's rate/financial-lock/meal-timing management screen. Backend actions
// (admin.settings.updateRates, admin.settings.setFinancialLock, settings.getRegistrationInfo,
// admin.settings.getMealTimings, admin.settings.updateMealTimings) — rates/lock from Phase 3,
// meal timings added in Phase 4 so the future Mess scanning utility (Phase 5) can tell which
// meal a scan belongs to.

async function renderSettingsScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Settings</h1><p>Loading…</p></div>';
  const info = await apiCall('settings.getRegistrationInfo', {});
  const timings = await apiCall('admin.settings.getMealTimings', {});
  renderForm(info, timings);

  function renderForm(info, timings) {
    const locked = info.financialSettingsLocked === 'true';
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Settings</h1>' +
        '<p class="subtitle">Financial settings are currently ' + (locked ? 'LOCKED' : 'unlocked') + '</p>' +
        '<div id="settings-error" class="error" style="display:none"></div>' +
        '<form id="rates-form">' +
          '<label>Breakfast Rate (Rs)<input type="number" id="rate-breakfast" min="0" step="1" value="' + info.rateBreakfast + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Lunch Rate (Rs)<input type="number" id="rate-lunch" min="0" step="1" value="' + info.rateLunch + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Dinner Rate (Rs)<input type="number" id="rate-dinner" min="0" step="1" value="' + info.rateDinner + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Dari Rate (Rs, per team member)<input type="number" id="rate-dari" min="0" step="1" value="' + info.rateDari + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Security Amount (Rs, flat per team)<input type="number" id="rate-security" min="0" step="1" value="' + info.securityAmount + '" ' + (locked ? 'disabled' : '') + '></label>' +
          (locked ? '' : '<button type="submit">Save Rates</button>') +
        '</form>' +
        '<button id="lock-toggle-btn" style="margin-top:12px;background:#666">' + (locked ? 'Unlock Financial Settings' : 'Lock Financial Settings') + '</button>' +

        '<h2 style="margin-top:24px">Meal Timings</h2>' +
        '<p>Used by the Mess scanning utility to identify which meal a scan belongs to, with a grace window on both sides of each range.</p>' +
        '<div id="timings-error" class="error" style="display:none"></div>' +
        '<form id="timings-form">' +
          '<label>Breakfast Start<input type="time" id="timing-breakfast-start" value="' + timings.breakfastStart + '" required></label>' +
          '<label>Breakfast End<input type="time" id="timing-breakfast-end" value="' + timings.breakfastEnd + '" required></label>' +
          '<label>Lunch Start<input type="time" id="timing-lunch-start" value="' + timings.lunchStart + '" required></label>' +
          '<label>Lunch End<input type="time" id="timing-lunch-end" value="' + timings.lunchEnd + '" required></label>' +
          '<label>Dinner Start<input type="time" id="timing-dinner-start" value="' + timings.dinnerStart + '" required></label>' +
          '<label>Dinner End<input type="time" id="timing-dinner-end" value="' + timings.dinnerEnd + '" required></label>' +
          '<label>Grace (minutes, applied before start and after end)<input type="number" id="timing-grace" min="0" step="1" value="' + timings.graceMinutes + '" required></label>' +
          '<button type="submit">Save Meal Timings</button>' +
        '</form>' +

        '<button id="back-btn" style="margin-top:16px;background:#999">Back</button>' +
      '</div>';

    if (!locked) {
      document.getElementById('rates-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const errEl = document.getElementById('settings-error');
        errEl.style.display = 'none';
        try {
          const updated = await apiCall('admin.settings.updateRates', {
            breakfast: Number(document.getElementById('rate-breakfast').value),
            lunch: Number(document.getElementById('rate-lunch').value),
            dinner: Number(document.getElementById('rate-dinner').value),
            dari: Number(document.getElementById('rate-dari').value),
            security: Number(document.getElementById('rate-security').value)
          });
          renderForm(updated, timings);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    }

    document.getElementById('lock-toggle-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('settings-error');
      errEl.style.display = 'none';
      try {
        await apiCall('admin.settings.setFinancialLock', { locked: !locked });
        const refreshed = await apiCall('settings.getRegistrationInfo', {});
        renderForm(refreshed, timings);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    document.getElementById('timings-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('timings-error');
      errEl.style.display = 'none';
      try {
        const updatedTimings = await apiCall('admin.settings.updateMealTimings', {
          breakfastStart: document.getElementById('timing-breakfast-start').value,
          breakfastEnd: document.getElementById('timing-breakfast-end').value,
          lunchStart: document.getElementById('timing-lunch-start').value,
          lunchEnd: document.getElementById('timing-lunch-end').value,
          dinnerStart: document.getElementById('timing-dinner-start').value,
          dinnerEnd: document.getElementById('timing-dinner-end').value,
          graceMinutes: Number(document.getElementById('timing-grace').value)
        });
        renderForm(info, updatedTimings);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    document.getElementById('back-btn').addEventListener('click', function () {
      goBack();
    });
  }
}
