'use strict';

/* ═══════════════════════════════════════════════════════════
   Kitsune Panel — vanilla JS SPA (no build, no dependencies)
   ═══════════════════════════════════════════════════════════ */

const S = {
  token: localStorage.getItem('kitsune_token') || '',
  me: null,
  games: [],
  tab: 'dashboard',
  filters: { q: '', status: '', game: '' },
  keyPage: 1,
  keySel: new Set(),
  config: { panel_name: 'KITSUNE', logo: '🦊' },
};
let store_allAccounts = [];

/* Branding — panel name & logo come from GET /api/config (replaceable by owner) */
function applyBranding() {
  document.title = `${S.config.panel_name || 'KITSUNE'} Panel — Key Management`;
  const fav = document.querySelector('link[rel="icon"]');
  if (fav) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${S.config.logo || '🦊'}</text></svg>`;
    fav.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
}

/* ── Helpers ─────────────────────────────────────────────── */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString();
}

function fmtExpiry(iso) {
  if (!iso) return '—';
  const ms = Date.parse(iso) - Date.now();
  if (isNaN(ms)) return '—';
  if (ms < 0) return 'expired';
  return Math.floor(ms / 86400000) + 'd left';
}

function badge(text, cls) {
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function statusBadge(status, expired) {
  if (status === 'banned') return badge('banned', 'bad');
  if (expired || status === 'expired') return badge('expired', 'warn');
  if (status === 'active') return badge('active', 'ok');
  return badge(status || '-', 'muted');
}

function roleBadge(role) {
  const map = { owner: 'violet', admin: 'cyan', reseller: 'orange' };
  return badge(role, map[role] || 'muted');
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast('Copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Copied to clipboard'); }
    catch { toast('Copy failed', 'error'); }
    ta.remove();
  }
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.textContent = msg;
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), 3400);
}

function closeModal() { $('#modal-root').innerHTML = ''; }

function openModal(title, bodyHtml, onSubmit, submitLabel = 'Save') {
  $('#modal-root').innerHTML = `
    <div class="overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" onclick="closeModal()">✕</button></div>
        ${onSubmit
          ? `<form id="modal-form">${bodyHtml}
              <div class="modal-foot">
                <button type="button" class="btn ghost" onclick="closeModal()">Cancel</button>
                <button class="btn" type="submit">${esc(submitLabel)}</button>
              </div></form>`
          : bodyHtml + `<div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button></div>`}
      </div>
    </div>`;
  if (onSubmit) {
    $('#modal-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const multi = {};
      for (const el of e.target.querySelectorAll('input[name]:checked')) {
        if (el.type === 'checkbox') (multi[el.name] = multi[el.name] || []).push(el.value);
      }
      try {
        await onSubmit({ ...fd, ...multi });
        closeModal();
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}

function deviceId() {
  let d = localStorage.getItem('kitsune_device');
  if (!d) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    d = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('kitsune_device', d);
  }
  return d;
}

/* ── API ─────────────────────────────────────────────────── */

async function api(path, opts = {}) {
  const res = await fetch('/api/panel' + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (res.status === 401 && S.token) {
    doLogout(true);
    throw new Error(data.error || 'Session expired');
  }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

/* ── Auth flow ───────────────────────────────────────────── */

function doLogout(silent) {
  if (!silent && S.token) api('/logout', { method: 'POST' }).catch(() => {});
  S.token = '';
  S.me = null;
  localStorage.removeItem('kitsune_token');
  renderLogin();
}

function renderLogin() {
  $('#app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="brand">
          <div class="logo">${esc(S.config.logo || '🦊')}</div>
          <div><b>${esc(S.config.panel_name || 'KITSUNE')}</b><small>Key Management Panel</small></div>
        </div>
        <div class="login-sub">Sign in to your account</div>
        <form id="login-form">
          <label>Username</label>
          <input name="username" autocomplete="username" required>
          <label>Password</label>
          <input name="password" type="password" autocomplete="current-password" required>
          <div class="login-err" id="login-err"></div>
          <button class="btn wfull" type="submit">Sign In</button>
        </form>
        <div class="device-hint">device: <span class="mono">${esc(deviceId())}</span></div>
      </div>
    </div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const errBox = $('#login-err');
    errBox.style.display = 'none';
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const d = await fetch('/api/panel/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fd.username, password: fd.password, device: deviceId() }),
      }).then((r) => r.json());
      if (d.token) {
        S.token = d.token;
        localStorage.setItem('kitsune_token', d.token);
        await boot();
      } else {
        errBox.textContent = d.error || 'Login failed';
        errBox.style.display = 'block';
      }
    } catch {
      errBox.textContent = 'Network error';
      errBox.style.display = 'block';
    }
  };
}

/* ── App shell ───────────────────────────────────────────── */

function navItemsFor(role) {
  const items = [
    ['dashboard', '◈', 'Dashboard'],
    ['keys', '🔑', 'Keys'],
    ['accounts', '👥', role === 'owner' ? 'Accounts' : 'Resellers'],
    ['games', '🎮', 'Games'],
    ['activity', '⏱', 'Activity'],
  ];
  if (role === 'owner' || role === 'admin') items.push(['custom', '🔗', 'Custom API']);
  if (role === 'owner') items.push(['settings', '⚙️', 'Settings']);
  return items;
}

function updateCreditsChip() {
  const el = $('#credits-chip');
  if (!el || !S.me) return;
  el.innerHTML = S.me.role === 'owner'
    ? '<span class="chip">credits <b>∞</b></span>'
    : `<span class="chip">credits <b>${esc(S.me.credits ?? 0)}</b></span>`;
}

function renderApp() {
  const me = S.me;
  const nav = navItemsFor(me.role)
    .map(([id, icon, label]) =>
      `<button class="nav-item ${S.tab === id ? 'active' : ''}" data-tab="${id}">${icon}&nbsp; ${label}</button>`)
    .join('');
  const initials = me.username.slice(0, 2).toUpperCase();

  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><div class="logo">${esc(S.config.logo || '🦊')}</div><div><b>${esc(S.config.panel_name || 'KITSUNE')}</b><small>Key Management</small></div></div>
        ${nav}
        <div class="side-spacer"></div>
        <div class="user-card">
          <div class="user-row">
            <div class="avatar">${esc(initials)}</div>
            <div><div class="user-name">${esc(me.username)}</div><div class="user-sub">${roleBadge(me.role)}</div></div>
          </div>
          <div id="credits-chip">${
            me.role === 'owner'
              ? '<span class="chip">credits <b>∞</b></span>'
              : `<span class="chip">credits <b>${esc(me.credits ?? 0)}</b></span>`
          }</div>
          <button class="btn ghost small wfull" id="btn-passwd">Change password</button>
          <button class="btn ghost small wfull" id="btn-logout">Log out</button>
        </div>
      </aside>
      <main class="main"><div id="main"></div></main>
    </div>`;

  document.querySelectorAll('.nav-item').forEach((b) =>
    b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#btn-logout').addEventListener('click', () => doLogout(false));
  $('#btn-passwd').addEventListener('click', showChangePassword);
  renderMain();
}

function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === t));
  renderMain();
}

