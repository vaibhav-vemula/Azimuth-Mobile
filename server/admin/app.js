'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { cellCenter } = require('../public/hex.js');

const MAX_BODY = 64 * 1024;
const LIST_LIMIT = 50;
const MAX_CELLS_SHOWN = 300;

// Everything the page loads comes from this folder or the leaflet package: no third-party scripts.
const FILES = {
  '/': ['admin.html', 'text/html; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/logo.svg': [path.join('..', 'public', 'logo.svg'), 'image/svg+xml'],
  '/hex.js': [path.join('..', 'public', 'hex.js'), 'text/javascript; charset=utf-8'],
  '/vendor/leaflet.js': [path.join('..', 'node_modules', 'leaflet', 'dist', 'leaflet.js'), 'text/javascript; charset=utf-8'],
  '/vendor/leaflet.css': [path.join('..', 'node_modules', 'leaflet', 'dist', 'leaflet.css'), 'text/css; charset=utf-8'],
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

/** What the portal shows about one stored report. The report is untrusted input, so only plain values are copied out. */
function summarise(r, p) {
  const rep = r.body && r.body.report ? r.body.report : null;
  const buckets = rep && Array.isArray(rep.buckets) ? rep.buckets : [];
  const cellIds = [...new Set(buckets.map((b) => b && b.cellId).filter((id) => typeof id === 'string'))];
  const cells = cellIds.slice(0, MAX_CELLS_SHOWN).map((id) => ({ id, center: cellCenter(id) })).filter((c) => c.center);
  return {
    hash: r.hash,
    node: r.node,
    type: r.type,
    receivedAt: r.received_at,
    device: rep && rep.device ? String(rep.device.model).slice(0, 64) : null,
    app: rep && rep.device ? String(rep.device.app).slice(0, 32) : null,
    samples: rep && rep.checks ? rep.checks.samples : null,
    durationSec: rep && rep.checks ? rep.checks.durationSec : null,
    maxSpeedMps: rep && rep.checks ? rep.checks.maxSpeedMps : null,
    mockedFixes: rep && rep.checks ? rep.checks.mockedFixes : null,
    cellCount: cellIds.length,
    cells,
    chest: rep && rep.chest ? { id: String(rep.chest.id), cellId: String(rep.chest.cellId) } : null,
    pass: rep && rep.pass ? { noradId: String(rep.pass.noradId), startMs: rep.pass.startMs, endMs: rep.pass.endMs, maxElevationDeg: rep.pass.maxElevationDeg } : null,
    check: { ok: p.ok, reasons: p.reasons, rewardRows: p.rewardRows || [], alreadyCommitted: !!p.alreadyCommitted },
  };
}

const PAY_STATE = (r) => (r.onchain_tx ? 'paid' : r.onchain_error ? 'failed' : 'pending');

/**
 * The admin portal's HTTP handler. It runs on the operator's own computer with the secret key; the page in the
 * browser only talks to this handler, so the key never reaches the browser.
 */
function createAdminApp({ reviewer, sink, chain = null, password }) {
  if (!password || password.length < 8) throw new Error('ADMIN_PASSWORD must be set to at least 8 characters.');

  return async function handle(req, res) {
    const send = (status, body, type = 'application/json', extra = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      const auth = String(req.headers.authorization || '');
      const given = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':') : null;
      if (given === null || !safeEqual(given, password)) {
        return send(401, { error: 'sign in required' }, 'application/json', { 'www-authenticate': 'Basic realm="Azimuth admin", charset="UTF-8"' });
      }

      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;

      if (req.method === 'GET' && FILES[p]) {
        const [file, type] = FILES[p];
        const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'";
        return send(200, fs.readFileSync(path.join(__dirname, file)), type, { 'content-security-policy': csp });
      }

      if (req.method === 'GET' && p === '/api/overview') {
        const [waiting, approved] = await Promise.all([sink.listNewReports(1000), sink.listApproved()]);
        const byNode = new Map();
        for (const r of approved) byNode.set(r.node, (byNode.get(r.node) || 0) + Math.round(Number(r.amount_usdc) * 1e6));
        return send(200, {
          waiting: waiting.length,
          payable: [...byNode.entries()].map(([node, units]) => ({ node, totalUsdc: units / 1e6 })).sort((a, b) => b.totalUsdc - a.totalUsdc),
          payableTotal: [...byNode.values()].reduce((n, v) => n + v, 0) / 1e6,
        });
      }

      if (req.method === 'GET' && p === '/api/reports') {
        await reviewer.syncChests();
        const rows = await sink.listNewReports(LIST_LIMIT);
        const out = [];
        for (const r of rows) out.push(summarise(r, await reviewer.preview(r)));
        return send(200, { reports: out });
      }

      let m = /^\/api\/reports\/([0-9a-f]{64})\/body$/.exec(p);
      if (req.method === 'GET' && m) {
        const r = await sink.getReport(m[1]);
        return r ? send(200, { body: r.body }) : send(404, { error: 'not found' });
      }

      m = /^\/api\/reports\/([0-9a-f]{64})\/approve$/.exec(p);
      if (req.method === 'POST' && m) {
        await reviewer.syncChests();
        const result = await reviewer.approve(m[1]);
        return send(result.status === 'verified' ? 200 : 409, result);
      }

      m = /^\/api\/reports\/([0-9a-f]{64})\/reject$/.exec(p);
      if (req.method === 'POST' && m) {
        const body = await readJson(req);
        const reason = String(body.reason || '').trim().slice(0, 300);
        if (!reason) return send(400, { error: 'give a reason so the decision can be explained' });
        const r = await sink.getReport(m[1]);
        if (!r) return send(404, { error: 'not found' });
        if (r.status !== 'new') return send(409, { error: `this report was already ${r.status}` });
        return send(200, await reviewer.reject(m[1], [reason]));
      }

      if (req.method === 'GET' && p === '/api/payouts') {
        if (!chain) return send(200, { enabled: false, status: null, statusError: null, items: [] });
        let status = null;
        let statusError = null;
        try { status = await chain.status(); } catch (e) { statusError = String(e.message || e).slice(0, 200); }
        const rows = await sink.listPayouts(30);
        return send(200, {
          enabled: true, status, statusError,
          items: rows.map((r) => ({
            hash: r.hash, node: r.node, type: r.type, amount: r.onchain_amount, state: PAY_STATE(r),
            error: r.onchain_error || null, record: r.onchain_record || null, tx: r.onchain_tx || null, verifiedAt: r.verified_at,
          })),
        });
      }

      m = /^\/api\/payouts\/([0-9a-f]{64})\/retry$/.exec(p);
      if (req.method === 'POST' && m) {
        const result = await reviewer.retryOnChain(m[1]);
        return send(result.status === 'paid' ? 200 : 409, result);
      }

      if (req.method === 'POST' && p === '/api/pause') {
        const body = await readJson(req);
        if (typeof body.paused !== 'boolean') return send(400, { error: 'paused must be true or false' });
        if (!chain) return send(503, { error: 'on-chain payouts are not configured' });
        await chain.setPaused(body.paused);
        return send(200, { ok: true, paused: body.paused });
      }

      return send(404, { error: 'not found' });
    } catch (e) {
      return send(e.status || 500, { error: e.status ? e.message : `internal error: ${e.message}` });
    }
  };
}

module.exports = { createAdminApp, summarise };
