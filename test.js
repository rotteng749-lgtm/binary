/**
 * DRIPNEXT local smoke test — runs the full scenario against the real
 * API handlers with mocked req/res. No server needed:  node test.js
 */
const assert = require('assert');

const store = require('./lib/store');

/* ── Mock req/res ── */
function mockReq({ method = 'GET', body = null, headers = {}, query = {}, url = '/api/x' } = {}) {
  return { method, headers, query, body, url };
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    end(b) { this.body = b !== undefined ? b : (this.body ?? ''); return this; },
    setHeader() {},
  };
}

async function call(handler, opts) {
  const res = await handler(mockReq(opts), mockRes());
  return { status: res.statusCode, body: res.body };
}

function authed(token) {
  // Node/Vercel lowercase incoming header names — mock must match
  return { headers: { authorization: `Bearer ${token}` } };
}

let passed = 0;
const failures = [];
function t(name, cond) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failures.push(name); console.log(`  ✘ ${name}`); }
}

(async () => {
  await store.ensureLoaded(); // seeds in-memory state

  const configApi = require('./handlers/config');
  const settingsApi = require('./handlers/panel/settings');
  const customApi = require('./handlers/panel/custom');
  const customOne = require('./handlers/panel/custom/[id].js');
  const clientAuth = require('./handlers/clientAuth');
  const login = require('./handlers/panel/login');
  const logout = require('./handlers/panel/logout');
  const me = require('./handlers/panel/me');
  const stats = require('./handlers/panel/stats');
  const accounts = require('./handlers/panel/accounts');
  const accountOne = require('./handlers/panel/accounts/[username].js');
  const keysApi = require('./handlers/panel/keys');
  const keysBulk = require('./handlers/panel/keys/bulk');
  const keyOne = require('./handlers/panel/keys/[key].js');
  const passwordApi = require('./handlers/panel/password');
  const gamesApi = require('./handlers/panel/games');
  const gameOne = require('./handlers/panel/games/[id].js');
  const activity = require('./handlers/panel/activity');
  const router = require('./api/[[...path]].js');

  console.log('\n[1] Client auth API basics');
  let r = await call(clientAuth, { method: 'GET' });
  t('GET /api/auth health', r.body.status === 'success' && r.body.games.length === 3);

  r = await call(clientAuth, { method: 'POST', body: { key: 'X', device: 'D', game: '' } });
  t('missing fields rejected', r.body.status === 'error');

  console.log('\n[2] Panel logins');
  r = await call(login, { method: 'POST', body: { username: 'owner', password: 'WRONG', device: 'dOwner' } });
  t('wrong password → 401', r.status === 401);

  r = await call(login, { method: 'POST', body: { username: 'owner', password: 'owner123', device: 'dOwner' } });
  t('owner login ok', r.status === 200 && r.body.token && r.body.account.role === 'owner');
  const ownerTok = r.body.token;

  r = await call(me, authed(ownerTok));
  t('me() returns owner + games', r.body.account.username === 'owner' && r.body.games.length === 3);

  console.log('\n[3] Owner creates admin → admin creates reseller');
  r = await call(accounts, { method: 'POST', ...authed(ownerTok), body: { username: 'boss', password: 'boss123', role: 'admin', credits: 5 } });
  t('create admin', r.status === 201 && r.body.account.role === 'admin');

  r = await call(login, { method: 'POST', body: { username: 'boss', password: 'boss123', device: 'dAdmin' } });
  const adminTok = r.body.token;
  t('admin login ok', r.status === 200);

  r = await call(accounts, { method: 'POST', ...authed(adminTok), body: { username: 'res1', password: 'r1pass', role: 'admin', credits: 5 } });
  t('admin cannot create admin', r.status === 403);

  r = await call(accounts, { method: 'POST', ...authed(adminTok), body: { username: 'res1', password: 'r1pass', role: 'reseller', credits: 5, expires_days: 7, games: ['mlbb'] } });
  t('admin creates reseller r1 (7d, mlbb only)', r.status === 201 && r.body.account.games[0] === 'mlbb');

  console.log('\n[4] Reseller one-device login');
  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'r1pass', device: 'dR1' } });
  const r1Tok = r.body.token;
  t('r1 login ok, device bound', r.status === 200 && r.body.account.device === 'dR1');

  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'r1pass', device: 'dR2' } });
  t('r1 second device blocked (one device login)', r.status === 403);

  r = await call(accountOne, { method: 'PATCH', query: { username: 'res1' }, ...authed(adminTok), body: { device_reset: true } });
  t('admin resets r1 device', r.status === 200 && r.body.account.device === null);

  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'r1pass', device: 'dR2' } });
  t('r1 can login on new device after reset', r.status === 200);
  const r1Tok2 = r.body.token;

  console.log('\n[5] Key generation + credits');
  r = await call(keysApi, { method: 'POST', ...authed(r1Tok2), body: { mode: 'random', game: 'mlbb', count: 3, duration_days: 30 } });
  const r1Keys = r.body.created.map((k) => k.key);
  t('r1 generates 3 keys, 2 credits left', r.status === 201 && r.body.created.length === 3 && r.body.credits_left === 2);

  r = await call(keysApi, { method: 'POST', ...authed(r1Tok2), body: { mode: 'random', game: 'ff', count: 1, duration_days: 30 } });
  t('r1 blocked from non-permitted game (ff)', r.status === 403);

  r = await call(keysApi, { method: 'POST', ...authed(r1Tok2), body: { mode: 'random', game: 'mlbb', count: 3, duration_days: 30 } });
  t('r1 not enough credits', r.status === 400 && /Not enough credits/.test(r.body.error));

  r = await call(keysApi, { method: 'POST', ...authed(ownerTok), body: { mode: 'random', game: 'ff', count: 2, duration_days: 30, prefix: 'OWN' } });
  t('owner generates unlimited (free)', r.status === 201 && r.body.credits_left === 'unlimited');

  r = await call(keysApi, { method: 'POST', ...authed(adminTok), body: { mode: 'custom', game: 'mlbb', keys: 'CUSTOM-ONE\nCUSTOM-TWO', duration_days: 7 } });
  t('admin custom keys (cost 2 → 3 left)', r.status === 201 && r.body.created.length === 2 && r.body.credits_left === 3);

  console.log('\n[6] Client auth — one device access on keys');
  const K1 = r1Keys[0];
  r = await call(clientAuth, { method: 'POST', body: { key: K1, device: 'phoneA', game: 'mlbb' } });
  t('first login registers device + sets expiry', r.body.status === 'success' && r.body.message === 'Device registered' && r.body.expired);

  r = await call(clientAuth, { method: 'POST', body: { key: K1, device: 'phoneB', game: 'mlbb' } });
  t('second device rejected (one device access)', r.body.status === 'error' && /another device/.test(r.body.message));

  r = await call(clientAuth, { method: 'POST', body: { key: K1, device: 'phoneA', game: 'ff' } });
  t('wrong game rejected', r.body.status === 'error' && r.body.message === 'Wrong game key');

  r = await call(clientAuth, { method: 'POST', body: { key: 'NOPE-NOPE-NOPE', device: 'phoneA', game: 'mlbb' } });
  t('invalid key rejected', r.body.status === 'error' && r.body.message === 'Invalid key');

  console.log('\n[7] Key management (ban/extend/reset device)');
  r = await call(keyOne, { method: 'PATCH', query: { key: K1 }, ...authed(ownerTok), body: { action: 'ban' } });
  t('owner bans key', r.status === 200 && r.body.key.status === 'banned');
  r = await call(clientAuth, { method: 'POST', body: { key: K1, device: 'phoneA', game: 'mlbb' } });
  t('banned key rejected by client auth', r.body.message === 'Key banned');

  r = await call(keyOne, { method: 'PATCH', query: { key: K1 }, ...authed(ownerTok), body: { action: 'activate' } });
  t('owner re-activates key', r.body.key.status === 'active');

  const before = store.findKey(K1).expires_at;
  r = await call(keyOne, { method: 'PATCH', query: { key: K1 }, ...authed(ownerTok), body: { action: 'extend', days: 5 } });
  t('extend +5 days', Date.parse(r.body.key.expires_at) - Date.parse(before) === 5 * 86400000);

  r = await call(keyOne, { method: 'PATCH', query: { key: K1 }, ...authed(ownerTok), body: { action: 'reset_device' } });
  t('reset device binding', r.body.key.device === null);
  r = await call(clientAuth, { method: 'POST', body: { key: K1, device: 'phoneB', game: 'mlbb' } });
  t('new device can bind after reset (expiry kept)', r.body.status === 'success' && r.body.message === 'Device registered');

  console.log('\n[8] Scoping: who sees what');
  r = await call(keysApi, authed(ownerTok));
  t('owner sees all keys (5 + 2 custom = 7)', r.body.keys.length === 7);

  r = await call(keysApi, authed(adminTok));
  t('admin sees own + reseller keys only (5)', r.body.keys.length === 5);

  r = await call(keysApi, authed(r1Tok2));
  t('reseller sees only own keys (3)', r.body.keys.length === 3);

  r = await call(keyOne, { method: 'PATCH', query: { key: 'OWN-FF-XXXXXXXX'.replace('XXXXXXXX', 'ZZZZZZZZ') }, ...authed(r1Tok2), body: { action: 'ban' } });
  t('reseller cannot touch a foreign key', r.status === 404 || r.status === 404);

  console.log('\n[9] Games management');
  r = await call(gamesApi, { method: 'POST', ...authed(adminTok), body: { id: 'valo', name: 'Valorant' } });
  t('admin cannot create game', r.status === 403);
  r = await call(gamesApi, { method: 'POST', ...authed(ownerTok), body: { id: 'valo', name: 'Valorant' } });
  t('owner adds game', r.status === 201);
  r = await call(gamesApi, { method: 'POST', ...authed(ownerTok), body: { id: 'valo', name: 'Dup' } });
  t('duplicate game id rejected', r.status === 409);
  r = await call(gameOne, { method: 'DELETE', query: { id: 'mlbb' }, ...authed(ownerTok) });
  t('cannot delete game with keys', r.status === 409);
  r = await call(gameOne, { method: 'PATCH', query: { id: 'valo' }, ...authed(ownerTok), body: { status: 'disabled' } });
  t('owner disables game', r.status === 200);
  r = await call(gameOne, { method: 'DELETE', query: { id: 'valo' }, ...authed(ownerTok) });
  t('delete unused game ok', r.status === 200);

  console.log('\n[10] Account expiry + ban');
  const db = store.state();
  store.findAccount('res1').expires_at = new Date(Date.now() - 1000).toISOString();
  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'r1pass', device: 'dR2' } });
  t('expired account blocked at login', r.status === 403 && /expired/.test(r.body.error));

  r = await call(accountOne, { method: 'PATCH', query: { username: 'res1' }, ...authed(ownerTok), body: { clear_expiry: true } });
  t('owner clears expiry', r.status === 200 && r.body.account.expires_at === null);
  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'r1pass', device: 'dR2' } });
  t('login works again', r.status === 200);

  r = await call(accountOne, { method: 'PATCH', query: { username: 'res1' }, ...authed(adminTok), body: { status: 'banned' } });
  t('admin bans r1', r.status === 200);
  r = await call(me, authed(r1Tok2));
  t('banned account session invalidated', r.status === 401);
  r = await call(accountOne, { method: 'PATCH', query: { username: 'res1' }, ...authed(adminTok), body: { status: 'active', credits: 25 } });
  t('admin re-activates + credits 25', r.body.account.credits === 25);

  console.log('\n[11] Activity scoping + stats + logout');
  r = await call(activity, { query: { limit: 500 }, ...authed(ownerTok) });
  const ownerActs = r.body.activity.length;
  t('owner sees activity', ownerActs > 10);

  // res1's old token died when the account was banned — log in again
  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'r1pass', device: 'dR2' } });
  t('res1 re-login after re-activation', r.status === 200);
  const r1Tok3 = r.body.token;

  r = await call(activity, authed(r1Tok3));
  t('reseller activity scoped to own actor/keys',
    r.body.activity.every((e) => e.actor === 'res1' || (e.key_owner && e.key_owner === 'res1')));

  r = await call(stats, authed(ownerTok));
  t('owner stats have admin+reseller counts', r.body.stats.accounts_admins >= 1 && r.body.stats.accounts_resellers >= 1);

  r = await call(logout, { method: 'POST', ...authed(r1Tok3) });
  t('logout ok', r.body.ok === true);
  r = await call(me, authed(r1Tok3));
  t('token dead after logout', r.status === 401);

  console.log('\n[12] Catch-all router (single lambda — the Vercel 401 fix)');
  r = await call(router, { method: 'GET', url: '/api/auth' });
  t('router: /api/auth health', r.body.status === 'success');

  r = await call(router, { method: 'POST', url: '/api/panel/login', body: { username: 'owner', password: 'owner123', device: 'dOwner' } });
  t('router: login works (same bound device)', r.status === 200 && r.body.token);
  const routerTok = r.body.token;

  r = await call(router, { method: 'GET', url: '/api/panel/me', headers: { authorization: `Bearer ${routerTok}` } });
  t('router: /api/panel/me works after login (no 401)', r.status === 200 && r.body.account.username === 'owner');

  r = await call(router, { method: 'POST', url: '/api/panel/keys', headers: { authorization: `Bearer ${routerTok}` }, body: { mode: 'random', game: 'pubg', count: 2, duration_days: 1 } });
  t('router: generate keys via POST /api/panel/keys', r.status === 201 && r.body.created.length === 2);
  const rk = r.body.created[0].key;

  r = await call(router, { method: 'PATCH', url: `/api/panel/keys/${encodeURIComponent(rk)}`, headers: { authorization: `Bearer ${routerTok}` }, body: { action: 'extend', days: 3 } });
  t('router: PATCH /api/panel/keys/:key', r.status === 200 && r.body.key.duration_days === 4);

  r = await call(router, { method: 'GET', url: '/api/panel/keys?limit=5', headers: { authorization: `Bearer ${routerTok}` } });
  t('router: query params parsed', r.status === 200 && r.body.keys.length >= 2);

  r = await call(router, { method: 'GET', url: '/api/panel/unknown' });
  t('router: unknown route → 404', r.status === 404);

  console.log('\n[13] Bulk key actions');
  // r1Tok3 was logged out in [11] — get a fresh reseller session
  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'r1pass', device: 'dR2' } });
  const r1Tok3b = r.body.token;
  t('res1 fresh session for bulk tests', r.status === 200);

  r = await call(keysApi, { method: 'POST', ...authed(ownerTok), body: { mode: 'random', game: 'pubg', count: 4, duration_days: 3, prefix: 'BULK' } });
  const bulkKeys = r.body.created.map((k) => k.key);
  t('seed 4 bulk keys', r.status === 201 && bulkKeys.length === 4);

  r = await call(keysBulk, { method: 'POST', ...authed(ownerTok), body: { action: 'ban', keys: bulkKeys } });
  t('bulk ban 4 keys', r.status === 200 && r.body.updated === 4 && r.body.skipped.length === 0);
  t('bulk ban applied', store.findKey(bulkKeys[0]).status === 'banned' && store.findKey(bulkKeys[3]).status === 'banned');

  r = await call(keysBulk, { method: 'POST', ...authed(ownerTok), body: { action: 'activate', keys: bulkKeys } });
  t('bulk activate 4 keys', r.status === 200 && r.body.updated === 4);

  r = await call(keysBulk, { method: 'POST', ...authed(ownerTok), body: { action: 'extend', keys: bulkKeys.slice(0, 2), days: 5 } });
  t('bulk extend +5d (unactivated → duration)', r.status === 200 && store.findKey(bulkKeys[0]).duration_days === 8);

  r = await call(keysBulk, { method: 'POST', ...authed(ownerTok), body: { action: 'reset_device', keys: bulkKeys } });
  t('bulk reset device', r.status === 200 && r.body.updated === 4);

  r = await call(keysBulk, { method: 'POST', ...authed(r1Tok3b), body: { action: 'ban', keys: bulkKeys } });
  t('reseller cannot bulk-touch foreign keys (skipped)', r.status === 200 && r.body.updated === 0 && r.body.skipped.length === 4);

  r = await call(keysBulk, { method: 'POST', ...authed(ownerTok), body: { action: 'delete', keys: [bulkKeys[0], bulkKeys[1], 'FAKE-KEY-1'] } });
  t('bulk delete 2 keys + 1 fake skipped', r.status === 200 && r.body.deleted === 2 && r.body.skipped.includes('FAKE-KEY-1'));

  r = await call(keysBulk, { method: 'POST', ...authed(ownerTok), body: { action: 'nuke', keys: bulkKeys } });
  t('unknown bulk action rejected', r.status === 400);

  console.log('\n[14] Self-service password change');
  r = await call(passwordApi, { method: 'POST', ...authed(r1Tok3b), body: { current: 'wrongpass', password: 'newpass1' } });
  t('wrong current password rejected', r.status === 401);

  r = await call(passwordApi, { method: 'POST', ...authed(r1Tok3b), body: { current: 'r1pass', password: 'newpass1' } });
  t('password change ok', r.status === 200 && r.body.ok === true);

  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'newpass1', device: 'dR2' } });
  t('login works with new password', r.status === 200);
  const r1Tok4 = r.body.token;

  r = await call(login, { method: 'POST', body: { username: 'res1', password: 'r1pass', device: 'dR2' } });
  t('old password no longer works', r.status === 401);

  r = await call(passwordApi, { method: 'POST', ...authed(r1Tok4), body: { current: 'newpass1', password: 'r1pass' } });
  t('password restored for later tests', r.status === 200);

  console.log('\n[15] PBKDF2 password hashing');
  const acc1 = store.findAccount('res1');
  t('password stored as pbkdf2 after change', String(acc1.password).startsWith('pbkdf2$'));

  console.log('\n[16] Login rate limiting');
  let lastStatus = 0;
  for (let i = 0; i < 12; i++) {
    r = await call(login, { method: 'POST', body: { username: 'ratelimit', password: 'x', device: 'd' } });
    lastStatus = r.status;
  }
  t('11+ failed attempts → 429', lastStatus === 429);

  console.log('\n[17] Accounts list includes keys_count');
  r = await call(accounts, authed(ownerTok));
  const bossAcc = r.body.accounts.find((a) => a.username === 'boss');
  t('accounts have keys_count field', r.status === 200 && bossAcc && typeof bossAcc.keys_count === 'number');

  console.log('\n[18] Cheat feature (attached to keys, returned to client)');
  r = await call(gameOne, { method: 'PATCH', query: { id: 'mlbb' }, ...authed(ownerTok), body: { cheat: 'CHEAT-DEFAULT' } });
  t('owner sets game cheat', r.status === 200 && r.body.game.cheat === 'CHEAT-DEFAULT');

  r = await call(gameOne, { method: 'PATCH', query: { id: 'mlbb' }, ...authed(adminTok), body: { cheat: 'ADMIN-EDIT' } });
  t('admin can edit game cheat', r.status === 200 && r.body.game.cheat === 'ADMIN-EDIT');
  r = await call(gameOne, { method: 'PATCH', query: { id: 'mlbb' }, ...authed(adminTok), body: { cheat: 'CHEAT-DEFAULT' } });
  t('admin restores cheat', r.status === 200);

  r = await call(gameOne, { method: 'PATCH', query: { id: 'mlbb' }, ...authed(r1Tok3b), body: { cheat: 'nope' } });
  t('reseller cannot edit game cheat', r.status === 403);

  r = await call(keysApi, { method: 'POST', ...authed(r1Tok3b), body: { mode: 'random', game: 'mlbb', count: 2, duration_days: 5, cheat: 'CHEAT-EXPLICIT' } });
  const cheatKeys = r.body.created.map((k) => k.key);
  t('key stores explicit cheat at generation', r.status === 201 && store.findKey(cheatKeys[0]).cheat === 'CHEAT-EXPLICIT');

  r = await call(clientAuth, { method: 'POST', body: { key: cheatKeys[0], device: 'phCheat', game: 'mlbb' } });
  t('client auth returns cheat on login', r.body.status === 'success' && r.body.cheat === 'CHEAT-EXPLICIT');

  r = await call(keysApi, { method: 'POST', ...authed(ownerTok), body: { mode: 'random', game: 'mlbb', count: 1, duration_days: 5 } });
  const inheritKey = r.body.created[0].key;
  t('key without cheat inherits game cheat', store.findKey(inheritKey).cheat === 'CHEAT-DEFAULT');

  r = await call(keyOne, { method: 'PATCH', query: { key: inheritKey }, ...authed(ownerTok), body: { action: 'edit', cheat: 'EDITED' } });
  t('key edit updates cheat', r.status === 200 && r.body.key.cheat === 'EDITED');

  console.log('\n[19] Config + branding (replaceable logo)');
  r = await call(configApi, { method: 'GET' });
  t('public /api/config returns branding', r.status === 200 && r.body.panel_name === 'KITSUNE' && r.body.logo === '🦊');

  r = await call(settingsApi, { method: 'PATCH', ...authed(r1Tok3b), body: { logo: '🐉' } });
  t('reseller cannot change branding', r.status === 403);

  r = await call(settingsApi, { method: 'PATCH', ...authed(ownerTok), body: { panel_name: 'NEXUS', logo: '🐉' } });
  t('owner changes branding', r.status === 200 && r.body.settings.logo === '🐉');

  r = await call(configApi, { method: 'GET' });
  t('config reflects new branding', r.body.panel_name === 'NEXUS' && r.body.logo === '🐉');

  r = await call(settingsApi, { method: 'GET', ...authed(ownerTok) });
  t('settings GET works for authed roles', r.status === 200 && r.body.settings.logo === '🐉');

  r = await call(settingsApi, { method: 'PATCH', ...authed(ownerTok), body: { panel_name: '', logo: '🦊' } });
  t('empty panel_name rejected', r.status === 400);

  r = await call(settingsApi, { method: 'PATCH', ...authed(ownerTok), body: { panel_name: 'KITSUNE', logo: '🦊' } });
  t('branding restored to defaults', r.status === 200 && r.body.settings.logo === '🦊');

  r = await call(router, { method: 'GET', url: '/api/config' });
  t('router: /api/config works', r.status === 200 && r.body.panel_name === 'KITSUNE');

  console.log('\n[20] Custom endpoints (public custom responses)');
  r = await call(customApi, { method: 'POST', ...authed(r1Tok3b), body: { path: 'v1/check', method: 'GET', content_type: 'text/plain', body: 'x' } });
  t('reseller cannot create custom endpoint', r.status === 403);

  const jsonBody = '{\n  "status": "ok",\n  "panel": "{{panel_name}}",\n  "time": "{{time}}"\n}';
  r = await call(customApi, { method: 'POST', ...authed(ownerTok), body: { path: 'v1/check', method: 'GET', content_type: 'application/json', body: jsonBody } });
  const cid = r.body.custom.id;
  t('owner creates custom endpoint', r.status === 201 && r.body.custom.path === 'v1/check');

  r = await call(router, { method: 'GET', url: '/v1/check' });
  t('custom endpoint served publicly with placeholders', r.status === 200 && r.body.includes('"panel": "KITSUNE"'));

  r = await call(customApi, { method: 'POST', ...authed(ownerTok), body: { path: 'v1/check', method: 'GET', content_type: 'text/plain', body: 'dup' } });
  t('duplicate custom path rejected', r.status === 409);

  r = await call(customApi, { method: 'POST', ...authed(ownerTok), body: { path: 'api/evil', method: 'GET', content_type: 'text/plain', body: 'x' } });
  t('reserved prefix (api/) rejected', r.status === 400);

  r = await call(customApi, { method: 'POST', ...authed(adminTok), body: { path: 'admin/route', method: 'POST', content_type: 'text/javascript', body: 'const v = {{version}};' } });
  t('admin can create custom endpoint', r.status === 201);

  r = await call(router, { method: 'POST', url: '/admin/route' });
  t('admin JS endpoint served on POST', r.status === 200 && r.body.includes('1.3.0'));

  r = await call(customOne, { method: 'PATCH', query: { id: cid }, ...authed(ownerTok), body: { active: false } });
  t('owner disables endpoint', r.status === 200 && r.body.custom.active === false);
  r = await call(router, { method: 'GET', url: '/v1/check' });
  t('disabled endpoint not served', r.status === 404);

  r = await call(customOne, { method: 'PATCH', query: { id: cid }, ...authed(adminTok), body: { body: 'hijack' } });
  t('admin cannot edit owner endpoint', r.status === 404);

  r = await call(customOne, { method: 'DELETE', query: { id: cid }, ...authed(ownerTok) });
  t('owner deletes endpoint', r.status === 200 && r.body.ok === true);

  r = await call(customApi, { method: 'GET', ...authed(ownerTok) });
  t('owner lists custom endpoints (admin route remains)', r.body.custom.some((c) => c.path === 'admin/route'));

  console.log(`\n════════════════════════════`);
  console.log(`PASSED: ${passed}  FAILED: ${failures.length}`);
  if (failures.length) {
    console.log('Failed:', failures);
    process.exit(1);
  }
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(1);
});
