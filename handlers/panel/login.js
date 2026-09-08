/**
 * POST /api/panel/login — panel login with ONE DEVICE LOGIN enforcement.
 * Body: { username, password, device }
 */
const store = require('../../lib/store');
const auth = require('../../lib/auth');
const { readBody, setCors, getIp, hashPassword, verifyPassword, rateLimit, resetRateLimit } = require('../../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  await store.ensureLoaded();
  const body = await readBody(req);
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const device = String(body.device || '').trim() || 'unknown-device';
  const ip = getIp(req);

  // Brute-force guard: 10 attempts / 5 min per username
  const rl = rateLimit(`login:${username}`, 10, 5 * 60 * 1000);
  if (!rl.ok) {
    store.logActivity(username || '?', 'login_failed', `Rate limited (${rl.retry_after}s left)`, ip);
    return res.status(429).json({ error: `Too many login attempts — try again in ${rl.retry_after}s` });
  }

  const acc = store.findAccount(username);
  if (!acc || !verifyPassword(password, acc.password)) {
    store.logActivity(username || '?', 'login_failed', 'Wrong username/password', ip);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  resetRateLimit(`login:${username}`);

  // Upgrade legacy sha256 hashes to PBKDF2 on successful login
  if (!String(acc.password).startsWith('pbkdf2$')) {
    acc.password = hashPassword(password);
  }

  if (acc.status !== 'active') {
    store.logActivity(username, 'login_failed', 'Blocked: account banned', ip);
    return res.status(403).json({ error: 'Account banned' });
  }

  if (store.accountExpired(acc)) {
    store.logActivity(username, 'login_failed', `Blocked: account expired (${acc.expires_at})`, ip);
    return res.status(403).json({ error: `Account expired on ${acc.expires_at}` });
  }

  // ── ONE DEVICE LOGIN ──
  if (acc.device && acc.device !== device) {
    store.logActivity(username, 'login_failed', `Blocked: already bound to device ${acc.device}`, ip);
    return res.status(403).json({
      error: 'Account already logged in on another device. Ask admin/owner to reset your device.',
    });
  }

  if (!acc.device) {
    acc.device = device;
    store.save();
  }

  const token = await auth.createSession(acc, device, ip);
  store.logActivity(username, 'login', 'Panel login', ip);

  return res.status(200).json({ token, account: store.safeAccount(acc) });
};
