// accommodation.js — Accommodation Dashboard: the ACCOMMODATION role's first real screen.
// Two independent pending lists, each allocated only into rooms of the matching type
// (Rooms.gs ROOM_TYPES): TEAM (team members, on-campus rooms — every registered team,
// unconditional) and INCHARGE (contingent incharges flagged at registration, rest
// houses/hotels). No reallocate/vacate/NOC here — those depend on the departure workflow
// and stay in the real future Phase 6.

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

async function renderAccommodationDashboard(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Welcome, ' + user.name + '</h1><p class="subtitle">Accommodation Committee</p><p>Loading…</p></div>';
  await refresh();

  async function refresh() {
    const pendingTeams = await apiCall('accommodation.listPending', { kind: 'TEAM' });
    const pendingIncharges = await apiCall('accommodation.listPending', { kind: 'INCHARGE' });
    const roomsData = await apiCall('rooms.list', {});
    const teamRooms = roomsData.rooms.filter(function (r) { return r.roomType === 'TEAM'; });
    const inchargeRooms = roomsData.rooms.filter(function (r) { return r.roomType === 'INCHARGE'; });

    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Welcome, ' + user.name + '</h1>' +
        '<p class="subtitle">Accommodation Committee</p>' +
        '<div id="accom-error" class="error" style="display:none"></div>' +
        _pendingSection('TEAM', 'Teams Needing Accommodation', pendingTeams.teams, 'No teams currently have members waiting for a room.') +
        _pendingSection('INCHARGE', 'Incharges Needing Accommodation', pendingIncharges.teams, 'No teams currently have incharges waiting for a room.') +
        _roomsSection('Team Rooms (on-campus)', teamRooms) +
        _roomsSection('Incharge Rooms (rest houses / hotels)', inchargeRooms) +
        '<button id="logout-btn" style="margin-top:16px">Log Out</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.allocate-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const kind = btn.getAttribute('data-kind');
        const roomList = kind === 'TEAM' ? teamRooms : inchargeRooms;
        renderAllocateForm(kind, btn.getAttribute('data-teamid'), Number(btn.getAttribute('data-remaining')), roomList);
      });
    });

    document.getElementById('logout-btn').addEventListener('click', async function () {
      await logout();
      renderLogin(root, null);
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
}
