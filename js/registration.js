// registration.js — Registration Dashboard nav, the registration wizard, and Teams list/detail.

// Must stay in sync with the backend's TRAVEL_MODES (Constants.gs) — also the choice list on
// the pre-registration Google Form itself (PreRegistration.gs), so a team's answer there always
// matches an option here.
const TRAVEL_MODES = ['By Bus', 'By hired vehicle', 'By College vehicle'];

function renderRegistrationDashboard(root, user) {
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">Registration Committee</p>' +
      '<button id="register-team-btn">Register New Team</button>' +
      '<button id="pre-registrations-btn">Pre-Registrations</button>' +
      '<button id="view-teams-btn">Teams</button>' +
      '<button id="match-fee-btn">Match Fee Collection</button>' +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  document.getElementById('register-team-btn').addEventListener('click', function () {
    navigateTo(renderRegisterWizard, root, user, null);
  });
  document.getElementById('pre-registrations-btn').addEventListener('click', function () {
    navigateTo(renderPreRegistrationsList, root, user);
  });
  document.getElementById('view-teams-btn').addEventListener('click', function () {
    navigateTo(renderTeamsList, root, user);
  });
  document.getElementById('match-fee-btn').addEventListener('click', function () {
    navigateTo(renderMatchFeeList, root, user);
  });
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    resetNavigation(renderLogin, root, null);
  });
}

