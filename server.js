#!/usr/bin/env node
/**
 * Kitsune Panel — local server (zero dependencies).
 *
 * Runs the EXACT same handlers as the Vercel deployment, so what works
 * here works on Vercel (and vice versa).
 *
 *   node server.js            → http://localhost:3000
 *   PORT=8080 node server.js  → custom port
 *
 * Panel UI : http://localhost:3000/
 * Client API: http://localhost:3000/api/auth
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const api = require('./api/[[...path]].js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));

  // path traversal guard
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return false; // not found → let the API 404 handle it
  }

  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    // Vercel-style response helpers on the raw Node response
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      if (!res.headersSent) res.writeHead(res.statusCode || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
      return res;
    };

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Static files from public/ (index.html, app.js, ...)
    if (serveStatic(req, res, url.pathname)) return;

    // Everything else → the shared catch-all handler (API, custom endpoints,
    // auth, config…). Custom endpoints live at arbitrary paths like /v1/status
    // or /api.php, so only real static files are served above.
    req.query = {};
    for (const [k, v] of url.searchParams) req.query[k] = v;
    await api(req, res);
  } catch (err) {
    console.error('[server] error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Internal error' }));
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🦊 Kitsune Panel running locally (zero deps)');
  console.log('  ────────────────────────────────────────────');
  console.log(`  Panel UI  : http://localhost:${PORT}/`);
  console.log(`  Client API: http://localhost:${PORT}/api/auth`);
  console.log('');
  console.log('  Default login → owner / owner123');
  console.log('  Data is in-memory unless UPSTASH env vars are set.');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