function setHead(title, sub) {
  return `<div class="page-head"><h1>${title}</h1><p>${sub}</p></div>`;
}

function cardStat(label, n, cls) {
  return `<div class="stat ${cls}"><div class="n">${n ?? 0}</div><div class="l">${label}</div></div>`;
}

async function renderMain() {
  const main = $('#main');
  store_allAccounts = [];
  try {
    if (S.tab === 'dashboard') await renderDashboard(main);
    else if (S.tab === 'keys') await renderKeys(main);
    else if (S.tab === 'accounts') await renderAccounts(main);
    else if (S.tab === 'games') await renderGames(main);
    else    if (S.tab === 'activity') await renderActivity(main);
    else if (S.tab === 'custom' && (S.me.role === 'owner' || S.me.role === 'admin')) await renderCustom(main);
    else if (S.tab === 'settings' && S.me.role === 'owner') await renderSettings(main);
  } catch (e) {
    if (e && /Session expired|Unauthorized/i.test(e.message || '')) return;
    main.innerHTML = `<div class="card">⚠️ ${esc((e && e.message) || 'Failed to load')}</div>`;
  }
}

/* ── Dashboard ───────────────────────────────────────────── */

async function renderDashboard(main) {
  const d = await api('/stats');
  const s = d.stats;
  const perGame = Object.entries(s.per_game || {});
  const maxPg = Math.max(1, ...perGame.map(([, n]) => n));

  main.innerHTML = setHead(
    `Welcome, ${esc(S.me.username)} 👋`,
    'Overview of ' + (S.me.role === 'owner' ? 'the whole server' : 'your scope')
  ) + `
    <div class="stats">
      ${cardStat('Total Keys', s.keys_total, 'violet')}
      ${cardStat('Active', s.keys_active, 'green')}
      ${cardStat('Banned', s.keys_banned, 'red')}
      ${cardStat('Expired', s.keys_expired, 'amber')}
      ${s.accounts_admins !== undefined ? cardStat('Admins', s.accounts_admins, 'cyan') : ''}
      ${s.accounts_resellers !== undefined ? cardStat('Resellers', s.accounts_resellers, 'cyan') : ''}
    </div>
    <div class="card">
      <h2>👤 Reseller top-up (owner)</h2>
      <div class="topup-row">
        <select id="topup-user"><option value="">select account…</option></select>
        <input id="topup-credits" type="number" min="-1000000" max="1000000" value="10" title="negative = subtract">
        <button class="btn" id="topup-btn">Top up</button>
      </div>
      <div class="muted" style="font-size:.72rem;margin-top:6px">Use a negative number to deduct credits.</div>
    </div>
    <div class="card">
      <h2>🎮 Keys per game</h2>
      ${perGame.length
        ? perGame.map(([g, n]) => `
          <div class="per-game-row">
            <span class="mono" style="width:70px">${esc(g)}</span>
            <div class="per-game-bar"><div class="per-game-fill" style="width:${(n / maxPg) * 100}%"></div></div>
            <b style="width:30px;text-align:right">${n}</b>
          </div>`).join('')
        : '<div class="muted">No keys yet.</div>'}
    </div>
    <div class="card">
      <h2>ℹ️ Account info</h2>
      <div class="form-grid">
        <div><label>Role</label><div>${roleBadge(S.me.role)}</div></div>
        <div><label>Credits</label><div>${S.me.role === 'owner' ? '∞ unlimited' : esc(S.me.credits ?? 0)}</div></div>
        <div><label>Account expires</label><div>${fmtDate(S.me.expires_at)}</div></div>
        <div><label>Bound device</label><div class="mono">${esc(S.me.device || '—')}</div></div>
        <div><label>Games permitted</label><div>${(S.me.games || []).map((g) => badge(g === '*' ? 'all' : g, 'violet')).join(' ')}</div></div>
      </div>
      <div style="margin-top:14px">
        <label>Client auth API (patch this URL into your client)</label>
        <div style="display:flex;gap:8px">
          <input readonly class="mono" value="${esc(location.origin + '/api/auth')}">
          <button class="btn small" id="btn-copy-api">Copy</button>
        </div>
      </div>
    </div>`;

  $('#btn-copy-api').addEventListener('click', () => copyText(location.origin + '/api/auth'));

  // Owner quick top-up
  if (S.me.role === 'owner') {
    try {
      const accs = (await api('/accounts')).accounts || [];
      store_allAccounts = accs;
      const sel = $('#topup-user');
      if (sel) {
        for (const a of accs) {
          if (a.role === 'owner') continue;
          const opt = document.createElement('option');
          opt.value = a.username;
          opt.textContent = `${a.username} (${a.role}, ${a.credits ?? 0} cr)`;
          sel.appendChild(opt);
        }
      }
    } catch { /* non-fatal */ }
    const btn = $('#topup-btn');
    if (btn) {
      btn.addEventListener('click', async () => {
        const u = $('#topup-user').value;
        const n = parseInt($('#topup-credits').value, 10) || 0;
        if (!u) return toast('Pick an account first', 'error');
        if (!n) return toast('Enter a non-zero amount', 'error');
        try {
          const target = store_allAccounts.find((x) => x.username === u);
          const cur = target ? (target.credits || 0) : 0;
          await api('/accounts/' + encodeURIComponent(u), { method: 'PATCH', body: { credits: Math.max(0, cur + n) } });
          toast(`Credits updated for ${u}`);
          renderMain();
        } catch (err) { toast(err.message, 'error'); }
      });
    }
  }
}

