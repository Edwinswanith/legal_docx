const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { hashPassword, verifyPassword } = require('../src/auth/password');
const { createSessionToken, verifySessionToken } = require('../src/auth/session');
const { FileUserStore, PgUserStore } = require('../src/auth/user-store');
const { ensureBootstrapAdmin } = require('../src/auth/routes');
const { createLimiter } = require('../src/auth/rate-limit');
const { createApp } = require('../server');

const quiet = { info() {}, warn() {}, error() {} };
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-')), 'users.json');

// ---- units ------------------------------------------------------------------

test('password hashes verify and reject the wrong password', async () => {
  const hash = await hashPassword('correct horse');
  assert.ok(hash.startsWith('scrypt$'));
  assert.strictEqual(await verifyPassword('correct horse', hash), true);
  assert.strictEqual(await verifyPassword('wrong horse', hash), false);
  assert.strictEqual(await verifyPassword('x', 'garbage'), false);
});

test('session tokens reject tampering, the wrong secret and expiry', () => {
  const token = createSessionToken({ userId: 'u1', passwordVersion: 1 }, 'secret-a', 1000);
  assert.deepStrictEqual(verifySessionToken(token, 'secret-a', 2000), { userId: 'u1', passwordVersion: 1 });
  assert.strictEqual(verifySessionToken(token, 'secret-b', 2000), null);
  assert.strictEqual(verifySessionToken(`${token}x`, 'secret-a', 2000), null);
  assert.strictEqual(verifySessionToken(token, 'secret-a', 1000 + 13 * 3600 * 1000), null);
});

test('rate limiter blocks after max failures and resets on success', () => {
  let t = 0;
  const lim = createLimiter({ max: 2, windowMs: 1000, now: () => t });
  lim.fail('k'); assert.strictEqual(lim.isBlocked('k'), false);
  lim.fail('k'); assert.strictEqual(lim.isBlocked('k'), true);
  t = 1001; assert.strictEqual(lim.isBlocked('k'), false);
  lim.fail('k'); lim.reset('k'); assert.strictEqual(lim.isBlocked('k'), false);
});

// ---- stores (same contract for both backends) ---------------------------------

async function exerciseStore(store) {
  const a = await store.create({ username: 'alice', passwordHash: 'h1', role: 'admin' });
  assert.strictEqual(a.passwordVersion, 1);
  await assert.rejects(store.create({ username: 'alice', passwordHash: 'h', role: 'user' }), { code: 'DUPLICATE_USERNAME' });
  const b = await store.create({ username: 'bob', passwordHash: 'h2', role: 'user' });
  assert.strictEqual((await store.list()).length, 2);
  assert.strictEqual(await store.countAdmins(), 1);
  const reset = await store.setPassword(b.id, 'h3');
  assert.strictEqual(reset.passwordHash, 'h3');
  assert.strictEqual(reset.passwordVersion, 2);
  assert.ok((await store.recordLogin(b.id)).lastLoginAt);
  assert.strictEqual((await store.findByUsername('bob')).id, b.id);
  assert.strictEqual(await store.remove(b.id), true);
  assert.strictEqual(await store.remove(b.id), false);
  assert.strictEqual(await store.findById(b.id), null);
}

test('file store: CRUD, duplicates, and data survives a reload', async () => {
  const file = tmpFile();
  const store = await new FileUserStore(file).init();
  await exerciseStore(store);
  await store.writing;
  const reloaded = await new FileUserStore(file).init();
  assert.deepStrictEqual((await reloaded.list()).map((u) => u.username), ['alice']);
});

test('postgres store: same contract (in-memory Postgres)', async () => {
  const { newDb } = require('pg-mem');
  const { Pool } = newDb().adapters.createPg();
  const store = await new PgUserStore(new Pool()).init();
  await exerciseStore(store);
});

test('bootstrap admin is created once and never overwritten', async () => {
  const store = await new FileUserStore(tmpFile()).init();
  await ensureBootstrapAdmin(store, { username: 'Root', password: 'rootpass123' }, quiet);
  await ensureBootstrapAdmin(store, { username: 'other', password: 'otherpass123' }, quiet);
  const users = await store.list();
  assert.deepStrictEqual(users.map((u) => [u.username, u.role]), [['root', 'admin']]);
});

// ---- HTTP integration ---------------------------------------------------------

async function startServer() {
  const store = await new FileUserStore(tmpFile()).init();
  await ensureBootstrapAdmin(store, { username: 'admin', password: 'adminpass123' }, quiet);
  const app = createApp({ store, secret: 'test-secret', logger: quiet });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  // Minimal client that keeps its own cookie, like one browser.
  const client = () => {
    let cookie = '';
    return async (method, url, body, { header = true, accept } = {}) => {
      const res = await fetch(base + url, {
        method,
        redirect: 'manual',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(header ? { 'X-Requested-With': 'fetch' } : {}),
          ...(accept ? { Accept: accept } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* html */ }
      return { status: res.status, json, location: res.headers.get('location'), setCookie: set };
    };
  };
  return { server, client };
}

test('pages and APIs require sign-in', async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.close());
  const anon = client();
  const page = await anon('GET', '/', null, { accept: 'text/html' });
  assert.strictEqual(page.status, 302);
  assert.match(page.location, /^\/login/);
  assert.strictEqual((await anon('GET', '/api/status')).status, 401);
  assert.strictEqual((await anon('GET', '/reports/MATTER-1.docx')).status, 401);
  assert.strictEqual((await anon('GET', '/login', null, { accept: 'text/html' })).status, 200);
});

