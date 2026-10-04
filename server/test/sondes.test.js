'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { createService } = require('../lib/service');
const { landedSondes, syncSondes } = require('../lib/sondes');
const { cellIdAt } = require('../public/hex.js');
const { newNode, bucket, signedReport } = require('./helpers');

const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);
const frame = (over = {}) => ({
  datetime: new Date(NOW - 40 * 60_000).toISOString(), lat: 39.09, lon: -76.26, alt: 480, vel_v: -5, frequency: 403.0002,
  type: 'RS41', ...over,
});

test('picks sondes that have landed and ignores the rest', () => {
  const all = {
    landed: frame(),
    stillHigh: frame({ alt: 21000 }),
    climbing: frame({ vel_v: 5 }),
    justSeen: frame({ datetime: new Date(NOW - 2 * 60_000).toISOString() }),
    ancient: frame({ datetime: new Date(NOW - 5 * 24 * 3600_000).toISOString() }),
    wrongBand: frame({ frequency: 433.9 }),
    broken: { datetime: 'nonsense' },
  };
  const picked = landedSondes(all, NOW);
  assert.deepEqual(picked.map((s) => s.serial), ['landed']);
  assert.equal(picked[0].frequencyHz, 403_000_200);
});

function setup(sondes) {
  const store = openStore(':memory:');
  const service = createService(store, { now: () => NOW });
  const fetchImpl = async () => ({ ok: true, json: async () => sondes });
  return { store, service, fetchImpl };
}

test('creates one chest per landed sonde, only once, within the region and daily cap', async () => {
  const { store, service, fetchImpl } = setup({ A1: frame(), A2: frame({ lat: 39.1 }), FAR: frame({ lat: 45, lon: -100 }) });
  const region = { lat: 39.0, lon: -76.3, radiusKm: 100 };
  const first = await syncSondes({ service, store, region, now: NOW, fetchImpl });
  assert.deepEqual(first.map((c) => c.serial).sort(), ['A1', 'A2']);
  const again = await syncSondes({ service, store, region, now: NOW, fetchImpl });
  assert.equal(again.length, 0, 'each balloon is offered once');
  const chest = service.listBounties().find((b) => b.spec.serial === 'A1');
  assert.equal(chest.kind, 'sonde');
  assert.equal(chest.requires, 'dongle');
  assert.equal(chest.spec.frequencyHz, 403_000_200);

  const capped = setup({ B1: frame(), B2: frame({ lat: 39.1 }), B3: frame({ lat: 39.2 }) });
  const made = await syncSondes({ ...capped, region, now: NOW, options: { maxChestsPerDay: 2 } });
  assert.equal(made.length, 2);
});

test('surfaces HTTP failures instead of hiding them', async () => {
  const { store, service } = setup({});
  await assert.rejects(syncSondes({ service, store, region: { lat: 0, lon: 0, radiusKm: 10 }, fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
});

test('pays a sonde chest only when the sonde was heard near the landing, on its frequency', async () => {
  const { store, service, fetchImpl } = setup({ A1: frame() });
  await syncSondes({ service, store, region: { lat: 39.0, lon: -76.3, radiusKm: 100 }, now: NOW, fetchImpl });
  const chest = service.listBounties()[0];
  const cell = chest.cellId;
  const sonde = (over = {}) => ({ frequencyHz: 403_000_200, samples: 3, detected: 2, peakDbMax: 14, rmsMax: 0.1, clipMax: 0, gainDb: 28, ...over });
  const claim = (node, buckets) =>
    signedReport(node, buckets, { type: 'chest-claim', chest: { id: chest.id, cellId: cell } });

  const silent = await service.submitReport(claim(newNode(), [bucket(cell, NOW + 60_000)]));
  assert.match(silent.reasons.join(), /not heard/);

  const wrongFreq = await service.submitReport(claim(newNode(), [bucket(cell, NOW + 60_000, { sonde: sonde({ frequencyHz: 404_500_000 }) })]));
  assert.match(wrongFreq.reasons.join(), /not heard/);

  const nothing = await service.submitReport(claim(newNode(), [bucket(cell, NOW + 60_000, { sonde: sonde({ detected: 0 }) })]));
  assert.match(nothing.reasons.join(), /not heard/);

  const far = await service.submitReport(claim(newNode(), [bucket(cellIdAt(39.5, -76.26), NOW + 60_000, { sonde: sonde() })]));
  assert.equal(far.accepted, false);

  const ok = await service.submitReport(claim(newNode(), [bucket(cell, NOW + 60_000, { sonde: sonde() })]));
  assert.equal(ok.accepted, true, ok.reasons.join('; '));
  assert.equal(ok.reward.chestUsdc, 0.25);
  assert.equal(service.listBounties().length, 0, 'a recovered sonde closes its chest');
});

test('rejects sonde readings that are not physical', async () => {
  const { service } = setup({});
  const bad = { frequencyHz: 433_000_000, samples: 1, detected: 1, peakDbMax: 10, rmsMax: 0.1, clipMax: 0, gainDb: 28 };
  const out = await service.submitReport(signedReport(newNode(), [bucket('h120:1:1', NOW - 3600_000, { sonde: bad })]));
  assert.match(out.reasons.join(), /400 to 406/);
});
