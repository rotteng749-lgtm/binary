/**
 * /api/panel/accounts — list & create accounts (role-scoped).
 *
 * GET  → owner: all accounts | admin: own resellers | reseller: self
 * POST → owner: create admin/reseller | admin: create reseller only
 * Body: { username, password, role, credits, expires_days | expires_at, games }
 */
const store = require('../../lib/store');
const auth = require('../../lib/auth');
const { readBody, setCors, getIp, hashPassword, toInt, nowIso, addDays } = require('../../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const g = await auth.requireAuth(req);
  if (g.error) return res.status(g.error[0]).json({ error: g.error[1] });
  const me = g.account;
  const db = store.state();

  /* ── LIST ── */
  if (req.method === 'GET') {
    const list = store.scopeAccounts(me).map((a) => ({
      ...store.safeAccount(a),
      keys_count: store.keysCountFor(a.username),
    }));
    // newest first
    list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return res.status(200).json({ accounts: list });
  }

  /* ── CREATE ── */
  if (req.method === 'POST') {
    if (me.role === 'reseller') {
      return res.status(403).json({ error: 'Resellers cannot create accounts' });
    }

    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    let role = String(body.role || 'reseller').toLowerCase();

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 chars (a-z, 0-9, _)' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    if (me.role === 'admin' && role !== 'reseller') {
      return res.status(403).json({ error: 'Admins can only create resellers' });
    }
    if (!['admin', 'reseller'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or reseller' });
    }
    if (store.findAccount(username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Credits (cost of generating keys; 1 credit = 1 key)
    const credits = Math.max(0, toInt(body.credits, 0));

    // Expiry: expires_days (from now) or explicit ISO expires_at, null = never
    let expires_at = null;
    if (body.expires_days) {
      expires_at = addDays(toInt(body.expires_days, 30));
    } else if (body.expires_at) {
      const t = Date.parse(body.expires_at);
      if (!Number.isFinite(t)) return res.status(400).json({ error: 'Invalid expires_at' });
      expires_at = new Date(t).toISOString();
    }

    // Game permissions
    let games = Array.isArray(body.games) ? body.games.map((x) => String(x).toLowerCase()) : ['*'];
    if (games.includes('*')) {
      games = ['*'];
    } else {
      for (const gid of games) {
        if (!store.findGame(gid)) return res.status(400).json({ error: `Unknown game: ${gid}` });
      }
      if (games.length === 0) return res.status(400).json({ error: 'Pick at least one game (or *)' });
    }

    const acc = {
      username,
      password: hashPassword(password),
      role,
      credits,
      expires_at,
      device: null,
      status: 'active',
      games,
      created_by: me.username,
      created_at: nowIso(),
    };
    db.accounts.push(acc);
    store.save();

    store.logActivity(me.username, 'account_create', `Created ${role} "${username}" (credits=${credits}, expiry=${expires_at || 'never'})`, getIp(req));
    return res.status(201).json({ account: store.safeAccount(acc) });
  }

  return res.status(405).json({ error: 'GET or POST only' });
};
