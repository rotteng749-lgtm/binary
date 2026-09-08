/**
 * POST /api/panel/password — change your own password.
 * Body: { current, password }
 * Any logged-in role can change their own password; current password required.
 */
const store = require('../../lib/store');
const auth = require('../../lib/auth');
const { readBody, setCors, getIp, hashPassword, verifyPassword } = require('../../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const g = await auth.requireAuth(req);
  if (g.error) return res.status(g.error[0]).json({ error: g.error[1] });
  const me = g.account;

  const body = await readBody(req);
  const current = String(body.current || '');
  const next = String(body.password || '');

  if (!verifyPassword(current, me.password)) {
    store.logActivity(me.username, 'password_change_failed', 'Wrong current password', getIp(req));
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  if (next.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }
  if (next === current) {
    return res.status(400).json({ error: 'New password must be different' });
  }

  me.password = hashPassword(next);
  store.save();
  store.logActivity(me.username, 'password_change', 'Password changed (self)', getIp(req));

  return res.status(200).json({ ok: true });
};
