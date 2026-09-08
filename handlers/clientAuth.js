/**
 * /api/auth — Client key authentication (the "php api" equivalent).
 *
 * GET  /api/auth     → health check + active games
 * POST /api/auth     → key login with ONE DEVICE binding
 *   Body: { key, device, game }   (accepts hwid/uuid/android_id aliases for device)
 *
 * Response format is compatible with the old panels: { status, message, ... }
 * Errors come back as HTTP 200 with status:"error" so game clients parse them easily.
 */
const store = require('../lib/store');
const { readBody, setCors, getIp, nowIso, rateLimit } = require('../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  await store.ensureLoaded();
  const ip = getIp(req);

  if (req.method === 'GET') {
    const db = store.state();
    return res.status(200).json({
      status: 'success',
      message: 'Kitsune Panel auth server is running',
      version: '1.0.0',
      games: db.games.filter((g) => g.status === 'active').map((g) => g.id),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'POST only' });
  }

  const body = await readBody(req);
  const key = String(body.key || body.license || body.login_key || '').trim();
  const device = String(body.device || body.hwid || body.uuid || body.android_id || body.serial || '').trim();
  const game = String(body.game || '').trim().toLowerCase();

  // Abuse guard: 30 auth attempts / minute per key
  const rl = rateLimit(`auth:${key || 'none'}`, 30, 60 * 1000);
  if (!rl.ok) {
    return res.status(200).json({ status: 'error', message: `Too many attempts — retry in ${rl.retry_after}s` });
  }

  const reject = (message) => {
    store.logActivity(key || '?', 'client_login', `REJECTED — ${message} (game=${game || '-'})`, ip, {
      key_owner: key && store.findKey(key) ? store.findKey(key).owner : null,
    });
    return res.status(200).json({ status: 'error', message });
  };

  if (!key || !device || !game) {
    return reject('key, device and game are required');
  }

  const k = store.findKey(key);
  if (!k) return reject('Invalid key');

  const g = store.findGame(k.game);
  if (!g || g.status !== 'active') return reject('Game is currently disabled');
  if (game !== k.game) return reject('Wrong game key');
  if (k.status === 'banned') return reject('Key banned');
  if (store.keyExpired(k)) {
    k.status = 'expired';
    store.save();
    return reject(`Key expired on ${k.expires_at}`);
  }

  // ── ONE DEVICE ACCESS ──
  if (k.device && k.device !== device) {
    return reject('Key already used on another device (device reset needed)');
  }

  let message;
  if (!k.device) {
    k.device = device;
    k.activated_at = nowIso();
    if (!k.expires_at) {
      k.expires_at = new Date(Date.now() + (k.duration_days || 0) * 86400000).toISOString();
    }
    message = 'Device registered';
  } else {
    message = 'Login successful';
  }

  k.last_used = nowIso();
  k.usage_count = (k.usage_count || 0) + 1;
  store.save();

  store.logActivity(key, 'client_login', `${message} game=${game}`, ip, { key_owner: k.owner });

  return res.status(200).json({
    status: 'success',
    message,
    key: k.key,
    game: k.game,
    game_name: (store.findGame(k.game) || {}).name || k.game,
    owner: k.owner,
    note: k.note || '',
    expired: k.expires_at,
    duration_days: k.duration_days,
    device,
    cheat: k.cheat || '',
    server_time: nowIso(),
  });
};
