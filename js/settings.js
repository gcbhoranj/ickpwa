// settings.js — Admin's rate/financial-lock/meal-timing management screen. Backend actions
// (admin.settings.updateRates, admin.settings.setFinancialLock, settings.getRegistrationInfo,
// admin.settings.getMealTimings, admin.settings.updateMealTimings) — rates/lock from Phase 3,
// meal timings added in Phase 4 so the future Mess scanning utility (Phase 5) can tell which
// meal a scan belongs to.

// Max upload size kept small and client-side only — a signature/seal scan has no business
// being large, and this avoids ever building a many-MB base64 string in the browser or JSON
// request body for something that should be a few hundred KB at most.
const SIGNATURE_MAX_BYTES = 3 * 1024 * 1024;

function _readFileAsBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      // reader.result is a data: URL ("data:image/png;base64,AAAA...") — the backend wants
      // just the base64 payload, mimeType is sent separately from file.type.
      resolve(reader.result.split(',')[1]);
    };
    reader.onerror = function () { reject(new Error('Could not read the selected file.')); };
    reader.readAsDataURL(file);
  });
}

function _signatureSlotHtml(key, current) {
  return (
    '<div style="margin:12px 0;padding:10px;border:1px solid #ddd;border-radius:8px">' +
      '<p style="margin:0 0 6px"><strong>' + current.label + '</strong> — ' +
        (current.fileId
          ? '<a href="' + current.url + '" target="_blank" rel="noopener">Uploaded (view)</a>'
          : '<span class="hint">Not uploaded yet</span>') +
      '</p>' +
      '<input type="file" accept="image/png,image/jpeg" data-sig-key="' + key + '">' +
      '<button type="button" class="sig-upload-btn" data-sig-key="' + key + '" style="margin-top:6px">Upload</button>' +
    '</div>'
  );
}

