'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { createReviewer } = require('../lib/review');
const { newNode, bucket, signedReport, signText } = require('./helpers');
const crypto = require('node:crypto');
const { canonicalize } = require('../lib/verify-report.cjs');

const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

const SEED_CHALLENGES = [
  { id: 'scan-30', title: 'Scan for 30 minutes', blurb: 'Keep mapping on for half an hour today.', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map', active: true, sort: 10 },
  { id: 'cells-20', title: 'Find 20 new cells', blurb: 'Map 20 cells nobody has mapped yet.', period: 'daily', metric: 'new_cells', goal: 20, reward: 5, go_tab: 'Map', active: true, sort: 20 },
  { id: 'ground-weekly', title: 'Explore new ground', blurb: 'Reveal 70 new cells this week.', period: 'weekly', metric: 'new_cells', goal: 70, reward: 40, go_tab: 'Map', active: true, sort: 30 },
  { id: 'passes-3', title: 'Catch 3 satellite passes', blurb: 'Record three satellite passes this week.', period: 'weekly', metric: 'satellite_passes', goal: 3, reward: 30, go_tab: 'Satellites', active: true, sort: 40 },
  { id: 'first-chest', title: 'Open your first chest', blurb: 'Find a chest and open it. Once only.', period: 'once', metric: 'chests_opened', goal: 1, reward: 20, go_tab: 'Map', active: true, sort: 50 },
];

/** An in-memory stand-in for the Supabase tables, with the same methods as the real sink. */
function fakeSupabase() {
  const db = { reports: new Map(), rewards: [], chests: new Map(), deletions: [], erased: [], challenges: SEED_CHALLENGES.map((c) => ({ ...c })), activity: [], cellRewards: [] };
  const failures = { insertRewards: 0 };
  const sink = {
    async listNewReports(limit = 100) { return [...db.reports.values()].filter((r) => r.status === 'new' && r.type !== 'challenge-claim').sort((a, b) => a.received_at.localeCompare(b.received_at)).slice(0, limit); },
    async setOnchain(hash, patch) { Object.assign(db.reports.get(hash), patch); },
    async finishReport(hash, status, reasons) { Object.assign(db.reports.get(hash), { status, reasons: reasons && reasons.length ? reasons : null }); },
    async getReport(hash) { return db.reports.get(hash) || null; },
    async insertRewards(hash, node, rows, status = 'pending') {
      if (failures.insertRewards > 0) { failures.insertRewards--; throw new Error('network down'); }
      for (const r of rows) if (!db.rewards.some((x) => x.report_hash === hash && x.kind === r.kind && x.ref === r.ref)) db.rewards.push({ node, report_hash: hash, kind: r.kind, ref: r.ref, amount_usdc: r.amountUsdc, status });
    },
    async listChests() { return [...db.chests.values()].filter((c) => c.status === 'open'); },
    async updateChest(id, patch) { Object.assign(db.chests.get(id), patch); },
    async listDeletionRequests() { return db.deletions.filter((d) => d.status === 'new'); },
    async finishDeletion(id, status, note) { Object.assign(db.deletions.find((d) => d.id === id), { status, note }); },
    async listChallenges() { return db.challenges; },
    async listNewClaims(limit = 50) { return [...db.reports.values()].filter((r) => r.status === 'new' && r.type === 'challenge-claim').sort((a, b) => a.received_at.localeCompare(b.received_at)).slice(0, limit); },
    async findVerifiedClaim(node, id, period) {
      return [...db.reports.values()].find((r) => r.type === 'challenge-claim' && r.status === 'verified' && r.node === node && r.body && r.body.report && r.body.report.challengeId === id && r.body.report.period === period) || null;
    },
    async listVerifiedActivity(node, from, to) { return db.activity.filter((a) => a.node === node && a.atMs >= Date.parse(from) && a.atMs < Date.parse(to)); },
    async listNewCellRewards(node, from, to) { return db.cellRewards.filter((a) => a.node === node && a.atMs >= Date.parse(from) && a.atMs < Date.parse(to)); },
    async eraseNode(node) { db.erased.push(node); for (const r of db.reports.values()) if (r.node === node) r.body = { deleted: true }; },
  };
  const insertReport = (env, receivedMs, over = {}) =>
    db.reports.set(env.hash, { hash: env.hash, node: env.report.node, type: env.report.type, received_at: iso(receivedMs), body: env, status: 'new', ...over });
  return { db, sink, failures, insertReport };
}

const reviewer = (fake, extra = {}) => createReviewer({ sink: fake.sink, store: openStore(':memory:'), ...extra });

test('verifies good reports, creates pending rewards, and leaves nothing unreviewed', async () => {
  const fake = fakeSupabase();
  const node = newNode();
  const env = signedReport(node, [bucket('h120:1:1', NOW - 3600_000), bucket('h120:1:2', NOW - 3600_000)]);
  fake.insertReport(env, NOW);
  const out = await reviewer(fake).run({ auto: true });
  assert.equal(out.verified, 1);
  assert.equal(fake.db.reports.get(env.hash).status, 'verified');
  assert.deepEqual(fake.db.rewards.map((r) => [r.kind, r.amount_usdc, r.status]), [['new-cells', 0.002, 'pending']]);
  assert.equal((await reviewer(fake).run({ auto: true })).verified, 0, 'a second run finds nothing new');
});

test('rejects tampered reports and mismatched columns with a reason', async () => {
  const fake = fakeSupabase();
  const a = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]);
  a.report.checks.samples = 99; // changed after signing
  fake.insertReport(a, NOW);

  const b = signedReport(newNode(), [bucket('h120:2:1', NOW - 3600_000)]);
  fake.insertReport(b, NOW + 1, { node: newNode().address }); // someone else's wallet in the column

  const c = signedReport(newNode(), [bucket('h120:3:1', NOW - 3600_000)]);
  fake.insertReport(c, NOW + 2);
  fake.db.reports.get(c.hash).hash = 'f'.repeat(64);
  fake.db.reports.set('f'.repeat(64), fake.db.reports.get(c.hash));
  fake.db.reports.delete(c.hash);

  const out = await reviewer(fake).run({ auto: true });
  assert.equal(out.rejected, 3);
  assert.equal(fake.db.rewards.length, 0);
  assert.match(fake.db.reports.get(a.hash).reasons.join(), /hash|signature/);
  assert.match(fake.db.reports.get(b.hash).reasons.join(), /wallet column/);
  assert.match(fake.db.reports.get('f'.repeat(64)).reasons.join(), /hash column/);
});