/* ── Keys ────────────────────────────────────────────────── */

function gameOptions(selected, includeDisabled) {
  const games = S.games.filter((g) => (includeDisabled || S.me.role === 'owner' ? true : g.status === 'active'));
  return games.map((g) =>
    `<option value="${esc(g.id)}" ${g.id === selected ? 'selected' : ''}>${esc(g.name)} (${esc(g.id)})${g.status !== 'active' ? ' — disabled' : ''}</option>`
  ).join('');
}

function gamesCheckboxesHtml(name, checkedList = []) {
  return `<div class="checkbox-row">
    <label><input type="checkbox" name="${name}" value="*" ${checkedList.includes('*') ? 'checked' : ''}> All (*)</label>
    ${S.games.map((g) =>
      `<label><input type="checkbox" name="${name}" value="${esc(g.id)}" ${checkedList.includes(g.id) ? 'checked' : ''}> ${esc(g.id)}</label>`
    ).join('')}
  </div>`;
}

function keyStatus(k) {
  if (k.status === 'banned') return 'banned';
  if (k.expires_at && Date.now() > Date.parse(k.expires_at)) return 'expired';
  if (k.status === 'active' && !k.expires_at) return 'unused';
  return 'active';
}

function keyVisible(k) {
  const f = S.filters;
  if (f.status && keyStatus(k) !== f.status) return false;
  if (f.game && k.game !== f.game) return false;
  if (f.q) {
    const hay = `${k.key} ${k.owner} ${k.device || ''} ${k.note || ''}`.toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

async function renderKeys(main) {
  const d = await api('/keys');
  const keys = d.keys || [];

  main.innerHTML = setHead('🔑 Keys', 'Generate, edit, ban/activate, extend, reset device') + `
    <div class="card">
      <h2>⚡ Generate keys</h2>
      <form id="gen-form">
        <div class="form-grid">
          <div><label>Mode</label>
            <select name="mode" id="gen-mode">
              <option value="random">Random</option>
              <option value="custom">Custom</option>
            </select></div>
          <div><label>Game</label><select name="game" id="gen-game">${gameOptions()}</select></div>
          <div><label>Duration (days)</label><input name="duration_days" type="number" min="1" max="3650" value="30" required></div>
          <div id="gen-count-wrap"><label>Count (max 100)</label><input name="count" type="number" min="1" max="100" value="1"></div>
          <div id="gen-prefix-wrap"><label>Prefix</label><input name="prefix" value="DRIP" maxlength="10"></div>
          <div><label>Note (optional)</label><input name="note" maxlength="120" placeholder="e.g. batch for shop A"></div>
        </div>
        <div id="gen-custom-wrap" style="display:none;margin-top:12px">
          <label>Custom keys (one per line, max 100)</label>
          <textarea name="keys" placeholder="VIP-MLBB-CUSTOM1&#10;VIP-MLBB-CUSTOM2"></textarea>
        </div>
        <div style="margin-top:12px">
          <label>Cheat (tutorial / link — ikut terkirim ke client saat login key)</label>
          <textarea name="cheat" id="gen-cheat" placeholder="e.g. Cara pakai: buka game → masukkan key → pilih menu cheat…"></textarea>
        </div>
        <div style="margin-top:14px">
          <button class="btn">Generate</button>
          <span class="muted" style="font-size:.78rem">cost: 1 credit / key${S.me.role === 'owner' ? ' (owner: free)' : ''}</span>
        </div>
      </form>
    </div>
    <div class="card">
      <h2>🗂 Keys <span class="muted" style="font-size:.78rem">(${keys.length})</span></h2>
      <div class="filters">
        <input id="f-q" placeholder="Search key / owner / device / note…" value="${esc(S.filters.q)}">
        <select id="f-status">
          <option value="">All status</option>
          ${['active', 'unused', 'banned', 'expired'].map((s) =>
            `<option value="${s}" ${S.filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select id="f-game">
          <option value="">All games</option>
          ${S.games.map((g) => `<option value="${esc(g.id)}" ${S.filters.game === g.id ? 'selected' : ''}>${esc(g.id)}</option>`).join('')}
        </select>
      </div>
      <div class="bulk-bar" id="bulk-bar">
        <span id="bulk-count" class="muted">0 selected</span>
        <button class="btn ghost" data-bulk="ban">Ban</button>
        <button class="btn ghost" data-bulk="activate">Activate</button>
        <button class="btn ghost" data-bulk="extend">+Days</button>
        <button class="btn ghost" data-bulk="reset_device">Reset dev</button>
        <button class="btn danger" data-bulk="delete">Delete</button>
        <span style="flex:1"></span>
        <button class="btn ghost" id="btn-export-csv">⬇ CSV</button>
      </div>
      <div class="tbl-wrap"><table>
        <thead><tr><th><input type="checkbox" id="sel-all" title="Select page"></th><th>Key</th><th>Game</th><th>Cheat</th><th>Owner</th><th>Status</th><th>Device</th><th>Expires</th><th>Last used</th><th>Actions</th></tr></thead>
        <tbody id="keys-body"></tbody>
      </table></div>
      <div class="pagination" id="key-pager"></div>
    </div>`;

  const modeSel = $('#gen-mode');
  const syncMode = () => {
    const custom = modeSel.value === 'custom';
    $('#gen-custom-wrap').style.display = custom ? 'block' : 'none';
    $('#gen-count-wrap').style.display = custom ? 'none' : '';
    $('#gen-prefix-wrap').style.display = custom ? 'none' : '';
  };
  modeSel.addEventListener('change', syncMode);
  syncMode();

  // Autofill cheat dari game yang dipilih (bisa diedit manual per batch)
  const gameSel = $('#gen-game');
  if (gameSel) gameSel.addEventListener('change', () => {
    const g = S.games.find((x) => x.id === gameSel.value);
    $('#gen-cheat').value = (g && g.cheat) ? g.cheat : '';
  });

  $('#gen-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const body = { mode: fd.mode, game: fd.game, duration_days: fd.duration_days, note: fd.note || '', cheat: fd.cheat || '' };
    if (fd.mode === 'custom') body.keys = fd.keys;
    else { body.count = fd.count; body.prefix = fd.prefix; }
    try {
      const d2 = await api('/keys', { method: 'POST', body });
      toast(`Created ${d2.created.length} key(s)`);
      if (typeof d2.credits_left === 'number' && S.me) {
        S.me.credits = d2.credits_left;
        updateCreditsChip();
      }
      showGeneratedKeys(d2.created);
      renderMain();
    } catch (err) { toast(err.message, 'error'); }
  };

  const apply = () => {
    S.filters.q = $('#f-q').value.toLowerCase();
    S.filters.status = $('#f-status').value;
    S.filters.game = $('#f-game').value;
    S.keyPage = 1;
    drawKeyRows(keys);
  };
  $('#f-q').addEventListener('input', apply);
  $('#f-status').addEventListener('change', apply);
  $('#f-game').addEventListener('change', apply);

  $('#btn-export-csv').addEventListener('click', () => exportKeysCsv(keys.filter(keyVisible)));

  $('#bulk-bar').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-bulk]');
    if (!b) return;
    const act = b.dataset.bulk;
    const sel = [...S.keySel];
    if (!sel.length) return toast('Select keys first (checkboxes)', 'error');
    let days = null;
    if (act === 'extend') {
      const v = prompt('Days to add to each selected key:', '30');
      if (v === null) return;
      days = parseInt(v, 10);
      if (!Number.isFinite(days) || days < 1) return toast('Invalid days', 'error');
    }
    if (act === 'delete' && !confirm(`Delete ${sel.length} key(s)?`)) return;
    try {
      const r = await api('/keys/bulk', { method: 'POST', body: { action: act, keys: sel, days } });
      S.keySel.clear();
      toast(`Bulk ${act}: ${r.updated} key(s) updated`);
      renderMain();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#keys-body').addEventListener('click', (e) => {
    const copyEl = e.target.closest('[data-copy]');
    if (copyEl) { copyText(copyEl.dataset.copy); return; }
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const k = keys.find((x) => x.key === b.dataset.key);
    if (k) handleKeyAction(k, b.dataset.act);
  });
  $('#keys-body').addEventListener('change', (e) => {
    const cb = e.target.closest('input.sel-key');
    if (!cb) return;
    if (cb.checked) S.keySel.add(cb.dataset.key);
    else S.keySel.delete(cb.dataset.key);
    updateBulkCount();
  });
  const selAll = $('#sel-all');
  if (selAll) selAll.addEventListener('change', () => {
    const filtered = keys.filter(keyVisible);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, S.keyPage), totalPages);
    for (const k of filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
      if (selAll.checked) S.keySel.add(k.key); else S.keySel.delete(k.key);
    }
    drawKeyRows(keys);
  });

  apply();
}

function updateBulkCount() {
  const el = $('#bulk-count');
  if (el) el.textContent = `${S.keySel.size} selected`;
}

function exportKeysCsv(list) {
  if (!list.length) return toast('Nothing to export', 'error');
  const cols = ['key', 'game', 'owner', 'status', 'device', 'expires_at', 'note', 'created_at', 'last_used', 'usage_count'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(',')].concat(list.map((k) => cols.map((c) => q(k[c])).join(','))).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'keys-export.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported ${list.length} key(s)`);
}

const PAGE_SIZE = 25;

function drawKeyRows(keys) {
  const filtered = keys.filter(keyVisible);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, S.keyPage), totalPages);
  S.keyPage = page;
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((k) => {
    const expired = k.expires_at && Date.now() > Date.parse(k.expires_at);
    return `
    <tr>
      <td><input type="checkbox" class="sel-key" data-key="${esc(k.key)}" ${S.keySel.has(k.key) ? 'checked' : ''}></td>
      <td class="mono key-text" data-copy="${esc(k.key)}" title="${esc(k.note || '')}">${esc(k.key)}</td>
      <td>${badge(k.game, 'violet')}</td>
      <td class="muted" style="font-size:.72rem;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(k.cheat || '')}">${k.cheat ? esc(k.cheat) : '—'}</td>
      <td>${esc(k.owner)}</td>
      <td>${statusBadge(k.status, expired)}</td>
      <td class="mono">${k.device ? esc(k.device.slice(0, 10)) + '…' : '<span class="muted">—</span>'}</td>
      <td>${k.expires_at
        ? fmtDate(k.expires_at) + `<div class="muted" style="font-size:.7rem">${fmtExpiry(k.expires_at)}</div>`
        : '<span class="muted">not activated</span>'}</td>
      <td class="muted" style="font-size:.75rem">${k.last_used ? fmtDate(k.last_used) : '—'}</td>
      <td><div class="row-btns">
        <button class="btn ghost" data-act="edit" data-key="${esc(k.key)}">Edit</button>
        <button class="btn ghost" data-act="${k.status === 'banned' ? 'activate' : 'ban'}" data-key="${esc(k.key)}">${k.status === 'banned' ? 'Activate' : 'Ban'}</button>
        <button class="btn ghost" data-act="extend" data-key="${esc(k.key)}">+Days</button>
        ${k.device ? `<button class="btn ghost" data-act="reset_device" data-key="${esc(k.key)}">Reset dev</button>` : ''}
        <button class="btn danger" data-act="delete" data-key="${esc(k.key)}">Del</button>
      </div></td>
    </tr>`;
  }).join('');
  $('#keys-body').innerHTML = rows || '<tr><td colspan="10" class="empty">No keys match.</td></tr>';

  const pager = $('#key-pager');
  if (pager) {
    pager.innerHTML = `
      <button class="btn ghost small" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
      <span class="muted" style="font-size:.75rem" id="page-info">page ${page}/${totalPages} — ${filtered.length} key(s)</span>
      <button class="btn ghost small" id="pg-next" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>`;
    $('#pg-prev').onclick = () => { S.keyPage--; drawKeyRows(keys); };
    $('#pg-next').onclick = () => { S.keyPage++; drawKeyRows(keys); };
  }
}