async function renderSettingsScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Settings</h1><p>Loading…</p></div>';
  const info = await apiCall('settings.getRegistrationInfo', {});
  const timings = await apiCall('admin.settings.getMealTimings', {});
  const tournamentInfo = await apiCall('admin.settings.getTournamentInfo', {});
  const signatures = await apiCall('admin.settings.getSignatures', {});
  const preRegForm = await apiCall('admin.preRegistration.getFormInfo', {});
  renderForm(info, timings, tournamentInfo, signatures, preRegForm);

  function renderForm(info, timings, tournamentInfo, signatures, preRegForm) {
    const locked = info.financialSettingsLocked === 'true';
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Settings</h1>' +
        '<p class="subtitle">Financial settings are currently ' + (locked ? 'LOCKED' : 'unlocked') + '</p>' +
        '<div id="settings-error" class="error" style="display:none"></div>' +

        '<h2>Tournament Info</h2>' +
        '<p>Printed on every generated document (receipts, coupons, NOC, relieving order).</p>' +
        '<div id="tournament-error" class="error" style="display:none"></div>' +
        '<form id="tournament-form">' +
          '<label>Tournament Name<input type="text" id="tournament-name" value="' + tournamentInfo.tournamentName + '" required></label>' +
          '<label>Organizer / College Name<input type="text" id="tournament-organizer" value="' + tournamentInfo.organizerName + '" required></label>' +
          '<label>District Address<input type="text" id="tournament-address" value="' + tournamentInfo.districtAddress + '" required></label>' +
          '<label>Start Date<input type="date" id="tournament-start" value="' + tournamentInfo.tournamentStartDate + '" required></label>' +
          '<label>End Date<input type="date" id="tournament-end" value="' + tournamentInfo.tournamentEndDate + '" required></label>' +
          '<button type="submit">Save Tournament Info</button>' +
        '</form>' +

        '<h2 style="margin-top:24px">Rates &amp; Security</h2>' +
        '<form id="rates-form">' +
          '<label>Breakfast Rate (Rs)<input type="number" id="rate-breakfast" min="0" step="1" value="' + info.rateBreakfast + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Lunch Rate (Rs)<input type="number" id="rate-lunch" min="0" step="1" value="' + info.rateLunch + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Dinner Rate (Rs)<input type="number" id="rate-dinner" min="0" step="1" value="' + info.rateDinner + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Dari Rate (Rs, per team member)<input type="number" id="rate-dari" min="0" step="1" value="' + info.rateDari + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Security Amount (Rs, flat per team)<input type="number" id="rate-security" min="0" step="1" value="' + info.securityAmount + '" ' + (locked ? 'disabled' : '') + '></label>' +
          '<label>Match Fee (Rs, per team per match)<input type="number" id="rate-matchfee" min="0" step="1" value="' + info.matchFeeRate + '" ' + (locked ? 'disabled' : '') + '></label>' +
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

        '<h2 style="margin-top:24px">Signatures &amp; Seals</h2>' +
        '<p>Uploaded once here, then placed automatically on every Final Receipt, Relieving Order, and NOC Certificate generated from now on. PNG or JPEG, up to 3 MB.</p>' +
        '<div id="signature-error" class="error" style="display:none"></div>' +
        Object.keys(signatures).map(function (key) { return _signatureSlotHtml(key, signatures[key]); }).join('') +

        '<h2 style="margin-top:24px">Pre-Registration Form</h2>' +
        '<p>Send this Google Form link to participating colleges well in advance — their answers show up as Pre-Registrations, ready to verify and check in on opening day.</p>' +
        '<div id="prereg-error" class="error" style="display:none"></div>' +
        (preRegForm.formUrl
          ? ('<p><a href="' + preRegForm.formUrl + '" target="_blank" rel="noopener">' + preRegForm.formUrl + '</a></p>' +
             '<button type="button" id="prereg-regenerate-btn" style="background:#666">Regenerate Form</button>' +
             '<p class="hint">Regenerating creates a brand-new form with a new link — the old link stops accepting new answers. Only do this for a new tournament, not to fix a typo (colleges can just resubmit to correct their own answers).</p>')
          : '<button type="button" id="prereg-generate-btn">Generate Pre-Registration Form</button>') +

        '<button id="back-btn" style="margin-top:16px;background:#999">Back</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.sig-upload-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const key = btn.getAttribute('data-sig-key');
        const fileInput = document.querySelector('input[data-sig-key="' + key + '"]');
        const errEl = document.getElementById('signature-error');
        errEl.style.display = 'none';
        const file = fileInput.files[0];
        if (!file) {
          errEl.textContent = 'Choose a file first.';
          errEl.style.display = 'block';
          return;
        }
        if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
          errEl.textContent = 'Signature/seal images must be PNG or JPEG.';
          errEl.style.display = 'block';
          return;
        }
        if (file.size > SIGNATURE_MAX_BYTES) {
          errEl.textContent = 'File is too large — please use an image under 3 MB.';
          errEl.style.display = 'block';
          return;
        }
        try {
          const base64Data = await _readFileAsBase64(file);
          await apiCall('admin.settings.uploadSignature', { key: key, base64Data: base64Data, mimeType: file.type });
          const updatedSignatures = await apiCall('admin.settings.getSignatures', {});
          renderForm(info, timings, tournamentInfo, updatedSignatures, preRegForm);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });

    document.getElementById('tournament-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('tournament-error');
      errEl.style.display = 'none';
      try {
        const updatedTournamentInfo = await apiCall('admin.settings.updateTournamentInfo', {
          tournamentName: document.getElementById('tournament-name').value,
          organizerName: document.getElementById('tournament-organizer').value,
          districtAddress: document.getElementById('tournament-address').value,
          tournamentStartDate: document.getElementById('tournament-start').value,
          tournamentEndDate: document.getElementById('tournament-end').value
        });
        renderForm(info, timings, updatedTournamentInfo, signatures, preRegForm);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

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
            security: Number(document.getElementById('rate-security').value),
            matchFee: Number(document.getElementById('rate-matchfee').value)
          });
          renderForm(updated, timings, tournamentInfo, signatures, preRegForm);
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
        renderForm(refreshed, timings, tournamentInfo, signatures, preRegForm);
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
        renderForm(info, updatedTimings, tournamentInfo, signatures, preRegForm);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    function _wirePreRegFormButton(btnId, force) {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('prereg-error');
        errEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Generating…';
        try {
          await apiCall('admin.bootstrap.setupPreRegistrationForm', { force: force });
          const updatedPreRegForm = await apiCall('admin.preRegistration.getFormInfo', {});
          renderForm(info, timings, tournamentInfo, signatures, updatedPreRegForm);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = force ? 'Regenerate Form' : 'Generate Pre-Registration Form';
        }
      });
    }
    _wirePreRegFormButton('prereg-generate-btn', false);
    _wirePreRegFormButton('prereg-regenerate-btn', true);

    document.getElementById('back-btn').addEventListener('click', function () {
      goBack();
    });
  }
}