test('judges each report as of when it was received, not when it is reviewed', async () => {
  const fake = fakeSupabase();
  // Readings 60 hours old when received (inside the 72 h limit), reviewed much later.
  const old = signedReport(newNode(), [bucket('h120:1:1', NOW - 60 * 3600_000)]);
  fake.insertReport(old, NOW);
  // Readings already 80 hours old when received: too old whenever it is reviewed.
  const tooOld = signedReport(newNode(), [bucket('h120:1:2', NOW - 80 * 3600_000)]);
  fake.insertReport(tooOld, NOW + 1);
  const out = await reviewer(fake).run({ auto: true });
  assert.equal(fake.db.reports.get(old.hash).status, 'verified');
  assert.equal(fake.db.reports.get(tooOld.hash).status, 'rejected');
  assert.equal(out.verified + out.rejected, 2);
});

test('chest claims fill the public chest and pay once', async () => {
  const fake = fakeSupabase();
  fake.db.chests.set('c1', { id: 'c1', title: 'Dead zone', kind: 'dead-zone', cell_id: 'h120:5:5', reward_usdc: 1, max_fills: 1, fills: 0, expires_at: iso(NOW + 86_400_000), requester: 'town', spec: {}, created_at: iso(NOW - 3600_000), status: 'open' });
  const a = newNode();
  const first = signedReport(a, [bucket('h120:5:5', NOW + 60_000)], { type: 'chest-claim', chest: { id: 'c1', cellId: 'h120:5:5' } });
  const second = signedReport(newNode(), [bucket('h120:5:5', NOW + 60_000)], { type: 'chest-claim', chest: { id: 'c1', cellId: 'h120:5:5' } });
  fake.insertReport(first, NOW + 120_000);
  fake.insertReport(second, NOW + 180_000);
  const out = await reviewer(fake).run({ auto: true });
  assert.equal(out.verified, 1);
  assert.equal(out.rejected, 1);
  assert.match(fake.db.reports.get(second.hash).reasons.join(), /no longer open/);
  assert.equal(fake.db.chests.get('c1').fills, 1);
  assert.equal(fake.db.chests.get('c1').status, 'filled', 'the public chest closes when filled');
  assert.deepEqual(fake.db.rewards.filter((r) => r.kind === 'chest').map((r) => [r.node, r.amount_usdc]), [[a.address, 1]]);
});

