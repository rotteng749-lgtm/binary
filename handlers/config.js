/**
 * GET /api/config — public branding config (no auth needed).
 * Clients & the panel UI fetch this to get panel name / logo.
 */
const store = require('../lib/store');
const { setCors } = require('../lib/util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  await store.ensureLoaded();
  const s = store.state().settings || {};

  return res.status(200).json({
    panel_name: s.panel_name || 'KITSUNE',
    logo: s.logo || '🦊',
    version: '1.2.0',
    auth: '/api/auth',
    time: new Date().toISOString(),
  });
};