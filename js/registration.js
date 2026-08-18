// registration.js — Registration Dashboard nav, the registration wizard, and Teams list/detail.

function renderRegistrationDashboard(root, user) {
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">Registration Committee</p>' +
      '<button id="register-team-btn">Register New Team</button>' +
      '<button id="view-teams-btn">Teams</button>' +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  document.getElementById('register-team-btn').addEventListener('click', function () {
    renderRegisterWizard(root, user);
  });
  document.getElementById('view-teams-btn').addEventListener('click', function () {
    renderTeamsList(root, user);
  });
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    renderLogin(root, null);
  });
}

function renderRegisterWizard(root, user) {
  const state = { teamId: null, registrationNumber: null, incharges: [{ name: '', designation: '', whatsapp: '', email: '', isPrimary: true, needsAccommodation: false }] };

  function renderTeamDetailsStep() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Register Team — Step 1 of 4</h1>' +
        '<div id="wizard-error" class="error" style="display:none"></div>' +
        '<form id="team-details-form">' +
          '<label>College Name<input type="text" id="college-name" required></label>' +
          '<label>District Name<input type="text" id="district-name" required></label>' +
          '<label>Number of Team Members<input type="number" id="team-members" min="1" required></label>' +
          '<div id="incharges-container"></div>' +
          '<button type="button" id="add-incharge-btn" style="background:#666">+ Add Contingent Incharge</button>' +
          '<button type="submit">Next: Calculate Charges</button>' +
        '</form>' +
        '<button id="cancel-btn" style="margin-top:8px;background:#999">Cancel</button>' +
      '</div>';

    function renderInchargeRows() {
      const container = document.getElementById('incharges-container');
      container.innerHTML = state.incharges.map(function (inc, i) {
        return '<fieldset style="margin:12px 0;padding:10px;border:1px solid #ddd;border-radius:8px">' +
          '<legend>Incharge ' + (i + 1) + '</legend>' +
          '<label>Name<input type="text" data-field="name" data-idx="' + i + '" value="' + inc.name + '" required></label>' +
          '<label>Designation<input type="text" data-field="designation" data-idx="' + i + '" value="' + inc.designation + '"></label>' +
          '<label>WhatsApp<input type="text" data-field="whatsapp" data-idx="' + i + '" value="' + inc.whatsapp + '"></label>' +
          '<label>Email<input type="email" data-field="email" data-idx="' + i + '" value="' + inc.email + '"></label>' +
          '<label><input type="radio" name="primary-incharge" data-idx="' + i + '" ' + (inc.isPrimary ? 'checked' : '') + ' style="width:auto;display:inline"> Primary contact</label>' +
          '<label><input type="checkbox" data-accom-idx="' + i + '" ' + (inc.needsAccommodation ? 'checked' : '') + ' style="width:auto;display:inline"> Needs accommodation (room)</label>' +
        '</fieldset>';
      }).join('');
      Array.prototype.forEach.call(container.querySelectorAll('input[data-field]'), function (el) {
        el.addEventListener('input', function () {
          state.incharges[Number(el.getAttribute('data-idx'))][el.getAttribute('data-field')] = el.value;
        });
      });
      Array.prototype.forEach.call(container.querySelectorAll('input[name="primary-incharge"]'), function (el) {
        el.addEventListener('change', function () {
          state.incharges.forEach(function (inc, i) { inc.isPrimary = i === Number(el.getAttribute('data-idx')); });
        });
      });
      Array.prototype.forEach.call(container.querySelectorAll('input[data-accom-idx]'), function (el) {
        el.addEventListener('change', function () {
          state.incharges[Number(el.getAttribute('data-accom-idx'))].needsAccommodation = el.checked;
        });
      });
    }
    renderInchargeRows();

    document.getElementById('add-incharge-btn').addEventListener('click', function () {
      state.incharges.push({ name: '', designation: '', whatsapp: '', email: '', isPrimary: false, needsAccommodation: false });
      renderInchargeRows();
    });

    document.getElementById('cancel-btn').addEventListener('click', function () {
      renderRegistrationDashboard(root, user);
    });

    document.getElementById('team-details-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('wizard-error');
      errEl.style.display = 'none';
      try {
        const result = await apiCall('registration.team.create', {
          collegeName: document.getElementById('college-name').value.trim(),
          districtName: document.getElementById('district-name').value.trim(),
          numberOfTeamMembers: Number(document.getElementById('team-members').value),
          incharges: state.incharges
        });
        state.teamId = result.teamId;
        state.registrationNumber = result.registrationNumber;
        renderChargesStep();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  async function renderChargesStep() {
    root.innerHTML = '<div class="wizard-card"><h1>Register Team — Step 2 of 4</h1><p>Calculating charges…</p></div>';
    try {
      const charges = await apiCall('registration.charges.calculate', { teamId: state.teamId });
      state.charges = charges;
      root.innerHTML =
        '<div class="wizard-card">' +
          '<h1>Register Team — Step 2 of 4</h1>' +
          '<p class="subtitle">Registration No. ' + state.registrationNumber + '</p>' +
          '<table><tbody>' +
            '<tr><td>Total Contingent</td><td>' + charges.totalContingentPersons + '</td></tr>' +
            '<tr><td>Dari Charges</td><td>Rs ' + charges.dariCharges + '</td></tr>' +
            '<tr><td>Security (refundable, not a charge)</td><td>Rs ' + charges.securityCharges + '</td></tr>' +
            '<tr><td><b>Total to Collect</b></td><td><b>Rs ' + charges.totalPayable + '</b></td></tr>' +
          '</tbody></table>' +
          '<button id="next-payment-btn">Next: Record Payment</button>' +
        '</div>';
      document.getElementById('next-payment-btn').addEventListener('click', function () { renderPaymentStep(); });
    } catch (err) {
      root.innerHTML = '<div class="wizard-card"><h1>Register Team</h1><p class="error">' + err.message + '</p></div>';
    }
  }

  function renderPaymentStep() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Register Team — Step 3 of 4</h1>' +
        '<p>Total to collect: Rs ' + state.charges.totalPayable + '</p>' +
        '<div id="wizard-error" class="error" style="display:none"></div>' +
        '<form id="payment-form">' +
          '<label>Payment Mode<select id="payment-mode">' +
            '<option value="Cash">Cash</option>' +
            '<option value="Online">Online / Bank Transfer</option>' +
            '<option value="Cheque">Cheque</option>' +
          '</select></label>' +
          '<button type="submit">Confirm Payment Received</button>' +
        '</form>' +
      '</div>';
    document.getElementById('payment-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('wizard-error');
      errEl.style.display = 'none';
      try {
        await apiCall('registration.payment.record', { teamId: state.teamId, mode: document.getElementById('payment-mode').value });
        renderReceiptStep();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  async function renderReceiptStep() {
    root.innerHTML = '<div class="wizard-card"><h1>Register Team — Step 4 of 4</h1><p>Generating temporary receipt…</p></div>';
    try {
      const receipt = await apiCall('registration.receipt.generateTemporary', { teamId: state.teamId });
      root.innerHTML =
        '<div class="wizard-card">' +
          '<h1>Registration Complete</h1>' +
          '<p class="subtitle">Registration No. ' + state.registrationNumber + '</p>' +
          '<p>Receipt No. ' + receipt.receiptNumber + '</p>' +
          '<a href="' + receipt.pdfUrl + '" target="_blank" rel="noopener"><button type="button">View / Download Receipt</button></a>' +
          '<button id="done-btn" style="margin-top:12px">Done</button>' +
        '</div>';
      document.getElementById('done-btn').addEventListener('click', function () { renderRegistrationDashboard(root, user); });
    } catch (err) {
      root.innerHTML = '<div class="wizard-card"><h1>Register Team</h1><p class="error">' + err.message + '</p></div>';
    }
  }

  renderTeamDetailsStep();
}

async function renderTeamsList(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Teams</h1><p>Loading…</p></div>';
  const data = await apiCall('registration.teams.list', {});
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>Teams</h1>' +
      '<table><thead><tr><th>Reg. No.</th><th>College</th><th>District</th><th>Contingent</th><th>Status</th></tr></thead>' +
      '<tbody id="teams-tbody">' +
        data.teams.map(function (t) {
          return '<tr class="team-row" data-teamid="' + t.teamId + '" style="cursor:pointer">' +
            '<td>' + t.registrationNumber + '</td><td>' + t.collegeName + '</td><td>' + t.districtName + '</td>' +
            '<td>' + t.totalContingentPersons + '</td><td>' + t.status + '</td></tr>';
        }).join('') +
      '</tbody></table>' +
      '<button id="back-btn">Back</button>' +
    '</div>';
  Array.prototype.forEach.call(document.querySelectorAll('.team-row'), function (row) {
    row.addEventListener('click', function () { renderTeamDetail(root, user, row.getAttribute('data-teamid')); });
  });
  document.getElementById('back-btn').addEventListener('click', function () { renderRegistrationDashboard(root, user); });
}

async function renderTeamDetail(root, user, teamId) {
  root.innerHTML = '<div class="wizard-card"><h1>Team Detail</h1><p>Loading…</p></div>';
  const data = await apiCall('registration.teams.detail', { teamId: teamId });
  const receipt = data.receipts.filter(function (r) { return r.Type === 'TEMPORARY'; })[0];
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>' + data.team.CollegeName + '</h1>' +
      '<p class="subtitle">' + data.team.RegistrationNumber + ' &middot; ' + data.team.DistrictName + ' &middot; ' + data.team.Status + '</p>' +
      '<h2>Incharges</h2>' +
      '<ul>' + data.incharges.map(function (i) { return '<li>' + i.Name + (i.IsPrimary === 'true' ? ' (Primary)' : '') + '</li>'; }).join('') + '</ul>' +
      (data.charges
        ? '<p>Dari: Rs ' + data.charges.DariCharges + ' &middot; Security: Rs ' + data.charges.SecurityCharges + '</p>'
        : '<p>Charges not yet calculated.</p>') +
      (receipt
        ? '<a href="https://drive.google.com/file/d/' + receipt.PdfFileId + '/view" target="_blank" rel="noopener"><button type="button">View Receipt</button></a>'
        : '<p>No receipt generated yet.</p>') +
      '<button id="back-btn" style="margin-top:12px">Back to Teams</button>' +
    '</div>';
  document.getElementById('back-btn').addEventListener('click', function () { renderTeamsList(root, user); });
}
