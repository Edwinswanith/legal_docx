// Password hashing with Node's built-in scrypt (memory-hard, no native deps).
// Stored format: scrypt$N$r$p$<salt b64>$<hash b64>, so parameters can be
// raised later without invalidating existing hashes.

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Spent on logins for unknown usernames so response time doesn't reveal
// whether an account exists.
let dummyHash = null;
async function verifyAgainstDummy(password) {
  dummyHash = dummyHash || (await hashPassword(crypto.randomBytes(16).toString('hex')));
  await verifyPassword(password, dummyHash);
  return false;
}

module.exports = { hashPassword, verifyPassword, verifyAgainstDummy };
