'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { createService } = require('../lib/service');
const { createSupabaseSink } = require('../lib/supabase');
const { newNode, bucket, signedReport, signText } = require('./helpers');

const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);

/** A fake Supabase REST endpoint that records calls and can be told to fail. */
function fakeFetch(queue = []) {
  const calls = [];
  let failing = false;
  const impl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (failing) return { ok: false, status: 503, text: async () => 'down' };
    const next = queue.shift();
    if (next) return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => JSON.stringify(next.body) };
    return { ok: true, status: 200, text: async () => '[]' };
  };
  return { impl, calls, setFailing: (v) => { failing = v; } };
}

const makeSink = (f, key = 'eyJservice.key.value') => createSupabaseSink({ url: 'https://abc.supabase.co/', serviceKey: key, fetchImpl: f.impl });

test('the sink talks to PostgREST with the service key and idempotent writes', async () => {
  const f = fakeFetch();
  const sink = makeSink(f);
  await sink.pushReport({ hash: 'h1', node: 'N', type: 'mapping-session', receivedMs: NOW, body: { a: 1 }, summary: { cells: 2 }, rewards: [{ kind: 'new-cells', ref: '', amountUsdc: 0.002 }] });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, 'https://abc.supabase.co/rest/v1/reports?on_conflict=hash');
  assert.equal(f.calls[0].headers.apikey, 'eyJservice.key.value');
  assert.equal(f.calls[0].headers.authorization, 'Bearer eyJservice.key.value');
  assert.match(f.calls[0].headers.prefer, /ignore-duplicates/);
  assert.equal(f.calls[0].body[0].received_at, new Date(NOW).toISOString());
  assert.equal(f.calls[1].url, 'https://abc.supabase.co/rest/v1/rewards?on_conflict=report_hash,kind,ref');
  assert.deepEqual(f.calls[1].body[0], { node: 'N', report_hash: 'h1', kind: 'new-cells', ref: '', amount_usdc: 0.002 });
});

test('payout helpers only touch approved rows', async () => {
  const f = fakeFetch();
  const sink = makeSink(f);
  await sink.listApproved(10);
  assert.match(f.calls[0].url, /status=eq\.approved/);
  assert.match(f.calls[0].url, /paid_at=is\.null/);
  await sink.markPaid(['a', 'b'], 'TX');
  assert.equal(f.calls[1].method, 'PATCH');
  assert.match(f.calls[1].url, /id=in\.\(a,b\)&status=eq\.approved/);
  assert.equal(f.calls[1].body.status, 'paid');
  assert.equal(f.calls[1].body.tx, 'TX');
  const before = f.calls.length;
  await sink.markPaid([], 'TX');
  assert.equal(f.calls.length, before, 'nothing to mark means no request');
});

test('refuses to start without credentials and reports server errors', async () => {
  assert.throws(() => createSupabaseSink({ url: '', serviceKey: '' }), /SUPABASE_URL/);
  const f = fakeFetch();
  f.setFailing(true);
  await assert.rejects(makeSink(f).listApproved(), /503/);
});

test('an accepted report reaches Supabase as pending rewards; a rejected one does not', async () => {
  const f = fakeFetch();
  const store = openStore(':memory:');
  const service = createService(store, { now: () => NOW, sink: makeSink(f) });
  const node = newNode();
  const ok = await service.submitReport(signedReport(node, [bucket('h120:1:1', NOW - 3600_000), bucket('h120:1:2', NOW - 3600_000)]));
  assert.equal(ok.accepted, true);
  const flushed = await service.flushOutbox();
  assert.equal(flushed.waiting, 0);
  const pushed = f.calls.filter((c) => c.url.includes('/reports?'));
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].body[0].node, node.address);
  assert.equal(pushed[0].body[0].summary.cells, 2);
  const rewards = f.calls.find((c) => c.url.includes('/rewards?')).body;
  assert.deepEqual(rewards.map((r) => [r.kind, r.amount_usdc]), [['new-cells', 0.002]]);

  const before = f.calls.length;
  const bad = signedReport(newNode(), [bucket('h120:1:3', NOW - 3600_000)], { checks: { samples: 3, mockedFixes: 4, poorAccuracyFixes: 0, maxSpeedMps: 1, durationSec: 60 } });
  assert.equal((await service.submitReport(bad)).accepted, false);
  await service.flushOutbox();
  assert.equal(f.calls.length, before, 'rejected reports are never sent');
});

