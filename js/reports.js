// reports.js — Phase 9: Admin Dashboard, Reports (tab-switched over one already-fetched
// bundle — no extra round trip per tab), and Audit Log.

async function renderAdminDashboard(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Welcome, ' + user.name + '</h1><p>Loading…</p></div>';
  const bundle = await apiCall('reports.getAll', {});
  const d = bundle.dashboard;
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">Admin Dashboard</p>' +
      '<h2>Summary</h2>' +
      '<p>Teams: ' + d.totalTeams + ' (' + Object.keys(d.teamsByStatus).map(function (s) { return s + ': ' + d.teamsByStatus[s]; }).join(', ') + ')</p>' +
      '<p>Total Contingent Persons: ' + d.totalContingentPersons + '</p>' +
      '<p>Packages Sold: ' + d.totalPackagesSold + ' &middot; Revenue: Rs ' + d.totalPackageRevenue + '</p>' +
      '<p>Dari Collected: Rs ' + d.totalDariCharges + ' &middot; Security Collected: Rs ' + d.totalSecurityCollected + '</p>' +
      '<p>Food Refunds: Rs ' + d.totalFoodRefunds + ' &middot; Security Refunds: Rs ' + d.totalSecurityRefunds + '</p>' +
      '<p>Team Rooms: ' + d.roomsTeam.allocated + '/' + d.roomsTeam.capacity + ' allocated &middot; Incharge Rooms: ' + d.roomsIncharge.allocated + '/' + d.roomsIncharge.capacity + ' allocated</p>' +
      '<p>NOC Granted: ' + d.nocGrantedCount + ' &middot; Pending: ' + d.nocPendingCount + '</p>' +
      '<p>Match Fee — Collected: Rs ' + d.matchFeeCollected + ' &middot; Pending Team Payments: ' + d.matchFeePending + ' &middot; Team Payments: ' + d.matchFeeTeamPayments + ' &middot; Receipts: ' + d.matchFeeReceiptsGenerated + '</p>' +
      '<button id="manage-users-btn" style="margin-top:12px">Manage Users</button>' +
      '<button id="settings-btn">Settings</button>' +
      '<button id="rooms-btn">Rooms</button>' +
      '<button id="reports-btn">Reports</button>' +
      '<button id="audit-log-btn">Audit Log</button>' +
      '<button id="logout-btn" style="margin-top:12px">Log Out</button>' +
    '</div>';
  document.getElementById('manage-users-btn').addEventListener('click', function () { navigateTo(renderUsersScreen, root, user); });
  document.getElementById('settings-btn').addEventListener('click', function () { navigateTo(renderSettingsScreen, root, user); });
  document.getElementById('rooms-btn').addEventListener('click', function () { navigateTo(renderRoomsScreen, root, user); });
  document.getElementById('reports-btn').addEventListener('click', function () { navigateTo(renderReportsScreen, root, user, bundle); });
  document.getElementById('audit-log-btn').addEventListener('click', function () { navigateTo(renderAuditLogScreen, root, user); });
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    resetNavigation(renderLogin, root, null);
  });
}

