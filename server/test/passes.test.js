'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { createService } = require('../lib/service');
const { maxElevationDeg } = require('../lib/orbit');
const { cellIdAt, cellCenter } = require('../public/hex.js');
const { newNode, bucket, signedReport } = require('./helpers');
const TLES = require('./fixtures');

// Washington, DC, and a search window starting at the TLE epoch.
const DC = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
const EPOCH = Date.UTC(2026, 9, 2, 14, 17, 0);
const CELL = cellIdAt(DC.latitudeDeg, DC.longitudeDeg);

/** Finds a real pass of the satellite over DC within a day of the epoch by scanning the orbit. */
function findPass(norad, minPeak = 25) {
  const center = cellCenter(CELL);
  for (let t = EPOCH; t < EPOCH + 24 * 3600_000; t += 60_000) {
    const e = maxElevationDeg(TLES[norad], center, t, t + 60_000, 30);
    if (e > 0) {
      // Expand to the whole pass.
      let start = t;
      while (maxElevationDeg(TLES[norad], center, start - 30_000, start, 10) > 0) start -= 30_000;
      let end = t;
      while (maxElevationDeg(TLES[norad], center, end, end + 30_000, 10) > 0) end += 30_000;
      const peak = maxElevationDeg(TLES[norad], center, start, end, 5);
      if (peak >= minPeak && end - start > 300_000) return { startMs: start, endMs: end, peak };
      t = end + 60_000;
    }
  }
  throw new Error('no pass found in the fixture window');
}

function passReport(node, norad, window, over = {}) {
  const startMs = window.startMs;
  const endMs = window.endMs;
  const sampleRateHz = 2_304_000;
  const samples = Math.round(((endMs - startMs) / 1000) * sampleRateHz);
  const b = bucket(CELL, endMs, { samples: 1, cellular: { seen: 0, none: 0, bestDbmSum: 0, bestDbmMin: 0, bestDbmMax: -200, maxCells: 0, techs: [] }, wifi: { samples: 0, countSum: 0, countMax: 0, strongestDbmMax: null }, bluetooth: { samples: 0, countSum: 0, countMax: 0 }, gnss: { samples: 0, cn0Sum: 0, usedSum: 0 } });
  return signedReport(node, [b], {
    type: 'satellite-pass',
    pass: {
      noradId: norad, startMs, endMs, maxElevationDeg: Math.round(window.peak),
      frequencyHz: 137_900_000, gainDb: 28.0, signalSnrDb: 9,
      recording: { bytes: samples * 2, samples, droppedBlocks: 0, sampleRateHz, format: 'fullband' },
      ...over,
    },
    checks: { samples: 1, mockedFixes: 0, poorAccuracyFixes: 0, maxSpeedMps: 0, durationSec: Math.round((endMs - startMs) / 1000) },
  });
}

const fresh = (now) => {
  const store = openStore(':memory:');
  return createService(store, { now: () => now, tleFor: (n) => TLES[n] || null });
};

test('accepts a pass that matches the orbit', async () => {
  const w = findPass('59051');
  const service = fresh(w.endMs + 60_000);
  const out = await service.submitReport(passReport(newNode(), '59051', w));
  assert.equal(out.accepted, true, out.reasons.join('; '));
});

test('rejects a pass claimed for a time the satellite was not overhead', async () => {
  const w = findPass('59051');
  const shifted = { startMs: w.startMs + 6 * 3600_000, endMs: w.endMs + 6 * 3600_000, peak: w.peak };
  const service = fresh(shifted.endMs + 60_000);
  const out = await service.submitReport(passReport(newNode(), '59051', shifted));
  assert.equal(out.accepted, false);
  assert.match(out.reasons.join(), /not above the horizon|peak elevation/);
});

test('rejects a peak elevation that does not match the orbit', async () => {
  const w = findPass('59051', 15);
  const service = fresh(w.endMs + 60_000);
  const out = await service.submitReport(passReport(newNode(), '59051', { ...w, peak: w.peak > 50 ? w.peak - 40 : w.peak + 40 }));
  assert.equal(out.accepted, false);
  assert.match(out.reasons.join(), /does not match the orbit/);
});

test('rejects unsupported satellites, empty recordings and fabricated sizes', async () => {
  const w = findPass('59051');
  const service = fresh(w.endMs + 60_000);
  assert.match((await service.submitReport(passReport(newNode(), '25544', w))).reasons.join(), /not supported/);
  const tiny = passReport(newNode(), '59051', w, { recording: { bytes: 10, samples: 0, droppedBlocks: 0, sampleRateHz: 2_304_000, format: 'fullband' } });
  assert.match((await service.submitReport(tiny)).reasons.join(), /empty/);
  const lie = passReport(newNode(), '59051', w, { recording: { bytes: 5000, samples: Math.round(((w.endMs - w.startMs) / 1000) * 2_304_000), droppedBlocks: 0, sampleRateHz: 2_304_000, format: 'fullband' } });
  assert.match((await service.submitReport(lie)).reasons.join(), /does not match its sample count/);
});

test('fails closed when there is no orbit data', async () => {
  const w = findPass('59051');
  const service = createService(openStore(':memory:'), { now: () => w.endMs + 60_000, tleFor: () => null });
  const out = await service.submitReport(passReport(newNode(), '59051', w));
  assert.equal(out.accepted, false);
  assert.match(out.reasons.join(), /no orbit data/);
});

test('a satellite raid chest pays each receiver once and checks the satellite, window and place', async () => {
  const w = findPass('59051');
  const now = w.endMs + 60_000;
  const store = openStore(':memory:');
  const service = createService(store, { now: () => now, tleFor: (n) => TLES[n] || null });
  // The chest must exist before the pass for the pass to count, so create it with an earlier clock.
  const early = createService(store, { now: () => w.startMs - 3600_000, tleFor: (n) => TLES[n] || null });
  const made = early.createBounty({
    title: 'Meteor-M2 4 raid', kind: 'satellite-pass', cellId: CELL, rewardUsdc: 2, maxFills: 2,
    expiresMs: w.endMs + 86_400_000, requester: 'club', spec: { noradId: '59051', windowStartMs: w.startMs - 60_000, windowEndMs: w.endMs + 60_000 },
  });
  assert.equal(made.ok, true);
  assert.equal(early.listBounties()[0].requires, 'dongle');

  const claim = (node, norad = '59051') => {
    const env = passReport(node, norad, w);
    env.report.chest = { id: made.id, cellId: CELL };
    return require('./helpers').resign(env, node);
  };

  const a = newNode();
  const ok = await service.submitReport(claim(a));
  assert.equal(ok.accepted, true, ok.reasons.join('; '));
  assert.equal(ok.reward.chestUsdc, 2);

  const dup = await service.submitReport(claim(a));
  assert.equal(dup.accepted, false);

  const wrongSat = await service.submitReport(claim(newNode(), '57166'));
  assert.equal(wrongSat.accepted, false);
});