test('a chest claim queues both the cell subsidy and the chest reward', async () => {
  const f = fakeFetch();
  const service = createService(openStore(':memory:'), { now: () => NOW, sink: makeSink(f) });
  const made = service.createBounty({ title: 'x', kind: 'gap', cellId: 'h120:5:5', rewardUsdc: 0.5, maxFills: 1, expiresMs: NOW + 86_400_000, requester: 'town' });
  const env = signedReport(newNode(), [bucket('h120:5:5', NOW + 60_000)], { type: 'chest-claim', chest: { id: made.id, cellId: 'h120:5:5' } });
  assert.equal((await service.submitReport(env)).accepted, true);
  await service.flushOutbox();
  const rewards = f.calls.find((c) => c.url.includes('/rewards?')).body;
  assert.deepEqual(rewards.map((r) => r.kind).sort(), ['chest', 'new-cells']);
  assert.equal(rewards.find((r) => r.kind === 'chest').ref, made.id);
});

test('when Supabase is down nothing is lost: the push waits and retries in order', async () => {
  const f = fakeFetch();
  f.setFailing(true);
  const store = openStore(':memory:');
  const service = createService(store, { now: () => NOW, sink: makeSink(f) });
  const a = signedReport(newNode(), [bucket('h120:2:1', NOW - 3600_000)]);
  const b = signedReport(newNode(), [bucket('h120:2:2', NOW - 3600_000)]);
  assert.equal((await service.submitReport(a)).accepted, true, 'the user is still told it was accepted');
  assert.equal((await service.submitReport(b)).accepted, true);
  const stuck = await service.flushOutbox();
  assert.equal(stuck.waiting, 2);
  assert.match(stuck.error, /503/);

  f.setFailing(false);
  const done = await service.flushOutbox();
  assert.deepEqual({ sent: done.sent, waiting: done.waiting }, { sent: 2, waiting: 0 });
  const order = f.calls.filter((c) => c.url.includes('/reports?') && c.body).map((c) => c.body[0].hash).slice(-2);
  assert.deepEqual(order, [a.hash, b.hash]);
});

test('deleting a wallet\'s data is mirrored to Supabase', async () => {
  const f = fakeFetch();
  const service = createService(openStore(':memory:'), { now: () => NOW, sink: makeSink(f) });
  const node = newNode();
  await service.submitReport(signedReport(node, [bucket('h120:1:1', NOW - 3600_000)]));
  await service.flushOutbox();
  const out = service.deleteNodeData(node.address, NOW, signText(node, `azimuth-delete-v1\n${node.address}\n${NOW}`));
  assert.equal(out.ok, true);
  await service.flushOutbox();
  const patch = f.calls.find((c) => c.method === 'PATCH');
  assert.match(patch.url, new RegExp(`/reports\\?node=eq\\.${node.address}`));
  assert.deepEqual(patch.body.body, { deleted: true });
});

test('review job calls use the right filters and never touch other rows', async () => {
  const f = fakeFetch();
  const sink = makeSink(f);
  await sink.listNewReports(5);
  assert.match(f.calls[0].url, /\/reports\?status=eq\.new&type=neq\.challenge-claim&order=received_at\.asc&limit=5/);
  await sink.finishReport('abc', 'rejected', ['why']);
  assert.match(f.calls[1].url, /\/reports\?hash=eq\.abc$/);
  assert.deepEqual([f.calls[1].body.status, f.calls[1].body.reasons], ['rejected', ['why']]);
  await sink.updateChest('c 1', { fills: 2 });
  assert.match(f.calls[2].url, /\/chests\?id=eq\.c%201$/);
  await sink.finishDeletion('d1', 'done', 'ok');
  assert.match(f.calls[3].url, /\/deletion_requests\?id=eq\.d1$/);
  await sink.listChests();
  assert.match(f.calls[4].url, /\/chests\?status=eq\.open/);
});

test('new-style secret keys go only in the apikey header', async () => {
  const f = fakeFetch();
  await makeSink(f, 'sb_secret_abc').listApproved(1);
  assert.equal(f.calls[0].headers.apikey, 'sb_secret_abc');
  assert.equal(f.calls[0].headers.authorization, undefined);
});

test('rewards created by a person approving are inserted already approved', async () => {
  const f = fakeFetch();
  const sink = makeSink(f);
  await sink.insertRewards('h', 'N', [{ kind: 'chest', ref: 'c1', amountUsdc: 1 }], 'approved');
  assert.equal(f.calls[0].body[0].status, 'approved');
  assert.ok(f.calls[0].body[0].approved_at);
  await sink.insertRewards('h', 'N', [{ kind: 'chest', ref: 'c1', amountUsdc: 1 }]);
  assert.equal(f.calls[1].body[0].status, 'pending');
  assert.equal(f.calls[1].body[0].approved_at, undefined);
  await sink.getReport('abc');
  assert.match(f.calls[2].url, /\/reports\?hash=eq\.abc&select=/);
});