test('login: wrong password is rejected, right one sets an HttpOnly cookie', async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.close());
  const c = client();
  const bad = await c('POST', '/api/auth/login', { username: 'admin', password: 'nope-nope' });
  assert.strictEqual(bad.status, 401);
  assert.strictEqual(bad.json.error, 'Invalid username or password.');
  const unknown = await c('POST', '/api/auth/login', { username: 'ghost', password: 'nope-nope' });
  assert.strictEqual(unknown.json.error, 'Invalid username or password.');
  const ok = await c('POST', '/api/auth/login', { username: 'ADMIN', password: 'adminpass123' });
  assert.strictEqual(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.strictEqual(ok.json.user.passwordHash, undefined);
  assert.strictEqual((await c('GET', '/api/auth/me')).json.user.role, 'admin');
});

test('writes without the fetch header are refused (CSRF)', async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.close());
  const c = client();
  const res = await c('POST', '/api/auth/login', { username: 'admin', password: 'adminpass123' }, { header: false });
  assert.strictEqual(res.status, 403);
});

test('repeated failures are rate limited', async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.close());
  const c = client();
  for (let i = 0; i < 5; i += 1) await c('POST', '/api/auth/login', { username: 'admin', password: 'wrong-pass' });
  const blocked = await c('POST', '/api/auth/login', { username: 'admin', password: 'adminpass123' });
  assert.strictEqual(blocked.status, 429);
});

test('admin manages users; resets and deletes take effect immediately', async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.close());
  const admin = client();
  await admin('POST', '/api/auth/login', { username: 'admin', password: 'adminpass123' });

  // validation
  assert.strictEqual((await admin('POST', '/api/admin/users', { username: 'x', password: 'longenough1' })).status, 400);
  assert.strictEqual((await admin('POST', '/api/admin/users', { username: 'priya', password: 'short' })).status, 400);
  assert.strictEqual((await admin('POST', '/api/admin/users', { username: 'priya', password: 'longenough1', role: 'owner' })).status, 400);

  const created = await admin('POST', '/api/admin/users', { username: 'Priya', password: 'firstpass123' });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.json.user.username, 'priya');
  assert.strictEqual(created.json.user.role, 'user');
  assert.strictEqual((await admin('POST', '/api/admin/users', { username: 'priya', password: 'firstpass123' })).status, 409);
  const id = created.json.user.id;

  // the new user can sign in, use the app, but not the admin API
  const priya = client();
  assert.strictEqual((await priya('POST', '/api/auth/login', { username: 'priya', password: 'firstpass123' })).status, 200);
  assert.strictEqual((await priya('GET', '/api/status')).status, 200);
  assert.strictEqual((await priya('GET', '/api/admin/users')).status, 403);
  assert.strictEqual((await priya('DELETE', `/api/admin/users/${id}`)).status, 403);

  const list = await admin('GET', '/api/admin/users');
  assert.deepStrictEqual(list.json.users.map((u) => u.username).sort(), ['admin', 'priya']);
  assert.ok(list.json.users.every((u) => u.passwordHash === undefined));

  // reset: old session and old password stop working, new password works
  assert.strictEqual((await admin('PUT', `/api/admin/users/${id}/password`, { password: 'secondpass123' })).status, 200);
  assert.strictEqual((await priya('GET', '/api/status')).status, 401);
  const relog = client();
  assert.strictEqual((await relog('POST', '/api/auth/login', { username: 'priya', password: 'firstpass123' })).status, 401);
  assert.strictEqual((await relog('POST', '/api/auth/login', { username: 'priya', password: 'secondpass123' })).status, 200);

  // delete: their session ends; admin can't delete themselves
  assert.strictEqual((await admin('DELETE', `/api/admin/users/${id}`)).status, 200);
  assert.strictEqual((await relog('GET', '/api/status')).status, 401);
  assert.strictEqual((await admin('DELETE', `/api/admin/users/${id}`)).status, 404);
  const me = (await admin('GET', '/api/auth/me')).json.user;
  assert.strictEqual((await admin('DELETE', `/api/admin/users/${me.id}`)).status, 400);
});

test('logout ends the session', async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.close());
  const c = client();
  await c('POST', '/api/auth/login', { username: 'admin', password: 'adminpass123' });
  await c('POST', '/api/auth/logout');
  assert.strictEqual((await c('GET', '/api/auth/me')).status, 401);
});

test('a malformed session cookie is ignored, not a server error', async (t) => {
  const { server } = await startServer();
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/me`, { headers: { Cookie: 'ts_session=%' } });
  assert.strictEqual(res.status, 401);
});

test('upload filenames are reduced to safe, unique names', () => {
  const { safeUploadNames } = require('../server');
  const names = safeUploadNames(['..', '', '../../etc/passwd', '..\\x.pdf', 'a.pdf', 'a.pdf', 'பத்திரம்.pdf']
    .map((originalname) => ({ originalname, buffer: null }))).map((f) => f.storedName);
  assert.deepStrictEqual(names, ['document-1.pdf', 'document-2.pdf', 'passwd', 'x.pdf', 'a.pdf', '6-a.pdf', 'பத்திரம்.pdf']);
});
