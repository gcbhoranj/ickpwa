// rooms.js — Admin's room master screen (create + list rooms).

async function renderRoomsScreen(root, user) {
  root.innerHTML = '<div class="wizard-card"><h1>Rooms</h1><p>Loading…</p></div>';
  await refresh();

  async function refresh() {
    const data = await apiCall('rooms.list', {});
    root.innerHTML =
      '<div class="wizard-card">' +
        '<h1>Rooms</h1>' +
        '<div id="rooms-error" class="error" style="display:none"></div>' +
        '<table><thead><tr><th>Room No.</th><th>Building</th><th>Floor</th><th>Capacity</th><th>Remaining</th><th>Status</th></tr></thead>' +
        '<tbody>' +
          data.rooms.map(function (r) {
            return '<tr><td>' + r.roomNumber + '</td><td>' + r.building + '</td><td>' + r.floor + '</td>' +
              '<td>' + r.capacity + '</td><td>' + r.remaining + '</td><td>' + r.status + '</td></tr>';
          }).join('') +
        '</tbody></table>' +
        '<h2>Add Room</h2>' +
        '<form id="add-room-form">' +
          '<label>Room Number<input type="text" id="new-room-number" required></label>' +
          '<label>Building<input type="text" id="new-room-building"></label>' +
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