test('a failure after accepting is recovered on the next run without double counting', async () => {
  const fake = fakeSupabase();
  fake.db.chests.set('c1', { id: 'c1', title: 'Gap', kind: 'gap', cell_id: 'h120:5:5', reward_usdc: 0.5, max_fills: 2, fills: 0, expires_at: iso(NOW + 86_400_000), requester: 'town', spec: {}, created_at: iso(NOW - 3600_000), status: 'open' });
  const env = signedReport(newNode(), [bucket('h120:5:5', NOW + 60_000)], { type: 'chest-claim', chest: { id: 'c1', cellId: 'h120:5:5' } });
  fake.insertReport(env, NOW + 120_000);

  const r = reviewer(fake); // the same local state across runs, like the real review database
  fake.failures.insertRewards = 1;
  await assert.rejects(r.run({ auto: true }), /network down/);
  assert.equal(fake.db.reports.get(env.hash).status, 'new', 'left for the next run');
  assert.equal(fake.db.rewards.length, 0);

  const out = await r.run({ auto: true });
  assert.equal(out.verified, 1, 'it is not rejected as a repeat');
  assert.deepEqual(fake.db.rewards.map((x) => x.kind).sort(), ['chest', 'new-cells']);
  assert.equal(fake.db.chests.get('c1').fills, 1, 'filled once, not twice');
});

test('carries out signed deletion requests and refuses forged ones', async () => {
  const fake = fakeSupabase();
  const me = newNode();
  const env = signedReport(me, [bucket('h120:1:1', NOW - 3600_000)]);
  fake.insertReport(env, NOW);
  const r = reviewer(fake);
  await r.run({ auto: true });

  const issued = Date.now() - 3600_000; // an hour ago: review is not instant
  const msg = `azimuth-delete-v1\n${me.address}\n${issued}`;
  fake.db.deletions.push({ id: 'd1', node: me.address, issued_ms: issued, signature: signText(me, msg), status: 'new' });
  fake.db.deletions.push({ id: 'd2', node: me.address, issued_ms: issued, signature: signText(newNode(), msg), status: 'new' });
  fake.db.deletions.push({ id: 'd3', node: me.address, issued_ms: Date.now() - 30 * 86400_000, signature: signText(me, `azimuth-delete-v1\n${me.address}\n${Date.now() - 30 * 86400_000}`), status: 'new' });
  const out = await r.run();
  assert.equal(out.deletions, 3);
  const status = Object.fromEntries(fake.db.deletions.map((d) => [d.id, d.status]));
  assert.deepEqual(status, { d1: 'done', d2: 'refused', d3: 'refused' });
  assert.deepEqual(fake.db.erased, [me.address], 'only the valid request erased anything');
  assert.deepEqual(fake.db.reports.get(env.hash).body, { deleted: true });
});

test('the Seeker gate applies in review too', async () => {
  const fake = fakeSupabase();
  fake.insertReport(signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]), NOW);
  const out = await reviewer(fake, { checkNode: async () => ({ ok: false, reason: 'no Seeker Genesis Token' }) }).run({ auto: true });
  assert.equal(out.rejected, 1);
  assert.equal(fake.db.rewards.length, 0);
});

// ---- Manual approval: a person decides, nothing is automatic ----