async function handleKeyAction(k, act) {
  try {
    if (act === 'edit') return showKeyEdit(k);
    if (act === 'extend') return showKeyExtend(k);
    if (act === 'delete') {
      if (!confirm(`Delete key ${k.key}?`)) return;
      await api('/keys/' + encodeURIComponent(k.key), { method: 'DELETE' });
      toast('Key deleted');
      renderMain();
      return;
    }
    const d = await api('/keys/' + encodeURIComponent(k.key), { method: 'PATCH', body: { action: act } });
    toast(d.key && d.key.status ? `Key ${d.key.status === 'active' ? 'activated' : d.key.status}` : 'Updated');
    renderMain();
  } catch (err) { toast(err.message, 'error'); }
}

function showKeyEdit(k) {
  openModal(`Edit ${k.key}`, `
    <div class="form-grid">
      <div style="grid-column:1/-1"><label>Note</label><input name="note" value="${esc(k.note || '')}" maxlength="120"></div>
      ${k.expires_at ? '' : `<div><label>Duration (days)</label><input name="duration_days" type="number" min="1" max="3650" value="${k.duration_days}"></div>`}
      <div><label>Game</label><select name="game">${gameOptions(k.game, true)}</select></div>
      <div style="grid-column:1/-1"><label>Cheat (dikirim ke client saat login)</label>
        <textarea name="cheat" placeholder="Tutorial / link cheat…">${esc(k.cheat || '')}</textarea></div>
    </div>`, async (fd) => {
    const body = { action: 'edit', note: fd.note, cheat: fd.cheat || '' };
    if (fd.duration_days) body.duration_days = fd.duration_days;
    if (fd.game) body.game = fd.game;
    await api('/keys/' + encodeURIComponent(k.key), { method: 'PATCH', body });
    toast('Key updated');
    renderMain();
  });
}

