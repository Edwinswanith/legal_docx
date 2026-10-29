// The shared top bar: theme switch, signed-in user, admin link, sign-out.
// Loaded by the intake and users pages and inlined into the generated review
// page, which may also be opened as a plain file (no server) — every server
// call here fails quietly in that case and the bar just shows less.
(function () {
  const THEME_KEY = 'ts-theme';
  const root = document.documentElement;

  function syncToggles() {
    const dark = root.dataset.theme === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(dark));
      btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }

  function setTheme(theme) {
    if (theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private window: not remembered */ }
    syncToggles();
  }

  // Adds the CSRF header the server requires on writes, and sends an expired
  // session back to the login page instead of failing silently.
  async function apiFetch(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), 'X-Requested-With': 'fetch' } });
    if (res.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
      throw new Error('Your session has ended — please sign in again.');
    }
    return res;
  }

  const me = location.protocol === 'file:'
    ? Promise.resolve(null)
    : apiFetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((body) => body?.user || null).catch(() => null);

  function initTopbar() {
    syncToggles();
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
    });
    document.querySelectorAll('[data-logout]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
        location.href = '/login';
      });
    });
    me.then((user) => {
      if (!user) return;
      document.querySelectorAll('[data-me]').forEach((el) => { el.textContent = user.username; });
      document.querySelectorAll('[data-signed-in]').forEach((el) => el.classList.remove('hidden'));
      if (user.role === 'admin') document.querySelectorAll('[data-admin-only]').forEach((el) => el.classList.remove('hidden'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTopbar);
  else initTopbar();

  window.Shell = { apiFetch, me };
})();
