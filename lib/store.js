/**
 * DRIPNEXT store — zero-dependency state + optional REST persistence.
 *
 * - Default: in-memory (resets on cold start — same behaviour as the old panels).
 * - Optional persistence: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   (or KV_REST_API_URL + KV_REST_API_URL_TOKEN) and the whole state is
 *   loaded/saved over plain fetch() — no npm driver needed.
 */
const { hashPassword, nowIso, randomCode } = require('./util');

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_URL_TOKEN || '';
const KV_KEY = 'nextpanel:db:v1';
const PERSIST = Boolean(KV_URL && KV_TOKEN);

let db = null;
let chain = Promise.resolve(); // serializes every KV read/write

function defaultSettings() {
  return { panel_name: 'KITSUNE', logo: '🦊' };
}

function defaultState() {
  return { accounts: [], keys: [], games: [], activity: [], sessions: [], settings: defaultSettings(), custom: [] };
}

/* ── Seed (first boot only) ───────────────────────────────── */

function seed(state) {
  const t = nowIso();
  state.games = [
    { id: 'mlbb', name: 'Mobile Legends', status: 'active', cheat: '', created_at: t },
    { id: 'ff', name: 'Free Fire', status: 'active', cheat: '', created_at: t },
    { id: 'pubg', name: 'PUBG Mobile', status: 'active', cheat: '', created_at: t },
  ];
  state.accounts = [
    {
      username: 'owner', password: hashPassword('owner123'), role: 'owner',
      credits: null, // unlimited
      expires_at: null, device: null, status: 'active', games: ['*'],
      created_by: 'system', created_at: t,
    },
    {
      username: 'reseller', password: hashPassword('reseller123'), role: 'reseller',
      credits: 10,
      expires_at: null, device: null, status: 'active', games: ['*'],
      created_by: 'owner', created_at: t,
    },
  ];
  state.activity.push({
    id: randomCode(12), ts: t, actor: 'system', type: 'seed',
    detail: 'Initial data created', ip: '-', key_owner: null,
  });
}

/* ── Persistence (optional, plain fetch) ──────────────────── */

async function loadFromKV() {
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(KV_KEY)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const j = await r.json();
    if (j && j.result) return JSON.parse(j.result);
  } catch (e) {
    console.error('[KV] load failed:', e.message);
  }
  return null;
}

function save() {
  if (!PERSIST || !db) return;
  const payload = JSON.stringify(db);
  chain = chain
    .then(() => fetch(`${KV_URL}/set/${encodeURIComponent(KV_KEY)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
      body: payload,
    }))
    .catch((e) => console.error('[KV] save failed:', e.message));
}

async function ensureLoaded() {
  if (!PERSIST) {
    if (!db) {
      db = defaultState();
      seed(db);
    }
    return;
  }
  // Refresh from KV on EVERY request → all serverless instances share one
  // source of truth and a save is always followed by consistent reads.
  chain = chain
    .then(async () => {
      const state = await loadFromKV();
      if (state && Array.isArray(state.accounts) && Array.isArray(state.keys)) {
        db = state;
        if (!db.settings) db.settings = defaultSettings();
        if (!Array.isArray(db.custom)) db.custom = [];
      } else if (!db) {
        db = defaultState();
        seed(db);
      }
    })
    .catch((e) => console.error('[KV] refresh failed:', e.message));
  await chain;
}

/* ── Lookups ──────────────────────────────────────────────── */

function state() { return db; }

function findAccount(username) {
  if (!username) return null;
  const u = String(username).toLowerCase();
  return db.accounts.find((a) => a.username === u) || null;
}

function findKey(keyStr) {
  if (!keyStr) return null;
  return db.keys.find((k) => k.key === keyStr) || null;
}

function findGame(id) {
  if (!id) return null;
  return db.games.find((g) => g.id === String(id).toLowerCase()) || null;
}

/* ── Expiry / status helpers ──────────────────────────────── */

function accountExpired(a) {
  return Boolean(a.expires_at && Date.now() > Date.parse(a.expires_at));
}

function keyExpired(k) {
  return Boolean(k.expires_at && Date.now() > Date.parse(k.expires_at));
}

/* ── Scoping (role visibility) ────────────────────────────── */

// null = see everything (owner). Otherwise a Set of visible usernames.
function visibleUsernames(me) {
  if (!me) return new Set();
  if (me.role === 'owner') return null;
  const set = new Set([me.username]);
  if (me.role === 'admin') {
    for (const a of db.accounts) {
      if (a.created_by === me.username) set.add(a.username);
    }
  }
  return set;
}

function scopeKeys(me) {
  const v = visibleUsernames(me);
  if (v === null) return db.keys;
  return db.keys.filter((k) => v.has(k.owner));
}

function scopeAccounts(me) {
  if (me.role === 'owner') return db.accounts;
  if (me.role === 'admin') {
    return db.accounts.filter((a) => a.role === 'reseller' && a.created_by === me.username);
  }
  return db.accounts.filter((a) => a.username === me.username);
}

function scopeActivity(me) {
  const v = visibleUsernames(me);
  if (v === null) return db.activity;
  return db.activity.filter(
    (e) => v.has(e.actor) || (e.key_owner && v.has(e.key_owner))
  );
}

/* ── Game permissions ─────────────────────────────────────── */

function canUseGame(me, gameId) {
  if (!me) return false;
  if (me.role === 'owner') return true;
  const games = Array.isArray(me.games) ? me.games : [];
  return games.includes('*') || games.includes(gameId);
}

function gamesFor(me) {
  if (!me) return [];
  if (me.role === 'owner' || (Array.isArray(me.games) && me.games.includes('*'))) {
    return db.games;
  }
  return db.games.filter((g) => (me.games || []).includes(g.id));
}

/* ── Misc ─────────────────────────────────────────────────── */

function keysCountFor(username) {
  return db.keys.filter((k) => k.owner === username).length;
}

function safeAccount(a) {
  if (!a) return null;
  const { password, ...rest } = a;
  return rest;
}

function logActivity(actor, type, detail, ip, extra = {}) {
  db.activity.unshift({
    id: randomCode(12),
    ts: nowIso(),
    actor,
    type,
    detail: String(detail).slice(0, 300),
    ip: ip || '-',
    key_owner: extra.key_owner || null,
  });
  if (db.activity.length > 1000) db.activity = db.activity.slice(0, 1000);
  save();
}

module.exports = {
  PERSIST,
  ensureLoaded,
  save,
  state,
  findAccount,
  findKey,
  findGame,
  accountExpired,
  keyExpired,
  visibleUsernames,
  scopeKeys,
  scopeAccounts,
  scopeActivity,
  canUseGame,
  gamesFor,
  keysCountFor,
  safeAccount,
  logActivity,
};
