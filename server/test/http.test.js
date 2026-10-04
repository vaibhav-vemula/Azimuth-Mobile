'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { createService } = require('../lib/service');
const { createServer } = require('../lib/http');
const { newNode, bucket, signedReport } = require('./helpers');

async function withServer(fn, requesterKey = 'k') {
  const now = Date.now();
  const service = createService(openStore(':memory:'), { now: () => now });
  const server = createServer(service, { requesterKey });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, now); } finally { await new Promise((r) => server.close(r)); }
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('health, bounty creation needs the key, reports flow end to end', async () => {
  await withServer(async (base, now) => {
    assert.equal((await (await fetch(`${base}/v1/health`)).json()).ok, true);

    const input = { title: 'Dead zone', kind: 'dead-zone', cellId: 'h120:2:2', rewardUsdc: 1, maxFills: 2, expiresMs: now + 3600_000, requester: 'town' };
    assert.equal((await post(`${base}/v1/bounties`, input)).status, 401);
    assert.equal((await post(`${base}/v1/bounties`, input, { 'x-api-key': 'k' })).status, 201);
    const list = await (await fetch(`${base}/v1/bounties`)).json();
    assert.equal(list.bounties.length, 1);

    const node = newNode();
    const env = signedReport(node, [bucket('h120:2:2', now + 60_000)], { type: 'chest-claim', chest: { id: list.bounties[0].id, cellId: 'h120:2:2' } });
    const res = await post(`${base}/v1/reports`, env);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.reward.chestUsdc, 1);

    const summary = await (await fetch(`${base}/v1/nodes/${node.address}`)).json();
    assert.ok(summary.totalUsdc >= 1);
    const cells = await (await fetch(`${base}/v1/atlas/cells`)).json();
    assert.deepEqual(cells.cells, ['h120:2:2']);
    const cell = await (await fetch(`${base}/v1/atlas/cell/${encodeURIComponent('h120:2:2')}`)).json();
    assert.equal(cell.history.length, 1);
  });
});

test('bad input gets clean errors', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    const bad = await fetch(`${base}/v1/reports`, { method: 'POST', body: '{not json' });
    assert.equal(bad.status, 400);
    const empty = await post(`${base}/v1/reports`, {});
    assert.equal(empty.status, 422);
  });
});

test('settlement queue is operator-only and drains once', async () => {
  const now = Date.now();
  const service = createService(openStore(':memory:'), { now: () => now });
  const server = createServer(service, { requesterKey: 'k', operatorKey: 'op' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const onchain = '4Nd1mYQq6bQmH1Yw7bX6jZ1pQe9mJ8cHn8V3tYk2uWJp';
    const created = await (await post(`${base}/v1/bounties`, { title: 'x', kind: 'dead-zone', cellId: 'h120:2:2', rewardUsdc: 1, maxFills: 2, expiresMs: now + 3600_000, requester: 'town', onchainBounty: onchain }, { 'x-api-key': 'k' })).json();
    const node = newNode();
    const env = signedReport(node, [bucket('h120:2:2', now + 60_000)], { type: 'chest-claim', chest: { id: created.id, cellId: 'h120:2:2' } });
    assert.equal((await post(`${base}/v1/reports`, env)).status, 200);

    assert.equal((await fetch(`${base}/v1/settlements/pending`)).status, 401);
    const pending = (await (await fetch(`${base}/v1/settlements/pending`, { headers: { 'x-operator-key': 'op' } })).json()).settlements;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].node, node.address);
    assert.equal(pending[0].onchainBounty, onchain);
    assert.equal(pending[0].reportHash, env.hash);

    const tx = 'T'.repeat(88);
    const done = await post(`${base}/v1/settlements/${pending[0].ledgerId}`, { tx }, { 'x-operator-key': 'op' });
    assert.equal(done.status, 200);
    assert.equal((await post(`${base}/v1/settlements/${pending[0].ledgerId}`, { tx }, { 'x-operator-key': 'op' })).status, 409, 'cannot settle twice');
    const after = (await (await fetch(`${base}/v1/settlements/pending`, { headers: { 'x-operator-key': 'op' } })).json()).settlements;
    assert.equal(after.length, 0);
  } finally { await new Promise((r) => server.close(r)); }
});

test('serves the requester console and its hex helper', async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/console`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /Requester console/);
    const js = await fetch(`${base}/console/hex.js`);
    assert.equal(js.status, 200);
    assert.match(await js.text(), /AzimuthHex/);
  });
});
