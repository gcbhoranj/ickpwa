// accommodation.js — Accommodation Dashboard: two pending lists (allocate), two active-
// allocation lists (reallocate/vacate), and the NOC screen (spec §13's 3-screen Accommodation
// nav: Teams [reuses registration.js's renderTeamsList/renderTeamDetail, same pattern Phase 5
// used for Mess] · Rooms [this dashboard] · NOC).

function _pendingSection(kind, title, pending, noneText) {
  if (pending.length === 0) return '<h2>' + title + '</h2><p>' + noneText + '</p>';
  return '<h2>' + title + '</h2>' +
    '<table><thead><tr><th>Reg. No.</th><th>College</th><th>Remaining</th><th></th></tr></thead><tbody>' +
      pending.map(function (t) {
        return '<tr><td>' + t.registrationNumber + '</td><td>' + t.collegeName + '</td><td>' + t.remainingCount + '</td>' +
          '<td><button class="allocate-btn" data-kind="' + kind + '" data-teamid="' + t.teamId + '" data-remaining="' + t.remainingCount + '">Allocate</button></td></tr>';
      }).join('') +
    '</tbody></table>';
}

function _roomsSection(title, rooms) {
  if (rooms.length === 0) return '<h2>' + title + '</h2><p>None yet.</p>';
  return '<h2>' + title + '</h2>' +
    '<table><thead><tr><th>Building / Hotel</th><th>Room No.</th><th>Capacity</th><th>Remaining</th><th>Status</th></tr></thead><tbody>' +
      rooms.map(function (r) {
        return '<tr><td>' + r.building + '</td><td>' + r.roomNumber + '</td><td>' + r.capacity + '</td><td>' + r.remaining + '</td><td>' + r.status + '</td></tr>';
      }).join('') +
    '</tbody></table>';
}

function _activeSection(kind, title, active, noneText) {
  if (active.length === 0) return '<h2>' + title + '</h2><p>' + noneText + '</p>';
  return '<h2>' + title + '</h2>' +
    '<table><thead><tr><th>Reg. No.</th><th>College</th><th>Room</th><th>Persons</th><th></th><th></th></tr></thead><tbody>' +
      active.map(function (a) {
        return '<tr><td>' + a.registrationNumber + '</td><td>' + a.collegeName + '</td>' +
          '<td>' + (a.building ? a.building + ' — ' : '') + a.roomNumber + '</td><td>' + a.personsAllocated + '</td>' +
          '<td><button class="reallocate-btn" data-kind="' + kind + '" data-allocid="' + a.allocationId + '">Reallocate</button></td>' +
          '<td><button class="vacate-btn" data-allocid="' + a.allocationId + '">Vacate</button></td></tr>';
      }).join('') +
    '</tbody></table>';
}

