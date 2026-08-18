// accommodation.js — Accommodation Dashboard: the ACCOMMODATION role's first real screen.
// Pending incharge-accommodation list + a single allocate action. No reallocate/vacate/NOC
// here — those depend on the departure workflow and stay in the real future Phase 6.

async function renderAccommodationDashboard(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Welcome, ' + user.name + '</h1><p class="subtitle">Accommodation Committee</p><p>Loading…</p></div>';
  await refresh();

  async function refresh() {
    const pending = await apiCall('accommodation.listPending', {});
    const rooms = await apiCall('rooms.list', {});
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Welcome, ' + user.name + '</h1>' +
        '<p class="subtitle">Accommodation Committee</p>' +
        '<div id="accom-error" class="error" style="display:none"></div>' +
        '<h2>Teams Needing Accommodation</h2>' +
        (pending.teams.length === 0
          ? '<p>No teams currently have incharges waiting for a room.</p>'
          : '<table><thead><tr><th>Reg. No.</th><th>College</th><th>Remaining</th><th></th></tr></thead><tbody>' +
              pending.teams.map(function (t) {
                return '<tr><td>' + t.registrationNumber + '</td><td>' + t.collegeName + '</td><td>' + t.remainingCount + '</td>' +
                  '<td><button class="allocate-btn" data-teamid="' + t.teamId + '" data-remaining="' + t.remainingCount + '">Allocate</button></td></tr>';
              }).join('') +
            '</tbody></table>') +
        '<h2>Rooms</h2>' +
        '<table><thead><tr><th>Room No.</th><th>Capacity</th><th>Remaining</th><th>Status</th></tr></thead><tbody>' +
          rooms.rooms.map(function (r) {
            return '<tr><td>' + r.roomNumber + '</td><td>' + r.capacity + '</td><td>' + r.remaining + '</td><td>' + r.status + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        '<button id="logout-btn" style="margin-top:16px">Log Out</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.allocate-btn'), function (btn) {
      btn.addEventListener('click', function () {
        renderAllocateForm(btn.getAttribute('data-teamid'), Number(btn.getAttribute('data-remaining')), rooms.rooms);
      });
    });

    document.getElementById('logout-btn').addEventListener('click', async function () {
      await logout();
      renderLogin(root, null);
    });
  }

  function renderAllocateForm(teamId, remaining, roomList) {
    const availableRooms = roomList.filter(function (r) { return r.remaining > 0; });
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Allocate Room</h1>' +
        '<p class="subtitle">' + remaining + ' incharge(s) still need a room</p>' +
        '<div id="allocate-error" class="error" style="display:none"></div>' +
        '<form id="allocate-form">' +
          '<label>Room<select id="allocate-room">' +
            availableRooms.map(function (r) {
              return '<option value="' + r.roomId + '">' + r.roomNumber + ' (remaining: ' + r.remaining + ')</option>';
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
