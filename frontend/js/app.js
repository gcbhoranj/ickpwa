// app.js — page bootstrap: show login, or route to a role-labeled landing/dashboard.

const ROLE_LABELS = {
  ADMIN: 'Admin', REGISTRATION: 'Registration Committee',
  MESS: 'Mess Committee', ACCOMMODATION: 'Accommodation Committee'
};

function renderLogin(root, errorMessage) {
  root.innerHTML =
    '<div class="login-card">' +
      '<h1>HPU Inter-College Kabaddi 2026</h1>' +
      '<p class="subtitle">Government College Bhoranj (Tarkwari) &middot; 21&ndash;25 Sep 2026</p>' +
      (errorMessage ? '<p class="error">' + errorMessage + '</p>' : '') +
      '<form id="login-form">' +
        '<label>Login ID / Email<input type="text" id="identifier" required autocomplete="username"></label>' +
        '<label>Password<input type="password" id="password" required autocomplete="current-password"></label>' +
        '<button type="submit">Log In</button>' +
      '</form>' +
    '</div>';
  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const identifier = document.getElementById('identifier').value.trim();
    const password = document.getElementById('password').value;
    try {
      const user = await login(identifier, password);
      renderLanding(root, user);
    } catch (err) {
      renderLogin(root, err.message);
    }
  });
}

function renderLanding(root, user) {
  const isAdmin = user.role === 'ADMIN';
  const isRegistration = user.role === 'REGISTRATION';
  const isAccommodation = user.role === 'ACCOMMODATION';
  if (isRegistration) {
    renderRegistrationDashboard(root, user);
    return;
  }
  if (isAccommodation) {
    renderAccommodationDashboard(root, user);
    return;
  }
  root.innerHTML =
    '<div class="landing-card">' +
      '<h1>Welcome, ' + user.name + '</h1>' +
      '<p class="subtitle">' + (ROLE_LABELS[user.role] || user.role) + '</p>' +
      (isAdmin
        ? '<p>Manage committee accounts and tournament settings below. Other screens are built in a later phase.</p>'
        : '<p>This role\'s screens are built in a later phase. Foundation phase confirms your ' +
          'login and session work end-to-end.</p>') +
      (isAdmin ? '<button id="manage-users-btn">Manage Users</button>' : '') +
      (isAdmin ? '<button id="settings-btn">Settings</button>' : '') +
      (isAdmin ? '<button id="rooms-btn">Rooms</button>' : '') +
      '<button id="logout-btn">Log Out</button>' +
    '</div>';
  if (isAdmin) {
    document.getElementById('manage-users-btn').addEventListener('click', function () {
      renderUsersScreen(root, user);
    });
    document.getElementById('settings-btn').addEventListener('click', function () {
      renderSettingsScreen(root, user);
    });
    document.getElementById('rooms-btn').addEventListener('click', function () {
      renderRoomsScreen(root, user);
    });
  }
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    renderLogin(root, null);
  });
}

(async function bootstrap() {
  const root = document.getElementById('app-root');
  const restored = await restoreSession();
  if (restored) {
    renderLanding(root, restored);
  } else {
    renderLogin(root, null);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(function () {});
  }
})();
