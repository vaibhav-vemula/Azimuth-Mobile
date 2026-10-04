'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { createService } = require('../lib/service');
const { newNode, bucket, signedReport, signText } = require('./helpers');

const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);
const fresh = (options) => {
  const store = openStore(':memory:');
  return { store, service: createService(store, { now: () => NOW, ...options }) };
};

test('accepts a valid session and pays for new cells once', async () => {
  const { service } = fresh();
  const node = newNode();
  const env = signedReport(node, [bucket('h120:1:1', NOW - 3600_000), bucket('h120:1:2', NOW - 3600_000)]);
  const out = await service.submitReport(env);
  assert.equal(out.accepted, true, out.reasons.join('; '));
  assert.equal(out.reward.newCells, 2);
  assert.equal(out.reward.subsidyUsdc, 0.002);

  const again = signedReport(node, [bucket('h120:1:1', NOW - 1800_000)]);
  const out2 = await service.submitReport(again);
  assert.equal(out2.accepted, true);
  assert.equal(out2.reward.newCells, 0, 'a known cell earns nothing');
  assert.equal(service.nodeSummary(node.address).totalUsdc, 0.002);
  assert.deepEqual(service.knownCells().sort(), ['h120:1:1', 'h120:1:2']);
});

test('rejects an exact resubmission', async () => {
  const { service } = fresh();
  const env = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]);
  assert.equal((await service.submitReport(env)).accepted, true);
  const second = await service.submitReport(env);
  assert.equal(second.accepted, false);
  assert.match(second.reasons[0], /already submitted/);
});

test('rejects a tampered report and one with a forged signature', async () => {
  const { service } = fresh();
  const env = signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]);
  env.report.buckets[0].samples = 50;
  const out = await service.submitReport(env);
  assert.equal(out.accepted, false);
});

test('rejects mock locations, teleporting, and impossible levels', async () => {
  const { service } = fresh();
  const node = newNode();
  const mocked = signedReport(node, [bucket('h120:1:1', NOW - 3600_000)], { checks: { samples: 3, mockedFixes: 2, poorAccuracyFixes: 0, maxSpeedMps: 1, durationSec: 60 } });
  assert.match((await service.submitReport(mocked)).reasons.join(), /mock/);

  const fast = signedReport(node, [bucket('h120:1:2', NOW - 3600_000)], { checks: { samples: 3, mockedFixes: 0, poorAccuracyFixes: 0, maxSpeedMps: 400, durationSec: 60 } });
  assert.match((await service.submitReport(fast)).reasons.join(), /speed/);

  const silly = signedReport(node, [bucket('h120:1:3', NOW - 3600_000, { cellular: { seen: 3, none: 0, bestDbmSum: -30, bestDbmMin: -10, bestDbmMax: -10, maxCells: 1, techs: [] } })]);
  assert.match((await service.submitReport(silly)).reasons.join(), /not physical/);
});

test('rejects stale and future buckets', async () => {
  const { service } = fresh();
  const old = signedReport(newNode(), [bucket('h120:1:1', NOW - 10 * 24 * 3600_000)]);
  assert.match((await service.submitReport(old)).reasons.join(), /older/);
  const future = signedReport(newNode(), [bucket('h120:1:1', NOW + 3600_000)]);
  assert.match((await service.submitReport(future)).reasons.join(), /future/);
});

test('caps the daily new-cell subsidy', async () => {
  const { service } = fresh({ config: { dailyNewCellCap: 2 } });
  const node = newNode();
  const buckets = [1, 2, 3, 4].map((i) => bucket(`h120:${i}:0`, NOW - 3600_000));
  const out = await service.submitReport(signedReport(node, buckets));
  assert.equal(out.accepted, true);
  assert.equal(out.reward.newCells, 4);
  assert.equal(out.reward.paidCells, 2);
});

test('limits reports per node per hour', async () => {
  const { service } = fresh({ config: { maxReportsPerHour: 2 } });
  const node = newNode();
  for (let i = 0; i < 2; i++) assert.equal((await service.submitReport(signedReport(node, [bucket(`h120:${i}:9`, NOW - 3600_000)]))).accepted, true);
  const third = await service.submitReport(signedReport(node, [bucket('h120:5:9', NOW - 3600_000)]));
  assert.match(third.reasons.join(), /too many/);
});

