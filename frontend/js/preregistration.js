// preregistration.js — Pre-Registrations list (opening-day check-in entry point). Backend
// actions: registration.preReg.list/.detail, admin.preRegistration.syncForm. Clicking a row
// loads registration.js's existing renderRegisterWizard, pre-filled from the pre-registration
// but fully editable — physical verification is exactly where a detail that varies gets
// corrected before proceeding into the unchanged Calculate Charges → Payment → Receipt steps.

async function renderPreRegistrationsList(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Pre-Registrations</h1><p>Loading…</p></div>';
  const data = await apiCall('registration.preReg.list', {});
  render(data.preRegistrations, null);

  function render(preRegistrations, statusMessage) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Pre-Registrations</h1>' +
        '<p class="subtitle">Teams that submitted the pre-registration form, awaiting check-in. Click a team to verify details and register it.</p>' +
        '<button id="sync-now-btn" style="background:#666">Sync Now</button>' +
        (statusMessage ? '<p class="hint" style="margin-top:6px">' + statusMessage + '</p>' : '') +
        (preRegistrations.length === 0
          ? '<p style="margin-top:12px">No pending pre-registrations.</p>'
          : '<div style="overflow-x:auto"><table><thead><tr><th>College</th><th>District</th><th>Members</th><th>Travel Mode</th><th>Submitted</th></tr></thead>' +
            '<tbody id="prereg-tbody">' +
              preRegistrations.map(function (r) {
                return '<tr class="prereg-row" data-preregid="' + r.preRegId + '" style="cursor:pointer">' +
                  '<td>' + r.collegeName + '</td><td>' + r.districtName + '</td><td>' + r.numberOfTeamMembers + '</td>' +
                  '<td>' + r.travelMode + '</td><td>' + new Date(r.formSubmittedAt).toLocaleString() + '</td>' +
                '</tr>';
              }).join('') +
            '</tbody></table></div>') +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.prereg-row'), function (row) {
      row.addEventListener('click', async function () {
        const preRegId = row.getAttribute('data-preregid');
        try {
          const detail = await apiCall('registration.preReg.detail', { preRegId: preRegId });
          navigateTo(renderRegisterWizard, root, user, detail);
        } catch (err) {
          render(preRegistrations, err.message);
        }
      });
    });

    document.getElementById('sync-now-btn').addEventListener('click', async function () {
      const btn = document.getElementById('sync-now-btn');
      btn.disabled = true;
      btn.textContent = 'Syncing…';
      try {
        const result = await apiCall('admin.preRegistration.syncForm', {});
        const refreshed = await apiCall('registration.preReg.list', {});
        render(refreshed.preRegistrations, 'Synced ' + result.synced + ' of ' + result.totalChecked + ' checked response(s).' + (result.errors.length ? ' ' + result.errors.length + ' failed — see Audit Log.' : ''));
      } catch (err) {
        render(preRegistrations, err.message);
      }
    });

    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
