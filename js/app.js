// app.js — page bootstrap: show login, or route to a role-labeled landing/dashboard.

// --- In-app navigation history --------------------------------------------------------
// Every screen in this app is just a function that overwrites #app-root's innerHTML —
// there was no browser History API involvement at all, so the physical/hardware back
// button (or an edge-swipe gesture) had nothing of ours to step back into: it exited the
// page outright, which on an installed/kiosk PWA closes the app. `navigateTo` pushes one
// history entry per screen change and keeps its own stack of {fn, args}, so a `popstate`
// (back button/gesture) re-renders the previous screen instead of leaving the app. Screens
// call `goBack()` for their own "Back" buttons too, so an on-screen Back button and the
// physical back button always agree.
const screenStack = [];

function navigateTo(renderFn) {
  const args = Array.prototype.slice.call(arguments, 1);
  screenStack.push({ fn: renderFn, args: args });
  history.pushState({ depth: screenStack.length }, '');
  renderFn.apply(null, args);
}

// For transitions that should NOT be reachable by going back into what they replaced
// (e.g. login -> landing: going back shouldn't re-show the login form while still
// authenticated). Swaps the top of the stack instead of growing it.
function navigateReplace(renderFn) {
  const args = Array.prototype.slice.call(arguments, 1);
  if (screenStack.length > 0) screenStack.pop();
  screenStack.push({ fn: renderFn, args: args });
  renderFn.apply(null, args);
}

// For the initial paint (bootstrap) and logout: clears the whole in-app stack. Note the
// History API has no way to truly erase earlier browser history entries from script, so a
// determined multiple-back-presses-after-logout could still walk into a stale popstate —
// the listener below is defensive against that (it only acts once the stack it can see has
// more than one entry), but a fully "sealed" history isn't something this API can give us.
function resetNavigation(renderFn) {
  const args = Array.prototype.slice.call(arguments, 1);
  screenStack.length = 0;
  screenStack.push({ fn: renderFn, args: args });
  history.replaceState({ depth: 1 }, '');
  renderFn.apply(null, args);
}

function goBack() {
  history.back();
}

window.addEventListener('popstate', function () {
  if (screenStack.length > 1) {
    screenStack.pop();
    const previous = screenStack[screenStack.length - 1];
    previous.fn.apply(null, previous.args);
  }
  // Only one screen left on our stack: nothing more of the app's to go back into — let
  // the browser's own default behavior (leave the page) proceed.
});

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
      navigateReplace(renderLanding, root, user);
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
      navigateTo(renderUsersScreen, root, user);
    });
    document.getElementById('settings-btn').addEventListener('click', function () {
      navigateTo(renderSettingsScreen, root, user);
    });
    document.getElementById('rooms-btn').addEventListener('click', function () {
      navigateTo(renderRoomsScreen, root, user);
    });
  }
  document.getElementById('logout-btn').addEventListener('click', async function () {
    await logout();
    resetNavigation(renderLogin, root, null);
  });
}

(async function bootstrap() {
  const root = document.getElementById('app-root');
  const restored = await restoreSession();
  if (restored) {
    resetNavigation(renderLanding, root, restored);
  } else {
    resetNavigation(renderLogin, root, null);
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(function () {});
  }
})();
