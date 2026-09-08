/**
 * /api/panel/custom — custom public endpoints (owner/admin).
 *
 * GET  → list (owner: all | admin: own only)
 * POST → create { path, method, content_type, body, active }
 *
 * Custom routes are served publicly (no auth) so clients can fetch
 * arbitrary JSON / JS / PHP / TS / text responses from the panel.
 */
const store = require('../../lib/store');
const auth = require('../../lib/auth');
const { readBody, setCors, getIp, nowIso, randomCode } = require('../../lib/util');

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

  /* ── LIST ── */
  if (req.method === 'GET') {
    const list = me.role === 'owner'
      ? db.custom
      : db.custom.filter((c) => c.created_by === me.username);
    list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return res.status(200).json({ custom: list });
  }

  /* ── CREATE ── */
  if (req.method === 'POST') {
    const body = await readBody(req);
    const path = normalizePath(body.path);
    const method = String(body.method || 'GET').toUpperCase();
    const contentType = String(body.content_type || 'text/plain');
    const routeBody = String(body.body !== undefined ? body.body : '').slice(0, 20000);

    const err = validatePath(path);
    if (err) return res.status(400).json({ error: err });
    if (!METHODS.includes(method)) return res.status(400).json({ error: `method must be ${METHODS.join('/')}` });
    if (!CONTENT_TYPES[contentType]) return res.status(400).json({ error: `content_type must be one of: ${Object.keys(CONTENT_TYPES).join(', ')}` });
    if (db.custom.some((c) => c.path === path)) return res.status(409).json({ error: `Custom path already exists: /${path}` });

    const route = {
      id: randomCode(10),
      path,
      method,
      content_type: contentType,
      body: routeBody,
      active: body.active !== false,
      created_by: me.username,
      created_at: nowIso(),
    };
    db.custom.push(route);
    store.save();
    store.logActivity(me.username, 'custom_create', `Created custom endpoint /${path} (${method}, ${contentType})`, getIp(req));
    return res.status(201).json({ custom: route });
  }

  return res.status(405).json({ error: 'GET or POST only' });
};