// `preRegDetail` (optional): the result of registration.preReg.detail, when this wizard was
// opened from the Pre-Registrations list (preregistration.js) rather than "Register New
// Team". Every field it supplies is just a starting point in `state` — fully editable, since
// the whole point of physical verification is that pre-registered details sometimes vary and
// need correcting on the spot.
function renderRegisterWizard(root, user, preRegDetail) {
  const state = preRegDetail
    ? {
        teamId: null, registrationNumber: null, collegeName: preRegDetail.collegeName,
        districtName: preRegDetail.districtName, numberOfTeamMembers: preRegDetail.numberOfTeamMembers,
        travelMode: preRegDetail.travelMode || '', preRegId: preRegDetail.preRegId,
        incharges: preRegDetail.incharges.length
          ? preRegDetail.incharges.map(function (inc) {
              return { name: inc.name, designation: inc.designation, whatsapp: inc.whatsapp, email: inc.email, isPrimary: inc.isPrimary, needsAccommodation: false };
            })
          : [{ name: '', designation: '', whatsapp: '', email: '', isPrimary: true, needsAccommodation: false }]
      }
    : {
        teamId: null, registrationNumber: null, collegeName: null, districtName: null, numberOfTeamMembers: null,
        travelMode: '', preRegId: null,
        incharges: [{ name: '', designation: '', whatsapp: '', email: '', isPrimary: true, needsAccommodation: false }]
      };

  function renderTeamDetailsStep() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Register Team — Step 1 of 4</h1>' +
        (state.preRegId ? '<p class="subtitle">From pre-registration — verify every field below, and correct anything that\'s changed.</p>' : '') +
        '<div id="wizard-error" class="error" style="display:none"></div>' +
        '<form id="team-details-form">' +
          '<label>College Name<input type="text" id="college-name" value="' + (state.collegeName || '') + '" required></label>' +
          '<label>District Name<input type="text" id="district-name" value="' + (state.districtName || '') + '" required></label>' +
          '<label>Number of Team Members<input type="number" id="team-members" min="1" value="' + (state.numberOfTeamMembers || '') + '" required></label>' +
          '<label>Mode of Travelling of Team<select id="travel-mode" required>' +
            '<option value="">Select…</option>' +
            TRAVEL_MODES.map(function (mode) { return '<option value="' + mode + '" ' + (state.travelMode === mode ? 'selected' : '') + '>' + mode + '</option>'; }).join('') +
          '</select></label>' +
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
      goBack();
    });

    document.getElementById('team-details-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('wizard-error');
      errEl.style.display = 'none';
      try {
        const collegeName = document.getElementById('college-name').value.trim();
        const result = await apiCall('registration.team.create', {
          collegeName: collegeName,
          districtName: document.getElementById('district-name').value.trim(),
          numberOfTeamMembers: Number(document.getElementById('team-members').value),
          incharges: state.incharges,
          travelMode: document.getElementById('travel-mode').value,
          preRegId: state.preRegId
        });
        state.teamId = result.teamId;
        state.registrationNumber = result.registrationNumber;
        state.collegeName = collegeName;
        renderChargesStep();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  // Which charge items apply is the Registration operator's call, not automatic — some
  // teams may already have paid Security elsewhere, or Dari may not apply. Only ticked
  // items get charged (calculateCharges_ zeroes the rest) and only ticked items end up on
  // the printed receipt (generateTemporaryReceipt_ omits any item that came back as 0).
  function renderChargesStep() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Register Team — Step 2 of 4</h1>' +
        '<p class="subtitle">Registration No. ' + state.registrationNumber + '</p>' +
        '<p>Tick which charges apply to this team. Unticked items are not charged and will not appear on the receipt.</p>' +
        '<div id="wizard-error" class="error" style="display:none"></div>' +
        '<form id="charges-select-form">' +
          '<label><input type="checkbox" id="include-dari" checked> Dari Charges</label>' +
          '<label><input type="checkbox" id="include-security" checked> Security (refundable)</label>' +
          '<button type="submit">Calculate Charges</button>' +
        '</form>' +
      '</div>';

    document.getElementById('charges-select-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('wizard-error');
      errEl.style.display = 'none';
      try {
        const charges = await apiCall('registration.charges.calculate', {
          teamId: state.teamId,
          includeDari: document.getElementById('include-dari').checked,
          includeSecurity: document.getElementById('include-security').checked
        });
        state.charges = charges;
        renderChargesSummary(charges);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  function renderChargesSummary(charges) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Register Team — Step 2 of 4</h1>' +
        '<p class="subtitle">Registration No. ' + state.registrationNumber + '</p>' +
        '<div style="overflow-x:auto"><table><tbody>' +
          '<tr><td>Total Contingent</td><td>' + charges.totalContingentPersons + '</td></tr>' +
          (charges.dariCharges > 0 ? '<tr><td>Dari Charges</td><td>Rs ' + charges.dariCharges + '</td></tr>' : '') +
          (charges.securityCharges > 0 ? '<tr><td>Security (refundable, not a charge)</td><td>Rs ' + charges.securityCharges + '</td></tr>' : '') +
          '<tr><td><b>Total to Collect</b></td><td><b>Rs ' + charges.totalPayable + '</b></td></tr>' +
        '</tbody></table></div>' +
        '<button id="next-payment-btn">Next: Record Payment</button>' +
      '</div>';
    document.getElementById('next-payment-btn').addEventListener('click', function () { renderPaymentStep(); });
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
      showToast('Team from ' + state.collegeName + ' is Successfully Registered');
      root.innerHTML =
        '<div class="wizard-card">' +
          '<h1>Registration Complete</h1>' +
          '<p class="subtitle">Registration No. ' + state.registrationNumber + '</p>' +
          '<p>Receipt No. ' + receipt.receiptNumber + '</p>' +
          '<a href="' + receipt.pdfUrl + '" target="_blank" rel="noopener"><button type="button">View / Download Receipt</button></a>' +
          '<button id="done-btn" style="margin-top:12px">Done</button>' +
        '</div>';
      document.getElementById('done-btn').addEventListener('click', function () { goBack(); });
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
      '<div class="no-print">' +
        '<button type="button" id="export-excel-btn" class="export-btn">Export Excel</button>' +
        '<button type="button" id="print-btn" class="export-btn">Print / Save PDF</button>' +
      '</div>' +
      '<div style="overflow-x:auto"><table><thead><tr><th>Reg. No.</th><th>College</th><th>District</th><th>Contingent</th><th>Status</th></tr></thead>' +
      '<tbody id="teams-tbody">' +
        data.teams.map(function (t) {
          return '<tr class="team-row" data-teamid="' + t.teamId + '" style="cursor:pointer">' +
            '<td>' + t.registrationNumber + '</td><td>' + t.collegeName + '</td><td>' + t.districtName + '</td>' +
            '<td>' + t.totalContingentPersons + '</td><td>' + t.status + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<button id="back-btn" class="no-print">Back</button>' +
    '</div>';
  Array.prototype.forEach.call(document.querySelectorAll('.team-row'), function (row) {
    row.addEventListener('click', function () { navigateTo(renderTeamDetail, root, user, row.getAttribute('data-teamid')); });
  });
  document.getElementById('export-excel-btn').addEventListener('click', function () {
    exportRowsToXlsx(
      [{ name: 'Teams', headers: ['Reg No', 'College', 'District', 'Contingent', 'Status'],
        rows: data.teams.map(function (t) { return [t.registrationNumber, t.collegeName, t.districtName, t.totalContingentPersons, t.status]; }) }],
      'HPUICK_teams_' + _exportDateStamp() + '.xlsx'
    );
  });
  document.getElementById('print-btn').addEventListener('click', function () { window.print(); });
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}

async function renderTeamDetail(root, user, teamId) {
  root.innerHTML = '<div class="wizard-card"><h1>Team Detail</h1><p>Loading…</p></div>';
  const data = await apiCall('registration.teams.detail', { teamId: teamId });
  // Prefer the FINAL settlement receipt once departure has been finalized — the TEMPORARY
  // receipt from registration-time is only ever the fallback before that happens.
  const finalReceipt = data.receipts.filter(function (r) { return r.Type === 'FINAL'; })[0];
  const tempReceipt = data.receipts.filter(function (r) { return r.Type === 'TEMPORARY'; })[0];
  const receipt = finalReceipt || tempReceipt;
  const relievingOrder = (data.relieving || [])[0];
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>' + data.team.CollegeName + '</h1>' +
      '<p class="subtitle">' + data.team.RegistrationNumber + ' &middot; ' + data.team.DistrictName + ' &middot; ' + data.team.Status +
        (data.team.TravelMode ? ' &middot; ' + data.team.TravelMode : '') + '</p>' +
      '<h2>Incharges</h2>' +
      '<ul>' + data.incharges.map(function (i) { return '<li>' + i.Name + (i.IsPrimary === 'true' ? ' (Primary)' : '') + '</li>'; }).join('') + '</ul>' +
      // MESS/ACCOMMODATION never see Dari/security/total-payable or the temp receipt (backend
      // redacts these fields to null/[] for those roles — getTeamDetail_, spec §20/§21) — the
      // frontend simply skips rendering the sections rather than showing a misleading state.
      (user.role !== 'MESS' && user.role !== 'ACCOMMODATION'
        ? (data.charges
            ? '<p>' + [
                Number(data.charges.DariCharges) > 0 ? 'Dari: Rs ' + data.charges.DariCharges : null,
                Number(data.charges.SecurityCharges) > 0 ? 'Security: Rs ' + data.charges.SecurityCharges : null
              ].filter(function (s) { return s; }).join(' &middot; ') + '</p>'
            : '<p>Charges not yet calculated.</p>') +
          (receipt
            ? '<a href="https://drive.google.com/file/d/' + receipt.PdfFileId + '/view" target="_blank" rel="noopener"><button type="button">View ' + (finalReceipt ? 'Final' : 'Temporary') + ' Receipt</button></a>'
            : '<p>No receipt generated yet.</p>') +
          (relievingOrder
            ? '<a href="https://drive.google.com/file/d/' + relievingOrder.PdfFileId + '/view" target="_blank" rel="noopener"><button type="button" style="margin-left:8px">View Relieving Order</button></a>'
            : '') +
          // Only once the departure is actually finalized (both documents exist) -- resending
          // before that would just 404 (spec: resendFinalDocuments_ throws NOT_FOUND).
          (finalReceipt && relievingOrder && user.role === 'REGISTRATION'
            ? '<button type="button" id="resend-final-btn" style="margin-left:8px">Resend Final Documents</button>' +
              '<div id="resend-final-status" style="margin-top:4px"></div>'
            : '') +
          // Accommodation's decision (and, if declined, why) — visible here without navigating
          // into Accommodation's own screen or waiting for the Departure screen to surface it.
          (data.nocStatus
            ? '<p style="margin-top:12px">Accommodation NOC: <strong>' + data.nocStatus.status + '</strong>' +
              (data.nocStatus.status === 'DECLINED' && data.nocStatus.notes ? ' — ' + data.nocStatus.notes : '') +
              (data.nocStatus.status === 'NOC_GRANTED' && data.nocStatus.pdfUrl
                ? ' <a href="' + data.nocStatus.pdfUrl + '" target="_blank" rel="noopener">View Certificate</a>' : '') +
              '</p>'
            : '')
        : '') +
      (user.role !== 'ACCOMMODATION' ? '<button id="packages-btn" style="margin-top:12px">Food Packages</button>' : '') +
      (user.role === 'ACCOMMODATION' ? '<button id="noc-btn" style="margin-top:12px">Accommodation NOC</button>' : '') +
      (user.role === 'REGISTRATION' ? '<button id="departure-btn" style="margin-top:12px">Process Departure</button>' : '') +
      // Correction 2026-08-20: refund authority for unused meal coupons belongs to Mess, not
      // Registration — Mess reaches its own food-refund screen from here.
      (user.role === 'MESS' ? '<button id="food-refund-btn" style="margin-top:12px">Food Refund</button>' : '') +
      '<button id="back-btn" style="margin-top:12px">Back to Teams</button>' +
    '</div>';
  if (document.getElementById('packages-btn')) {
    document.getElementById('packages-btn').addEventListener('click', function () {
      navigateTo(renderPackagesScreen, root, user, teamId, data.team.RegistrationNumber, data.incharges);
    });
  }
  if (document.getElementById('noc-btn')) {
    document.getElementById('noc-btn').addEventListener('click', function () {
      navigateTo(renderNocScreen, root, user, teamId, data.team.RegistrationNumber, data.team.CollegeName);
    });
  }
  if (document.getElementById('departure-btn')) {
    document.getElementById('departure-btn').addEventListener('click', function () {
      navigateTo(renderDepartureScreen, root, user, teamId, data.team.RegistrationNumber, data.team.CollegeName);
    });
  }
  if (document.getElementById('food-refund-btn')) {
    document.getElementById('food-refund-btn').addEventListener('click', function () {
      navigateTo(renderFoodRefundScreen, root, user, teamId, data.team.RegistrationNumber, data.team.CollegeName);
    });
  }
  if (document.getElementById('resend-final-btn')) {
    document.getElementById('resend-final-btn').addEventListener('click', async function () {
      const statusEl = document.getElementById('resend-final-status');
      statusEl.textContent = 'Sending…';
      try {
        const result = await apiCall('departure.resendFinalDocuments', { teamId: teamId, recipientEmails: [] });
        statusEl.textContent = result.emailStatus === 'SENT'
          ? 'Resent to: ' + result.recipients.join(', ')
          : 'Resend attempt status: ' + result.emailStatus;
      } catch (err) {
        statusEl.textContent = err.message;
      }
    });
  }
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}