test('without auto, new reports wait for a person and earn nothing', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]);
  fake.insertReport(env, NOW);
  const out = await reviewer(fake).run();
  assert.equal(out.waiting, 1);
  assert.equal(out.verified + out.rejected, 0);
  assert.equal(fake.db.reports.get(env.hash).status, 'new');
  assert.equal(fake.db.rewards.length, 0);
});

test('a preview shows what approving would pay and changes nothing', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000), bucket('h120:1:2', NOW - 3600_000)]);
  fake.insertReport(env, NOW);
  const r = reviewer(fake);
  const p = await r.preview(fake.db.reports.get(env.hash));
  assert.equal(p.ok, true);
  assert.deepEqual(p.rewardRows, [{ kind: 'new-cells', ref: '', amountUsdc: 0.002 }]);
  // Previewing twice is the same: no cell was marked known, no report recorded.
  assert.deepEqual((await r.preview(fake.db.reports.get(env.hash))).rewardRows, p.rewardRows);
  assert.equal(r.service.knownCells().length, 0);
  assert.equal(fake.db.reports.get(env.hash).status, 'new');
  assert.equal(fake.db.rewards.length, 0);
});

test('a preview explains why a bad report would be refused', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)], { checks: { samples: 3, mockedFixes: 3, poorAccuracyFixes: 0, maxSpeedMps: 1, durationSec: 60 } });
  fake.insertReport(env, NOW);
  const p = await reviewer(fake).preview(fake.db.reports.get(env.hash));
  assert.equal(p.ok, false);
  assert.match(p.reasons.join(), /mock/);
});

test('approving creates approved rewards, ready for the weekly payout, and finishes the report', async () => {
  const fake = fakeSupabase();
  const node = newNode();
  const env = signedReport(node, [bucket('h120:1:1', NOW - 3600_000)]);
  fake.insertReport(env, NOW);
  const res = await reviewer(fake).approve(env.hash);
  assert.equal(res.status, 'verified');
  assert.equal(fake.db.reports.get(env.hash).status, 'verified');
  assert.deepEqual(fake.db.rewards.map((x) => [x.node, x.kind, x.status]), [[node.address, 'new-cells', 'approved']]);
});

test('approval cannot be used on a report that fails the checks, or twice', async () => {
  const fake = fakeSupabase();
  const bad = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)], { checks: { samples: 3, mockedFixes: 3, poorAccuracyFixes: 0, maxSpeedMps: 1, durationSec: 60 } });
  const good = signedReport(newNode(), [bucket('h120:2:2', NOW - 3600_000)]);
  fake.insertReport(bad, NOW);
  fake.insertReport(good, NOW + 1);
  const r = reviewer(fake);
  const blocked = await r.approve(bad.hash);
  assert.equal(blocked.status, 'blocked');
  assert.equal(fake.db.reports.get(bad.hash).status, 'new', 'still waiting; the person can reject it');
  assert.equal(fake.db.rewards.length, 0);

  assert.equal((await r.approve(good.hash)).status, 'verified');
  const again = await r.approve(good.hash);
  assert.match(again.reasons.join(), /already verified/);
  assert.equal(fake.db.rewards.length, 1, 'no second payment');
  assert.equal((await r.approve('f'.repeat(64))).status, 'missing');
});

test('rejecting records the reason and creates nothing', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]);
  fake.insertReport(env, NOW);
  const res = await reviewer(fake).reject(env.hash, 'readings look copied from another report');
  assert.equal(res.status, 'rejected');
  assert.deepEqual(fake.db.reports.get(env.hash).reasons, ['readings look copied from another report']);
  assert.equal(fake.db.rewards.length, 0);
  const after = await reviewer(fake).approve(env.hash);
  assert.equal(after.status, 'unchanged');
  assert.equal(after.current, 'rejected', 'a rejected report cannot then be approved');
});

