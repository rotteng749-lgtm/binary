/**
 * POST /api/panel/keys/bulk — bulk actions on many keys at once.
 *
 * Body: { action: "ban"|"activate"|"delete"|"extend"|"reset_device",
 *         keys: ["KEY1","KEY2",...], days?: number }
 * Action scope follows normal key visibility (owner: all, admin: own+their
 * resellers', reseller: own only).
 */
const store = require('../../../lib/store');
const auth = require('../../../lib/auth');
const { readBody, setCors, getIp, toInt } = require('../../../lib/util');

const ACTIONS = ['ban', 'activate', 'delete', 'extend', 'reset_device'];

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const g = await auth.requireAuth(req);
  if (g.error) return res.status(g.error[0]).json({ error: g.error[1] });
  const me = g.account;
  const db = store.state();

  const body = await readBody(req);
  const action = String(body.action || '').toLowerCase();
  const keyList = (Array.isArray(body.keys) ? body.keys : String(body.keys || '').split(/[\s,]+/))
    .map((s) => String(s).trim())
    .filter(Boolean);

  if (!ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${ACTIONS.join(', ')}` });
  }
  if (keyList.length === 0) return res.status(400).json({ error: 'keys list is empty' });
  if (keyList.length > 500) return res.status(400).json({ error: 'max 500 keys per request' });

  let days = 0;
  if (action === 'extend') {
    days = toInt(body.days, 0);
    if (days < 1 || days > 3650) return res.status(400).json({ error: 'days must be 1-3650 for extend' });
  }

  const visible = store.visibleUsernames(me); // null for owner = everything
  const results = { updated: 0, deleted: 0, skipped: [] };

  for (const keyStr of [...new Set(keyList)]) {
    const k = store.findKey(keyStr);
    if (!k || (visible !== null && !visible.has(k.owner))) {
      results.skipped.push(keyStr);
      continue;
    }

    switch (action) {
      case 'ban':
        k.status = 'banned';
        results.updated++;
        break;
      case 'activate':
        k.status = 'active';
        if (store.keyExpired(k)) results.skipped.push(keyStr); // expired keys stay expired
        else results.updated++;
        break;
      case 'extend':
        if (k.expires_at) {
          const base = Math.max(Date.now(), Date.parse(k.expires_at));
          k.expires_at = new Date(base + days * 86400000).toISOString();
          if (k.status === 'expired') k.status = 'active';
        } else {
          k.duration_days = (k.duration_days || 0) + days;
        }
        results.updated++;
        break;
      case 'reset_device':
        k.device = null;
        results.updated++;
        break;
      case 'delete':
        db.keys = db.keys.filter((x) => x.key !== k.key);
        results.deleted++;
        break;
    }
  }

  results.updated += results.deleted;
  store.save();

  store.logActivity(
    me.username,
    `keys_bulk_${action}`,
    `bulk ${action} on ${keyList.length} key(s): ${results.updated} ok, ${results.skipped.length} skipped`,
    getIp(req)
  );

  return res.status(200).json(results);
};
