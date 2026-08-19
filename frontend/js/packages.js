// packages.js — Food Packages screen (Registration Dashboard → Team Detail → Food Packages):
// purchase (mandatory Package 1, rolling Package 2/3+), list, resend, reprint. Backend:
// registration.package.purchase/list/resend/reprint (Phase 4).
//
// Incharge meal selection is per individual, per meal (decided with the human 2026-08-19) —
// most teams stay at a hotel for breakfast/dinner and only join mess for lunch, so a single
// "include incharges" checkbox applying uniformly to all three meals was wrong. `incharges`
// comes from Team Detail's already-fetched CONTINGENT_INCHARGES rows (both Registration and
// Mess get this — no extra API call needed here).

async function renderPackagesScreen(root, user, teamId, registrationNumber, incharges) {
  root.innerHTML = '<div class="wizard-card"><h1>Food Packages</h1><p>Loading…</p></div>';
  let soldConfirmation = null; // survives refresh() re-renders; cleared on the next purchase or a manual dismiss
  await refresh();

  async function refresh() {
    const data = await apiCall('registration.package.list', { teamId: teamId });
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Food Packages</h1>' +
        '<p class="subtitle">' + registrationNumber + '</p>' +
        (soldConfirmation ? '<div id="sold-confirmation" class="success">' + soldConfirmation + '</div>' : '') +
        '<div id="packages-error" class="error" style="display:none"></div>' +
        (data.packages.length === 0
          ? '<p>No packages purchased yet.</p>'
          : '<table><thead><tr><th>#</th><th>Eligible</th><th>Amount</th><th>Dinner</th><th>Bkfst/Lunch</th><th>Status</th><th></th></tr></thead><tbody>' +
              data.packages.map(function (p) {
                return '<tr>' +
                  '<td>' + p.packageNumber + '</td><td>' + p.eligiblePersons + '</td><td>Rs ' + p.amount + '</td>' +
                  '<td>' + p.startMeal + '</td><td>' + p.endMeal + '</td><td>' + p.status + '</td>' +
                  '<td>' +
                    (p.digitalCouponUrl ? '<a href="' + p.digitalCouponUrl + '" target="_blank" rel="noopener">Digital</a> ' : '') +
                    (p.printedCouponUrl ? '<a href="' + p.printedCouponUrl + '" target="_blank" rel="noopener">Printed</a> ' : '') +
                    '<button class="resend-btn" data-packageid="' + p.packageId + '">Resend</button> ' +
                    '<button class="reprint-btn" data-packageid="' + p.packageId + '">Reprint</button>' +
                  '</td>' +
                '</tr>';
              }).join('') +
            '</tbody></table>') +
        '<h2>Purchase Package</h2>' +
        '<form id="purchase-form">' +
          ((incharges && incharges.length > 0)
            ? '<h3 style="margin:16px 0 4px">Incharge meal selection</h3>' +
              '<p class="subtitle" style="margin:0 0 8px">Team members are always included in every meal. Tick only the meals each incharge will actually eat at mess — e.g. leave Breakfast/Dinner blank if they\'re staying at a hotel.</p>' +
              '<table><thead><tr><th>Incharge</th><th>Breakfast</th><th>Lunch</th><th>Dinner</th></tr></thead><tbody>' +
                incharges.map(function (inc) {
                  return '<tr data-inchargeid="' + inc.InchargeId + '">' +
                    '<td>' + inc.Name + (inc.Designation ? ' (' + inc.Designation + ')' : '') + '</td>' +
                    '<td><input type="checkbox" class="incharge-meal" data-meal="breakfast"></td>' +
                    '<td><input type="checkbox" class="incharge-meal" data-meal="lunch"></td>' +
                    '<td><input type="checkbox" class="incharge-meal" data-meal="dinner"></td>' +
                  '</tr>';
                }).join('') +
              '</tbody></table>'
            : '') +
          '<label>Dinner Date (leave blank to auto-continue)<input type="date" id="purchase-dinner-date"></label>' +
          '<label>Payment Mode<select id="purchase-mode">' +
            '<option value="Cash">Cash</option>' +
            '<option value="Online">Online / Bank Transfer</option>' +
            '<option value="Cheque">Cheque</option>' +
          '</select></label>' +
          '<button type="submit">Purchase Package</button>' +
        '</form>' +
        '<button id="back-btn" style="margin-top:16px;background:#999">Back</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.resend-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('packages-error');
        errEl.style.display = 'none';
        try {
          await apiCall('registration.package.resend', { packageId: btn.getAttribute('data-packageid') });
          await refresh();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.reprint-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('packages-error');
        errEl.style.display = 'none';
        try {
          await apiCall('registration.package.reprint', { packageId: btn.getAttribute('data-packageid') });
          await refresh();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });

    document.getElementById('purchase-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('packages-error');
      errEl.style.display = 'none';
      try {
        const inchargeMealSelections = Array.prototype.map.call(
          document.querySelectorAll('#purchase-form tr[data-inchargeid]'),
          function (row) {
            const meal = function (name) { return row.querySelector('.incharge-meal[data-meal="' + name + '"]').checked; };
            return {
              inchargeId: row.getAttribute('data-inchargeid'),
              breakfast: meal('breakfast'), lunch: meal('lunch'), dinner: meal('dinner')
            };
          }
        );
        const result = await apiCall('registration.package.purchase', {
          teamId: teamId,
          inchargeMealSelections: inchargeMealSelections,
          dinnerDate: document.getElementById('purchase-dinner-date').value || null,
          mode: document.getElementById('purchase-mode').value
        });
        soldConfirmation = 'Meal Package No. ' + result.packageNumber + ' Sold to Team of ' + result.collegeName;
        await refresh();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
