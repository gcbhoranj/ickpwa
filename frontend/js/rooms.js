// rooms.js — Admin's room master screen (create + list rooms). Every room is one of two
// types: TEAM (on-campus, for team members) or INCHARGE (rest houses/hotels, for contingent
// incharges) — shown as two separate tables since they're allocated separately.

function _roomsTable(rooms) {
  if (rooms.length === 0) return '<p>None yet.</p>';
  return '<table><thead><tr><th>Room No.</th><th>Building</th><th>Floor</th><th>Capacity</th><th>Remaining</th><th>Status</th></tr></thead>' +
    '<tbody>' +
      rooms.map(function (r) {
        return '<tr><td>' + r.roomNumber + '</td><td>' + r.building + '</td><td>' + r.floor + '</td>' +
          '<td>' + r.capacity + '</td><td>' + r.remaining + '</td><td>' + r.status + '</td></tr>';
      }).join('') +
    '</tbody></table>';
}

async function renderRoomsScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Rooms</h1><p>Loading…</p></div>';
  await refresh();

  async function refresh() {
    const data = await apiCall('rooms.list', {});
    const teamRooms = data.rooms.filter(function (r) { return r.roomType === 'TEAM'; });
    const inchargeRooms = data.rooms.filter(function (r) { return r.roomType === 'INCHARGE'; });
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Rooms</h1>' +
        '<div id="rooms-error" class="error" style="display:none"></div>' +
        '<h2>Team Rooms (on-campus)</h2>' + _roomsTable(teamRooms) +
        '<h2>Incharge Rooms (rest houses / hotels)</h2>' + _roomsTable(inchargeRooms) +
        '<h2>Add Room</h2>' +
        '<form id="add-room-form">' +
          '<label>Room Type<select id="new-room-type">' +
            '<option value="TEAM">Team (on-campus)</option>' +
            '<option value="INCHARGE">Incharge (rest house / hotel)</option>' +
          '</select></label>' +
          '<label>Room Number<input type="text" id="new-room-number" required></label>' +
          '<label>Building / Venue<input type="text" id="new-room-building"></label>' +
          '<label>Floor<input type="text" id="new-room-floor"></label>' +
          '<label>Capacity<input type="number" id="new-room-capacity" min="1" required></label>' +
          '<button type="submit">Add Room</button>' +
        '</form>' +
        '<button id="back-btn" style="margin-top:16px;background:#999">Back</button>' +
      '</div>';

    document.getElementById('add-room-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errEl = document.getElementById('rooms-error');
      errEl.style.display = 'none';
      try {
        await apiCall('admin.rooms.create', {
          roomType: document.getElementById('new-room-type').value,
          roomNumber: document.getElementById('new-room-number').value.trim(),
          building: document.getElementById('new-room-building').value.trim(),
          floor: document.getElementById('new-room-floor').value.trim(),
          capacity: Number(document.getElementById('new-room-capacity').value)
        });
        await refresh();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    document.getElementById('back-btn').addEventListener('click', function () {
      renderLanding(root, user);
    });
  }
}