test('can require an eligible node (for example a Seeker Genesis Token)', async () => {
  const { service } = fresh({ checkNode: async () => ({ ok: false, reason: 'no Seeker Genesis Token' }) });
  const out = await service.submitReport(signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000)]));
  assert.equal(out.accepted, false);
  assert.match(out.reasons[0], /Seeker Genesis/);
});

function openChest(service, over = {}) {
  const r = service.createBounty({
    title: 'Cafe Wi-Fi quality', kind: 'wifi-quality', cellId: 'h120:5:5', rewardUsdc: 0.5, maxFills: 1,
    expiresMs: NOW + 86_400_000, requester: 'cafe', ...over,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.id;
}

const claim = (node, id, cellId, buckets) =>
  signedReport(node, buckets, { type: 'chest-claim', chest: { id, cellId } });

test('pays a chest once, then closes it', async () => {
  const { service } = fresh();
  const id = openChest(service);
  const a = newNode();
  const out = await service.submitReport(claim(a, id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000)]));
  assert.equal(out.accepted, true, out.reasons.join('; '));
  assert.equal(out.reward.chestUsdc, 0.5);
  assert.equal(service.listBounties().length, 0, 'a filled chest disappears');

  const b = newNode();
  const late = await service.submitReport(claim(b, id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000)]));
  assert.match(late.reasons.join(), /no longer open/);
});

test('refuses a chest claim from the wrong place, with too few readings, or twice', async () => {
  const { service } = fresh();
  const id = openChest(service, { maxFills: 5 });
  const node = newNode();

  const away = await service.submitReport(claim(node, id, 'h120:5:5', [bucket('h120:30:30', NOW + 60_000)]));
  assert.match(away.reasons.join(), /at least|readings/);

  const thin = await service.submitReport(claim(node, id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000, { samples: 1, wifi: { samples: 1, countSum: 3, countMax: 3, strongestDbmMax: -50 }, cellular: { seen: 1, none: 0, bestDbmSum: -90, bestDbmMin: -90, bestDbmMax: -90, maxCells: 1, techs: ['lte'] }, bluetooth: { samples: 0, countSum: 0, countMax: 0 }, gnss: { samples: 1, cn0Sum: 30, usedSum: 8 } })]));
  assert.match(thin.reasons.join(), /at least 3/);

  const ok = await service.submitReport(claim(node, id, 'h120:5:5', [bucket('h120:5:6', NOW + 60_000)]));
  assert.equal(ok.accepted, true, 'a neighbouring cell counts');
  const twice = await service.submitReport(claim(node, id, 'h120:5:5', [bucket('h120:5:5', NOW + 90_000)]));
  assert.match(twice.reasons.join(), /already opened/);
});

test('a radio chest is paid when the report carries dongle readings', async () => {
  const { service } = fresh();
  const id = openChest(service, { kind: 'weather-radio', title: 'NOAA reception' });
  const radio = { samples: 3, carriers: 2, peakDbSum: 30, peakDbMax: 14, rmsSum: 0.3, rmsMax: 0.12, clipMax: 0, gainDb: 28 };
  const out = await service.submitReport(claim(newNode(), id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000, { radio })]));
  assert.equal(out.accepted, true, out.reasons.join('; '));
  assert.equal(out.reward.chestUsdc, 0.5);
});

test('rejects radio readings that are not physical', async () => {
  const { service } = fresh();
  const bad = { samples: 3, carriers: 5, peakDbSum: 30, peakDbMax: 14, rmsSum: 0.3, rmsMax: 0.12, clipMax: 0, gainDb: 28 };
  const out = await service.submitReport(signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000, { radio: bad })]));
  assert.match(out.reasons.join(), /carriers/);
  const loud = { samples: 3, carriers: 1, peakDbSum: 30, peakDbMax: 500, rmsSum: 0.3, rmsMax: 0.12, clipMax: 0, gainDb: 28 };
  const out2 = await service.submitReport(signedReport(newNode(), [bucket('h120:1:2', NOW - 3600_000, { radio: loud })]));
  assert.match(out2.reasons.join(), /not physical/);
});