test('approving a chest claim fills the chest and pays the chest reward', async () => {
  const fake = fakeSupabase();
  fake.db.chests.set('c1', { id: 'c1', title: 'Dead zone', kind: 'dead-zone', cell_id: 'h120:5:5', reward_usdc: 1, max_fills: 1, fills: 0, expires_at: iso(NOW + 86_400_000), requester: 'town', spec: {}, created_at: iso(NOW - 3600_000), status: 'open' });
  const a = newNode();
  const env = signedReport(a, [bucket('h120:5:5', NOW + 60_000)], { type: 'chest-claim', chest: { id: 'c1', cellId: 'h120:5:5' } });
  fake.insertReport(env, NOW + 120_000);
  const r = reviewer(fake);
  await r.syncChests();
  const p = await r.preview(fake.db.reports.get(env.hash));
  assert.deepEqual(p.rewardRows.map((x) => x.kind).sort(), ['chest', 'new-cells']);
  await r.approve(env.hash);
  assert.equal(fake.db.chests.get('c1').fills, 1);
  assert.equal(fake.db.chests.get('c1').status, 'filled');
  assert.equal(fake.db.rewards.find((x) => x.kind === 'chest').amount_usdc, 1);
});

function fakeChain(over = {}) {
  const calls = [];
  return {
    calls,
    async reward(args) {
      calls.push(args);
      if (over.fail) throw new Error(over.fail);
      return { signature: 'SIG', record: 'REC', existed: false };
    },
  };
}
const manyCells = (n) => Array.from({ length: n }, (_, i) => bucket(`h120:1:${i + 1}`, NOW - 3600_000));

test('approving a mapping report with enough new cells pays AZMTest and stores the transaction', async () => {
  const fake = fakeSupabase();
  const chain = fakeChain();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake, { chain }).approve(env.hash);
  assert.equal(out.status, 'verified');
  assert.deepEqual(out.onchain, { ok: true, amount: 2, signature: 'SIG', record: 'REC' });
  assert.deepEqual(chain.calls, [{ wallet: env.report.node, hash: env.hash, kind: 0, amount: 2 }]);
  const row = fake.db.reports.get(env.hash);
  assert.equal(row.onchain_amount, 2);
  assert.equal(row.onchain_tx, 'SIG');
  assert.equal(row.onchain_record, 'REC');
  assert.equal(row.onchain_error, null);
});

test('a report worth less than one token makes no chain call and no error', async () => {
  const fake = fakeSupabase();
  const chain = fakeChain();
  const env = signedReport(newNode(), manyCells(3));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake, { chain }).approve(env.hash);
  assert.equal(out.status, 'verified');
  assert.equal(out.onchain, null);
  assert.equal(chain.calls.length, 0);
  assert.equal(fake.db.reports.get(env.hash).onchain_error, undefined);
});

test('a chain failure keeps the report verified, stores the error and the amount, and can be retried', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const broken = await reviewer(fake, { chain: fakeChain({ fail: 'Rewards are paused' }) }).approve(env.hash);
  assert.equal(broken.status, 'verified');
  assert.deepEqual(broken.onchain, { ok: false, amount: 2, error: 'Rewards are paused' });
  const row = fake.db.reports.get(env.hash);
  assert.equal(row.status, 'verified');
  assert.equal(row.onchain_error, 'Rewards are paused');
  assert.equal(row.onchain_tx, undefined);

  const good = fakeChain();
  const rev = reviewer(fake, { chain: good });
  const retried = await rev.retryOnChain(env.hash);
  assert.equal(retried.status, 'paid');
  assert.equal(good.calls[0].amount, 2);
  assert.equal(fake.db.reports.get(env.hash).onchain_error, null);
  assert.equal((await rev.retryOnChain(env.hash)).status, 'already-paid');
  assert.equal(good.calls.length, 1, 'no second payment');
});

test('retry refuses reports that are not verified or have nothing to pay', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(3));
  fake.insertReport(env, NOW);
  const rev = reviewer(fake, { chain: fakeChain() });
  assert.equal((await rev.retryOnChain('f'.repeat(64))).status, 'missing');
  assert.equal((await rev.retryOnChain(env.hash)).status, 'not-verified');
  await rev.approve(env.hash);
  assert.equal((await rev.retryOnChain(env.hash)).status, 'nothing-to-pay');
});

