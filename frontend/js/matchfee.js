// matchfee.js — Match Fee Collection: match list/history, create match, collect/view/resend
// receipts, and (Admin only) void a transaction. Backend actions: matchfee.match.create/
// .list/.detail, matchfee.pay, matchfee.receipt.resend, matchfee.transaction.void.

async function renderMatchFeeList(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Match Fee Collection</h1><p>Loading…</p></div>';
  const data = await apiCall('matchfee.match.list', {});
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>Match Fee Collection</h1>' +
      '<p class="subtitle">Every match and both teams\' payment status — this list is also the Match Fee history.</p>' +
      '<button id="create-match-btn">+ Create Match</button>' +
      '<div style="overflow-x:auto"><table><thead><tr><th>Match No.</th><th>Date</th><th>Team 1</th><th>Status</th><th>Team 2</th><th>Status</th></tr></thead>' +
      '<tbody id="matches-tbody">' +
        data.matches.map(function (m) {
          return '<tr class="match-row" data-matchid="' + m.matchId + '" style="cursor:pointer">' +
            '<td>' + m.matchNumber + '</td><td>' + m.matchDate + '</td>' +
            '<td>' + m.team1.collegeName + '</td><td><strong>' + m.team1Status.status + '</strong></td>' +
            '<td>' + m.team2.collegeName + '</td><td><strong>' + m.team2Status.status + '</strong></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<button id="back-btn" style="margin-top:12px">Back</button>' +
    '</div>';
  Array.prototype.forEach.call(document.querySelectorAll('.match-row'), function (row) {
    row.addEventListener('click', function () { navigateTo(renderMatchDetail, root, user, row.getAttribute('data-matchid')); });
  });
  document.getElementById('create-match-btn').addEventListener('click', function () {
    navigateTo(renderCreateMatchForm, root, user);
  });
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}

async function renderCreateMatchForm(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Create Match</h1><p>Loading teams…</p></div>';
  const data = await apiCall('registration.teams.list', {});

  function teamOptions(excludeTeamId) {
    return data.teams
      .filter(function (t) { return t.teamId !== excludeTeamId; })
      .map(function (t) { return '<option value="' + t.teamId + '">' + t.collegeName + '</option>'; })
      .join('');
  }

  function render(team1Id, team2Id) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Create Match</h1>' +
        '<div id="create-match-error" class="error" style="display:none"></div>' +
        '<form id="create-match-form">' +
          '<label>Team 1<select id="team1-select" required><option value="">Select team…</option>' + teamOptions(team2Id) + '</select></label>' +
          '<label>Team 2<select id="team2-select" required><option value="">Select team…</option>' + teamOptions(team1Id) + '</select></label>' +
          '<label>Match Date<input type="date" id="match-date" required></label>' +
          '<button type="submit">Create Match</button>' +
        '</form>' +
        '<button id="cancel-btn" style="margin-top:8px;background:#999">Cancel</button>' +
      '</div>';

    if (team1Id) document.getElementById('team1-select').value = team1Id;
    if (team2Id) document.getElementById('team2-select').value = team2Id;

    // Picking a team in one selector removes it from the other's options — a client-side
    // convenience only; matchfee.match.create is what actually enforces distinct teams.
    document.getElementById('team1-select').addEventListener('change', function () {
      render(this.value || null, document.getElementById('team2-select').value || null);
    });
    document.getElementById('team2-select').addEventListener('change', function () {
      render(document.getElementById('team1-select').value || null, this.value || null);
    });

    document.getElementById('cancel-btn').addEventListener('click', function () { goBack(); });

    document.getElementById('create-match-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('create-match-error');
      errEl.style.display = 'none';
      try {
        const result = await apiCall('matchfee.match.create', {
          team1Id: document.getElementById('team1-select').value,
          team2Id: document.getElementById('team2-select').value,
          matchDate: document.getElementById('match-date').value
        });
        navigateReplace(renderMatchDetail, root, user, result.matchId);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  render(null, null);
}

function _matchFeeTeamCardHtml(sideLabel, teamStatus, teamName, rate, canCollect, sideKey, isAdmin) {
  const paid = teamStatus.status === 'PAID';
  return (
    '<div style="margin:12px 0;padding:12px;border:1px solid #ddd;border-radius:8px">' +
      '<p style="margin:0 0 4px"><strong>' + sideLabel + ': ' + teamName + '</strong></p>' +
      '<p style="margin:0 0 4px">Status: <strong style="color:' + (paid ? 'var(--success)' : 'var(--error)') + '">' + teamStatus.status + '</strong></p>' +
      '<p style="margin:0 0 8px">Match Fee: Rs ' + rate + '</p>' +
      (paid
        ? ('<p class="hint" style="margin:0 0 8px">Receipt No.: ' + teamStatus.receiptNumber + ' &middot; Email: ' + teamStatus.emailStatus + '</p>' +
           '<a href="' + (teamStatus.receiptPdfFileId ? 'https://drive.google.com/file/d/' + teamStatus.receiptPdfFileId + '/view' : '#') + '" target="_blank" rel="noopener"><button type="button">View Receipt</button></a>' +
           '<button type="button" class="mf-resend-btn" data-txid="' + teamStatus.transactionId + '" style="margin-top:8px;background:#666">Resend Receipt</button>' +
           '<div class="mf-resend-status" data-txid="' + teamStatus.transactionId + '" style="margin-top:4px"></div>' +
           (isAdmin
             ? ('<button type="button" class="mf-void-toggle-btn" data-txid="' + teamStatus.transactionId + '" style="margin-top:8px;background:#b91c1c">Void Transaction</button>' +
                '<div class="mf-void-form" data-txid="' + teamStatus.transactionId + '" style="display:none;margin-top:8px">' +
                  '<label>Reason for void<input type="text" class="mf-void-reason" data-txid="' + teamStatus.transactionId + '"></label>' +
                  '<button type="button" class="mf-void-confirm-btn" data-txid="' + teamStatus.transactionId + '" style="background:#b91c1c">Confirm Void</button>' +
                  '<div class="mf-void-status" data-txid="' + teamStatus.transactionId + '" style="margin-top:4px"></div>' +
                '</div>')
             : ''))
        : (canCollect
            ? ('<label>Payment Mode<select class="mf-mode-select" data-side="' + sideKey + '">' +
                 '<option value="Cash">Cash</option>' +
                 '<option value="Online">Online / Bank Transfer</option>' +
                 '<option value="Cheque">Cheque</option>' +
               '</select></label>' +
               '<button type="button" class="mf-collect-btn" data-side="' + sideKey + '">Collect Match Fee</button>')
            : '<p class="hint">Only Registration Committee/Admin can collect Match Fee.</p>')) +
    '</div>'
  );
}

async function renderMatchDetail(root, user, matchId) {
  root.innerHTML = '<div class="wizard-card"><h1>Match Detail</h1><p>Loading…</p></div>';
  const initial = await apiCall('matchfee.match.detail', { matchId: matchId });
  render(initial);

  async function _refreshMatchDetail(errMessage) {
    const refreshed = await apiCall('matchfee.match.detail', { matchId: matchId });
    render(refreshed);
    if (errMessage) {
      const errEl = document.getElementById('matchfee-error');
      errEl.textContent = errMessage;
      errEl.style.display = 'block';
    }
  }

  function render(m) {
    const canCollect = user.role === 'REGISTRATION' || user.role === 'ADMIN';
    const isAdmin = user.role === 'ADMIN';
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Match ' + m.matchNumber + '</h1>' +
        '<p class="subtitle">' + m.matchDate + '</p>' +
        '<div id="matchfee-error" class="error" style="display:none"></div>' +
        _matchFeeTeamCardHtml('Team 1', m.team1Status, m.team1.collegeName, m.matchFeeRate, canCollect, 'team1', isAdmin) +
        _matchFeeTeamCardHtml('Team 2', m.team2Status, m.team2.collegeName, m.matchFeeRate, canCollect, 'team2', isAdmin) +
        '<button id="back-btn" style="margin-top:12px">Back to Match Fee Collection</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.mf-collect-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const side = btn.getAttribute('data-side');
        const teamId = side === 'team1' ? m.team1.teamId : m.team2.teamId;
        const mode = document.querySelector('.mf-mode-select[data-side="' + side + '"]').value;
        btn.disabled = true;
        btn.textContent = 'Collecting…';
        try {
          await apiCall('matchfee.pay', { matchId: matchId, teamId: teamId, mode: mode });
          showToast('Match Fee collected for ' + (side === 'team1' ? m.team1.collegeName : m.team2.collegeName));
          await _refreshMatchDetail(null);
        } catch (err) {
          await _refreshMatchDetail(err.message);
        }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.mf-resend-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const txId = btn.getAttribute('data-txid');
        const statusEl = document.querySelector('.mf-resend-status[data-txid="' + txId + '"]');
        statusEl.textContent = 'Sending…';
        try {
          const result = await apiCall('matchfee.receipt.resend', { transactionId: txId, recipientEmails: [] });
          statusEl.textContent = result.emailStatus === 'SENT' ? 'Resent.' : 'Resend attempt status: ' + result.emailStatus;
        } catch (err) {
          statusEl.textContent = err.message;
        }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.mf-void-toggle-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const txId = btn.getAttribute('data-txid');
        document.querySelector('.mf-void-form[data-txid="' + txId + '"]').style.display = 'block';
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.mf-void-confirm-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const txId = btn.getAttribute('data-txid');
        const reason = document.querySelector('.mf-void-reason[data-txid="' + txId + '"]').value.trim();
        const statusEl = document.querySelector('.mf-void-status[data-txid="' + txId + '"]');
        if (!reason) { statusEl.textContent = 'A reason is required.'; return; }
        statusEl.textContent = 'Voiding…';
        try {
          await apiCall('matchfee.transaction.void', { transactionId: txId, reason: reason });
          showToast('Match Fee transaction voided.');
          await _refreshMatchDetail(null);
        } catch (err) {
          statusEl.textContent = err.message;
        }
      });
    });

    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