async function renderAccommodationDashboard(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Welcome, ' + user.name + '</h1><p class="subtitle">Accommodation Committee</p><p>Loading…</p></div>';
  await refresh();

  async function refresh() {
    const pendingTeams = await apiCall('accommodation.listPending', { kind: 'TEAM' });
    const pendingIncharges = await apiCall('accommodation.listPending', { kind: 'INCHARGE' });
    const activeTeams = await apiCall('accommodation.listActive', { kind: 'TEAM' });
    const activeIncharges = await apiCall('accommodation.listActive', { kind: 'INCHARGE' });
    const roomsData = await apiCall('rooms.list', {});
    const teamRooms = roomsData.rooms.filter(function (r) { return r.roomType === 'TEAM'; });
    const inchargeRooms = roomsData.rooms.filter(function (r) { return r.roomType === 'INCHARGE'; });

    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Welcome, ' + user.name + '</h1>' +
        '<p class="subtitle">Accommodation Committee</p>' +
        '<div id="accom-error" class="error" style="display:none"></div>' +
        '<button id="teams-btn" style="margin-bottom:12px">Teams</button>' +
        _pendingSection('TEAM', 'Teams Needing Accommodation', pendingTeams.teams, 'No teams currently have members waiting for a room.') +
        _pendingSection('INCHARGE', 'Incharges Needing Accommodation', pendingIncharges.teams, 'No teams currently have incharges waiting for a room.') +
        _activeSection('TEAM', 'Team Rooms — Currently Allocated', activeTeams.allocations, 'No active team allocations yet.') +
        _activeSection('INCHARGE', 'Incharge Rooms — Currently Allocated', activeIncharges.allocations, 'No active incharge allocations yet.') +
        _roomsSection('Team Rooms (on-campus)', teamRooms) +
        _roomsSection('Incharge Rooms (rest houses / hotels)', inchargeRooms) +
        '<button id="logout-btn" style="margin-top:16px">Log Out</button>' +
      '</div>';

    document.getElementById('teams-btn').addEventListener('click', function () { navigateTo(renderTeamsList, root, user); });

    Array.prototype.forEach.call(document.querySelectorAll('.allocate-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const kind = btn.getAttribute('data-kind');
        const roomList = kind === 'TEAM' ? teamRooms : inchargeRooms;
        renderAllocateForm(kind, btn.getAttribute('data-teamid'), Number(btn.getAttribute('data-remaining')), roomList);
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.vacate-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('accom-error');
        errEl.style.display = 'none';
        try {
          await apiCall('accommodation.vacateRoom', { allocationId: btn.getAttribute('data-allocid') });
          await refresh();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.reallocate-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const kind = btn.getAttribute('data-kind');
        const roomList = kind === 'TEAM' ? teamRooms : inchargeRooms;
        renderReallocateForm(btn.getAttribute('data-allocid'), roomList);
      });
    });

    document.getElementById('logout-btn').addEventListener('click', async function () {
      await logout();
      resetNavigation(renderLogin, root, null);
    });
  }

  function renderAllocateForm(kind, teamId, remaining, roomList) {
    const availableRooms = roomList.filter(function (r) { return r.remaining > 0; });
    const subjectLabel = kind === 'TEAM' ? 'team member(s)' : 'incharge(s)';
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Allocate Room</h1>' +
        '<p class="subtitle">' + remaining + ' ' + subjectLabel + ' still need a room</p>' +
        '<div id="allocate-error" class="error" style="display:none"></div>' +
        '<form id="allocate-form">' +
          '<label>Room<select id="allocate-room">' +
            availableRooms.map(function (r) {
              return '<option value="' + r.roomId + '">' + (r.building ? r.building + ' — ' : '') + r.roomNumber + ' (remaining: ' + r.remaining + ')</option>';
            }).join('') +
          '</select></label>' +
          '<label>Persons to Allocate<input type="number" id="allocate-persons" min="1" max="' + remaining + '" value="1" required></label>' +
          '<button type="submit">Allocate</button>' +
        '</form>' +
        '<button id="cancel-btn" style="margin-top:8px;background:#999">Cancel</button>' +
      '</div>';

    document.getElementById('cancel-btn').addEventListener('click', function () { refresh(); });

    document.getElementById('allocate-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('allocate-error');
      errEl.style.display = 'none';
      try {
        await apiCall('accommodation.allocateRoom', {
          kind: kind,
          teamId: teamId,
          roomId: document.getElementById('allocate-room').value,
          personsAllocated: Number(document.getElementById('allocate-persons').value)
        });
        await refresh();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }

  function renderReallocateForm(allocationId, roomList) {
    const availableRooms = roomList.filter(function (r) { return r.remaining > 0; });
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Reallocate Room</h1>' +
        '<div id="reallocate-error" class="error" style="display:none"></div>' +
        '<form id="reallocate-form">' +
          '<label>New Room<select id="reallocate-room">' +
            availableRooms.map(function (r) {
              return '<option value="' + r.roomId + '">' + (r.building ? r.building + ' — ' : '') + r.roomNumber + ' (remaining: ' + r.remaining + ')</option>';
            }).join('') +
          '</select></label>' +
          '<button type="submit">Reallocate</button>' +
        '</form>' +
        '<button id="cancel-btn" style="margin-top:8px;background:#999">Cancel</button>' +
      '</div>';

    document.getElementById('cancel-btn').addEventListener('click', function () { refresh(); });

    document.getElementById('reallocate-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('reallocate-error');
      errEl.style.display = 'none';
      try {
        await apiCall('accommodation.reallocateRoom', {
          allocationId: allocationId,
          newRoomId: document.getElementById('reallocate-room').value
        });
        await refresh();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });
  }
}

// Reached from registration.js's renderTeamDetail via the Accommodation role's "Accommodation
// NOC" button (Team Detail is already reused across roles — Phase 5 did the same for Mess).
async function renderNocScreen(root, user, teamId, registrationNumber, collegeName) {
  root.innerHTML = '<div class="wizard-card"><h1>Accommodation NOC</h1><p>Loading…</p></div>';
  const status = await apiCall('accommodation.noc.status', { teamId: teamId });
  render(status);

  function render(status) {
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Accommodation NOC</h1>' +
        '<p class="subtitle">' + collegeName + ' &middot; ' + registrationNumber + '</p>' +
        '<div id="noc-error" class="error" style="display:none"></div>' +
        '<p>Status: <strong>' + status.status + '</strong></p>' +
        (status.status === 'NOC_GRANTED'
          ? '<a href="' + status.pdfUrl + '" target="_blank" rel="noopener"><button type="button">View NOC Certificate</button></a>'
          : '<button id="grant-btn">Grant NOC</button>') +
        '<button id="back-btn" style="margin-top:12px">Back</button>' +
      '</div>';

    if (status.status !== 'NOC_GRANTED') {
      document.getElementById('grant-btn').addEventListener('click', async function () {
        const errEl = document.getElementById('noc-error');
        errEl.style.display = 'none';
        try {
          const granted = await apiCall('accommodation.noc.issue', { teamId: teamId });
          render({ status: 'NOC_GRANTED', pdfUrl: granted.pdfUrl });
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    }
    document.getElementById('back-btn').addEventListener('click', function () { goBack(); });
  }
}
