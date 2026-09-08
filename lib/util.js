/**
 * DRIPNEXT shared helpers — Node stdlib only, zero npm dependencies.
 */
const crypto = require('crypto');

/* ── HTTP helpers ─────────────────────────────────────────── */

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function readBody(req) {
  // Pre-parsed body (tests / middleware) short-circuit
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { return resolve(JSON.parse(data)); } catch { /* not json */ }
      try { return resolve(Object.fromEntries(new URLSearchParams(data))); } catch { /* not form */ }
      resolve({});
    });
    req.on('error', () => resolve({}));
  });
}

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/* ── Crypto helpers ───────────────────────────────────────── */

function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

/**
 * PBKDF2-SHA512 password hashing with per-password salt.
 * Format: pbkdf2$<iterations>$<salt-hex>$<hash-hex>
 */
const PBKDF2_ITERS = 60000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(pw), salt, PBKDF2_ITERS, 32, 'sha512');
  return `pbkdf2$${PBKDF2_ITERS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const s = String(stored || '');
  if (s.startsWith('pbkdf2$')) {
    const [, iters, saltHex, hashHex] = s.split('$');
    try {
      const test = crypto.pbkdf2Sync(String(pw), Buffer.from(saltHex, 'hex'), parseInt(iters, 10), 32, 'sha512');
      const expect = Buffer.from(hashHex, 'hex');
      return test.length === expect.length && crypto.timingSafeEqual(test, expect);
    } catch { return false; }
  }
  // Legacy unsalted sha256('dripnext:'+pw) — upgrade on next successful login
  return timingSafeEqStr(sha256('dripnext:' + String(pw)), s);
}

function timingSafeEqStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/* ── Rate limiting (per-key fixed window) ─────────────────── */

const rlMap = new Map();
const rlTimer = setInterval(() => { // periodic cleanup so the map never grows unbounded
  const now = Date.now();
  for (const [k, v] of rlMap) if (now > v.until) rlMap.delete(k);
}, 60000);
if (rlTimer.unref) rlTimer.unref();

function rateLimit(id, maxHits, windowMs) {
  const now = Date.now();
  let e = rlMap.get(id);
  if (!e || now > e.until) {
    e = { hits: 0, until: now + windowMs };
    rlMap.set(id, e);
  }
  e.hits += 1;
  if (e.hits > maxHits) {
    const retry = Math.ceil((e.until - now) / 1000);
    return { ok: false, retry_after: retry };
  }
  return { ok: true, remaining: maxHits - e.hits };
}

function resetRateLimit(id) {
  rlMap.delete(id);
}

function randomToken(len = 48) {
  return crypto.randomBytes(64).toString('hex').slice(0, len);
}

// Unambiguous alphabet (no 0/O/1/I)
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALNUM[crypto.randomInt(ALNUM.length)];
  return s;
}

/* ── Time helpers ─────────────────────────────────────────── */

function nowIso() {
  return new Date().toISOString();
}

function addDays(days) {
  return new Date(Date.now() + Number(days || 0) * 86400000).toISOString();
}

module.exports = {
  setCors,
  readBody,
  getIp,
  toInt,
  sha256,
  hashPassword,
  verifyPassword,
  timingSafeEqStr,
  rateLimit,
  resetRateLimit,
  randomToken,
  randomCode,
  nowIso,
  addDays,
};
