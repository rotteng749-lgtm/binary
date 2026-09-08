/**
 * Catch-all Vercel function — single lambda for ALL endpoints.
 *
 * Why one lambda: separate api/*.js files = separate serverless instances,
 * each with its own memory. In-memory state (accounts, sessions) would be
 * split across instances → random 401s. Routing inside one function keeps
 * every request in the same memory (as long as it's warm).
 *
 * With UPSTASH_REDIS_REST_URL + TOKEN set, state is also refreshed from
 * Redis on every request, so even multiple instances share one source of
 * truth and data survives cold starts.
 *
 * Routes:
 *   GET       /api/config                   public branding (no auth)
 *   GET/POST  /api/auth
 *   POST      /api/panel/login | /api/panel/logout
 *   GET       /api/panel/me | /api/panel/stats | /api/panel/activity
 *   GET/PATCH /api/panel/settings           branding (PATCH: owner)
 *   GET/POST  /api/panel/accounts            PATCH/DELETE /api/panel/accounts/:username
 *   GET/POST  /api/panel/keys                PATCH/DELETE /api/panel/keys/:key
 *   POST      /api/panel/keys/bulk           bulk ban/activate/delete/extend/reset
 *   POST      /api/panel/password            change own password (any role)
 *   GET/POST  /api/panel/games               PATCH/DELETE /api/panel/games/:id
 */
const { setCors } = require('../lib/util');

const configApi = require('../handlers/config');
const clientAuth = require('../handlers/clientAuth');
const login = require('../handlers/panel/login');
const logout = require('../handlers/panel/logout');
const me = require('../handlers/panel/me');
const stats = require('../handlers/panel/stats');
const accounts = require('../handlers/panel/accounts');
const accountOne = require('../handlers/panel/accounts/[username].js');
const keysApi = require('../handlers/panel/keys');
const keysBulk = require('../handlers/panel/keys/bulk');
const keyOne = require('../handlers/panel/keys/[key].js');
const password = require('../handlers/panel/password');
const gamesApi = require('../handlers/panel/games');
const gameOne = require('../handlers/panel/games/[id].js');
const activity = require('../handlers/panel/activity');
const settings = require('../handlers/panel/settings');

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = new URL(req.url, 'http://localhost');
  let seg = url.pathname.split('/').filter(Boolean);
  if (seg[0] === 'api') seg = seg.slice(1);

  if (!req.query || typeof req.query !== 'object') req.query = {};
  for (const [k, v] of url.searchParams) {
    if (!(k in req.query)) req.query[k] = v;
  }

  // Public branding config
  if (seg[0] === 'config' && seg.length === 1) return configApi(req, res);

  // Client auth API — GET health, POST key login
  if (seg[0] === 'auth' && seg.length === 1) return clientAuth(req, res);

  // Panel API
  if (seg[0] === 'panel') {
    const resource = seg[1];
    const param = seg[2];

    switch (resource) {
      case 'login': return login(req, res);
      case 'logout': return logout(req, res);
      case 'me': return me(req, res);
      case 'stats': return stats(req, res);
      case 'activity': return activity(req, res);
      case 'accounts':
        if (param) { req.query.username = safeDecode(param); return accountOne(req, res); }
        return accounts(req, res);
      case 'keys':
        if (param === 'bulk') return keysBulk(req, res);
        if (param) { req.query.key = safeDecode(param); return keyOne(req, res); }
        return keysApi(req, res);
      case 'password': return password(req, res);
      case 'settings': return settings(req, res);
      case 'games':
        if (param) { req.query.id = safeDecode(param); return gameOne(req, res); }
        return gamesApi(req, res);
    }
  }

  return res.status(404).json({ error: 'Not found' });
};
