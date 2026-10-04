'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openStore } = require('../lib/store');
const { createReviewer } = require('../lib/review');
const { createAdminApp, summarise } = require('../admin/app');
const { newNode, bucket, signedReport } = require('./helpers');

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const PASSWORD = 'correct horse battery';
const auth = 'Basic ' + Buffer.from('admin:' + PASSWORD).toString('base64');

function fakeSink() {
  const db = { reports: new Map(), rewards: [], chests: new Map() };
  return {
    db,
    async listNewReports(n = 100) { return [...db.reports.values()].filter((r) => r.status === 'new').slice(0, n); },
    async getReport(h) { return db.reports.get(h) || null; },
    async finishReport(h, status, reasons) { Object.assign(db.reports.get(h), { status, reasons }); },
    async insertRewards(h, node, rows, status = 'pending') { for (const r of rows) db.rewards.push({ node, report_hash: h, kind: r.kind, amount_usdc: r.amountUsdc, status }); },
    async listChests() { return []; },
    async updateChest() {},
    async listApproved() { return db.rewards.filter((r) => r.status === 'approved'); },
    async listDeletionRequests() { return []; },
  };
}

async function withPortal(fn) {
  const sink = fakeSink();
  const reviewer = createReviewer({ sink, store: openStore(':memory:') });
  const server = http.createServer(createAdminApp({ reviewer, sink, password: PASSWORD }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, headers = { authorization: auth }) =>
    fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), headers: r.headers }));
  try { await fn({ sink, call, base }); } finally { await new Promise((r) => server.close(r)); }
}

const add = (sink, env, over = {}) => sink.db.reports.set(env.hash, { hash: env.hash, node: env.report.node, type: env.report.type, received_at: iso(NOW), body: env, status: 'new', ...over });

test('refuses to start without a real password', () => {
  assert.throws(() => createAdminApp({ reviewer: {}, sink: {}, password: '' }), /ADMIN_PASSWORD/);
  assert.throws(() => createAdminApp({ reviewer: {}, sink: {}, password: 'short' }), /ADMIN_PASSWORD/);
});

test('every route needs the password, including the page itself', async () => {
  await withPortal(async ({ call }) => {
    for (const path of ['/', '/api/overview', '/api/reports']) {
      const none = await call('GET', path, undefined, {});
      assert.equal(none.status, 401, path);
      assert.match(none.headers.get('www-authenticate'), /Basic/);
      const wrong = await call('GET', path, undefined, { authorization: 'Basic ' + Buffer.from('admin:wrong-password').toString('base64') });
      assert.equal(wrong.status, 401, path);
    }
    assert.equal((await call('POST', '/api/reports/' + 'a'.repeat(64) + '/approve', {}, {})).status, 401);
  });
});

test('lists waiting reports with the automatic advice and a reward preview', async () => {
  await withPortal(async ({ sink, call }) => {
    const good = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000), bucket('h120:1:2', NOW - 3600_000)]);
    const bad = signedReport(newNode(), [bucket('h120:2:1', NOW - 3600_000)], { checks: { samples: 3, mockedFixes: 2, poorAccuracyFixes: 0, maxSpeedMps: 1, durationSec: 60 } });
    add(sink, good);
    add(sink, bad);
    const { status, json } = await call('GET', '/api/reports');
    assert.equal(status, 200);
    assert.equal(json.reports.length, 2);
    const g = json.reports.find((r) => r.hash === good.hash);
    assert.equal(g.check.ok, true);
    assert.deepEqual(g.check.rewardRows, [{ kind: 'new-cells', ref: '', amountUsdc: 0.002 }]);
    assert.equal(g.cellCount, 2);
    assert.equal(g.cells.length, 2);
    const b = json.reports.find((r) => r.hash === bad.hash);
    assert.equal(b.check.ok, false);
    assert.match(b.check.reasons.join(), /mock/);
    assert.equal(sink.db.rewards.length, 0, 'viewing the list pays nothing');
    assert.equal(sink.db.reports.get(good.hash).status, 'new');
  });
});

test('approve pays only what passed; a failing report cannot be approved; reject needs a reason', async () => {
  await withPortal(async ({ sink, call }) => {
    const good = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]);
    const bad = signedReport(newNode(), [bucket('h120:2:1', NOW - 3600_000)], { checks: { samples: 3, mockedFixes: 2, poorAccuracyFixes: 0, maxSpeedMps: 1, durationSec: 60 } });
    add(sink, good);
    add(sink, bad);

    const blocked = await call('POST', `/api/reports/${bad.hash}/approve`, {});
    assert.equal(blocked.status, 409);
    assert.match(blocked.json.reasons.join(), /mock/);
    assert.equal(sink.db.rewards.length, 0);

    assert.equal((await call('POST', `/api/reports/${bad.hash}/reject`, { reason: '  ' })).status, 400);
    const rej = await call('POST', `/api/reports/${bad.hash}/reject`, { reason: 'mock locations' });
    assert.equal(rej.status, 200);
    assert.equal(sink.db.reports.get(bad.hash).status, 'rejected');

    const ok = await call('POST', `/api/reports/${good.hash}/approve`, {});
    assert.equal(ok.status, 200);
    assert.deepEqual(sink.db.rewards.map((r) => [r.kind, r.status]), [['new-cells', 'approved']]);

    assert.equal((await call('POST', `/api/reports/${good.hash}/approve`, {})).status, 409, 'cannot approve twice');
    assert.equal((await call('POST', `/api/reports/${good.hash}/reject`, { reason: 'x' })).status, 409, 'cannot reject after approving');

    const overview = await call('GET', '/api/overview');
    assert.equal(overview.json.waiting, 0);
    assert.equal(overview.json.payableTotal, 0.001);
    assert.equal(overview.json.payable.length, 1);
  });
});

test('serves the page and its scripts without any third-party source, and a strict policy', async () => {
  await withPortal(async ({ base }) => {
    const page = await fetch(base + '/', { headers: { authorization: auth } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3)/, 'no external links or scripts in the page');
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline.*script|script-src[^;]*unsafe-inline/);
    for (const p of ['/admin.js', '/hex.js', '/vendor/leaflet.js', '/vendor/leaflet.css']) {
      assert.equal((await fetch(base + p, { headers: { authorization: auth } })).status, 200, p);
    }
  });
});

test('report contents are only ever passed on as plain text values', () => {
  const evil = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]);
  evil.report.device.model = '<img src=x onerror=alert(1)>'.repeat(10);
  const s = summarise({ hash: evil.hash, node: evil.report.node, type: 'mapping-session', received_at: iso(NOW), body: evil }, { ok: true, reasons: [] });
  assert.ok(s.device.length <= 64, 'long strings are cut');
  assert.equal(typeof s.device, 'string');
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'admin', 'admin.js'), 'utf8');
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|document\.write|outerHTML/, 'the page never builds markup from report data');
});
