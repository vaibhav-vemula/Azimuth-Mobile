'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  challengeFromRow, createChallengeSource, periodKey, previousPeriodKey, periodWindow, isClaimablePeriod, onchainHash, progressFor,
} = require('../lib/challenges');

const T = Date.UTC(2026, 9, 10, 15, 30); // Saturday 2026-10-10, ISO week 41

const row = (over = {}) => ({ id: 'scan-30', title: 'Scan for 30 minutes', blurb: 'b', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map', active: true, sort: 1, ...over });

test('rows become challenges and invalid rows are dropped', () => {
  assert.deepEqual(challengeFromRow(row()), { id: 'scan-30', title: 'Scan for 30 minutes', blurb: 'b', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go: 'Map' });
  assert.equal(challengeFromRow(row({ reward: 0 })), null);
  assert.equal(challengeFromRow(row({ reward: 101 })), null);
  assert.equal(challengeFromRow(row({ reward: 2.5 })), null);
  assert.equal(challengeFromRow(row({ goal: 0 })), null);
  assert.equal(challengeFromRow(row({ period: 'monthly' })), null);
  assert.equal(challengeFromRow(row({ metric: 'steps' })), null);
  assert.equal(challengeFromRow(row({ go_tab: 'Profile' })), null);
  assert.equal(challengeFromRow(row({ id: 'Bad Id' })), null);
  assert.equal(challengeFromRow(null), null);
});

test('the source caches, drops invalid rows, and survives a failed refresh', async () => {
  let calls = 0;
  let fail = false;
  const sink = { async listChallenges() { calls++; if (fail) throw new Error('down'); return [row(), row({ id: 'bad', reward: 0 })]; } };
  let t = 1000;
  const src = createChallengeSource({ sink, ttlMs: 60_000, now: () => t });
  assert.deepEqual((await src.list()).map((c) => c.id), ['scan-30']);
  assert.equal((await src.get('scan-30')).reward, 5);
  assert.equal(await src.get('bad'), null);
  assert.equal(calls, 1, 'cached');
  t += 61_000; fail = true;
  assert.deepEqual((await src.list()).map((c) => c.id), ['scan-30'], 'serves the last good list when refresh fails');
  const fresh = createChallengeSource({ sink: { async listChallenges() { throw new Error('down'); } } });
  await assert.rejects(fresh.list(), /down/);
});

test('period keys are UTC days and ISO weeks (shared vectors with the app)', () => {
  assert.equal(periodKey('daily', T), '2026-10-10');
  assert.equal(periodKey('daily', Date.UTC(2026, 9, 10, 23, 59, 59)), '2026-10-10');
  assert.equal(periodKey('daily', Date.UTC(2026, 9, 11, 0, 0, 0)), '2026-10-11');
  assert.equal(periodKey('weekly', T), '2026-W41');
  assert.equal(periodKey('weekly', Date.UTC(2026, 9, 12, 0, 0, 0)), '2026-W42'); // Monday
  assert.equal(periodKey('weekly', Date.UTC(2026, 9, 11, 23, 59, 59)), '2026-W41'); // Sunday
  assert.equal(periodKey('weekly', Date.UTC(2027, 0, 1)), '2026-W53'); // Fri 1 Jan 2027 belongs to 2026-W53
  assert.equal(periodKey('weekly', Date.UTC(2024, 11, 30)), '2025-W01'); // Mon 30 Dec 2024
  assert.equal(periodKey('once', T), 'once');
});

test('previous period and windows', () => {
  assert.equal(previousPeriodKey('daily', T), '2026-10-09');
  assert.equal(previousPeriodKey('weekly', T), '2026-W40');
  assert.equal(previousPeriodKey('once', T), 'once');
  assert.deepEqual(periodWindow('daily', '2026-10-10', T), { fromMs: Date.UTC(2026, 9, 10), toMs: Date.UTC(2026, 9, 11) });
  assert.deepEqual(periodWindow('weekly', '2026-W41', T), { fromMs: Date.UTC(2026, 9, 5), toMs: Date.UTC(2026, 9, 12) });
  assert.deepEqual(periodWindow('once', 'once', T), { fromMs: 0, toMs: T + 1 });
});

test('only the current or previous period can be claimed', () => {
  assert.ok(isClaimablePeriod('daily', '2026-10-10', T));
  assert.ok(isClaimablePeriod('daily', '2026-10-09', T));
  assert.ok(!isClaimablePeriod('daily', '2026-10-08', T));
  assert.ok(!isClaimablePeriod('daily', '2026-10-11', T), 'the future is refused');
  assert.ok(!isClaimablePeriod('daily', 'garbage', T));
  assert.ok(isClaimablePeriod('weekly', '2026-W41', T));
  assert.ok(isClaimablePeriod('weekly', '2026-W40', T));
  assert.ok(!isClaimablePeriod('weekly', '2026-W39', T));
  assert.ok(isClaimablePeriod('once', 'once', T));
  assert.ok(!isClaimablePeriod('once', '2026-10-10', T));
});

test('the on-chain hash is stable, 64 hex, and differs by id and period', () => {
  const a = onchainHash('scan-30', '2026-10-10');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, onchainHash('scan-30', '2026-10-10'));
  assert.notEqual(a, onchainHash('scan-30', '2026-10-11'));
  assert.notEqual(a, onchainHash('cells-20', '2026-10-10'));
  assert.equal(a, require('node:crypto').createHash('sha256').update('challenge:scan-30:2026-10-10').digest('hex'));
});

test('progress per metric', () => {
  const reports = [
    { type: 'mapping-session', seconds: '600' },
    { type: 'mapping-session', seconds: '1500' },
    { type: 'satellite-pass', seconds: '540' },
    { type: 'satellite-pass', seconds: null },
    { type: 'chest-claim', seconds: null },
  ];
  const rewards = [{ amount_usdc: 0.012 }, { amount_usdc: 0.008 }];
  const data = { reports, rewards };
  assert.equal(progressFor('mapping_minutes', data, 0.001), 35); // only mapping sessions, (600+1500)/60
  assert.equal(progressFor('satellite_passes', data, 0.001), 2);
  assert.equal(progressFor('chests_opened', data, 0.001), 1);
  assert.equal(progressFor('new_cells', data, 0.001), 20); // 0.020 / 0.001
  assert.equal(progressFor('mapping_minutes', { reports: [], rewards: [] }, 0.001), 0);
  assert.equal(progressFor('mapping_minutes', { reports: [{ type: 'mapping-session', seconds: 'abc' }], rewards: [] }, 0.001), 0);
  assert.throws(() => progressFor('bogus', data, 0.001), /unknown metric/);
});
