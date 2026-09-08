/**
 * /api/panel/keys — list & generate keys (role-scoped).
 *
 * GET  → owner: all keys | admin: own + their resellers' | reseller: own
 * POST → generate keys
 *   Body (random): { mode:"random", game, count, duration_days, prefix?, note? }
 *   Body (custom): { mode:"custom", game, keys:["...","..."], duration_days, note? }
 *
 * Cost: 1 credit per key (admin & reseller). Owner = unlimited.
 */
const store = require('../../lib/store');
const auth = require('../../lib/auth');
const { readBody, setCors, getIp, toInt, randomCode, nowIso } = require('../../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const g = await auth.requireAuth(req);
  if (g.error) return res.status(g.error[0]).json({ error: g.error[1] });
  const me = g.account;
  const db = store.state();

  /* ── LIST ── */
  if (req.method === 'GET') {
    const list = [...store.scopeKeys(me)];
    list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return res.status(200).json({ keys: list });
  }

  /* ── GENERATE ── */
  if (req.method === 'POST') {
    const body = await readBody(req);
    const mode = body.mode === 'custom' ? 'custom' : 'random';
    const gameId = String(body.game || '').trim().toLowerCase();
    const game = store.findGame(gameId);

    if (!game) return res.status(400).json({ error: 'Unknown game' });
    if (game.status !== 'active' && me.role !== 'owner') {
      return res.status(400).json({ error: 'Game is currently disabled' });
    }
    if (!store.canUseGame(me, gameId)) {
      return res.status(403).json({ error: 'Game not permitted for your account' });
    }

    const duration = toInt(body.duration_days, 0);
    if (duration < 1 || duration > 3650) {
      return res.status(400).json({ error: 'duration_days must be 1-3650' });
    }

    // Cheat info attached to the generated keys (defaults to the game's cheat)
    const cheat = String(body.cheat !== undefined ? body.cheat : (game.cheat || '')).slice(0, 2000);

    // Build the key strings
    let names = [];
    if (mode === 'custom') {
      const raw = Array.isArray(body.keys) ? body.keys : String(body.keys || '').split(/\r?\n/);
      names = [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))].slice(0, 100);
      if (names.length === 0) return res.status(400).json({ error: 'No custom keys provided' });
      const clash = names.find((n) => store.findKey(n));
      if (clash) return res.status(409).json({ error: `Key already exists: ${clash}` });
    } else {
      const count = Math.min(100, Math.max(1, toInt(body.count, 1)));
      const prefix = String(body.prefix || 'DRIP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'DRIP';
      names = new Set();
      while (names.size < count) {
        names.add(`${prefix}-${gameId.toUpperCase()}-${randomCode(8)}`);
      }
      names = [...names];
    }

    // Credits: 1 per key (owner unlimited)
    const cost = me.role === 'owner' ? 0 : names.length;
    if (me.role !== 'owner' && (me.credits || 0) < cost) {
      return res.status(400).json({
        error: `Not enough credits (have ${me.credits || 0}, need ${cost})`,
      });
    }

    const created = names.map((n) => {
      const k = {
        key: n,
        game: gameId,
        owner: me.username,
        cheat,
        note: String(body.note || '').slice(0, 120),
        duration_days: duration,
        status: 'active',
        device: null,
        expires_at: null, // set on first client login (activation)
        activated_at: null,
        last_used: null,
        usage_count: 0,
        created_at: nowIso(),
      };
      db.keys.push(k);
      return k;
    });

    if (cost > 0) me.credits = (me.credits || 0) - cost;
    store.save();

    store.logActivity(
      me.username,
      'keys_generate',
      `${mode} x${created.length} game=${gameId} duration=${duration}d${cost ? ` (cost ${cost} credits)` : ''}${cheat ? ' (with cheat)' : ''}`,
      getIp(req)
    );

    return res.status(201).json({
      created,
      credits_left: me.role === 'owner' ? 'unlimited' : me.credits || 0,
    });
  }

  return res.status(405).json({ error: 'GET or POST only' });
};
