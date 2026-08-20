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

// Static fallback — used only if the pre-login public.getTournamentInfo fetch fails (e.g. a
// brand-new deployment before seedSettings_ has run) so the login screen never renders blank.
const LOGIN_FALLBACK_TITLE = 'HPU Inter-College Kabaddi 2026';
const LOGIN_FALLBACK_SUBTITLE = 'Government College Bhoranj (Tarkwari) · 21–25 Sep 2026';

function _formatTournamentDateRange(startDate, endDate) {
  if (!startDate || !endDate) return '';
  const opts = { day: 'numeric', month: 'short' };
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const startLabel = start.toLocaleDateString('en-IN', opts);
  const endLabel = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return startLabel + '–' + endLabel;
}

async function renderLogin(root, errorMessage) {
  root.innerHTML = '<div class="login-card"><h1>' + LOGIN_FALLBACK_TITLE + '</h1><p class="subtitle">Loading…</p></div>';
  let title = LOGIN_FALLBACK_TITLE;
  let subtitle = LOGIN_FALLBACK_SUBTITLE;
  try {
    const info = await apiCall('public.getTournamentInfo', {});
    if (info.tournamentName) title = info.tournamentName;
    const dateRange = _formatTournamentDateRange(info.tournamentStartDate, info.tournamentEndDate);
    if (info.organizerName || dateRange) {
      subtitle = [info.organizerName, dateRange].filter(function (s) { return !!s; }).join(' · ');
    }
  } catch (err) {
    // Pre-login and best-effort — keep the static fallback rather than blocking the login form.
  }
  root.innerHTML =
    '<div class="login-card">' +
      '<h1>' + title + '</h1>' +
      '<p class="subtitle">' + subtitle + '</p>' +
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
  const isRegistration = user.role === 'REGISTRATION';
  const isAccommodation = user.role === 'ACCOMMODATION';
  const isMess = user.role === 'MESS';
  if (isRegistration) {
    renderRegistrationDashboard(root, user);
    return;
  }
  if (isAccommodation) {
    renderAccommodationDashboard(root, user);
    return;
  }
  if (isMess) {
    renderMessDashboard(root, user);
    return;
  }
  // Every role except ADMIN returns early above (Registration/Accommodation/Mess each have
  // their own dashboard) — ADMIN's real dashboard is reports.js's renderAdminDashboard
  // (Phase 9), replacing the placeholder landing this used to render directly.
  renderAdminDashboard(root, user);
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
