/**
 * /api/panel/games/[id] — edit / delete a game (owner only).
 *
 * PATCH  body: { status: "active"|"disabled", name? }
 * DELETE → remove game (blocked while keys still exist for it)
 */
const store = require('../../../lib/store');
const auth = require('../../../lib/auth');
const { readBody, setCors, getIp } = require('../../../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const g = await auth.requireAuth(req);
  if (g.error) return res.status(g.error[0]).json({ error: g.error[1] });
  const me = g.account;
  const db = store.state();

  const game = store.findGame(req.query.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    const changes = [];

    if (body.status !== undefined) {
      if (me.role !== 'owner') return res.status(403).json({ error: 'Owner only — server access control' });
      if (!['active', 'disabled'].includes(body.status)) {
        return res.status(400).json({ error: 'status must be active or disabled' });
      }
      game.status = body.status;
      changes.push(`status=${body.status}`);
    }
    if (body.name !== undefined) {
      if (me.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
      game.name = String(body.name).trim().slice(0, 40) || game.name;
      changes.push(`name=${game.name}`);
    }
    if (body.cheat !== undefined) {
      if (!['owner', 'admin'].includes(me.role)) {
        return res.status(403).json({ error: 'Owner/Admin only' });
      }
      game.cheat = String(body.cheat).slice(0, 2000);
      changes.push(`cheat=${game.cheat ? 'set' : 'cleared'}`);
    }
    if (changes.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    store.save();
    store.logActivity(me.username, 'game_update', `Updated game ${game.id}: ${changes.join(', ')}`, getIp(req));
    return res.status(200).json({ game });
  }

  if (req.method === 'DELETE') {
    if (me.role !== 'owner') return res.status(403).json({ error: 'Owner only' });
    const used = db.keys.filter((k) => k.game === game.id).length;
    if (used > 0) {
      return res.status(409).json({ error: `Game still has ${used} keys — delete or move them first` });
    }
    db.games = db.games.filter((x) => x.id !== game.id);
    for (const a of db.accounts) {
      if (Array.isArray(a.games)) a.games = a.games.filter((x) => x !== game.id);
    }
    store.save();
    store.logActivity(me.username, 'game_delete', `Deleted game ${game.id}`, getIp(req));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'PATCH or DELETE only' });
};
        
