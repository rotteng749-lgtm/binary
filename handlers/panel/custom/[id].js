/**
 * /api/panel/custom/[id] — edit / delete a custom endpoint.
 * Owner manages all; admin only their own.
 */
const store = require('../../../lib/store');
const auth = require('../../../lib/auth');
const { readBody, setCors, getIp } = require('../../../lib/util');

const METHODS = ['GET', 'POST', 'ANY'];
const CONTENT_TYPES = {
  'application/json': 'JSON',
  'text/javascript': 'JavaScript',
  'application/x-php': 'PHP',
  'text/typescript': 'TypeScript',
  'text/html': 'HTML',
  'text/css': 'CSS',
  'text/plain': 'Plain text',
};
const RESERVED = ['api', 'auth', 'config', 'panel'];

function normalizePath(p) {
  return String(p || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
}

function validatePath(p) {
  if (!p) return 'path is required';
  if (p.length < 2 || p.length > 60) return 'path must be 2-60 chars';
  if (!/^[a-z0-9_./-]+$/.test(p)) return 'path: only a-z, 0-9, _ , . , - and /';
  if (p.split('/').some((s) => !s || s === '.' || s === '..')) return 'invalid path segment';
  if (RESERVED.includes(p.split('/')[0])) return `path cannot start with: ${RESERVED.join(', ')}`;
  return null;
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const g = await auth.requireAuth(req, ['owner', 'admin']);
  if (g.error) return res.status(g.error[0]).json({ error: g.error[1] });
  const me = g.account;
  const db = store.state();
  if (!Array.isArray(db.custom)) db.custom = [];

  const route = db.custom.find((c) => c.id === req.query.id);
  if (!route || (me.role === 'admin' && route.created_by !== me.username)) {
    return res.status(404).json({ error: 'Custom endpoint not found (or not yours)' });
  }

  if (req.method === 'PATCH') {
    const body = await readBody(req);
    const changes = [];

    if (body.path !== undefined) {
      const path = normalizePath(body.path);
      const err = validatePath(path);
      if (err) return res.status(400).json({ error: err });
      if (db.custom.some((c) => c.id !== route.id && c.path === path)) {
        return res.status(409).json({ error: `Custom path already exists: /${path}` });
      }
      route.path = path;
      changes.push(`path=/${path}`);
    }
    if (body.method !== undefined) {
      const method = String(body.method).toUpperCase();
      if (!METHODS.includes(method)) return res.status(400).json({ error: `method must be ${METHODS.join('/')}` });
      route.method = method;
      changes.push(`method=${method}`);
    }
    if (body.content_type !== undefined) {
      const ct = String(body.content_type);
      if (!CONTENT_TYPES[ct]) return res.status(400).json({ error: `content_type must be one of: ${Object.keys(CONTENT_TYPES).join(', ')}` });
      route.content_type = ct;
      changes.push(`type=${ct}`);
    }
    if (body.body !== undefined) {
      route.body = String(body.body).slice(0, 20000);
      changes.push('body');
    }
    if (body.active !== undefined) {
      route.active = body.active !== false;
      changes.push(`active=${route.active}`);
    }
    if (changes.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    store.save();
    store.logActivity(me.username, 'custom_update', `Updated custom endpoint /${route.path}: ${changes.join(', ')}`, getIp(req));
    return res.status(200).json({ custom: route });
  }

  if (req.method === 'DELETE') {
    db.custom = db.custom.filter((c) => c.id !== route.id);
    store.save();
    store.logActivity(me.username, 'custom_delete', `Deleted custom endpoint /${route.path}`, getIp(req));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'PATCH or DELETE only' });
};