test('setOnchain patches only the on-chain columns', async () => {
  const f = fakeFetch();
  const sink = makeSink(f);
  await sink.setOnchain('a'.repeat(64), { onchain_tx: 'SIG', onchain_record: 'REC', onchain_error: null });
  assert.equal(f.calls[0].method, 'PATCH');
  assert.match(f.calls[0].url, /\/reports\?hash=eq\.a{64}$/);
  assert.deepEqual(f.calls[0].body, { onchain_tx: 'SIG', onchain_record: 'REC', onchain_error: null });
  await assert.rejects(sink.setOnchain('a'.repeat(64), { status: 'verified' }), /not an on-chain column/);
});

test('listPayouts asks for verified reports with a payout, newest first', async () => {
  const f = fakeFetch();
  const sink = makeSink(f);
  assert.deepEqual(await sink.listPayouts(10), []);
  assert.match(f.calls[0].url, /status=eq\.verified/);
  assert.match(f.calls[0].url, /onchain_amount=gt\.0/);
  assert.match(f.calls[0].url, /order=verified_at\.desc/);
  assert.match(f.calls[0].url, /limit=10/);
  assert.match(f.calls[0].url, /select=[^&]*onchain_error/);
});

test('listChallenges reads the active challenges in order', async () => {
  const f = fakeFetch([{ status: 200, body: [{ id: 'scan-30' }] }]);
  const sink = makeSink(f);
  assert.deepEqual(await sink.listChallenges(), [{ id: 'scan-30' }]);
  assert.match(f.calls[0].url, /\/challenges\?/);
  assert.match(f.calls[0].url, /active=eq\.true/);
  assert.match(f.calls[0].url, /order=sort\.asc/);
});

test('listNewReports leaves out challenge claims, and listNewClaims asks only for them', async () => {
  const f = fakeFetch([{ status: 200, body: [] }, { status: 200, body: [{ hash: 'c' }] }]);
  const sink = makeSink(f);
  await sink.listNewReports(5);
  assert.match(f.calls[0].url, /type=neq\.challenge-claim/);
  assert.deepEqual(await sink.listNewClaims(7), [{ hash: 'c' }]);
  assert.match(f.calls[1].url, /status=eq\.new/);
  assert.match(f.calls[1].url, /type=eq\.challenge-claim/);
  assert.match(f.calls[1].url, /limit=7/);
});

test('findVerifiedClaim filters on wallet, challenge and period and answers true or false', async () => {
  const f = fakeFetch([{ status: 200, body: [{ hash: 'h' }] }, { status: 200, body: [] }]);
  const sink = makeSink(f);
  assert.equal(await sink.findVerifiedClaim('NodeA', 'scan-30', '2026-10-10'), true);
  assert.match(f.calls[0].url, /node=eq\.NodeA/);
  assert.match(f.calls[0].url, /status=eq\.verified/);
  assert.match(f.calls[0].url, /body-%3Ereport-%3E%3EchallengeId=eq\.scan-30|body->report->>challengeId=eq\.scan-30/);
  assert.match(f.calls[0].url, /2026-10-10/);
  assert.equal(await sink.findVerifiedClaim('NodeA', 'scan-30', '2026-10-11'), false);
});

test('activity queries are bounded by wallet and time', async () => {
  const f = fakeFetch([{ status: 200, body: [{ type: 'mapping-session', seconds: '60' }] }, { status: 200, body: [{ amount_usdc: 0.01 }] }]);
  const sink = makeSink(f);
  const a = await sink.listVerifiedActivity('NodeA', '2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z');
  assert.deepEqual(a, [{ type: 'mapping-session', seconds: '60' }]);
  assert.match(f.calls[0].url, /status=eq\.verified/);
  assert.match(f.calls[0].url, /type=neq\.challenge-claim/);
  assert.match(decodeURIComponent(f.calls[0].url), /verified_at=gte\.2026-10-10T00:00:00\.000Z/);
  assert.match(decodeURIComponent(f.calls[0].url), /verified_at=lt\.2026-10-11T00:00:00\.000Z/);
  const r = await sink.listNewCellRewards('NodeA', '2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z');
  assert.deepEqual(r, [{ amount_usdc: 0.01 }]);
  assert.match(f.calls[1].url, /kind=eq\.new-cells/);
  assert.match(f.calls[1].url, /status=neq\.rejected/);
});

test('listNewReportsFor asks for one wallet\'s unreviewed reports in a window, never claims', async () => {
  const f = fakeFetch([{ status: 200, body: [{ hash: 'h', type: 'mapping-session' }] }]);
  const sink = makeSink(f);
  const rows = await sink.listNewReportsFor('NodeA', '2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z');
  assert.deepEqual(rows, [{ hash: 'h', type: 'mapping-session' }]);
  const url = decodeURIComponent(f.calls[0].url);
  assert.match(url, /node=eq\.NodeA/);
  assert.match(url, /status=eq\.new/);
  assert.match(url, /type=neq\.challenge-claim/);
  assert.match(url, /received_at=gte\.2026-10-10T00:00:00\.000Z/);
  assert.match(url, /received_at=lt\.2026-10-11T00:00:00\.000Z/);
});