function showKeyExtend(k) {
  openModal(`Extend ${k.key}`, `
    <div><label>Days to add</label><input name="days" type="number" min="1" max="3650" value="30" required></div>
    <div class="muted" style="font-size:.75rem;margin-top:8px">${
      k.expires_at
        ? 'Current expiry: ' + fmtDate(k.expires_at)
        : 'Not activated yet — days are added to the duration applied at first login.'
    }</div>`, async (fd) => {
    await api('/keys/' + encodeURIComponent(k.key), { method: 'PATCH', body: { action: 'extend', days: fd.days } });
    toast(`Extended +${fd.days}d`);
    renderMain();
  }, 'Extend');
}

function showGeneratedKeys(created) {
  openModal(`✅ ${created.length} key(s) created`, `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span class="muted" style="font-size:.8rem">game: ${esc(created[0].game)} · ${created[0].duration_days}d · activates on first client login</span>
      <button class="btn ghost small" id="modal-copyall">Copy all</button>
    </div>
    ${created.map((k) => `<div class="key-output">${esc(k.key)}</div>`).join('')}`, null);
  const b = $('#modal-copyall');
  if (b) b.addEventListener('click', () => copyText(created.map((k) => k.key).join('\n')));
}

/* ── Accounts (owner / admin) ────────────────────────────── */

