// Stateless signed session tokens kept in an HttpOnly cookie. The token carries
// the user's passwordVersion; the server re-checks it against the store on
// every request, so resetting a password or deleting a user ends their
// existing sessions immediately.

const crypto = require('crypto');

const COOKIE_NAME = 'ts_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function createSessionToken({ userId, passwordVersion }, secret, now = Date.now()) {
  const payload = b64url(JSON.stringify({ uid: userId, pwv: passwordVersion, exp: now + SESSION_TTL_MS }));
  return `${payload}.${sign(payload, secret)}`;
}

function verifySessionToken(token, secret, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < now) return null;
    return { userId: data.uid, passwordVersion: data.pwv };
  } catch {
    return null;
  }
}

// A malformed cookie (e.g. "%") is ignored rather than crashing the request.
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseCookies(header) {
  return Object.fromEntries(
    String(header || '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, safeDecode(v.join('='))])
      .filter(([, v]) => v !== null),
  );
}

function sessionCookie(token, { secure }) {
  return [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

function clearedCookie({ secure }) {
  return [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', secure ? 'Secure' : null]
    .filter(Boolean).join('; ');
}

module.exports = { COOKIE_NAME, createSessionToken, verifySessionToken, parseCookies, sessionCookie, clearedCookie };
