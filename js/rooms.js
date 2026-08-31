// rooms.js — Admin's room master screen (create + edit + list rooms). Every room is one of
// two types: TEAM (on-campus, for team members) or INCHARGE (rest houses/hotels, for
// contingent incharges) — shown as two separate tables since they're allocated separately.

function _roomsTable(rooms) {
  if (rooms.length === 0) return '<p>None yet.</p>';
  return '<div style="overflow-x:auto"><table><thead><tr><th>Room No.</th><th>Building</th><th>Floor</th><th>Capacity</th><th>Remaining</th><th>Status</th><th></th></tr></thead>' +
    '<tbody>' +
      rooms.map(function (r) {
        return '<tr><td>' + r.roomNumber + '</td><td>' + r.building + '</td><td>' + r.floor + '</td>' +
          '<td>' + r.capacity + '</td><td>' + r.remaining + '</td><td>' + r.status + '</td>' +
          '<td>' +
            '<button type="button" class="edit-room-btn toggle-btn" data-roomid="' + r.roomId + '">Edit</button> ' +
            '<button type="button" class="delete-room-btn toggle-btn" data-roomid="' + r.roomId + '" style="background:var(--error)">Delete</button>' +
            '<div class="delete-room-confirm" data-roomid="' + r.roomId + '" style="display:none;margin-top:6px">' +
              '<p class="error" style="margin:0 0 6px">Delete room ' + r.roomNumber + '? This cannot be undone.</p>' +
              '<button type="button" class="delete-room-confirm-btn" data-roomid="' + r.roomId + '" style="background:var(--error)">Confirm Delete</button> ' +
              '<button type="button" class="delete-room-cancel-btn" data-roomid="' + r.roomId + '" style="background:#999">Cancel</button>' +
            '</div>' +
          '</td></tr>';
      }).join('') +
    '</tbody></table></div>';
}

async function renderRoomsScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Rooms</h1><p>Loading…</p></div>';
  await refresh(null);

  // editingRoom: null shows the "Add Room" form; a room object (from the last fetched list)
  // shows an "Edit Room" form pre-filled with that room's current values instead — never both
  // at once, matching this app's one-clear-screen-state convention.
  async function refresh(editingRoom) {
    const data = await apiCall('rooms.list', {});
    const teamRooms = data.rooms.filter(function (r) { return r.roomType === 'TEAM'; });
    const inchargeRooms = data.rooms.filter(function (r) { return r.roomType === 'INCHARGE'; });
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Rooms</h1>' +
        '<div id="rooms-error" class="error" style="display:none"></div>' +
        '<h2>Team Rooms (on-campus)</h2>' + _roomsTable(teamRooms) +
        '<h2>Incharge Rooms (rest houses / hotels)</h2>' + _roomsTable(inchargeRooms) +
        (editingRoom
          ? '<h2>Edit Room</h2>' +
            '<form id="edit-room-form">' +
              '<label>Room Number<input type="text" id="edit-room-number" value="' + editingRoom.roomNumber + '" required></label>' +
              '<label>Building / Venue<input type="text" id="edit-room-building" value="' + editingRoom.building + '"></label>' +
              '<label>Floor<input type="text" id="edit-room-floor" value="' + editingRoom.floor + '"></label>' +
              '<label>Capacity<input type="number" id="edit-room-capacity" min="1" value="' + editingRoom.capacity + '" required></label>' +
              '<button type="submit">Save Changes</button>' +
            '</form>' +
            '<button type="button" id="edit-room-cancel-btn" style="margin-top:8px;background:#999">Cancel</button>'
          : '<h2>Add Room</h2>' +
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
            '</form>') +
        '<button id="back-btn" style="margin-top:16px;background:#999">Back</button>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.edit-room-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const roomId = btn.getAttribute('data-roomid');
        const room = data.rooms.filter(function (r) { return r.roomId === roomId; })[0];
        refresh(room);
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.delete-room-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const roomId = btn.getAttribute('data-roomid');
        document.querySelector('.delete-room-confirm[data-roomid="' + roomId + '"]').style.display = 'block';
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.delete-room-cancel-btn'), function (btn) {
      btn.addEventListener('click', function () {
        const roomId = btn.getAttribute('data-roomid');
        document.querySelector('.delete-room-confirm[data-roomid="' + roomId + '"]').style.display = 'none';
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.delete-room-confirm-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const roomId = btn.getAttribute('data-roomid');
        const room = data.rooms.filter(function (r) { return r.roomId === roomId; })[0];
        const errEl = document.getElementById('rooms-error');
        errEl.style.display = 'none';
        try {
          await apiCall('admin.rooms.delete', { roomId: roomId });
          showToast('Room ' + (room ? room.roomNumber : roomId) + ' has been deleted');
          await refresh(null);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });

    if (editingRoom) {
      document.getElementById('edit-room-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const errEl = document.getElementById('rooms-error');
        errEl.style.display = 'none';
        try {
          const roomNumber = document.getElementById('edit-room-number').value.trim();
          await apiCall('admin.rooms.update', {
            roomId: editingRoom.roomId,
            roomNumber: roomNumber,
            building: document.getElementById('edit-room-building').value.trim(),
            floor: document.getElementById('edit-room-floor').value.trim(),
            capacity: Number(document.getElementById('edit-room-capacity').value)
          });
          showToast('Room ' + roomNumber + ' has been updated');
          await refresh(null);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
      document.getElementById('edit-room-cancel-btn').addEventListener('click', function () {
        refresh(null);
      });
    } else {
      document.getElementById('add-room-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const errEl = document.getElementById('rooms-error');
        errEl.style.display = 'none';
        try {
          const roomNumber = document.getElementById('new-room-number').value.trim();
          await apiCall('admin.rooms.create', {
            roomType: document.getElementById('new-room-type').value,
            roomNumber: roomNumber,
            building: document.getElementById('new-room-building').value.trim(),
            floor: document.getElementById('new-room-floor').value.trim(),
            capacity: Number(document.getElementById('new-room-capacity').value)
          });
          showToast('Room ' + roomNumber + ' has been added');
          await refresh(null);
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    }

    document.getElementById('back-btn').addEventListener('click', function () {
      goBack();
    });
  }
}
