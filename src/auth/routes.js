// Login, logout and admin user management, plus the middleware that guards
// every other route. Admins can list users, create them, reset any user's
// password and delete users; they cannot delete themselves or the last admin.

const express = require('express');
const { hashPassword, verifyPassword, verifyAgainstDummy } = require('./password');
const {
  COOKIE_NAME, createSessionToken, verifySessionToken, parseCookies, sessionCookie, clearedCookie,
} = require('./session');
const { normalizeUsername, usernameError, passwordError, roleError } = require('./validate');
const { createLimiter } = require('./rate-limit');

const LOGIN_FAILS = { max: 5, windowMs: 15 * 60 * 1000 };
const IP_FAILS = { max: 30, windowMs: 15 * 60 * 1000 };
// Caps guessing against one account from many addresses. Kept high so an
// attacker can't cheaply lock a real user out.
const USERNAME_FAILS = { max: 50, windowMs: 60 * 60 * 1000 };

// Never send the hash or password version to a browser.
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt });

function createAuth({ store, secret, secure, logger = console }) {
  const perAccount = createLimiter(LOGIN_FAILS);
  const perIp = createLimiter(IP_FAILS);
  const perUsername = createLimiter(USERNAME_FAILS);

  // Resolves the session cookie to a live user, or null. A token whose
  // passwordVersion no longer matches (password reset) or whose user is gone
  // (deleted) is rejected.
  async function currentUser(req) {
    const session = verifySessionToken(parseCookies(req.headers.cookie)[COOKIE_NAME], secret);
    if (!session) return null;
    const user = await store.findById(session.userId);
    return user && user.passwordVersion === session.passwordVersion ? user : null;
  }

  const wantsHtml = (req) => req.method === 'GET' && !req.path.startsWith('/api/') && (req.headers.accept || '').includes('text/html');

  function guard(check) {
    return async (req, res, next) => {
      try {
        const user = await currentUser(req);
        if (!user) {
          if (wantsHtml(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
          return res.status(401).json({ error: 'Please sign in.' });
        }
        if (!check(user)) {
          return wantsHtml(req) ? res.status(403).send('Admins only.') : res.status(403).json({ error: 'Admins only.' });
        }
        req.user = user;
        return next();
      } catch (err) {
        return next(err);
      }
    };
  }

  const requireUser = guard(() => true);
  const requireAdmin = guard((u) => u.role === 'admin');

  // CSRF defence for cookie-authenticated writes: browsers won't attach a
  // custom header to a cross-site request without a CORS preflight, which this
  // server never grants. Combined with SameSite=Lax cookies.
  function requireFetchHeader(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('X-Requested-With') !== 'fetch') return res.status(403).json({ error: 'Missing request header.' });
    return next();
  }

  const router = express.Router();
  router.use('/api', requireFetchHeader);

  router.post('/api/auth/login', express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const accountKey = `${req.ip}|${username}`;
      const limited = [[perAccount, accountKey], [perIp, req.ip], [perUsername, username]]
        .filter(([lim, key]) => lim.isBlocked(key));
      if (limited.length) {
        const wait = Math.max(...limited.map(([lim, key]) => lim.retryAfterSeconds(key)));
        res.set('Retry-After', String(wait));
        return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` });
      }

      const user = username ? await store.findByUsername(username) : null;
      const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);
      if (!ok) {
        perAccount.fail(accountKey);
        perIp.fail(req.ip);
        if (username) perUsername.fail(username);
        logger.warn?.(`[auth] failed login for "${username}" from ${req.ip}`);
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      perAccount.reset(accountKey);
      const updated = (await store.recordLogin(user.id)) || user;
      res.setHeader('Set-Cookie', sessionCookie(createSessionToken({ userId: user.id, passwordVersion: user.passwordVersion }, secret), { secure }));
      return res.json({ user: publicUser(updated) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearedCookie({ secure }));
    res.json({ ok: true });
  });

  router.get('/api/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

  // --- admin -----------------------------------------------------------------
  router.get('/api/admin/users', requireAdmin, async (_req, res, next) => {
    try {
      res.json({ users: (await store.list()).map(publicUser) });
    } catch (err) { next(err); }
  });

  router.post('/api/admin/users', requireAdmin, express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const role = req.body?.role || 'user';
      const error = usernameError(username) || passwordError(req.body?.password) || roleError(role);
      if (error) return res.status(400).json({ error });
      const user = await store.create({ username, role, passwordHash: await hashPassword(req.body.password) });
      logger.info?.(`[auth] ${req.user.username} created ${role} "${username}"`);
      return res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      if (err.code === 'DUPLICATE_USERNAME') return res.status(409).json({ error: err.message });
      return next(err);
    }
  });

  router.put('/api/admin/users/:id/password', requireAdmin, express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const error = passwordError(req.body?.password);
      if (error) return res.status(400).json({ error });
      const updated = await store.setPassword(req.params.id, await hashPassword(req.body.password));
      if (!updated) return res.status(404).json({ error: 'User not found.' });
      logger.info?.(`[auth] ${req.user.username} reset the password of "${updated.username}"`);
      // Resetting your own password ends your session too; re-issue it.
      if (updated.id === req.user.id) {
        res.setHeader('Set-Cookie', sessionCookie(createSessionToken({ userId: updated.id, passwordVersion: updated.passwordVersion }, secret), { secure }));
      }
      return res.json({ user: publicUser(updated) });
    } catch (err) { return next(err); }
  });

  router.delete('/api/admin/users/:id', requireAdmin, async (req, res, next) => {
    try {
      const target = await store.findById(req.params.id);
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
      if (target.role === 'admin' && (await store.countAdmins()) <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin.' });
      }
      await store.remove(target.id);
      logger.info?.(`[auth] ${req.user.username} deleted "${target.username}"`);
      return res.json({ ok: true });
    } catch (err) { return next(err); }
  });

  return { router, requireUser, requireAdmin, currentUser };
}

// Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD when the store
// has none, so a fresh deploy is never locked out. Never overwrites an admin.
async function ensureBootstrapAdmin(store, { username, password }, logger = console) {
  if ((await store.countAdmins()) > 0) return null;
  if (!username || !password) {
    logger.warn('[auth] No admin account exists. Set ADMIN_USERNAME and ADMIN_PASSWORD to create one.');
    return null;
  }
  const name = normalizeUsername(username);
  const error = usernameError(name) || passwordError(password);
  if (error) throw new Error(`ADMIN_USERNAME/ADMIN_PASSWORD invalid: ${error}`);
  const existing = await store.findByUsername(name);
  if (existing) {
    logger.warn(`[auth] "${name}" exists but is not an admin; not changing it.`);
    return null;
  }
  const admin = await store.create({ username: name, role: 'admin', passwordHash: await hashPassword(password) });
  logger.info(`[auth] Created bootstrap admin "${name}".`);
  return admin;
}

module.exports = { createAuth, ensureBootstrapAdmin, publicUser };