test('if saving the amount fails, approval still completes and reports the problem', async () => {
  const fake = fakeSupabase();
  fake.sink.setOnchain = async () => { throw new Error('column onchain_amount does not exist'); };
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake, { chain: fakeChain() }).approve(env.hash);
  assert.equal(out.status, 'verified');
  assert.equal(out.onchain.ok, false);
  assert.match(out.onchain.error, /onchain_amount/);
});

test('without a chain nothing changes', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake).approve(env.hash);
  assert.equal(out.status, 'verified');
  assert.equal(out.onchain, null);
});

test('auto-mode approvals never touch the chain', async () => {
  const fake = fakeSupabase();
  const chain = fakeChain();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake, { chain }).run({ auto: true });
  assert.equal(out.verified, 1);
  assert.equal(chain.calls.length, 0);
  assert.equal(out.results[0].onchain, null);
  assert.equal(fake.db.reports.get(env.hash).onchain_amount, undefined);
});

test('retry does nothing for a report type that has no AZMTest kind', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(3));
  fake.insertReport(env, NOW, { status: 'verified', type: 'mystery', onchain_amount: 5 });
  const chain = fakeChain();
  assert.equal((await reviewer(fake, { chain }).retryOnChain(env.hash)).status, 'nothing-to-pay');
  assert.equal(chain.calls.length, 0);
});

test('money moved but saving the result failed: reported as paid with a warning', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  let n = 0;
  const real = fake.sink.setOnchain;
  fake.sink.setOnchain = async (h, patch) => { if (++n === 2) throw new Error('db down'); return real(h, patch); };
  const out = await reviewer(fake, { chain: fakeChain() }).approve(env.hash);
  assert.equal(out.onchain.ok, true);
  assert.equal(out.onchain.signature, 'SIG');
  assert.match(out.onchain.warning, /paid on-chain but could not save the result: db down/);
});

test('an already-recorded payout (no signature) is stored as already-recorded', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const chain = { async reward() { return { signature: null, record: 'REC', existed: true }; } };
  const out = await reviewer(fake, { chain }).approve(env.hash);
  assert.deepEqual(out.onchain, { ok: true, amount: 2, signature: null, record: 'REC' });
  assert.equal(fake.db.reports.get(env.hash).onchain_tx, 'already-recorded');
});

test('satellite pass pays 25 with kind 1 and chest claim pays 10 with kind 2', async () => {
  const fake = fakeSupabase();
  const chain = fakeChain();
  const sat = signedReport(newNode(), manyCells(1), { type: 'satellite-pass' });
  fake.insertReport(sat, NOW);
  const rev = reviewer(fake, { chain });
  // Building a physically valid signed pass is heavy (see passes.test.js); the review path is what matters here.
  rev.service.wasAccepted = () => true;
  rev.service.rewardsFor = () => [];
  const out = await rev.approve(sat.hash);
  assert.equal(out.onchain.amount, 25);
  assert.deepEqual(chain.calls[0], { wallet: sat.report.node, hash: sat.hash, kind: 1, amount: 25 });

  fake.db.chests.set('c1', { id: 'c1', title: 'Dead zone', kind: 'dead-zone', cell_id: 'h120:5:5', reward_usdc: 1, max_fills: 1, fills: 0, expires_at: iso(NOW + 86_400_000), requester: 'town', spec: {}, created_at: iso(NOW - 3600_000), status: 'open' });
  const chain2 = fakeChain();
  const rev2 = reviewer(fake, { chain: chain2 });
  await rev2.syncChests();
  const claim = signedReport(newNode(), [bucket('h120:5:5', NOW + 60_000)], { type: 'chest-claim', chest: { id: 'c1', cellId: 'h120:5:5' } });
  fake.insertReport(claim, NOW);
  const out2 = await rev2.approve(claim.hash);
  assert.equal(out2.status, 'verified');
  assert.equal(out2.onchain.amount, 10);
  assert.deepEqual(chain2.calls[0], { wallet: claim.report.node, hash: claim.hash, kind: 2, amount: 10 });
});

test('a rejected report makes no chain call', async () => {
  const fake = fakeSupabase();
  const chain = fakeChain();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  await reviewer(fake, { chain }).reject(env.hash, 'nope');
  assert.equal(chain.calls.length, 0);
  assert.equal(fake.db.reports.get(env.hash).onchain_amount, undefined);
});

