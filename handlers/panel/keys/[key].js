/**
 * /api/panel/keys/[key] — manage one key.
 *
 * PATCH body: { action: "ban" | "activate" | "extend" | "reset_device" | "edit",
 *               days?, note?, duration_days?, game? }
 * DELETE → remove the key
 */
const store = require('../../../lib/store');
const auth = require('../../../lib/auth');
const { readBody, setCors, getIp, toInt, nowIso } = require('../../../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const g = await auth.requireAuth(req);
  if (g.error) return res.status(g.error[0]).json({ error: g.error[1] });
  const me = g.account;
  const db = store.state();

  const k = store.findKey(req.query.key);
  const visible = k && (me.role === 'owner' || (store.visibleUsernames(me) || new Set()).has(k.owner));
  if (!k || !visible) {
    return res.status(404).json({ error: 'Key not found' });
  }

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    const action = String(body.action || '').toLowerCase();

    switch (action) {
      case 'ban':
        k.status = 'banned';
        store.logActivity(me.username, 'key_ban', `Banned key ${k.key}`, getIp(req), { key_owner: k.owner });
        break;

      case 'activate':
        k.status = 'active';
        store.logActivity(me.username, 'key_activate', `Activated key ${k.key}`, getIp(req), { key_owner: k.owner });
        break;

      case 'extend': {
        const days = toInt(body.days, 0);
        if (days < 1 || days > 3650) return res.status(400).json({ error: 'days must be 1-3650' });
        if (k.expires_at) {
          // already activated → push the expiry date
          const base = Math.max(Date.now(), Date.parse(k.expires_at));
          k.expires_at = new Date(base + days * 86400000).toISOString();
          if (k.status === 'expired') k.status = 'active';
        } else {
          // not activated yet → add to the duration applied at activation
          k.duration_days = (k.duration_days || 0) + days;
        }
        store.logActivity(me.username, 'key_extend', `Extended key ${k.key} +${days}d`, getIp(req), { key_owner: k.owner });
        break;
      }

      case 'reset_device':
        k.device = null;
        store.logActivity(me.username, 'key_reset_device', `Reset device on key ${k.key}`, getIp(req), { key_owner: k.owner });
        break;

      case 'edit': {
        const changes = [];
        if (body.note !== undefined) {
          k.note = String(body.note).slice(0, 120);
          changes.push('note');
        }
        if (body.cheat !== undefined) {
          k.cheat = String(body.cheat).slice(0, 2000);
          changes.push('cheat');
        }
        if (body.duration_days !== undefined && !k.expires_at) {
          const d = toInt(body.duration_days, k.duration_days);
          if (d < 1 || d > 3650) return res.status(400).json({ error: 'duration_days must be 1-3650' });
          k.duration_days = d;
          changes.push(`duration=${d}d`);
        }
        if (body.game !== undefined) {
          const gameId = String(body.game).toLowerCase();
          const game = store.findGame(gameId);
          if (!game) return res.status(400).json({ error: 'Unknown game' });
          if (!store.canUseGame(me, gameId)) return res.status(403).json({ error: 'Game not permitted for your account' });
          k.game = gameId;
          changes.push(`game=${gameId}`);
        }
        if (changes.length === 0) return res.status(400).json({ error: 'Nothing to edit' });
        store.logActivity(me.username, 'key_edit', `Edited key ${k.key}: ${changes.join(', ')}`, getIp(req), { key_owner: k.owner });
        break;
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }

    store.save();
    return res.status(200).json({ key: k });
  }

  if (req.method === 'DELETE') {
    db.keys = db.keys.filter((x) => x.key !== k.key);
    store.save();
    store.logActivity(me.username, 'key_delete', `Deleted key ${k.key}`, getIp(req), { key_owner: k.owner });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'PATCH or DELETE only' });
};
            