test('a venue visit chest requires hearing the venue tag', async () => {
  const { service } = fresh();
  const id = openChest(service, { kind: 'visit', title: 'Visit Main St Cafe', spec: { beaconName: 'azm-cafe-17', minRssi: -85 } });
  const none = await service.submitReport(claim(newNode(), id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000)]));
  assert.match(none.reasons.join(), /venue tag was not heard/);

  const faint = { name: 'azm-cafe-17', samples: 2, seen: 1, rssiMax: -95 };
  const weak = await service.submitReport(claim(newNode(), id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000, { beacon: faint })]));
  assert.match(weak.reasons.join(), /not heard/);

  const wrong = { name: 'azm-other', samples: 2, seen: 2, rssiMax: -60 };
  const other = await service.submitReport(claim(newNode(), id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000, { beacon: wrong })]));
  assert.match(other.reasons.join(), /not heard/);

  const good = { name: 'azm-cafe-17', samples: 3, seen: 2, rssiMax: -62 };
  const ok = await service.submitReport(claim(newNode(), id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000, { beacon: good })]));
  assert.equal(ok.accepted, true, ok.reasons.join('; '));
});

test('beacon counts must be consistent', async () => {
  const { service } = fresh();
  const bad = { name: 'x', samples: 2, seen: 5, rssiMax: -60 };
  const out = await service.submitReport(signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000, { beacon: bad })]));
  assert.match(out.reasons.join(), /beacon counts/);
});

test('radio chests need radio readings', async () => {
  const { service } = fresh();
  const id = openChest(service, { kind: 'weather-radio', title: 'NOAA reception' });
  assert.equal(service.listBounties()[0].requires, 'dongle');
  const out = await service.submitReport(claim(newNode(), id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000)]));
  assert.match(out.reasons.join(), /dongle/);
});

test('rejects expired chests and invalid bounty input', async () => {
  const store = openStore(':memory:');
  const early = createService(store, { now: () => NOW });
  assert.equal(early.createBounty({ title: '', kind: 'x', cellId: 'bad', rewardUsdc: -1, maxFills: 0, expiresMs: 0, requester: '' }).ok, false);
  const id = openChest(early, { expiresMs: NOW + 1000 });

  // Two minutes later the chest has expired, though readings are recent enough to be plausible.
  const later = createService(store, { now: () => NOW + 120_000 });
  const out = await later.submitReport(claim(newNode(), id, 'h120:5:5', [bucket('h120:5:5', NOW + 60_000)]));
  assert.match(out.reasons.join(), /expired/);
  assert.equal(later.listBounties().length, 0);
});

test('erases a node\'s readings on its own signed request, and only then', async () => {
  const { store, service } = fresh();
  const node = newNode();
  const other = newNode();
  assert.equal((await service.submitReport(signedReport(node, [bucket('h120:1:1', NOW - 3600_000), bucket('h120:1:2', NOW - 3600_000)]))).accepted, true);
  assert.equal((await service.submitReport(signedReport(other, [bucket('h120:7:7', NOW - 3600_000)]))).accepted, true);
  assert.equal(service.cellHistory('h120:1:1').length, 1);

  const message = `azimuth-delete-v1\n${node.address}\n${NOW}`;
  // Someone else cannot erase it, and neither can a stale request.
  assert.equal(service.deleteNodeData(node.address, NOW, signText(other, message)).ok, false);
  assert.equal(service.deleteNodeData(node.address, NOW - 3600_000, signText(node, `azimuth-delete-v1\n${node.address}\n${NOW - 3600_000}`)).ok, false);
  assert.equal(service.cellHistory('h120:1:1').length, 1, 'nothing was deleted by the failed attempts');

  const done = service.deleteNodeData(node.address, NOW, signText(node, message));
  assert.deepEqual(done, { ok: true, deletedBuckets: 2, deletedReports: 1 });
  assert.equal(service.cellHistory('h120:1:1').length, 0);
  assert.equal(service.cellHistory('h120:7:7').length, 1, 'other nodes are untouched');
  const kept = store.db.prepare('SELECT body FROM reports WHERE node = ?').get(node.address).body;
  assert.equal(kept, '{"deleted":true}');
  assert.ok(service.nodeSummary(node.address).totalUsdc > 0, 'earnings records stay so payouts are not lost');
});
