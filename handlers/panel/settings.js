/**
 * /api/panel/settings — branding settings.
 *
 * GET   → any authenticated role: current settings
 * PATCH → owner only: { panel_name?, logo? } (max 30 / 8 chars)
 */
const store = require('../../lib/store');
const auth = require('../../lib/auth');
const { readBody, setCors, getIp } = require('../../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const g = await auth.requireAuth(req);
  if (g.error) return res.status(g.error[0]).json({ error: g.error[1] });
  const me = g.account;
  const db = store.state();
  if (!db.settings) db.settings = { panel_name: 'KITSUNE', logo: '🦊' };
  const s = db.settings;

  if (req.method === 'GET') {
    return res.status(200).json({ settings: s });
  }

  if (req.method === 'PATCH') {
    if (me.role !== 'owner') return res.status(403).json({ error: 'Owner only' });

    const body = await readBody(req);
    const changes = [];

    if (body.panel_name !== undefined) {
      const n = String(body.panel_name).trim().slice(0, 30);
      if (!n) return res.status(400).json({ error: 'panel_name cannot be empty' });
      s.panel_name = n;
      changes.push(`panel_name=${n}`);
    }
    if (body.logo !== undefined) {
      const l = String(body.logo).trim().slice(0, 8);
      if (!l) return res.status(400).json({ error: 'logo cannot be empty' });
      s.logo = l;
      changes.push(`logo=${l}`);
    }
    if (changes.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    store.save();
    store.logActivity(me.username, 'settings_update', `Updated branding: ${changes.join(', ')}`, getIp(req));
    return res.status(200).json({ settings: s });
  }

  return res.status(405).json({ error: 'GET or PATCH only' });
};