async function renderAccounts(main) {
  const d = await api('/accounts');
  const accounts = d.accounts || [];
  const isOwner = S.me.role === 'owner';
  const canCreate = isOwner || S.me.role === 'admin';

  main.innerHTML = setHead(
    isOwner ? '👥 Accounts' : '👥 Resellers',
    isOwner
      ? 'Admins & resellers — credits, expiry, game permissions'
      : 'Your resellers — credits, expiry, game permissions'
  ) + `
    ${canCreate ? `
    <div class="card"><h2>➕ Create account</h2>
      <form id="acc-create">
        <div class="form-grid">
          <div><label>Username</label><input name="username" required pattern="[a-z0-9_]{3,20}" placeholder="reseller2"></div>
          <div><label>Password</label><input name="password" required minlength="4"></div>
          <div><label>Role</label>
            <select name="role" ${isOwner ? '' : 'disabled'}>
              <option value="reseller">Reseller</option>
              ${isOwner ? '<option value="admin">Admin</option>' : ''}
            </select></div>
          <div><label>Credits (keys)</label><input name="credits" type="number" min="0" value="10"></div>
          <div><label>Expires in days (blank = never)</label><input name="expires_days" type="number" min="1" placeholder="30"></div>
        </div>
        <div style="margin-top:12px"><label>Game permission</label>${gamesCheckboxesHtml('games', ['*'])}</div>
        <div style="margin-top:14px"><button class="btn">Create</button></div>
      </form></div>` : ''}
    <div class="card"><h2>🗂 List <span class="muted" style="font-size:.78rem">(${accounts.length})</span></h2>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Username</th><th>Role</th><th>Credits</th><th>Expires</th><th>Device</th><th>Games</th><th>Status</th><th>By</th><th>Actions</th></tr></thead>
        <tbody id="acc-body"></tbody>
      </table></div></div>`;

  if (canCreate) {
    $('#acc-create').onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const fd = Object.fromEntries(new FormData(form));
      const games = [...form.querySelectorAll('input[name="games"]:checked')].map((c) => c.value);
      const body = {
        username: fd.username,
        password: fd.password,
        role: fd.role || 'reseller',
        credits: fd.credits || 0,
        games: games.length ? games : ['*'],
      };
      if (fd.expires_days) body.expires_days = fd.expires_days;
      try {
        await api('/accounts', { method: 'POST', body });
        toast('Account created');
        renderMain();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  $('#acc-body').innerHTML = accounts.map((a) => {
    const self = a.username === S.me.username;
    const isOwnerAcc = a.role === 'owner';
    return `<tr>
      <td><b>${esc(a.username)}</b>${self ? ' <span class="muted">(you)</span>' : ''}</td>
      <td>${roleBadge(a.role)}</td>
      <td>${a.role === 'owner' ? '∞' : esc(a.credits ?? 0)}</td>
      <td>${a.expires_at
        ? fmtDate(a.expires_at) + `<div class="muted" style="font-size:.7rem">${fmtExpiry(a.expires_at)}</div>`
        : '<span class="muted">never</span>'}</td>
      <td class="mono">${a.device ? esc(a.device.slice(0, 10)) + '…' : '<span class="muted">—</span>'}</td>
      <td>${(a.games || []).map((g) => badge(g === '*' ? 'all' : g, 'violet')).join(' ')}</td>
      <td>${statusBadge(a.status, a.expires_at && Date.now() > Date.parse(a.expires_at))}</td>
      <td class="muted" style="font-size:.75rem">${esc(a.created_by || '—')}</td>
      <td><div class="row-btns">
        ${isOwnerAcc ? '<span class="muted">—</span>' : `
          <button class="btn ghost" data-act="edit" data-u="${esc(a.username)}">Edit</button>
          ${a.device ? `<button class="btn ghost" data-act="devreset" data-u="${esc(a.username)}">Reset dev</button>` : ''}
          <button class="btn ghost" data-act="${a.status === 'banned' ? 'unban' : 'ban'}" data-u="${esc(a.username)}">${a.status === 'banned' ? 'Activate' : 'Ban'}</button>
          ${self ? '' : `<button class="btn danger" data-act="delete" data-u="${esc(a.username)}">Del</button>`}`}
      </div></td></tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">No accounts.</td></tr>';

  $('#acc-body').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = accounts.find((x) => x.username === b.dataset.u);
    if (a) handleAccountAction(a, b.dataset.act);
  });
}

async function handleAccountAction(a, act) {
  try {
    if (act === 'edit') return showAccountEdit(a);
    if (act === 'devreset') {
      await api('/accounts/' + encodeURIComponent(a.username), { method: 'PATCH', body: { device_reset: true } });
      toast('Device reset — user can login from a new device');
      renderMain();
      return;
    }
    if (act === 'ban' || act === 'unban') {
      await api('/accounts/' + encodeURIComponent(a.username), {
        method: 'PATCH',
        body: { status: act === 'ban' ? 'banned' : 'active' },
      });
      toast(act === 'ban' ? 'Account banned' : 'Account activated');
      renderMain();
      return;
    }
    if (act === 'delete') {
      if (!confirm(`Delete account ${a.username}?`)) return;
      await api('/accounts/' + encodeURIComponent(a.username), { method: 'DELETE' });
      toast('Account deleted');
      renderMain();
    }
  } catch (err) { toast(err.message, 'error'); }
}

function showAccountEdit(a) {
  const isOwnerTarget = a.role === 'owner';
  openModal(`Edit ${a.username}`, `
    <div class="form-grid">
      <div><label>New password (blank = keep)</label><input name="password" minlength="4" placeholder="••••"></div>
      ${isOwnerTarget ? '' : `<div><label>Credits</label><input name="credits" type="number" min="0" value="${a.credits ?? 0}"></div>`}
      <div><label>Status</label>
        <select name="status">
          <option value="active" ${a.status === 'active' ? 'selected' : ''}>active</option>
          <option value="banned" ${a.status === 'banned' ? 'selected' : ''}>banned</option>
        </select></div>
    </div>
    <div style="margin-top:12px"><label>Expiry</label>
      <div class="checkbox-row">
        <label><input type="checkbox" name="never" value="1"> Never expires</label>
        <label>+ days: <input name="expires_days" type="number" min="1" style="width:90px" placeholder="30"></label>
      </div>
      <div class="muted" style="font-size:.72rem;margin-top:4px">current: ${a.expires_at ? fmtDate(a.expires_at) : 'never'}</div>
    </div>
    <div style="margin-top:12px"><label>Game permission</label>${gamesCheckboxesHtml('games', a.games || [])}</div>
    <label style="margin-top:12px"><input type="checkbox" name="devreset" value="1" style="width:auto"> Reset device binding</label>`,
    async (d) => {
      const body = {};
      if (d.password) body.password = d.password;
      if (!isOwnerTarget) body.credits = d.credits || 0;
      if (d.status) body.status = d.status;
      if (d.never) body.clear_expiry = true;
      else if (d.expires_days) body.expires_days = d.expires_days;
      if (d.games && d.games.length) body.games = d.games;
      if (d.devreset) body.device_reset = true;
      await api('/accounts/' + encodeURIComponent(a.username), { method: 'PATCH', body });
      toast('Account updated');
      renderMain();
    });
}

/* ── Games ───────────────────────────────────────────────── */

async function renderGames(main) {
  const d = await api('/games');
  const games = d.games || [];
  const isOwner = S.me.role === 'owner';
  const canEditCheat = isOwner || S.me.role === 'admin';

  main.innerHTML = setHead(
    '🎮 Games',
    isOwner
      ? 'Server access control — only active games accept client logins'
      : 'Server game list (read-only)'
  ) + `
    ${isOwner ? `
    <div class="card"><h2>➕ Add game</h2>
      <form id="game-add" class="form-grid">
        <div><label>ID (a-z0-9_)</label><input name="id" required pattern="[a-z0-9_]{2,16}" placeholder="efootball"></div>
        <div><label>Name</label><input name="name" placeholder="eFootball"></div>
      </form>
      <div style="margin-top:12px"><button class="btn" id="game-add-btn">Add game</button></div>
    </div>` : ''}
    <div class="card"><h2>🗂 Game list</h2>
      <div class="tbl-wrap" id="games-tbl"><table>
        <thead><tr><th>ID</th><th>Name</th><th>Cheat</th><th>Status</th><th>Keys</th>${(isOwner || canEditCheat) ? '<th>Actions</th>' : ''}</tr></thead>
        <tbody>${games.map((g) => `<tr>
          <td class="mono">${esc(g.id)}</td>
          <td>${esc(g.name)}</td>
          <td class="muted" style="font-size:.75rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(g.cheat || '')}">${g.cheat ? esc(g.cheat) : '—'}</td>
          <td>${g.status === 'active' ? badge('active', 'ok') : badge('disabled', 'muted')}</td>
          <td>${g.keys_count ?? 0}</td>
          ${(isOwner || canEditCheat) ? `<td><div class="row-btns">
            ${canEditCheat ? `<button class="btn ghost" data-id="${esc(g.id)}" data-act="cheat">Cheat</button>` : ''}
            ${isOwner ? `<button class="btn ghost" data-id="${esc(g.id)}" data-act="toggle">${g.status === 'active' ? 'Disable' : 'Enable'}</button>
            <button class="btn danger" data-id="${esc(g.id)}" data-act="delete">Del</button>` : ''}
          </div></td>` : ''}
        </tr>`).join('') || '<tr><td colspan="6" class="empty">No games.</td></tr>'}</tbody>
      </table></div></div>`;

  if (isOwner) {
    $('#game-add-btn').addEventListener('click', async () => {
      const fd = Object.fromEntries(new FormData($('#game-add')));
      try {
        await api('/games', { method: 'POST', body: fd });
        toast('Game added');
        renderMain();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  if (isOwner || canEditCheat) {
    $('#games-tbl').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      const g = games.find((x) => x.id === id);
      try {
        if (b.dataset.act === 'cheat') {
          openModal(`Cheat — ${g.name}`, `
            <label>Cheat (tutorial / link / instruksi pemakaian)</label>
            <textarea name="cheat" placeholder="e.g. Cara pakai: …">${esc(g.cheat || '')}</textarea>
            <div class="muted" style="font-size:.72rem;margin-top:6px">Kosongkan untuk menghapus. Key baru yang dibuat untuk game ini otomatis membawa cheat ini (bisa diedit saat generate).</div>`,
            async (fd) => {
              await api('/games/' + encodeURIComponent(id), { method: 'PATCH', body: { cheat: fd.cheat || '' } });
              toast('Cheat saved');
              renderMain();
            }, 'Save');
          return;
        }
        if (b.dataset.act === 'toggle') {
          await api('/games/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: { status: g.status === 'active' ? 'disabled' : 'active' },
          });
          toast('Game updated');
        } else if (b.dataset.act === 'delete') {
          if (!confirm(`Delete game ${id}?`)) return;
          await api('/games/' + encodeURIComponent(id), { method: 'DELETE' });
          toast('Game deleted');
        }
        renderMain();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
}

/* ── Activity ────────────────────────────────────────────── */

function typeCls(t) {
  if (/failed|ban|delete/.test(t)) return 'bad';
  if (/client_login/.test(t)) return 'cyan';
  if (/login|generate|create/.test(t)) return 'violet';
  return 'muted';
}

async function renderActivity(main) {
  const d = await api('/activity?limit=200');
  const list = d.activity || [];
  main.innerHTML = setHead('⏱ Activity', 'Logins, key actions & client logins — scoped to your role') + `
    <div class="card"><div class="tbl-wrap"><table>
      <thead><tr><th>Time</th><th>Actor</th><th>Type</th><th>Detail</th><th>IP</th></tr></thead>
      <tbody>${list.map((a) => `<tr>
        <td class="muted" style="white-space:nowrap;font-size:.75rem">${fmtDate(a.ts)}</td>
        <td>${esc(a.actor)}</td>
        <td>${badge(a.type, typeCls(a.type))}</td>
        <td style="font-size:.8rem">${esc(a.detail)}</td>
        <td class="mono muted" style="font-size:.72rem">${esc(a.ip || '-')}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">No activity.</td></tr>'}</tbody>
    </table></div></div>`;
}

/* ── Custom API (owner/admin — public custom endpoints) ─── */

const CUSTOM_TYPES = {
  'application/json': 'JSON',
  'text/javascript': 'JavaScript',
  'application/x-php': 'PHP',
  'text/typescript': 'TypeScript',
  'text/html': 'HTML',
  'text/css': 'CSS',
  'text/plain': 'Plain text',
};

function customTypeOptions(sel) {
  return Object.entries(CUSTOM_TYPES).map(([v, l]) =>
    `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');
}

async function renderCustom(main) {
  const d = await api('/custom');
  const list = d.custom || [];

  main.innerHTML = setHead('🔗 Custom API', 'Endpoint publik custom — response JSON / JS / PHP / TS / HTML / teks') + `
    <div class="card"><h2>➕ Add endpoint</h2>
      <form id="custom-add">
        <div class="form-grid">
          <div><label>Path (tanpa slash awal, boleh bertingkat)</label><input name="path" required pattern="[a-z0-9_./\\-]{2,60}" placeholder="v1/check" style="font-family:ui-monospace,monospace"></div>
          <div><label>Method</label><select name="method">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="ANY">ANY</option>
          </select></div>
          <div><label>Content type</label><select name="content_type">${customTypeOptions('text/plain')}</select></div>
        </div>
        <div style="margin-top:12px"><label>Response body (placeholder: {{panel_name}} {{logo}} {{time}} {{version}} {{auth}} {{path}} {{method}})</label>
          <textarea name="body" id="custom-body" placeholder="{&#10;  \"status\": \"ok\",&#10;  \"panel\": \"{{panel_name}}\",&#10;  \"time\": \"{{time}}\"&#10;}"></textarea></div>
        <label style="margin-top:10px"><input type="checkbox" name="active" value="1" checked style="width:auto"> Active (bisa langsung diakses publik)</label>
        <div style="margin-top:14px"><button class="btn">Create endpoint</button></div>
      </form></div>
    <div class="card"><h2>🗂 Endpoints <span class="muted" style="font-size:.78rem">(${list.length})</span></h2>
      <div class="tbl-wrap" id="custom-tbl"><table>
        <thead><tr><th>Path</th><th>Method</th><th>Type</th><th>Active</th><th>By</th><th>Actions</th></tr></thead>
        <tbody>${list.map((c) => `<tr>
          <td class="mono"><a href="/${esc(c.path)}" target="_blank" style="color:var(--gold)">/${esc(c.path)}</a></td>
          <td>${badge(c.method, 'violet')}</td>
          <td>${badge(CUSTOM_TYPES[c.content_type] || c.content_type, 'cyan')}</td>
          <td>${c.active ? badge('active', 'ok') : badge('off', 'muted')}</td>
          <td class="muted" style="font-size:.75rem">${esc(c.created_by)}</td>
          <td><div class="row-btns">
            <button class="btn ghost" data-id="${esc(c.id)}" data-act="toggle">${c.active ? 'Disable' : 'Enable'}</button>
            <button class="btn ghost" data-id="${esc(c.id)}" data-act="edit">Edit</button>
            <button class="btn danger" data-id="${esc(c.id)}" data-act="delete">Del</button>
          </div></td>
        </tr>`).join('') || '<tr><td colspan="6" class="empty">Belum ada custom endpoint.</td></tr>'}</tbody>
      </table></div></div>`;

  $('#custom-add').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const body = {
      path: fd.path,
      method: fd.method,
      content_type: fd.content_type,
      body: fd.body || '',
      active: fd.active ? true : false,
    };
    try {
      await api('/custom', { method: 'POST', body });
      toast('Endpoint created');
      renderMain();
    } catch (err) { toast(err.message, 'error'); }
  };

  $('#custom-tbl').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const c = list.find((x) => x.id === id);
    try {
      if (b.dataset.act === 'toggle') {
        await api('/custom/' + encodeURIComponent(id), { method: 'PATCH', body: { active: !c.active } });
        toast(c.active ? 'Endpoint disabled' : 'Endpoint enabled');
        renderMain();
      } else if (b.dataset.act === 'delete') {
        if (!confirm(`Delete endpoint /${c.path}?`)) return;
        await api('/custom/' + encodeURIComponent(id), { method: 'DELETE' });
        toast('Endpoint deleted');
        renderMain();
      } else if (b.dataset.act === 'edit') {
        openModal(`Edit /${c.path}`, `
          <div class="form-grid">
            <div><label>Path</label><input name="path" required pattern="[a-z0-9_./\\-]{2,60}" value="${esc(c.path)}" style="font-family:ui-monospace,monospace"></div>
            <div><label>Method</label><select name="method">${['GET', 'POST', 'ANY'].map((m) => `<option value="${m}" ${m === c.method ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
            <div><label>Content type</label><select name="content_type">${customTypeOptions(c.content_type)}</select></div>
          </div>
          <div style="margin-top:12px"><label>Response body</label>
            <textarea name="body" style="min-height:130px">${esc(c.body || '')}</textarea></div>
          <label style="margin-top:10px"><input type="checkbox" name="active" value="1" ${c.active ? 'checked' : ''} style="width:auto"> Active</label>`,
          async (fd) => {
            const body = { path: fd.path, method: fd.method, content_type: fd.content_type, body: fd.body || '', active: fd.active ? true : false };
            await api('/custom/' + encodeURIComponent(id), { method: 'PATCH', body });
            toast('Endpoint updated');
            renderMain();
          });
      }
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ── Settings (owner — branding) ────────────────────────── */

async function renderSettings(main) {
  const d = await api('/settings');
  const s = d.settings || {};
  main.innerHTML = setHead('⚙️ Settings', 'Branding panel — ganti nama & logo') + `
    <div class="card"><h2>🎨 Branding</h2>
      <form id="settings-form">
        <div class="form-grid">
          <div><label>Panel name</label><input name="panel_name" maxlength="30" value="${esc(s.panel_name || '')}"></div>
          <div><label>Logo (emoji / text, max 8)</label><input name="logo" maxlength="8" value="${esc(s.logo || '')}"></div>
        </div>
        <div class="muted" style="font-size:.72rem;margin-top:8px">Logo dipakai di sidebar, halaman login, title tab & favicon browser.</div>
        <div style="margin-top:14px"><button class="btn">Save branding</button></div>
      </form></div>
    <div class="card"><h2>ℹ️ Endpoints</h2>
      <div class="form-grid">
        <div><label>Panel</label><input readonly class="mono" value="${esc(location.origin)}"></div>
        <div><label>Client auth API</label><input readonly class="mono" value="${esc(location.origin + '/api/auth')}"></div>
        <div><label>Public config</label><input readonly class="mono" value="${esc(location.origin + '/api/config')}"></div>
      </div></div>`;

  $('#settings-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const d2 = await api('/settings', { method: 'PATCH', body: { panel_name: fd.panel_name, logo: fd.logo } });
      S.config = d2.settings;
      applyBranding();
      toast('Branding saved');
      renderApp();
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ── Self-service password change ────────────────────────── */

function showChangePassword() {
  openModal('Change my password', `
    <div><label>Current password</label><input name="current" type="password" required></div>
    <div style="margin-top:10px"><label>New password (min 4)</label><input name="password" type="password" minlength="4" required></div>
    <div style="margin-top:10px"><label>Repeat new password</label><input name="password2" type="password" minlength="4" required></div>`,
    async (d) => {
      if (d.password !== d.password2) throw new Error('New passwords do not match');
      await api('/password', { method: 'POST', body: { current: d.current, password: d.password } });
      toast('Password changed');
    }, 'Change');
}

/* ── Boot ────────────────────────────────────────────────── */

async function boot() {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json()).catch(() => null);
    if (cfg && cfg.panel_name) { S.config = cfg; applyBranding(); }
  } catch { /* branding optional */ }
  if (!S.token) return renderLogin();
  try {
    const d = await api('/me');
    S.me = d.account;
    S.games = d.games || [];
    renderApp();
  } catch {
    S.token = '';
    localStorage.removeItem('kitsune_token');
    renderLogin();
  }
}

boot();
