// Input rules for accounts, enforced on the server for every write.

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const ROLES = ['admin', 'user'];
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

const normalizeUsername = (u) => String(u ?? '').trim().toLowerCase();

function usernameError(username) {
  return USERNAME_RE.test(normalizeUsername(username))
    ? null
    : 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.';
}

function passwordError(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters.`;
  return null;
}

function roleError(role) {
  return ROLES.includes(role) ? null : `Role must be one of: ${ROLES.join(', ')}.`;
}

module.exports = { normalizeUsername, usernameError, passwordError, roleError, ROLES };
