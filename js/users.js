// users.js — Admin's user management screen. Only reachable when the logged-in role is ADMIN
// (server-side enforced regardless — see backend/Auth.gs's requireRole_ on every action here).

async function renderUsersScreen(root, user) {
  root.innerHTML =
    '<div class="users-card">' +
      '<h1>Users</h1>' +
      '<p class="subtitle">Signed in as ' + user.name + ' (Admin)</p>' +
      '<div id="users-error" class="error" style="display:none"></div>' +
      '<div style="overflow-x:auto"><table id="users-table"><thead><tr>' +
        '<th>Name</th><th>Login ID / Email</th><th>Role</th><th>Active</th><th></th>' +
      '</tr></thead><tbody id="users-tbody"></tbody></table></div>' +
      '<h2>Add User</h2>' +
      '<form id="add-user-form">' +
        '<label>Name<input type="text" id="new-name" required></label>' +
        '<label>Role<select id="new-role">' +
          '<option value="REGISTRATION">Registration</option>' +
          '<option value="MESS">Mess</option>' +
          '<option value="ACCOMMODATION">Accommodation</option>' +
          '<option value="ADMIN">Admin</option>' +
        '</select></label>' +
        '<label id="loginid-label">Login ID<input type="text" id="new-loginid"></label>' +
        '<label id="email-label" style="display:none">Email<input type="email" id="new-email"></label>' +
        '<label>Password<input type="password" id="new-password" required></label>' +
        '<button type="submit">Add User</button>' +
      '</form>' +
      '<button id="back-btn" style="margin-top:16px">Back</button>' +
    '</div>';

  const roleSelect = document.getElementById('new-role');
  roleSelect.addEventListener('change', function () {
    const isAdmin = roleSelect.value === 'ADMIN';
    document.getElementById('loginid-label').style.display = isAdmin ? 'none' : 'block';
    document.getElementById('email-label').style.display = isAdmin ? 'block' : 'none';
  });

  async function refreshList() {
    const data = await apiCall('admin.users.list', {});
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = data.users.map(function (u) {
      return '<tr>' +
        '<td>' + u.name + '</td>' +
        '<td>' + (u.loginId || u.email) + '</td>' +
        '<td>' + u.role + '</td>' +
        '<td>' + (u.active ? 'Active' : 'Disabled') + '</td>' +
        '<td><button data-userid="' + u.userId + '" data-active="' + u.active + '" class="toggle-btn">' +
          (u.active ? 'Disable' : 'Enable') + '</button></td>' +
      '</tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.toggle-btn'), function (btn) {
      btn.addEventListener('click', async function () {
        const errEl = document.getElementById('users-error');
        errEl.style.display = 'none';
        try {
          await apiCall('admin.users.setActive', {
            userId: btn.getAttribute('data-userid'),
            active: btn.getAttribute('data-active') !== 'true'
          });
          await refreshList();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
        }
      });
    });
  }

  document.getElementById('add-user-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const errEl = document.getElementById('users-error');
    errEl.style.display = 'none';
    const role = roleSelect.value;
    try {
      await apiCall('admin.users.create', {
        name: document.getElementById('new-name').value.trim(),
        role: role,
        loginId: document.getElementById('new-loginid').value.trim(),
        email: document.getElementById('new-email').value.trim(),
        password: document.getElementById('new-password').value
      });
      document.getElementById('add-user-form').reset();
      await refreshList();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  document.getElementById('back-btn').addEventListener('click', function () {
    goBack();
  });

  await refreshList();
}
