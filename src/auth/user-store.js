// User storage behind one interface, two backends:
//   - FileUserStore: a JSON file. Fine locally; on a host with an ephemeral
//     disk (Render free tier) every user the admin creates is lost on restart.
//   - PgUserStore: Postgres, used whenever DATABASE_URL is set. Persistent.
// Every method returns plain copies; callers never hold the store's objects.
//
// User shape: { id, username, role, passwordHash, passwordVersion, createdAt, lastLoginAt }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DuplicateUsernameError extends Error {
  constructor(username) {
    super(`Username "${username}" is already taken.`);
    this.code = 'DUPLICATE_USERNAME';
  }
}

const copy = (u) => (u ? { ...u } : null);

class FileUserStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.users = [];
    this.writing = Promise.resolve();
  }

  async init() {
    if (fs.existsSync(this.filePath)) {
      this.users = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    }
    return this;
  }

  // Writes are serialised and atomic (temp file + rename), so a crash
  // mid-write can't leave a truncated users file.
  persist() {
    const snapshot = JSON.stringify(this.users, null, 2);
    this.writing = this.writing.then(() => {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, snapshot, { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    });
    return this.writing;
  }

  async list() { return this.users.map(copy); }
  async findById(id) { return copy(this.users.find((u) => u.id === id)); }
  async findByUsername(username) { return copy(this.users.find((u) => u.username === username)); }
  async countAdmins() { return this.users.filter((u) => u.role === 'admin').length; }

  async create({ username, passwordHash, role }) {
    if (this.users.some((u) => u.username === username)) throw new DuplicateUsernameError(username);
    const user = {
      id: crypto.randomUUID(), username, role, passwordHash,
      passwordVersion: 1, createdAt: new Date().toISOString(), lastLoginAt: null,
    };
    this.users = [...this.users, user];
    await this.persist();
    return copy(user);
  }

  async update(id, changes) {
    const existing = this.users.find((u) => u.id === id);
    if (!existing) return null;
    const updated = { ...existing, ...changes };
    this.users = this.users.map((u) => (u.id === id ? updated : u));
    await this.persist();
    return copy(updated);
  }

  async setPassword(id, passwordHash) {
    const existing = this.users.find((u) => u.id === id);
    return existing ? this.update(id, { passwordHash, passwordVersion: existing.passwordVersion + 1 }) : null;
  }

  async recordLogin(id) { return this.update(id, { lastLoginAt: new Date().toISOString() }); }

  async remove(id) {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    if (this.users.length === before) return false;
    await this.persist();
    return true;
  }
}

const fromRow = (r) => r && ({
  id: r.id,
  username: r.username,
  role: r.role,
  passwordHash: r.password_hash,
  passwordVersion: Number(r.password_version),
  createdAt: new Date(r.created_at).toISOString(),
  lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
});

class PgUserStore {
  constructor(pool) { this.pool = pool; }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id UUID PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      )`);
    return this;
  }

  async one(sql, params) { return fromRow((await this.pool.query(sql, params)).rows[0]) || null; }

  async list() { return (await this.pool.query('SELECT * FROM app_users ORDER BY created_at')).rows.map(fromRow); }
  async findById(id) { return this.one('SELECT * FROM app_users WHERE id = $1', [id]); }
  async findByUsername(username) { return this.one('SELECT * FROM app_users WHERE username = $1', [username]); }

  async countAdmins() {
    const { rows } = await this.pool.query("SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin'");
    return Number(rows[0].n);
  }

  async create({ username, passwordHash, role }) {
    try {
      return await this.one(
        'INSERT INTO app_users (id, username, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
        [crypto.randomUUID(), username, role, passwordHash],
      );
    } catch (err) {
      if (err.code === '23505' || /unique|duplicate/i.test(err.message)) throw new DuplicateUsernameError(username);
      throw err;
    }
  }

  async setPassword(id, passwordHash) {
    return this.one(
      'UPDATE app_users SET password_hash = $2, password_version = password_version + 1 WHERE id = $1 RETURNING *',
      [id, passwordHash],
    );
  }

  async recordLogin(id) {
    return this.one('UPDATE app_users SET last_login_at = NOW() WHERE id = $1 RETURNING *', [id]);
  }

  async remove(id) {
    const { rowCount } = await this.pool.query('DELETE FROM app_users WHERE id = $1', [id]);
    return rowCount > 0;
  }
}

async function createUserStore({ databaseUrl, filePath }) {
  if (databaseUrl) {
    const { Pool } = require('pg');
    const local = /localhost|127\.0\.0\.1/.test(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, ssl: local ? false : { rejectUnauthorized: true } });
    return new PgUserStore(pool).init();
  }
  return new FileUserStore(filePath).init();
}

module.exports = { createUserStore, FileUserStore, PgUserStore, DuplicateUsernameError };
