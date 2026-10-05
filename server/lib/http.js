'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path_ = require('node:path');

const PUBLIC_DIR = path_.join(__dirname, '..', 'public');
const FILES = {
  '/console': ['console.html', 'text/html; charset=utf-8'],
  '/console/hex.js': ['hex.js', 'text/javascript; charset=utf-8'],
  '/privacy': ['privacy.html', 'text/html; charset=utf-8'],
  '/logo.svg': ['logo.svg', 'image/svg+xml'],
  '/favicon.png': ['favicon.png', 'image/png'],
};

const MAX_BODY = 2 * 1024 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Wraps the service in a small JSON HTTP API. */
function createServer(service, options = {}) {
  const requesterKey = options.requesterKey || null;
  const operatorKey = options.operatorKey || null;

  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type,x-api-key',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === 'OPTIONS') return send(204, {});
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;

      if (req.method === 'GET' && FILES[path]) {
        const [file, type] = FILES[path];
        res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
        return res.end(fs.readFileSync(path_.join(PUBLIC_DIR, file)));
      }

      if (req.method === 'GET' && path === '/v1/health') return send(200, { ok: true });
      if (req.method === 'GET' && path === '/v1/bounties') return send(200, { bounties: service.listBounties() });
      if (req.method === 'GET' && path === '/v1/atlas/cells') return send(200, { cells: service.knownCells() });

      let m = /^\/v1\/atlas\/cell\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && m) return send(200, { cellId: decodeURIComponent(m[1]), history: service.cellHistory(decodeURIComponent(m[1])) });

      m = /^\/v1\/nodes\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
      if (req.method === 'GET' && m) return send(200, service.nodeSummary(m[1]));

      m = /^\/v1\/nodes\/([1-9A-HJ-NP-Za-km-z]{32,44})\/delete$/.exec(path);
      if (req.method === 'POST' && m) {
        const body = await readJson(req);
        const result = service.deleteNodeData(m[1], Number(body.issuedAtMs), String(body.signature || ''));
        return send(result.ok ? 200 : 403, result);
      }

      m = /^\/v1\/nodes\/([1-9A-HJ-NP-Za-km-z]{32,44})\/verify$/.exec(path);
      if (req.method === 'POST' && m) return send(200, await service.verifyNode(m[1]));

      if (path === '/v1/settlements/pending' || /^\/v1\/settlements\/\d+$/.test(path)) {
        if (!operatorKey || req.headers['x-operator-key'] !== operatorKey) return send(401, { error: 'operator key required' });
        if (req.method === 'GET' && path === '/v1/settlements/pending') return send(200, { settlements: service.pendingSettlements() });
        if (req.method === 'POST') {
          const body = await readJson(req);
          const result = service.markSettled(Number(path.split('/').pop()), body.tx);
          return send(result.ok ? 200 : 409, result);
        }
      }

      if (req.method === 'POST' && path === '/v1/reports') {
        const result = await service.submitReport(await readJson(req));
        return send(result.accepted ? 200 : 422, result);
      }

      if (req.method === 'POST' && path === '/v1/bounties') {
        if (requesterKey && req.headers['x-api-key'] !== requesterKey) return send(401, { error: 'missing or wrong API key' });
        const result = service.createBounty(await readJson(req));
        return send(result.ok ? 201 : 400, result);
      }

      return send(404, { error: 'not found' });
    } catch (e) {
      return send(e.status || 500, { error: e.status ? e.message : 'internal error' });
    }
  });
}

module.exports = { createServer };
