// departure.js — Phase 7: Departure screen (Registration role only). Shows the departure-lock
// state, meal-entitlement reference data (Eligible/Served/Remaining/MealOrderStatus — no
// formula applied, refund amounts are the Mess Committee's discretion per spec §22) as
// READ-ONLY reference, and the NOC-gated security-refund action. Food refund entry itself
// moved to Mess's own screen (mess.js's renderFoodRefundScreen) — correction 2026-08-20:
// refund authority belongs to Mess, not Registration; the backend now rejects Registration's
// attempts to record one even while it holds this team's departure lock.

function _renderFinalizeSection(overview) {
  const p = overview.settlementPreview;
  const today = new Date().toISOString().slice(0, 10);
  return (
    '<h2 style="margin-top:16px">Finalize & Send</h2>' +
    '<p>Gross Food/Dari Charges: Rs ' + p.grossCharges + ' &middot; Net Charges (after food refund only — security is separate below): Rs ' + p.netCharges + '</p>' +
    '<label>Other Adjustments<input type="number" id="other-adjustments" value="0"></label>' +
    '<p id="final-balance-preview">Final Balance (refunded to team): Rs ' + (p.foodRefund + p.securityRefunded) + '</p>' +
    '<label>Session<select id="relieving-session"><option value="FN">Forenoon</option><option value="AN">Afternoon</option></select></label>' +
    '<label>Relieving Date<input type="date" id="relieving-date" value="' + today + '"></label>' +
    '<button id="finalize-btn">Finalize &amp; Send</button>'
  );
}

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
        '<h2>Meal Entitlements (reference only — refund amount is the Mess Committee\'s call, recorded on their own screen)</h2>' +
        '<table><thead><tr><th>Date</th><th>Meal</th><th>Eligible</th><th>Served</th><th>Remaining</th><th>Order Status</th><th>Food Refund</th></tr></thead><tbody>' +
          overview.entitlements.map(function (e) {
            const refundRow = overview.refunds.filter(function (r) { return r.EntitlementId === e.entitlementId; })[0];
            return '<tr><td>' + e.date + '</td><td>' + e.meal + '</td><td>' + e.eligiblePersons + '</td><td>' + e.servedPersons + '</td><td>' + e.remainingPersons + '</td><td>' + e.mealOrderStatus + '</td>' +
              '<td>' + (refundRow ? 'Refunded: Rs ' + refundRow.RefundAmount : 'Awaiting Mess Committee') + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        '<h2 style="margin-top:16px">Security Refund</h2>' +
        '<p>Charged: Rs ' + overview.securityCharged + ' &middot; NOC: ' + overview.nocStatus + '</p>' +
        (overview.securityRefunds.length > 0
          ? '<p>Security refund recorded: Rs ' + overview.securityRefunds[0].Amount + '</p>'
          : (overview.nocStatus === 'NOC_GRANTED'
              ? '<label>Amount<input type="number" id="security-refund-amount" min="0" value="' + overview.securityCharged + '"></label><button id="submit-security-refund-btn">Record Security Refund</button>'
              : '<p>NOC not yet granted — security refund unavailable.</p>')) +
        (overview.nocStatus === 'NOC_GRANTED' ? _renderFinalizeSection(overview) : '') +
        '<button id="cancel-departure-btn" style="margin-top:16px;background:#999">Cancel Departure</button>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';

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

    if (document.getElementById('other-adjustments')) {
      const preview = overview.settlementPreview;
      document.getElementById('other-adjustments').addEventListener('input', function () {
        const adjustments = Number(document.getElementById('other-adjustments').value) || 0;
        document.getElementById('final-balance-preview').textContent =
          'Final Balance (refunded to team): Rs ' + (preview.foodRefund + preview.securityRefunded - adjustments);
      });
      document.getElementById('finalize-btn').addEventListener('click', async function () {
        const errEl = document.getElementById('departure-error');
        errEl.style.display = 'none';
        try {
          const finalized = await apiCall('departure.finalize', {
            teamId: teamId,
            otherAdjustments: Number(document.getElementById('other-adjustments').value) || 0,
            relievingSession: document.getElementById('relieving-session').value,
            relievingDate: document.getElementById('relieving-date').value
          });
          renderFinalizedConfirmation(finalized);
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

  // Shown immediately after a successful Finalize & Send — the previous behavior navigated
  // straight back with no confirmation, which made a genuinely successful finalize look
  // identical to nothing having happened. Surfaces the real Drive links (view/print) and the
  // real email outcome, with a resend path if the email failed or the incharge's address on
  // file was wrong — Finalize & Send itself never retries the email on a repeat call.
  function renderFinalizedConfirmation(finalized) {
    const emailNote = finalized.emailStatus === 'SENT'
      ? '<p style="color:#2a2">Final Receipt and Relieving Order emailed to the contingent incharge.</p>'
      : '<p style="color:#a22">Documents generated, but the email did not go through (status: ' + finalized.emailStatus + '). ' +
        'Use "View" to print/save them directly, or resend below.</p>';
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Departure Finalized</h1>' +
        '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + ' &middot; RELIEVED</p>' +
        emailNote +
        '<a href="https://drive.google.com/file/d/' + finalized.receiptPdfFileId + '/view" target="_blank" rel="noopener"><button type="button">View Final Receipt</button></a>' +
        '<a href="https://drive.google.com/file/d/' + finalized.relievingPdfFileId + '/view" target="_blank" rel="noopener"><button type="button" style="margin-left:8px">View Relieving Order</button></a>' +
        '<div id="departure-error" class="error" style="display:none;margin-top:12px"></div>' +
        '<label style="margin-top:12px">Resend to (comma-separated emails, blank = incharges on file)<input type="text" id="resend-emails" placeholder="leave blank to use incharges on file"></label>' +
        '<button id="resend-btn">Resend Email</button>' +
        '<button id="done-btn" style="margin-top:16px">Done</button>' +
      '</div>';
    document.getElementById('resend-btn').addEventListener('click', async function () {
      const errEl = document.getElementById('departure-error');
      errEl.style.display = 'none';
      const raw = document.getElementById('resend-emails').value.trim();
      const recipientEmails = raw ? raw.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; }) : [];
      try {
        const resent = await apiCall('departure.resendFinalDocuments', { teamId: teamId, recipientEmails: recipientEmails });
        renderFinalizedConfirmation(resent);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
    document.getElementById('done-btn').addEventListener('click', function () { goBack(); });
  }
}
