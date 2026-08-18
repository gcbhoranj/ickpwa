// settings.js — Admin's rate/financial-lock management screen. Backend actions
// (admin.settings.updateRates, admin.settings.setFinancialLock, settings.getRegistrationInfo)
// were built and tested in Phase 3 but had no frontend screen until now.

async function renderSettingsScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Settings</h1><p>Loading…</p></div>';
  const info = await apiCall('settings.getRegistrationInfo', {});
  renderForm(info);

  function renderForm(info) {
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
        '<button id="back-btn" style="margin-top:8px;background:#999">Back</button>' +
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
          renderForm(updated);
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
        renderForm(refreshed);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    document.getElementById('back-btn').addEventListener('click', function () {
      renderLanding(root, user);
    });
  }
}