test('a failed retry returns status failed with the error', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  await reviewer(fake, { chain: fakeChain({ fail: 'paused' }) }).approve(env.hash);
  const r = await reviewer(fake, { chain: fakeChain({ fail: 'still paused' }) }).retryOnChain(env.hash);
  assert.equal(r.status, 'failed');
  assert.equal(r.onchain.error, 'still paused');
});

test('a type column that differs from the signed report is blocked and rejected', async () => {
  const fake = fakeSupabase();
  const chain = fakeChain();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW, { type: 'satellite-pass' });
  const out = await reviewer(fake, { chain }).approve(env.hash);
  assert.equal(out.status, 'blocked');
  assert.match(out.reasons.join(), /type column/);
  assert.equal(chain.calls.length, 0);
  const run = await reviewer(fake, { chain }).run({ auto: true });
  assert.equal(run.rejected, 1);
  assert.match(fake.db.reports.get(env.hash).reasons.join(), /type column/);
  assert.equal(chain.calls.length, 0);
});

function claimRow(node, over = {}, receivedMs = NOW) {
  const report = { version: 1, type: 'challenge-claim', node: node.address, challengeId: 'scan-30', period: '2026-10-02', claimedMs: receivedMs, ...over };
  const canonical = canonicalize(report);
  const env = { report, signature: node.signMessage(`azimuth-report-v1\n${canonical}`), hash: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex') };
  return { hash: env.hash, node: node.address, type: 'challenge-claim', received_at: new Date(receivedMs).toISOString(), body: env, status: 'new' };
}

test('a met daily challenge is verified and paid on-chain with the derived hash and kind 3', async () => {
  const fake = fakeSupabase(); const chain = fakeChain();
  const node = newNode();
  fake.db.activity.push({ node: node.address, atMs: NOW - 3600_000, type: 'mapping-session', seconds: '2400' }); // 40 min
  const row = claimRow(node); fake.db.reports.set(row.hash, row);
  const out = await reviewer(fake, { chain }).settleChallenges({ nowMs: NOW });
  assert.equal(out[0].status, 'verified');
  const { onchainHash } = require('../lib/challenges');
  assert.deepEqual(chain.calls, [{ wallet: node.address, hash: onchainHash('scan-30', '2026-10-02'), kind: 3, amount: 5 }]);
  const saved = fake.db.reports.get(row.hash);
  assert.equal(saved.status, 'verified');
  assert.equal(saved.onchain_amount, 5);
  assert.equal(saved.onchain_tx, 'SIG');
});

test('an unmet challenge is rejected with the real numbers and pays nothing', async () => {
  const fake = fakeSupabase(); const chain = fakeChain();
  const node = newNode();
  fake.db.activity.push({ node: node.address, atMs: NOW - 3600_000, type: 'mapping-session', seconds: '1380' }); // 23 min
  const row = claimRow(node); fake.db.reports.set(row.hash, row);
  const out = await reviewer(fake, { chain }).settleChallenges({ nowMs: NOW });
  assert.equal(out[0].status, 'rejected');
  assert.match(out[0].reasons[0], /23 of 30/);
  assert.equal(chain.calls.length, 0);
  assert.equal(fake.db.reports.get(row.hash).status, 'rejected');
});

test('new-cell challenges count the wallet\'s paid new-cell rewards', async () => {
  const fake = fakeSupabase(); const chain = fakeChain();
  const node = newNode();
  fake.db.cellRewards.push({ node: node.address, atMs: NOW - 1000, amount_usdc: 0.020 });
  const row = claimRow(node, { challengeId: 'cells-20' }); fake.db.reports.set(row.hash, row);
  assert.equal((await reviewer(fake, { chain }).settleChallenges({ nowMs: NOW }))[0].status, 'verified');
});

test('stale, future, unknown and malformed claims are rejected without paying', async () => {
  const fake = fakeSupabase(); const chain = fakeChain();
  const node = newNode();
  const rows = [
    claimRow(node, { period: '2026-09-20' }, NOW),      // too old
    claimRow(node, { period: '2026-10-05' }, NOW + 1),  // future
    claimRow(node, { challengeId: 'does-not-exist' }, NOW + 2),
    { ...claimRow(node, {}, NOW + 3), node: 'SomeoneElse1111111111111111111111111111111' }, // wallet column differs from the signed body
  ];
  for (const r of rows) fake.db.reports.set(r.hash, r);
  const out = await reviewer(fake, { chain }).settleChallenges({ nowMs: NOW + 10 });
  assert.deepEqual(out.map((o) => o.status), ['rejected', 'rejected', 'rejected', 'rejected']);
  assert.equal(chain.calls.length, 0);
});

test('a second claim for the same challenge and period is rejected even with a different hash', async () => {
  const fake = fakeSupabase(); const chain = fakeChain();
  const node = newNode();
  fake.db.activity.push({ node: node.address, atMs: NOW - 3600_000, type: 'mapping-session', seconds: '2400' });
  const first = claimRow(node, {}, NOW); const second = claimRow(node, {}, NOW + 5);
  fake.db.reports.set(first.hash, first); fake.db.reports.set(second.hash, second);
  const out = await reviewer(fake, { chain }).settleChallenges({ nowMs: NOW + 10 });
  assert.deepEqual(out.map((o) => o.status), ['verified', 'rejected']);
  assert.match(out[1].reasons[0], /already claimed/);
  assert.equal(chain.calls.length, 1);
});

test('a chain failure keeps the claim verified and unpaid; retry pays with the derived hash', async () => {
  const fake = fakeSupabase();
  const node = newNode();
  fake.db.activity.push({ node: node.address, atMs: NOW - 3600_000, type: 'mapping-session', seconds: '2400' });
  const row = claimRow(node); fake.db.reports.set(row.hash, row);
  const out = await reviewer(fake, { chain: fakeChain({ fail: 'Rewards are paused' }) }).settleChallenges({ nowMs: NOW });
  assert.equal(out[0].status, 'verified');
  assert.equal(out[0].onchain.ok, false);
  assert.equal(fake.db.reports.get(row.hash).onchain_error, 'Rewards are paused');
  const good = fakeChain();
  const retried = await reviewer(fake, { chain: good }).retryOnChain(row.hash);
  assert.equal(retried.status, 'paid');
  const { onchainHash } = require('../lib/challenges');
  assert.deepEqual(good.calls[0], { wallet: node.address, hash: onchainHash('scan-30', '2026-10-02'), kind: 3, amount: 5 });
});

test('without a chain nothing is settled and claims stay new', async () => {
  const fake = fakeSupabase();
  const node = newNode();
  const row = claimRow(node); fake.db.reports.set(row.hash, row);
  assert.deepEqual(await reviewer(fake).settleChallenges({ nowMs: NOW }), []);
  assert.equal(fake.db.reports.get(row.hash).status, 'new');
});

test('claims never reach manual review or auto-approval', async () => {
  const fake = fakeSupabase();
  const node = newNode();
  const row = claimRow(node); fake.db.reports.set(row.hash, row);
  const out = await reviewer(fake, { chain: fakeChain() }).run({ auto: true });
  assert.equal(out.results.length, 0);
  assert.equal(fake.db.reports.get(row.hash).status, 'new');
});

test('a claim whose challenge is removed or has no reward is rejected as unknown and pays nothing', async () => {
  for (const mutate of [(db) => { db.challenges.length = 0; }, (db) => { db.challenges.find((c) => c.id === 'scan-30').reward = 0; }]) {
    const fake = fakeSupabase(); const chain = fakeChain();
    const node = newNode();
    fake.db.activity.push({ node: node.address, atMs: NOW - 3600_000, type: 'mapping-session', seconds: '2400' });
    mutate(fake.db);
    const row = claimRow(node); fake.db.reports.set(row.hash, row);
    const out = await reviewer(fake, { chain }).settleChallenges({ nowMs: NOW });
    assert.equal(out[0].status, 'rejected');
    assert.match(out[0].reasons[0], /unknown challenge/);
    assert.equal(chain.calls.length, 0);
  }
});