function _renderReportTab(tab, bundle) {
  if (tab === 'financial') {
    return '<div style="overflow-x:auto"><table><thead><tr><th>Reg No</th><th>College</th><th>Dari</th><th>Security</th><th>Food Revenue</th><th>Food Refund</th><th>Security Refunded</th><th>Final Balance</th></tr></thead><tbody>' +
      bundle.financial.map(function (r) {
        return '<tr><td>' + r.registrationNumber + '</td><td>' + r.collegeName + '</td><td>' + r.dariCharges + '</td><td>' + r.securityCharges + '</td><td>' + r.packageRevenue + '</td><td>' + r.foodRefund + '</td><td>' + r.securityRefunded + '</td><td>' + (r.settled ? r.finalBalance : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  if (tab === 'food') {
    return '<div style="overflow-x:auto"><table><thead><tr><th>Reg No</th><th>College</th><th>Packages</th><th>Revenue</th><th>Eligible</th><th>Served</th><th>Remaining</th><th>Refunded</th></tr></thead><tbody>' +
      bundle.food.map(function (r) {
        return '<tr><td>' + r.registrationNumber + '</td><td>' + r.collegeName + '</td><td>' + r.packagesCount + '</td><td>' + r.packageRevenue + '</td><td>' + r.totalEligible + '</td><td>' + r.totalServed + '</td><td>' + r.totalRemaining + '</td><td>' + r.totalFoodRefund + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  if (tab === 'accommodation') {
    return '<h3>Rooms</h3><div style="overflow-x:auto"><table><thead><tr><th>Room</th><th>Type</th><th>Capacity</th><th>Allocated</th><th>Remaining</th><th>Status</th></tr></thead><tbody>' +
      bundle.accommodation.rooms.map(function (r) {
        return '<tr><td>' + (r.building ? r.building + ' — ' : '') + r.roomNumber + '</td><td>' + r.roomType + '</td><td>' + r.capacity + '</td><td>' + r.allocated + '</td><td>' + r.remaining + '</td><td>' + r.status + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<h3 style="margin-top:12px">Teams</h3><div style="overflow-x:auto"><table><thead><tr><th>Reg No</th><th>College</th><th>Members Allocated</th><th>Needed</th><th>Incharges Allocated</th><th>NOC</th></tr></thead><tbody>' +
      bundle.accommodation.teams.map(function (r) {
        return '<tr><td>' + r.registrationNumber + '</td><td>' + r.collegeName + '</td><td>' + r.teamMembersAllocated + '</td><td>' + r.teamMembersNeeded + '</td><td>' + r.inchargesAllocated + '</td><td>' + r.nocStatus + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  if (tab === 'departure') {
    return '<div style="overflow-x:auto"><table><thead><tr><th>Reg No</th><th>College</th><th>Status</th><th>Locked By</th></tr></thead><tbody>' +
      bundle.departure.map(function (r) {
        return '<tr><td>' + r.registrationNumber + '</td><td>' + r.collegeName + '</td><td>' + r.status + '</td><td>' + (r.departureLockedBy || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  if (tab === 'matchFee') {
    const s = bundle.matchFee.summary;
    return '<p>Total Collected: Rs ' + s.totalCollected + ' &middot; Matches: ' + s.matchesCount + ' &middot; Team Payments: ' + s.teamPaymentsCount + ' &middot; Pending: ' + s.pendingCount + '</p>' +
      '<p>Cash: Rs ' + s.cashCollected + ' &middot; Online: Rs ' + s.onlineCollected + ' &middot; Cheque: Rs ' + s.chequeCollected + '</p>' +
      '<div style="overflow-x:auto"><table><thead><tr><th>Match No</th><th>Date</th><th>Paying Team</th><th>Opponent</th><th>Amount</th><th>Receipt No.</th><th>Method</th><th>Paid At</th><th>Collected By</th><th>Status</th></tr></thead><tbody>' +
      bundle.matchFee.transactions.map(function (t) {
        return '<tr><td>' + t.matchNumber + '</td><td>' + t.matchDate + '</td><td>' + t.payingTeam + '</td><td>' + t.opponent + '</td><td>' + t.amount + '</td><td>' + t.receiptNumber + '</td><td>' + t.paymentMethod + '</td><td>' + t.paidAt + '</td><td>' + t.collectedBy + '</td><td>' + t.status + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  // 'final'
  if (bundle.collegeWiseFinalStatement.length === 0) return '<p>No teams have been finalized yet.</p>';
  return '<div style="overflow-x:auto"><table><thead><tr><th>Reg No</th><th>College</th><th>Gross</th><th>Food Refund</th><th>Net</th><th>Security Collected</th><th>Security Refunded</th><th>Adjustments</th><th>Final Balance</th><th>Documents</th></tr></thead><tbody>' +
    bundle.collegeWiseFinalStatement.map(function (r) {
      return '<tr><td>' + r.registrationNumber + '</td><td>' + r.collegeName + '</td><td>' + r.grossCharges + '</td><td>' + r.foodRefund + '</td><td>' + r.netCharges + '</td><td>' + r.securityCollected + '</td><td>' + r.securityRefunded + '</td><td>' + r.otherAdjustments + '</td><td>' + r.finalBalance + '</td>' +
        '<td>' + (r.receiptPdfUrl ? '<a href="' + r.receiptPdfUrl + '" target="_blank" rel="noopener">Receipt</a> ' : '') + (r.relievingPdfUrl ? '<a href="' + r.relievingPdfUrl + '" target="_blank" rel="noopener">Relieving</a>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function renderReportsScreen(root, user, bundle) {
  const tabs = [
    { key: 'financial', label: 'Financial' }, { key: 'food', label: 'Food' },
    { key: 'accommodation', label: 'Accommodation' }, { key: 'departure', label: 'Departure' },
    { key: 'final', label: 'Final Statement' }, { key: 'matchFee', label: 'Match Fee' }
  ];
  let activeTab = 'financial';
  render();

  function render() {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Reports</h1>' +
        '<div style="margin-bottom:12px">' +
          tabs.map(function (t) {
            return '<button class="tab-btn" data-tab="' + t.key + '" style="' + (t.key === activeTab ? 'font-weight:bold' : '') + '">' + t.label + '</button>';
          }).join('') +
        '</div>' +
        '<div style="overflow-x:auto">' + _renderReportTab(activeTab, bundle) + '</div>' +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (btn) {
      btn.addEventListener('click', function () { activeTab = btn.getAttribute('data-tab'); render(); });
    });
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}

async function renderAuditLogScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Audit Log</h1><p>Loading…</p></div>';
  const data = await apiCall('reports.auditLog', { limit: 200 });
  root.innerHTML =
    '<div class="wizard-card">' +
      '<h1>Audit Log</h1>' +
      '<p class="subtitle">Most recent ' + data.entries.length + ' entries</p>' +
      '<div style="overflow-x:auto"><table><thead><tr><th>Timestamp</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Entity ID</th></tr></thead><tbody>' +
        data.entries.map(function (e) {
          return '<tr><td>' + e.Timestamp + '</td><td>' + e.UserId + '</td><td>' + e.Role + '</td><td>' + e.Action + '</td><td>' + e.Entity + '</td><td>' + e.EntityId + '</td></tr>';
        }).join('') +
      '</tbody></table></div>' +
      '<button id="back-btn" style="margin-top:12px">Back</button>' +
    '</div>';
  document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
}
