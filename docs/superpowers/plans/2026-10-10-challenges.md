# Challenges (Quests) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Quests tab that tracks daily, weekly and one-time challenges automatically, lets the user claim a finished one with one wallet signature, and pays AZMTest (on-chain `reward`, kind 3) automatically after the server re-checks the claim against the wallet's already-verified reports.

**Architecture:** The challenge list lives in a Supabase table `challenges` that you edit (Supabase table editor); the server reads it with the service key and the app fetches it with the public key, so challenges change without an app update. The app computes live progress for display only. A claim is a signed `challenge-claim` report inserted into Supabase like any report; the admin portal process settles new claims on a timer: it recomputes progress from the wallet's verified reports and reward rows, then verifies and pays through the existing `payOnChain`, or rejects with the numbers. Once per challenge and period is enforced by the server (duplicate check) and on-chain (the registry record hash is derived from challenge id and period).

**Tech Stack:** Node 22 `node:test` (server), Supabase REST/PostgREST + SQL, Expo/React Native + TypeScript + Jest (app), existing `azimuth_registry` program and `chain.js`.

**Spec:** `docs/superpowers/specs/2026-10-10-challenges-design.md`

## Global Constraints

- Devnet only. Rewards are whole AZMTest (0 decimals), each at most 100 (the on-chain cap) and at least 1.
- Reward flow: **Claim, then paid automatically** after the server check. No admin click, but only while the admin portal process is running; nothing is paid when it is off or when no chain is configured (claims then stay `new`).
- The server never trusts the phone's numbers: progress is recomputed from `reports` with `status = 'verified'` (by `verified_at`) and `rewards` rows of kind `new-cells`.
- Periods are **UTC**: a day is a UTC calendar day (`2026-10-10`), a week is an ISO week Monday to Sunday UTC (`2026-W41`), one-time is `once`. A claim's period must be the current period or the one just before it (grace for late claims); `once` is always valid.
- Once per challenge and period: the on-chain `report_hash` for a claim is `sha256("challenge:" + id + ":" + period)` (hex), not the claim's own hash; the server also refuses a claim when a verified claim for the same wallet, id and period exists.
- Kinds on-chain: 3 = challenge (already supported by the program). No program change, no redeploy.
- Tab name **Quests**. Sonde challenge is out of v1.
- The list is the table `public.challenges` (columns `id, title, blurb, period, metric, goal, reward, go_tab, active, sort`), seeded by `schema_challenges.sql` with five rows: `scan-30`, `cells-20`, `ground-weekly`, `passes-3`, `first-chest`. The public key may only SELECT active rows; only the service key writes. Challenge values are validated on both sides (known period/metric/go_tab, whole reward 1..100, positive goal); an invalid row is ignored, never paid. Changing `goal` or `reward` of a challenge affects claims settled after the change.
- Ruling carried into this plan: the spec's "1 square mile of new ground" is implemented as **70 new cells** (metric `new_cells`, goal 70). One map-grid cell is 120 m (circumradius) = about 0.0374 km² on the projected grid, so 70 cells is about 2.6 km² (1 square mile) on the grid; real ground area is smaller at mid latitudes (about 0.6 of that at Washington, DC). The title says "about a square mile on the map grid". Cost if wrong: only the wording; the goal is a clean cell count both sides can verify.
- **Git:** one commit per task, made by the controller after the task is reviewed. Implementers do NOT run `git add`/`git commit`. Never add a co-author line or trailers. Never touch `.git` otherwise.
- Secrets stay out of git; `server/.env` stays untracked.
- Whoever runs the SQL (`server/supabase/schema_challenges.sql`) is the user, in the Supabase SQL editor.

## Review Focus

- **Claim for a period that is too old / in the future / made up** (clock wrong, replayed claim): must be rejected with a clear reason and never paid. Tested in `challenges.test.js` and `review.test.js`.
- **Claim made before the reports were verified** ("23 of 30 minutes"): rejected with the real numbers and claimable again later; never paid early. Tested.
- **Same claim twice (double tap, second device, retry after confirm timeout)**: pays once. Tested (duplicate verified claim, on-chain hash derivation, `existed` path).
- **Chain failure, paused registry, or no chain configured**: failure keeps the claim verified-but-unpaid with a retry that uses the derived hash; no chain leaves claims `new` and unpaid. Tested.
- **Claims leaking into the manual review list**: `challenge-claim` rows must never appear in "Waiting for review", in `run({auto})`, or be approvable as mapping reports. Tested in `supabase.test.js` and `review.test.js`.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/supabase/schema_challenges.sql` | `challenges` table (+ seed, read-only for the public key), `reports.type`, `node_summary` |
| `server/lib/challenges.js` | Row validation, cached challenge source, period keys and windows (UTC), on-chain hash, `progressFor` |
| `server/lib/verify-report.cjs` | Add `verifyClaim(envelope)` |
| `server/lib/azmRewards.js` | `kindFor('challenge-claim') = 3` |
| `server/lib/supabase.js` | `listNewClaims`, `findVerifiedClaim`, `listVerifiedActivity`, `listNewCellRewards`; `listNewReports` excludes claims |
| `server/lib/review.js` | `settleChallenges`, claim retry with derived hash |
| `server/admin/app.js`, `admin.html`, `admin.js`, `index.js` | Timer, manual "Check challenge claims" |
| `src/challenges/definitions.ts` (types + row mapping), `periods.ts`, `progress.ts`, `claim.ts`, `useChallenges.ts` | App logic |
| `src/screens/quests/QuestsScreen.tsx` | The tab |
| `src/navigation/*`, `src/network/*` | Tab, summary fields, claim insert |

---

### Task 1: Server challenge source, periods and progress

**Files:**
- Create: `server/lib/challenges.js`
- Test: `server/test/challenges.test.js`

**Interfaces:**
- Produces (`server/lib/challenges.js`):
  - `challengeFromRow(row): Challenge | null` where `Challenge = { id, title, blurb, period: 'daily'|'weekly'|'once', metric: 'mapping_minutes'|'new_cells'|'satellite_passes'|'chests_opened', goal: number, reward: number, go: 'Map'|'Satellites' }`; the row has `go_tab`; returns `null` when invalid (unknown period/metric/go_tab, id not `/^[a-z0-9-]{1,40}$/`, goal not a positive number, reward not an integer 1..100)
  - `createChallengeSource({ sink, ttlMs = 60_000, now = Date.now }): { list(): Promise<Challenge[]>, get(id): Promise<Challenge | null> }` — reads `sink.listChallenges()`, drops invalid rows, caches for `ttlMs`; if a refresh fails it keeps serving the last good list, and throws only when it has never loaded one
  - `periodKey(period, ms): string`  (`'2026-10-10'`, `'2026-W41'`, `'once'`)
  - `previousPeriodKey(period, ms): string`
  - `periodWindow(period, key, nowMs): { fromMs, toMs }`  (`toMs` exclusive; for `once`: `{0, nowMs + 1}`)
  - `isClaimablePeriod(period, key, nowMs): boolean` (current or previous key)
  - `onchainHash(id, key): string` (64 hex)
  - `progressFor(metric, { reports, rewards }, newCellUsdc): number` where `reports = [{ type, seconds }]`, `rewards = [{ amount_usdc }]`

- [ ] **Step 1: Write the failing test** `server/test/challenges.test.js`

```js
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
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && node --test test/challenges.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `server/lib/challenges.js`**

```js
'use strict';
const crypto = require('node:crypto');

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const PERIODS = ['daily', 'weekly', 'once'];
const METRICS = ['mapping_minutes', 'new_cells', 'satellite_passes', 'chests_opened'];
const TABS = ['Map', 'Satellites'];

/** A `challenges` table row as a challenge, or null when anything about it is off (an invalid row is never paid). */
function challengeFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const ok =
    typeof row.id === 'string' && /^[a-z0-9-]{1,40}$/.test(row.id) &&
    typeof row.title === 'string' && row.title.length > 0 &&
    PERIODS.includes(row.period) && METRICS.includes(row.metric) && TABS.includes(row.go_tab) &&
    Number.isFinite(Number(row.goal)) && Number(row.goal) > 0 &&
    Number.isInteger(Number(row.reward)) && Number(row.reward) >= 1 && Number(row.reward) <= 100;
  if (!ok) return null;
  return { id: row.id, title: row.title, blurb: String(row.blurb || ''), period: row.period, metric: row.metric, goal: Number(row.goal), reward: Number(row.reward), go: row.go_tab };
}

/** The server's view of the challenge list: read from the table, validated, and cached briefly. */
function createChallengeSource({ sink, ttlMs = 60_000, now = Date.now }) {
  let cached = null;
  let loadedAt = 0;
  async function list() {
    if (cached && now() - loadedAt < ttlMs) return cached;
    try {
      cached = (await sink.listChallenges()).map(challengeFromRow).filter(Boolean);
      loadedAt = now();
    } catch (e) {
      if (!cached) throw e;
      loadedAt = now(); // keep serving the last good list and try again after the next interval
    }
    return cached;
  }
  return { list, async get(id) { return (await list()).find((c) => c.id === id) || null; } };
}

/** ISO week of a UTC instant: the year the week belongs to and its number. */
function isoWeek(ms) {
  const d = new Date(ms);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const mondayIndex = (new Date(t).getUTCDay() + 6) % 7;
  const thursday = t + (3 - mondayIndex) * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return { year, week };
}

function periodKey(period, ms) {
  if (period === 'daily') return new Date(ms).toISOString().slice(0, 10);
  if (period === 'weekly') {
    const { year, week } = isoWeek(ms);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  return 'once';
}

function previousPeriodKey(period, ms) {
  if (period === 'daily') return periodKey('daily', ms - DAY);
  if (period === 'weekly') return periodKey('weekly', ms - WEEK);
  return 'once';
}

function periodWindow(period, key, nowMs) {
  if (period === 'once') return { fromMs: 0, toMs: nowMs + 1 };
  if (period === 'daily') {
    const from = Date.parse(`${key}T00:00:00Z`);
    return { fromMs: from, toMs: from + DAY };
  }
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  const from = week1Monday + (Number(m[2]) - 1) * WEEK;
  return { fromMs: from, toMs: from + WEEK };
}

function isClaimablePeriod(period, key, nowMs) {
  if (typeof key !== 'string') return false;
  return key === periodKey(period, nowMs) || key === previousPeriodKey(period, nowMs);
}

/** What goes on-chain as the report hash of a claim, so the registry refuses a second payment for the same period. */
const onchainHash = (id, key) => crypto.createHash('sha256').update(`challenge:${id}:${key}`).digest('hex');

/**
 * Progress from the wallet's verified reports in the period. `reports` rows are { type, seconds } (seconds is the
 * report's checks.durationSec as text or null); `rewards` rows are the 'new-cells' reward rows { amount_usdc }.
 */
function progressFor(metric, { reports, rewards }, newCellUsdc) {
  switch (metric) {
    case 'mapping_minutes': {
      const sec = reports.filter((r) => r.type === 'mapping-session').reduce((n, r) => n + (Number.isFinite(Number(r.seconds)) ? Number(r.seconds) : 0), 0);
      return Math.floor(sec / 60);
    }
    case 'satellite_passes': return reports.filter((r) => r.type === 'satellite-pass').length;
    case 'chests_opened': return reports.filter((r) => r.type === 'chest-claim').length;
    case 'new_cells': return Math.round(rewards.reduce((n, r) => n + Number(r.amount_usdc), 0) / newCellUsdc);
    default: throw new Error(`unknown metric ${metric}`);
  }
}

module.exports = { challengeFromRow, createChallengeSource, periodKey, previousPeriodKey, periodWindow, isClaimablePeriod, onchainHash, progressFor };
```

If the test's `mapping_minutes` case `(600+1500)/60 = 35` passes with `Math.floor`, the vector `2026-W53` for 1 Jan 2027 and `2025-W01` for 30 Dec 2024 must also pass; if a vector disagrees with the implementation, check the vector against the ISO 8601 rule (week with the year's first Thursday is week 1) before changing code.

- [ ] **Step 3b: Run to confirm it passes**

Run: `cd server && node --test test/challenges.test.js`
Expected: 7 passing.

- [ ] **Step 4: Checkpoint** — run `cd server && npm test` (all green) and report. Do not commit.

---

### Task 2: `verifyClaim` and the challenge-claim kind

**Files:**
- Modify: `server/lib/verify-report.cjs`
- Modify: `server/lib/azmRewards.js`
- Test: `server/test/claim.test.js`, and a line in `server/test/azmRewards.test.js`

**Interfaces:**
- Produces:
  - `verifyClaim(envelope): { valid: boolean, problems: string[], hash?: string, node?: string }` — envelope `{ report: { version: 1, type: 'challenge-claim', node, challengeId, period, claimedMs }, signature, hash }`; same canonical hashing and ed25519 signature check as `verifyEnvelope` (same `SIGNING_PREFIX`), but no buckets requirement. Exported from `verify-report.cjs`.
  - `kindFor('challenge-claim') === 3`; `azmAmount({ type: 'challenge-claim', ... })` stays `0` (the amount comes from the challenge definition).
- Consumes: `canonicalize`, `base58Decode`, `SPKI_PREFIX`, `SIGNING_PREFIX` already in `verify-report.cjs`; test helpers `newNode`, `signText` in `server/test/helpers.js` (read it first for how a node signs; if there is no raw `sign(node, message)` helper, add one there that signs `SIGNING_PREFIX + canonicalize(report)` with the node's private key and returns base64).

- [ ] **Step 1: Failing tests** `server/test/claim.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyClaim, canonicalize } = require('../lib/verify-report.cjs');
const { newNode } = require('./helpers');

/** Builds a signed claim the same way the app does. `node` is a helper node that can sign. */
function signedClaim(node, over = {}) {
  const report = { version: 1, type: 'challenge-claim', node: node.address, challengeId: 'scan-30', period: '2026-10-10', claimedMs: 1_000, ...over };
  const canonical = canonicalize(report);
  const signature = node.signMessage(`azimuth-report-v1\n${canonical}`);
  return { report, signature, hash: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex') };
}

test('a correctly signed claim is valid', () => {
  const node = newNode();
  const out = verifyClaim(signedClaim(node));
  assert.equal(out.valid, true, out.problems.join('; '));
  assert.equal(out.node, node.address);
});

test('tampering, wrong signer, wrong type and bad fields are refused', () => {
  const node = newNode();
  const other = newNode();
  const good = signedClaim(node);
  assert.equal(verifyClaim({ ...good, report: { ...good.report, challengeId: 'cells-20' } }).valid, false, 'changed after signing');
  assert.equal(verifyClaim({ ...good, signature: signedClaim(other).signature }).valid, false, 'wrong signer');
  assert.equal(verifyClaim(signedClaim(node, { type: 'mapping-session' })).valid, false, 'wrong type');
  assert.equal(verifyClaim(signedClaim(node, { challengeId: '' })).valid, false);
  assert.equal(verifyClaim(signedClaim(node, { period: 42 })).valid, false);
  assert.equal(verifyClaim(signedClaim(node, { version: 2 })).valid, false);
  assert.equal(verifyClaim(null).valid, false);
  assert.equal(verifyClaim({}).valid, false);
});
```

If `newNode()` in `helpers.js` does not expose `address` and `signMessage(text)`, add exactly those two members (base58 public key; base64 ed25519 signature over the UTF-8 text) without changing existing members, and note it in the report.

Append to `server/test/azmRewards.test.js`:

```js
test('challenge claims have kind 3 and an amount of 0 here (the amount comes from the challenge list)', () => {
  assert.equal(kindFor('challenge-claim'), 3);
  assert.equal(azmAmount({ type: 'challenge-claim', rows: [], newCellUsdc: 0.001 }, {}), 0);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && node --test test/claim.test.js test/azmRewards.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `server/lib/azmRewards.js` add `'challenge-claim': KIND.challenge` to `TYPE_KIND`.

In `server/lib/verify-report.cjs`, below `verifyEnvelope` add (reusing the same helpers already defined in the file) and export it:

```js
/** Checks a signed challenge claim. It is a small report with no readings, so only the signature and shape are checked. */
function verifyClaim(envelope) {
  const problems = [];
  const report = envelope && envelope.report;
  if (!report || typeof report !== 'object') return { valid: false, problems: ['missing claim'] };
  if (report.version !== 1) problems.push(`unsupported claim version ${report.version}`);
  if (report.type !== 'challenge-claim') problems.push('not a challenge claim');
  if (typeof report.node !== 'string') problems.push('missing node address');
  if (typeof report.challengeId !== 'string' || !/^[a-z0-9-]{1,40}$/.test(report.challengeId)) problems.push('invalid challenge id');
  if (typeof report.period !== 'string' || !/^(once|\d{4}-\d{2}-\d{2}|\d{4}-W\d{2})$/.test(report.period)) problems.push('invalid period');
  if (!Number.isFinite(report.claimedMs)) problems.push('invalid claim time');

  const canonical = canonicalize(report);
  const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  if (hash !== envelope.hash) problems.push('hash does not match the claim contents');
  try {
    const publicKey = base58Decode(report.node);
    if (publicKey.length !== 32) throw new Error(`node address decodes to ${publicKey.length} bytes, expected 32`);
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: 'der', type: 'spki' });
    const signature = Buffer.from(envelope.signature || '', 'base64');
    if (signature.length !== 64) throw new Error(`signature is ${signature.length} bytes, expected 64`);
    if (!crypto.verify(null, Buffer.from(SIGNING_PREFIX + canonical, 'utf8'), key, signature)) problems.push('signature is not valid for this node and claim');
  } catch (e) {
    problems.push(e.message);
  }
  return { valid: problems.length === 0, problems, hash, node: report.node };
}
```

Change the export line to `module.exports = { canonicalize, base58Decode, verifyEnvelope, verifyClaim, verifyMessage };`.

- [ ] **Step 4: Run to confirm it passes**

Run: `cd server && npm test`
Expected: all green.

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 3: Supabase schema and sink methods for claims

**Files:**
- Create: `server/supabase/schema_challenges.sql`
- Modify: `server/lib/supabase.js`
- Test: `server/test/supabase.test.js` (append)

**Interfaces:**
- Produces on the sink:
  - `listChallenges(): Promise<row[]>` — rows of `public.challenges` where `active = true`, ordered by `sort`, all columns (`id, title, blurb, period, metric, goal, reward, go_tab, active, sort`).
  - `listNewReports(limit)` now **excludes** claims (`type=neq.challenge-claim`).
  - `listNewClaims(limit = 50): Promise<{ hash, node, type, received_at, body }[]>`
  - `findVerifiedClaim(node, challengeId, period): Promise<boolean>`
  - `listVerifiedActivity(node, fromIso, toIso): Promise<{ type, seconds }[]>` — verified, non-claim reports with `verified_at` in `[from, to)`; `seconds` is `body->report->checks->>durationSec`.
  - `listNewCellRewards(node, fromIso, toIso): Promise<{ amount_usdc }[]>` — `kind = 'new-cells'`, status not `rejected`, `created_at` in `[from, to)`.
- Produces in SQL: table `public.challenges` (primary key `id`; checks: `id ~ '^[a-z0-9-]{1,40}$'`, `period in ('daily','weekly','once')`, `metric in ('mapping_minutes','new_cells','satellite_passes','chests_opened')`, `go_tab in ('Map','Satellites')`, `goal > 0`, `reward between 1 and 100`; `active boolean default true`, `sort int default 0`), row level security on with a policy letting the public key SELECT rows where `active`, no insert/update/delete for it, and the five seed rows (below); `reports_shape` accepts type `challenge-claim`; `node_summary` returns, in addition to everything in `schema_azm.sql`: each `verified` item gains `challenge` (id or null) and `period` (or null); new key `claims`: `[{ challengeId, period, status, reasons }]` for this wallet's claims received in the last 10 days.

- [ ] **Step 1: Failing tests** (append to `server/test/supabase.test.js`; read the file's `fakeFetch` and match how it records calls)

```js
test('listChallenges reads the active challenges in order', async () => {
  const f = fakeFetch([{ status: 200, body: [{ id: 'scan-30' }] }]);
  const sink = createSupabaseSink({ url: 'https://x.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: f.impl });
  assert.deepEqual(await sink.listChallenges(), [{ id: 'scan-30' }]);
  assert.match(f.calls[0].url, /\/challenges\?/);
  assert.match(f.calls[0].url, /active=eq\.true/);
  assert.match(f.calls[0].url, /order=sort\.asc/);
});

test('listNewReports leaves out challenge claims, and listNewClaims asks only for them', async () => {
  const f = fakeFetch([{ status: 200, body: [] }, { status: 200, body: [{ hash: 'c' }] }]);
  const sink = createSupabaseSink({ url: 'https://x.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: f.impl });
  await sink.listNewReports(5);
  assert.match(f.calls[0].url, /type=neq\.challenge-claim/);
  assert.deepEqual(await sink.listNewClaims(7), [{ hash: 'c' }]);
  assert.match(f.calls[1].url, /status=eq\.new/);
  assert.match(f.calls[1].url, /type=eq\.challenge-claim/);
  assert.match(f.calls[1].url, /limit=7/);
});

test('findVerifiedClaim filters on wallet, challenge and period and answers true or false', async () => {
  const f = fakeFetch([{ status: 200, body: [{ hash: 'h' }] }, { status: 200, body: [] }]);
  const sink = createSupabaseSink({ url: 'https://x.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: f.impl });
  assert.equal(await sink.findVerifiedClaim('NodeA', 'scan-30', '2026-10-10'), true);
  assert.match(f.calls[0].url, /node=eq\.NodeA/);
  assert.match(f.calls[0].url, /status=eq\.verified/);
  assert.match(f.calls[0].url, /body-%3Ereport-%3E%3EchallengeId=eq\.scan-30|body->report->>challengeId=eq\.scan-30/);
  assert.match(f.calls[0].url, /2026-10-10/);
  assert.equal(await sink.findVerifiedClaim('NodeA', 'scan-30', '2026-10-11'), false);
});

test('activity queries are bounded by wallet and time', async () => {
  const f = fakeFetch([{ status: 200, body: [{ type: 'mapping-session', seconds: '60' }] }, { status: 200, body: [{ amount_usdc: 0.01 }] }]);
  const sink = createSupabaseSink({ url: 'https://x.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: f.impl });
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
```

(Assertions on URLs use regexes tolerant of percent-encoding; keep them equivalent to the intent. `fakeFetch` in the existing file may always answer `[]`; extend it minimally to return queued bodies if needed, without changing existing tests.)

- [ ] **Step 2: Run to confirm failure** — `cd server && node --test test/supabase.test.js` → new tests FAIL.

- [ ] **Step 3: Implement in `server/lib/supabase.js`**

Change `listNewReports` URL to `/reports?status=eq.new&type=neq.challenge-claim&order=received_at.asc&limit=${limit}&select=hash,node,type,received_at,body`. Add:

```js
    /** The active challenges, in display order. */
    async listChallenges() {
      return call('GET', '/challenges?active=eq.true&order=sort.asc&select=id,title,blurb,period,metric,goal,reward,go_tab,active,sort');
    },

    /** The active challenges, in display order. */
    async listChallenges() {
      return call('GET', '/challenges?active=eq.true&order=sort.asc&select=id,title,blurb,period,metric,goal,reward,go_tab,active,sort');
    },

    /** Claims for challenge rewards that nobody has settled yet, oldest first. */
    async listNewClaims(limit = 50) {
      return call('GET', `/reports?status=eq.new&type=eq.challenge-claim&order=received_at.asc&limit=${limit}&select=hash,node,type,received_at,body`);
    },

    /** Whether this wallet already has a verified claim for the challenge in the period. */
    async findVerifiedClaim(node, challengeId, period) {
      const rows = await call('GET', `/reports?node=eq.${encodeURIComponent(node)}&type=eq.challenge-claim&status=eq.verified&body->report->>challengeId=eq.${encodeURIComponent(challengeId)}&body->report->>period=eq.${encodeURIComponent(period)}&select=hash&limit=1`);
      return Array.isArray(rows) && rows.length > 0;
    },

    /** The wallet's verified reports (not claims) in a time window, with the session length where the report has one. */
    async listVerifiedActivity(node, fromIso, toIso) {
      return call('GET', `/reports?node=eq.${encodeURIComponent(node)}&status=eq.verified&type=neq.challenge-claim&verified_at=gte.${encodeURIComponent(fromIso)}&verified_at=lt.${encodeURIComponent(toIso)}&select=type,seconds:body->report->checks->>durationSec&limit=1000`);
    },

    /** The wallet's 'new-cells' reward rows created in a time window. */
    async listNewCellRewards(node, fromIso, toIso) {
      return call('GET', `/rewards?node=eq.${encodeURIComponent(node)}&kind=eq.new-cells&status=neq.rejected&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}&select=amount_usdc&limit=1000`);
    },
```

- [ ] **Step 4: Write `server/supabase/schema_challenges.sql`** (run by the user after `schema_azm.sql`)

```sql
-- Challenge claims. Run once in the Supabase SQL editor (after schema_azm.sql).
-- A claim is a small signed report; the admin portal settles it by re-checking the wallet's verified reports.

-- The challenge list. Edit it in the Supabase table editor (the service key and the dashboard can write; the app can only read active rows).
create table if not exists public.challenges (
  id      text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  title   text not null check (length(title) between 1 and 80),
  blurb   text not null default '' check (length(blurb) <= 200),
  period  text not null check (period in ('daily', 'weekly', 'once')),
  metric  text not null check (metric in ('mapping_minutes', 'new_cells', 'satellite_passes', 'chests_opened')),
  goal    numeric not null check (goal > 0),
  reward  integer not null check (reward between 1 and 100),
  go_tab  text not null check (go_tab in ('Map', 'Satellites')),
  active  boolean not null default true,
  sort    integer not null default 0
);
alter table public.challenges enable row level security;
drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to anon using (active);
revoke all on public.challenges from anon;
grant select on public.challenges to anon;

insert into public.challenges (id, title, blurb, period, metric, goal, reward, go_tab, sort) values
  ('scan-30', 'Scan for 30 minutes', 'Keep mapping on for half an hour today.', 'daily', 'mapping_minutes', 30, 5, 'Map', 10),
  ('cells-20', 'Find 20 new cells', 'Map 20 cells nobody has mapped yet.', 'daily', 'new_cells', 20, 5, 'Map', 20),
  ('ground-weekly', 'Explore new ground', 'Reveal 70 new cells this week, about a square mile on the map grid.', 'weekly', 'new_cells', 70, 40, 'Map', 30),
  ('passes-3', 'Catch 3 satellite passes', 'Record three satellite passes this week.', 'weekly', 'satellite_passes', 3, 30, 'Satellites', 40),
  ('first-chest', 'Open your first chest', 'Find a chest and open it. Once only.', 'once', 'chests_opened', 1, 20, 'Map', 50)
on conflict (id) do nothing;

-- Claims.
alter table public.reports drop constraint if exists reports_shape;
alter table public.reports add constraint reports_shape check (
  hash ~ '^[0-9a-f]{64}$'
  and node ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  and type in ('mapping-session', 'chest-claim', 'satellite-pass', 'challenge-claim')
  and octet_length(body::text) < 400000
);

-- node_summary: everything from schema_azm.sql, plus which challenge each verified payout was for and the wallet's recent claims.
create or replace function public.node_summary(p_node text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'address', p_node,
    'pendingReports',  (select count(*) from public.reports where node = p_node and status = 'new' and type <> 'challenge-claim'),
    'rejectedReports', (select count(*) from public.reports where node = p_node and status = 'rejected' and type <> 'challenge-claim'),
    'pendingUsdc',  coalesce(sum(amount_usdc) filter (where status = 'pending'), 0),
    'approvedUsdc', coalesce(sum(amount_usdc) filter (where status = 'approved'), 0),
    'paidUsdc',     coalesce(sum(amount_usdc) filter (where status = 'paid'), 0),
    'chestsOpened', count(*) filter (where kind = 'chest' and status <> 'rejected'),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('kind', r.kind, 'ref', r.ref, 'amount_usdc', r.amount_usdc, 'status', r.status, 'created_ms', (extract(epoch from r.created_at) * 1000)::bigint) order by r.created_at desc)
      from (select * from public.rewards where node = p_node order by created_at desc limit 50) r
    ), '[]'::jsonb),
    'azmTotal', (select coalesce(sum(onchain_amount), 0) from public.reports where node = p_node and onchain_record is not null),
    'verified', coalesce((
      select jsonb_agg(jsonb_build_object(
        'hash', v.hash, 'type', v.type, 'amount', v.onchain_amount, 'record', v.onchain_record,
        'verified_ms', (extract(epoch from v.verified_at) * 1000)::bigint,
        'challenge', v.challenge, 'period', v.period) order by v.verified_at desc)
      from (
        select hash, type, onchain_amount, onchain_record, verified_at,
               body->'report'->>'challengeId' as challenge, body->'report'->>'period' as period
        from public.reports where node = p_node and onchain_record is not null order by verified_at desc limit 50
      ) v
    ), '[]'::jsonb),
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('challengeId', c.challenge, 'period', c.period, 'status', c.status, 'reasons', c.reasons) order by c.received_at desc)
      from (
        select body->'report'->>'challengeId' as challenge, body->'report'->>'period' as period, status, reasons, received_at
        from public.reports
        where node = p_node and type = 'challenge-claim' and received_at > now() - interval '10 days'
        order by received_at desc limit 50
      ) c
    ), '[]'::jsonb)
  )
  from public.rewards where node = p_node;
$$;
revoke all on function public.node_summary(text) from public;
grant execute on function public.node_summary(text) to anon;
```

Before finishing, diff the `reports_shape` constraint against `schema_direct.sql` (it lists the same first three types and the same size limit) and the function against `schema_azm.sql`; every existing key must stay identical.

- [ ] **Step 5: Run to confirm all supabase tests pass** — `cd server && npm test`.

- [ ] **Step 6: Checkpoint** — report; the user must run `schema_challenges.sql` before the live check. Do not commit.

---

### Task 4: `review.js` settles challenge claims and pays on-chain

**Files:**
- Modify: `server/lib/review.js`
- Test: `server/test/review.test.js` (append)

**Interfaces:**
- Consumes: Tasks 1–3: `createChallengeSource` (default source is `createChallengeSource({ sink })`; `createReviewer` gains an optional `challenges = createChallengeSource({ sink })` parameter whose `.get(id)` replaces any static lookup), `isClaimablePeriod`, `periodWindow`, `onchainHash`, `progressFor`, `verifyClaim`, `kindFor`, sink `listNewClaims`/`findVerifiedClaim`/`listVerifiedActivity`/`listNewCellRewards`, existing `payOnChain`, `sink.finishReport`, `sink.setOnchain`.
- Produces:
  - `reviewer.settleChallenges({ nowMs = Date.now(), limit = 50 } = {}): Promise<{ hash, status: 'verified'|'rejected'|'skipped', reasons?: string[], onchain?: object }[]>`. Returns `[]` and touches nothing when no `chain` is configured.
  - `payOnChain(hash, node, type, amount, chainHash = hash)` (internal) — the row is updated under `hash`, the on-chain record uses `chainHash`.
  - `retryOnChain(hash)` works for claims: uses `onchainHash(challengeId, period)` from the stored body and kind 3.

- [ ] **Step 1: Failing tests** (append to `server/test/review.test.js`; reuse `fakeSupabase`, `reviewer`, `fakeChain`, `newNode`, `NOW`; extend `fakeSupabase`'s sink with the four new methods backed by `db`: `listNewClaims` returns `status==='new' && type==='challenge-claim'` rows; `findVerifiedClaim(node,id,period)` checks `status==='verified'` claim rows by body; `listVerifiedActivity` and `listNewCellRewards` return arrays held in `db.activity` / `db.cellRewards` (objects `{ node, atMs, type?, seconds?, amount_usdc? }`) filtered by node and `[from,to)`; also make its `listNewReports` skip claims)

Helpers to add in the test file:

```js
const crypto = require('node:crypto');
const { canonicalize } = require('../lib/verify-report.cjs');

function claimRow(node, over = {}, receivedMs = NOW) {
  const report = { version: 1, type: 'challenge-claim', node: node.address, challengeId: 'scan-30', period: '2026-10-02', claimedMs: receivedMs, ...over };
  const canonical = canonicalize(report);
  const env = { report, signature: node.signMessage(`azimuth-report-v1\n${canonical}`), hash: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex') };
  return { hash: env.hash, node: node.address, type: 'challenge-claim', received_at: new Date(receivedMs).toISOString(), body: env, status: 'new' };
}
```

Also give `fakeSupabase`'s sink `async listChallenges() { return db.challenges; }` with `db.challenges` seeded by the five rows from `schema_challenges.sql` (as `{ id, title, blurb, period, metric, goal, reward, go_tab, active: true, sort }`; a small constant `SEED_CHALLENGES` in the test file), and add one test: a claim whose challenge row has been removed from `db.challenges` (or has `reward: 0`) is rejected with 'unknown challenge' and pays nothing.

(`NOW` is `Date.UTC(2026, 9, 2, 15, 0, 0)` in this file, so the daily period key is `2026-10-02`.)

Tests:

```js
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
```

- [ ] **Step 2: Run to confirm failure** — `cd server && node --test test/review.test.js` → new tests FAIL.

- [ ] **Step 3: Implement in `server/lib/review.js`**

Add requires: `const { verifyEnvelope, verifyClaim } = require('./verify-report.cjs');` (extend the existing import), `const { createChallengeSource, isClaimablePeriod, periodWindow, onchainHash, progressFor } = require('./challenges');`. Add the parameter `challenges = createChallengeSource({ sink })` to `createReviewer`'s options (next to `chain`).

Change `payOnChain` to take an optional on-chain hash:

```js
  async function payOnChain(hash, node, type, amount, chainHash = hash) {
    try {
      const out = await chain.reward({ wallet: node, hash: chainHash, kind: kindFor(type), amount });
      // ... rest unchanged (setOnchain under `hash`, same return shape and warning behaviour)
```

(The existing body stays as it is, only `hash:` in the `chain.reward` call becomes `chainHash`; setOnchain calls keep using `hash`.)

In `retryOnChain`, compute the hash before paying:

```js
    const rep = r.body && r.body.report;
    const chainHash = r.type === 'challenge-claim' && rep ? onchainHash(String(rep.challengeId), String(rep.period)) : hash;
    const onchain = await payOnChain(hash, r.node, r.type, amount, chainHash);
```

(Keep the existing `kindFor(r.type) === null` guard; `kindFor('challenge-claim')` is now 3.)

Add `settleChallenges` before `processDeletions`:

```js
  /** Settles one stored claim. Returns the outcome; never throws for a bad claim, only for storage failures. */
  async function settleClaim(r, nowMs) {
    const reject = async (reasons) => { await sink.finishReport(r.hash, 'rejected', reasons); return { hash: r.hash, status: 'rejected', reasons }; };
    const checked = verifyClaim(r.body);
    if (!checked.valid) return reject(checked.problems);
    const c = r.body.report;
    if (checked.hash !== r.hash) return reject(['the report hash column does not match the signed claim']);
    if (c.node !== r.node) return reject(['the wallet column does not match the signed claim']);
    if (r.type !== 'challenge-claim') return reject(['the type column does not match the signed claim']);
    const def = await challenges.get(c.challengeId);
    if (!def) return reject(['unknown challenge']);
    if (!isClaimablePeriod(def.period, c.period, nowMs)) return reject(['this period can no longer be claimed']);
    if (await sink.findVerifiedClaim(r.node, def.id, c.period)) return reject(['already claimed for this period']);

    const { fromMs, toMs } = periodWindow(def.period, c.period, nowMs);
    const [reports, rewards] = await Promise.all([
      sink.listVerifiedActivity(r.node, new Date(fromMs).toISOString(), new Date(toMs).toISOString()),
      sink.listNewCellRewards(r.node, new Date(fromMs).toISOString(), new Date(toMs).toISOString()),
    ]);
    const progress = progressFor(def.metric, { reports, rewards }, service.config.newCellUsdc);
    if (progress < def.goal) return reject([`${progress} of ${def.goal} verified so far. Reports are counted once they have been checked.`]);

    await sink.finishReport(r.hash, 'verified', null);
    let onchain;
    try {
      await sink.setOnchain(r.hash, { onchain_amount: def.reward });
      onchain = await payOnChain(r.hash, r.node, 'challenge-claim', def.reward, onchainHash(def.id, c.period));
    } catch (e) {
      onchain = { ok: false, amount: def.reward, error: `Could not save the payout amount (nothing was sent): ${String((e && e.message) || e).slice(0, 250)}` };
    }
    return { hash: r.hash, status: 'verified', onchain };
  }

  /** Settles every new challenge claim. Does nothing unless on-chain payouts are configured. */
  async function settleChallenges({ nowMs = Date.now(), limit = 50 } = {}) {
    if (!chain) return [];
    const out = [];
    for (const r of await sink.listNewClaims(limit)) {
      try { out.push(await settleClaim(r, nowMs)); } catch (e) { out.push({ hash: r.hash, status: 'skipped', reasons: [String((e && e.message) || e)] }); }
    }
    return out;
  }
```

Add `settleChallenges` to the returned object.

- [ ] **Step 4: Run all server tests** — `cd server && npm test` → green.

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 5: Admin portal timer and manual check

**Files:**
- Modify: `server/admin/app.js`, `server/admin/admin.html`, `server/admin/admin.js`, `server/admin/index.js`
- Test: `server/test/admin.test.js` (append)

**Interfaces:**
- Consumes: `reviewer.settleChallenges`.
- Produces: `POST /api/claims/settle` (behind the existing auth) → 200 `{ settled: n, verified: n, rejected: n }` from the reviewer's result; 503 `{ error }` when no chain is configured (use `chain` already passed to `createAdminApp`).

- [ ] **Step 1: Failing tests**

```js
test('settling claims runs the reviewer and counts outcomes', async () => {
  const reviewer = { settleChallenges: async () => [{ status: 'verified' }, { status: 'rejected' }, { status: 'verified' }] };
  const res = await call({ reviewer, chain: { status: async () => ({}) } }, 'POST', '/api/claims/settle');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { settled: 3, verified: 2, rejected: 1 });
});

test('settling claims needs a configured chain', async () => {
  assert.equal((await call({ reviewer: { settleChallenges: async () => [] }, chain: null }, 'POST', '/api/claims/settle')).status, 503);
});
```

(`call` is the existing helper in `admin.test.js` used by the payouts tests; adapt names to the real ones as the payouts tests do.)

- [ ] **Step 2: Run to confirm failure** — `cd server && node --test test/admin.test.js`.

- [ ] **Step 3: Implement**

In `app.js` before the final `return send(404, ...)`:

```js
      if (req.method === 'POST' && p === '/api/claims/settle') {
        if (!chain) return send(503, { error: 'on-chain payouts are not configured' });
        const out = await reviewer.settleChallenges();
        return send(200, { settled: out.length, verified: out.filter((x) => x.status === 'verified').length, rejected: out.filter((x) => x.status === 'rejected').length });
      }
```

In `admin.html`, inside the payouts panel next to `#vault`, add `<button class="ghost" id="settle">Check challenge claims now</button>`. In `admin.js` add (using the existing `api`, `$`, `loadPayouts`):

```js
  $('settle').addEventListener('click', function () {
    var v = $('vault');
    api('POST', '/api/claims/settle').then(function (r) {
      v.textContent = r.status === 200 ? 'Claims checked: ' + r.json.verified + ' paid or verified, ' + r.json.rejected + ' rejected.' : ((r.json && r.json.error) || 'Could not check claims.');
      loadPayouts();
    }).catch(function () { v.textContent = 'Could not reach the portal.'; });
  });
```

(`loadPayouts` rewrites `#vault`; if the message disappears immediately, set it after the reload promise resolves instead; verify by reading the function and keep the message visible.)

In `index.js`, after the server starts listening:

```js
if (chain) {
  const SETTLE_EVERY_MS = 30_000;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const out = await reviewer.settleChallenges();
      if (out.length) console.log(`Challenge claims: ${out.filter((x) => x.status === 'verified').length} verified, ${out.filter((x) => x.status === 'rejected').length} rejected`);
    } catch (e) {
      console.warn(`Challenge settlement failed: ${e.message}`);
    } finally {
      busy = false;
    }
  }, SETTLE_EVERY_MS).unref();
}
```

(`unref` so the timer never keeps the process alive on its own; `busy` stops overlapping runs and therefore double payment attempts in the same process.)

- [ ] **Step 4: Run** — `cd server && npm test && node --check admin/index.js && node --check admin/admin.js` → green.

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 6: App periods, definitions and progress

**Files:**
- Create: `src/challenges/definitions.ts`, `src/challenges/periods.ts`, `src/challenges/progress.ts`
- Test: `src/challenges/__tests__/periods.test.ts`, `src/challenges/__tests__/progress.test.ts`

**Interfaces:**
- Produces:
  - `definitions.ts`: `export type Challenge = { id: string; title: string; blurb: string; period: 'daily'|'weekly'|'once'; metric: 'mapping_minutes'|'new_cells'|'satellite_passes'|'chests_opened'; goal: number; reward: number; go: 'Map'|'Satellites' }`; `challengeFromRow(row: unknown): Challenge | null` (same validation as the server: id `/^[a-z0-9-]{1,40}$/`, non-empty title, known period/metric/`go_tab`, goal > 0, whole reward 1..100; maps `go_tab` to `go`). There is no bundled list: the list comes from the server (Task 7).
  - `periods.ts`: `periodKey(period, ms)`, `previousPeriodKey`, `periodWindow(period, key, nowMs)`, `isClaimablePeriod` — **same behaviour as the server** (UTC, ISO week).
  - `progress.ts`: `export interface VerifiedItem { type: string; verified_ms: number; challenge?: string | null; period?: string | null }`; `localProgress(challenge, { sessions, verified, nowMs }): number` (current period).
- Consumes: `SessionRecord` from `src/mapping/sessionHistory.ts`.

- [ ] **Step 1: Failing tests**

`periods.test.ts` — the same vectors as the server test:

```ts
import { periodKey, previousPeriodKey, periodWindow, isClaimablePeriod } from '../periods';

const T = Date.UTC(2026, 9, 10, 15, 30);

describe('periods (UTC, same vectors as the server)', () => {
  it('keys', () => {
    expect(periodKey('daily', T)).toBe('2026-10-10');
    expect(periodKey('daily', Date.UTC(2026, 9, 10, 23, 59, 59))).toBe('2026-10-10');
    expect(periodKey('daily', Date.UTC(2026, 9, 11))).toBe('2026-10-11');
    expect(periodKey('weekly', T)).toBe('2026-W41');
    expect(periodKey('weekly', Date.UTC(2026, 9, 12))).toBe('2026-W42');
    expect(periodKey('weekly', Date.UTC(2026, 9, 11, 23, 59, 59))).toBe('2026-W41');
    expect(periodKey('weekly', Date.UTC(2027, 0, 1))).toBe('2026-W53');
    expect(periodKey('weekly', Date.UTC(2024, 11, 30))).toBe('2025-W01');
    expect(periodKey('once', T)).toBe('once');
  });
  it('previous period, windows and claimable', () => {
    expect(previousPeriodKey('daily', T)).toBe('2026-10-09');
    expect(previousPeriodKey('weekly', T)).toBe('2026-W40');
    expect(periodWindow('daily', '2026-10-10', T)).toEqual({ fromMs: Date.UTC(2026, 9, 10), toMs: Date.UTC(2026, 9, 11) });
    expect(periodWindow('weekly', '2026-W41', T)).toEqual({ fromMs: Date.UTC(2026, 9, 5), toMs: Date.UTC(2026, 9, 12) });
    expect(periodWindow('once', 'once', T)).toEqual({ fromMs: 0, toMs: T + 1 });
    expect(isClaimablePeriod('daily', '2026-10-09', T)).toBe(true);
    expect(isClaimablePeriod('daily', '2026-10-08', T)).toBe(false);
    expect(isClaimablePeriod('daily', '2026-10-11', T)).toBe(false);
  });
});
```

`progress.test.ts`:

```ts
import { challengeFromRow } from '../definitions';
import type { Challenge } from '../definitions';
import { localProgress } from '../progress';
import type { SessionRecord } from '../../mapping/sessionHistory';

const NOW = Date.UTC(2026, 9, 10, 15, 0);
const session = (over: Partial<SessionRecord>): SessionRecord => ({
  id: String(over.startedMs), startedMs: NOW - 3600_000, endedMs: NOW - 1800_000, durationSec: 1800, distanceM: 0,
  clearedCells: 0, areaKm2: 0, newCells: 0, readings: 5, towers: 0, wifi: 0, bluetooth: 0, radioDbfs: null, ...over,
});

const make = (over: Record<string, unknown>): Challenge =>
  challengeFromRow({ id: 'x', title: 't', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map', ...over })!;

describe('challengeFromRow', () => {
  it('maps a valid row and drops invalid ones', () => {
    expect(make({})).toEqual({ id: 'x', title: 't', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go: 'Map' });
    for (const bad of [{ reward: 0 }, { reward: 101 }, { reward: 2.5 }, { goal: 0 }, { period: 'monthly' }, { metric: 'steps' }, { go_tab: 'Profile' }, { id: 'Bad Id' }]) {
      expect(challengeFromRow({ id: 'x', title: 't', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map', ...bad })).toBeNull();
    }
    expect(challengeFromRow(null)).toBeNull();
    expect(challengeFromRow('nope')).toBeNull();
  });
});

describe('localProgress', () => {
  const scan = make({ id: 'scan-30' });
  const cells = make({ id: 'cells-20', metric: 'new_cells', goal: 20 });
  const weekly = make({ id: 'ground-weekly', period: 'weekly', metric: 'new_cells', goal: 70, reward: 40 });
  const passes = make({ id: 'passes-3', period: 'weekly', metric: 'satellite_passes', goal: 3, reward: 30, go_tab: 'Satellites' });
  const chest = make({ id: 'first-chest', period: 'once', metric: 'chests_opened', goal: 1, reward: 20 });

  it('adds up today\'s mapping minutes and ignores sessions from other UTC days', () => {
    const sessions = [session({ startedMs: NOW - 3600_000, durationSec: 1800 }), session({ startedMs: NOW - 86_400_000 * 2, durationSec: 3600 })];
    expect(localProgress(scan, { sessions, verified: [], nowMs: NOW })).toBe(30);
  });
  it('counts new cells in the period (day vs week)', () => {
    const sessions = [session({ startedMs: NOW - 1000, newCells: 12 }), session({ startedMs: NOW - 3 * 86_400_000, newCells: 30 })];
    expect(localProgress(cells, { sessions, verified: [], nowMs: NOW })).toBe(12);
    expect(localProgress(weekly, { sessions, verified: [], nowMs: NOW })).toBe(42); // Oct 7 is in ISO week 41 with Oct 10
  });
  it('counts verified passes this week and chests ever', () => {
    const verified = [
      { type: 'satellite-pass', verified_ms: NOW - 1000 }, { type: 'satellite-pass', verified_ms: NOW - 86_400_000 },
      { type: 'satellite-pass', verified_ms: NOW - 20 * 86_400_000 }, { type: 'chest-claim', verified_ms: NOW - 40 * 86_400_000 },
    ];
    expect(localProgress(passes, { sessions: [], verified, nowMs: NOW })).toBe(2);
    expect(localProgress(chest, { sessions: [], verified, nowMs: NOW })).toBe(1);
  });
  it('never goes above the goal for display', () => {
    expect(localProgress(scan, { sessions: [session({ durationSec: 99999 })], verified: [], nowMs: NOW })).toBe(30);
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `npx jest src/challenges` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`definitions.ts`:

```ts
export type Challenge = {
  id: string;
  title: string;
  blurb: string;
  period: 'daily' | 'weekly' | 'once';
  metric: 'mapping_minutes' | 'new_cells' | 'satellite_passes' | 'chests_opened';
  goal: number;
  reward: number;
  go: 'Map' | 'Satellites';
};

const PERIODS = ['daily', 'weekly', 'once'];
const METRICS = ['mapping_minutes', 'new_cells', 'satellite_passes', 'chests_opened'];
const TABS = ['Map', 'Satellites'];

/** A server row as a challenge, or null when anything about it is off. The server applies the same checks before paying. */
export function challengeFromRow(row: unknown): Challenge | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const goal = Number(r.goal);
  const reward = Number(r.reward);
  const ok =
    typeof r.id === 'string' && /^[a-z0-9-]{1,40}$/.test(r.id) &&
    typeof r.title === 'string' && r.title.length > 0 &&
    PERIODS.includes(r.period as string) && METRICS.includes(r.metric as string) && TABS.includes(r.go_tab as string) &&
    Number.isFinite(goal) && goal > 0 && Number.isInteger(reward) && reward >= 1 && reward <= 100;
  if (!ok) return null;
  return { id: r.id as string, title: r.title as string, blurb: typeof r.blurb === 'string' ? r.blurb : '', period: r.period as Challenge['period'], metric: r.metric as Challenge['metric'], goal, reward, go: r.go_tab as Challenge['go'] };
}
```

`periods.ts` — a TypeScript port of `server/lib/challenges.js` periods (`DAY`, `WEEK`, `isoWeek`, `periodKey`, `previousPeriodKey`, `periodWindow`, `isClaimablePeriod`) with the same algorithm and `Period = 'daily' | 'weekly' | 'once'` types; copy the server code and add types, nothing else.

`progress.ts`:

```ts
import type { SessionRecord } from '../mapping/sessionHistory';
import type { Challenge } from './definitions';
import { periodKey, periodWindow } from './periods';

export interface VerifiedItem {
  type: string;
  verified_ms: number;
  challenge?: string | null;
  period?: string | null;
}

/**
 * Progress shown on the card, from what is on the phone (sessions) and what the server already verified (passes and
 * chests). It is for display only: the server recomputes everything when a challenge is claimed.
 */
export function localProgress(
  c: Challenge,
  data: { sessions: SessionRecord[]; verified: VerifiedItem[]; nowMs: number }
): number {
  const { fromMs, toMs } = periodWindow(c.period, periodKey(c.period, data.nowMs), data.nowMs);
  const inWindow = (ms: number) => ms >= fromMs && ms < toMs;
  let value = 0;
  switch (c.metric) {
    case 'mapping_minutes':
      value = Math.floor(data.sessions.filter((s) => inWindow(s.startedMs)).reduce((n, s) => n + s.durationSec, 0) / 60);
      break;
    case 'new_cells':
      value = data.sessions.filter((s) => inWindow(s.startedMs)).reduce((n, s) => n + s.newCells, 0);
      break;
    case 'satellite_passes':
      value = data.verified.filter((v) => v.type === 'satellite-pass' && inWindow(v.verified_ms)).length;
      break;
    case 'chests_opened':
      value = data.verified.filter((v) => v.type === 'chest-claim' && inWindow(v.verified_ms)).length;
      break;
  }
  return Math.min(value, c.goal);
}
```

- [ ] **Step 4: Run** — `npx jest src/challenges && npm run typecheck` → green.

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 7: App claim builder, submit, summary fields

**Files:**
- Create: `src/challenges/claim.ts`
- Test: `src/challenges/__tests__/claim.test.ts`
- Modify: `src/network/api.ts`, `src/network/supabaseApi.ts`, `src/network/__tests__/supabaseApi.test.ts`

**Interfaces:**
- Produces:
  - `claim.ts`: `export interface ChallengeClaim { version: 1; type: 'challenge-claim'; node: string; challengeId: string; period: string; claimedMs: number }`; `buildClaim(node, challengeId, period, claimedMs): ChallengeClaim`; `claimHash(claim): string`; `claimSigningText(claim): string` (`SIGNING_PREFIX + canonicalize(claim)`); `async signAndSubmitClaim(claim, base64Address): Promise<SubmitResult>` (signs with `signText`, then calls the network `submitClaim`).
  - `api.ts`: `fetchChallenges(): Promise<Challenge[]>` (direct mode only; other modes return `[]`); `NodeSummary.claims?: { challengeId: string; period: string; status: 'new'|'verified'|'rejected'; reasons: string[] | null }[]`; `NodeSummary.verified` items gain `challenge?: string | null; period?: string | null`; `submitClaim(signed: { report: ChallengeClaim; signature: string; hash: string }): Promise<SubmitResult>`.
  - `supabaseApi.ts`: `fetchChallenges` does `GET /challenges?active=eq.true&order=sort.asc&select=id,title,blurb,period,metric,goal,reward,go_tab` with the public key, maps rows through `challengeFromRow` and drops invalid ones, throws a readable error on a non-200; `submitClaim` inserts `{ hash, node, type: 'challenge-claim', body: signed }` into `reports` with the same status handling as `submitReport` (201/200/204 → received; 409 → already submitted); `fetchNodeSummary` maps `claims` (default `[]`).
- Consumes: `canonicalize` from `src/reports/canonical.ts`, `SIGNING_PREFIX` from `src/reports/report.ts`, `signText` from `src/wallet/signReport.ts`, `sha256`/`bytesToHex`/`utf8ToBytes` from `@noble/hashes` as `report.ts` does.

- [ ] **Step 1: Failing tests**

`claim.test.ts`:

```ts
import { buildClaim, claimHash, claimSigningText } from '../claim';
import { SIGNING_PREFIX } from '../../reports/report';
import { canonicalize } from '../../reports/canonical';

describe('challenge claim', () => {
  const claim = buildClaim('Node1111111111111111111111111111111111111', 'scan-30', '2026-10-10', 1_000);

  it('has the exact shape the server verifies', () => {
    expect(claim).toEqual({ version: 1, type: 'challenge-claim', node: 'Node1111111111111111111111111111111111111', challengeId: 'scan-30', period: '2026-10-10', claimedMs: 1_000 });
  });
  it('signs the prefixed canonical text and hashes the canonical form', () => {
    expect(claimSigningText(claim)).toBe(SIGNING_PREFIX + canonicalize(claim));
    expect(claimHash(claim)).toMatch(/^[0-9a-f]{64}$/);
    expect(claimHash(claim)).toBe(claimHash({ ...claim }));
    expect(claimHash(claim)).not.toBe(claimHash({ ...claim, period: '2026-10-11' }));
  });
});
```

Append to `supabaseApi.test.ts`:

```ts
  it('submits a challenge claim as a report row of type challenge-claim', async () => {
    const f = fakeFetch([{ status: 201 }, { status: 409 }]);
    const claim = { report: { version: 1, type: 'challenge-claim', node: 'N', challengeId: 'scan-30', period: '2026-10-10', claimedMs: 1 }, signature: 's', hash: 'a'.repeat(64) };
    const out = await api(f).submitClaim(claim as never);
    expect(out).toMatchObject({ accepted: true, pending: true });
    const sent = JSON.parse(f.calls[0].init.body as string);
    expect(sent).toMatchObject({ hash: 'a'.repeat(64), node: 'N', type: 'challenge-claim' });
    expect(await api(f).submitClaim(claim as never)).toMatchObject({ accepted: false });
  });

  it('fetches the challenge list from the server and drops invalid rows', async () => {
    const f = fakeFetch([{ status: 200, body: [
      { id: 'scan-30', title: 'Scan', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map' },
      { id: 'bad', title: 'Bad', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 0, go_tab: 'Map' },
    ] }, { status: 500, body: { message: 'boom' } }]);
    const a = api(f);
    expect((await a.fetchChallenges()).map((c) => c.id)).toEqual(['scan-30']);
    expect(f.calls[0].url).toMatch(/\/challenges\?active=eq\.true&order=sort\.asc/);
    await expect(a.fetchChallenges()).rejects.toThrow();
  });

  it('maps claims from node_summary and tolerates their absence', async () => {
    const f = fakeFetch([
      { status: 200, body: { pendingUsdc: 0, approvedUsdc: 0, paidUsdc: 0, entries: [], claims: [{ challengeId: 'scan-30', period: '2026-10-10', status: 'rejected', reasons: ['23 of 30'] }] } },
      { status: 200, body: { pendingUsdc: 0, approvedUsdc: 0, paidUsdc: 0, entries: [] } },
    ]);
    const a = api(f);
    expect((await a.fetchNodeSummary('Addr')).claims).toEqual([{ challengeId: 'scan-30', period: '2026-10-10', status: 'rejected', reasons: ['23 of 30'] }]);
    expect((await a.fetchNodeSummary('Addr')).claims).toEqual([]);
  });
```

- [ ] **Step 2: Run to confirm failure** — `npx jest src/challenges/__tests__/claim.test.ts src/network/__tests__/supabaseApi.test.ts`.

- [ ] **Step 3: Implement**

`src/challenges/claim.ts`:

```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalize } from '../reports/canonical';
import { SIGNING_PREFIX } from '../reports/report';
import { signText } from '../wallet/signReport';
import { submitClaim } from '../network/api';
import type { SubmitResult } from '../network/api';

export interface ChallengeClaim {
  version: 1;
  type: 'challenge-claim';
  node: string;
  challengeId: string;
  period: string;
  claimedMs: number;
}

export function buildClaim(node: string, challengeId: string, period: string, claimedMs: number): ChallengeClaim {
  return { version: 1, type: 'challenge-claim', node, challengeId, period, claimedMs };
}

export const claimHash = (c: ChallengeClaim): string => bytesToHex(sha256(utf8ToBytes(canonicalize(c))));
export const claimSigningText = (c: ChallengeClaim): string => SIGNING_PREFIX + canonicalize(c);

/** One wallet prompt: signs the claim and sends it. The server pays it after re-checking the numbers. */
export async function signAndSubmitClaim(claim: ChallengeClaim, walletBase64: string): Promise<SubmitResult> {
  const signature = await signText(claimSigningText(claim), walletBase64);
  return submitClaim({ report: claim, signature, hash: claimHash(claim) });
}
```

(Read `src/reports/canonical.ts` and `report.ts` to import the right names; `SubmitResult` is the type returned by `submitReport` in `api.ts`: if it has another name, use it.)

In `api.ts` add the `NodeSummary` fields and `submitClaim` wrapper following the pattern of `submitReport` (direct mode → `direct().submitClaim(...)`; server mode: throw `new Error('Challenges need the direct Supabase connection.')`). In `supabaseApi.ts` implement `submitClaim` (same status handling as `submitReport`, `type: 'challenge-claim'`) and the `claims`/`verified.challenge/period` mapping in `fetchNodeSummary` (`claims: j.claims ?? []`).

- [ ] **Step 4: Run** — `npx jest src/challenges src/network && npm run typecheck` → green.

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 8: Quests tab and screen

**Files:**
- Create: `src/challenges/useChallenges.ts`, `src/challenges/cardState.ts`, `src/screens/quests/QuestsScreen.tsx`
- Test: `src/challenges/__tests__/cardState.test.ts`, `src/screens/quests/__tests__/QuestsScreen.test.tsx`
- Modify: `src/navigation/types.ts`, `src/navigation/RootNavigator.tsx`

**Interfaces:**
- Produces:
  - `cardState.ts`: `export type CardState = { kind: 'progress'; value: number } | { kind: 'ready' } | { kind: 'waiting' } | { kind: 'claimed' } | { kind: 'rejected'; value: number; reason: string }`; `cardState(c: Challenge, args: { value: number; claims: NodeSummary['claims']; verified: VerifiedItem[]; nowMs: number }): CardState`.
    - `claimed`: a `verified` claim for this challenge in the current period (`once`: any), from `verified` (items with `challenge === c.id && period === periodKey(...)`) or `claims` with `status === 'verified'`.
    - `waiting`: a claim for the current period with `status === 'new'`.
    - `rejected`: the newest claim for the current period has `status === 'rejected'` and local progress still ≥ goal → `{ kind: 'rejected', value, reason: reasons?.[0] ?? 'Not verified yet' }` (the card still offers Claim).
    - `ready`: `value >= goal`.
    - else `progress`.
  - `useChallenges.ts`: `useChallenges(): { items: { challenge: Challenge; value: number; state: CardState }[]; loading: boolean; error: string | null; claiming: string | null; message: string | null; claim: (id: string) => Promise<void>; refresh: () => Promise<void> }`. Reads `useMapping((s) => s.sessions)` and `useWallet` address; on focus fetches the challenge list with `fetchChallenges()` (the list comes from the server; keep the last good list in memory if a refresh fails, and show an error line only when there is none) and `fetchNodeSummary(address)`; `claim(id)` builds the claim for `periodKey(c.period, Date.now())`, calls `signAndSubmitClaim` with the wallet's base64 address (`Buffer.from(bs58.decode(address)).toString('base64')`, as `useSubmission` does), sets `message` ("Claim sent. It is checked automatically and the reward arrives once your reports are verified."), then refreshes.
  - `QuestsScreen.tsx`: default export; cards grouped under `Daily`, `Weekly`, `One time` section labels; each card: title, blurb, a progress bar with `value / goal`, reward `+N AZMTest`, and a button: **Go** (state progress or rejected-but-not-ready: navigates to the `Map` or `Satellites` tab via `navigation.navigate(c.go)`), **Claim** (ready or rejected-with-progress: calls `claim`), disabled "Waiting for check" (waiting), "Claimed" check (claimed). Shows connect-wallet text when no wallet is connected, and the error/`message` lines.
  - Navigation: `RootTabParamList` gains `Quests: undefined`; tab placed between Satellites and Profile with icons `{ active: 'trophy', idle: 'trophy-outline' }`; screen wrapped with `guarded(...)`.

- [ ] **Step 1: Failing tests**

`cardState.test.ts`:

```ts
import { cardState } from '../cardState';
import { challengeFromRow } from '../definitions';

const NOW = Date.UTC(2026, 9, 10, 15, 0);
const scan = challengeFromRow({ id: 'scan-30', title: 'Scan', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map' })!;
const chest = challengeFromRow({ id: 'first-chest', title: 'Chest', blurb: '', period: 'once', metric: 'chests_opened', goal: 1, reward: 20, go_tab: 'Map' })!;
const base = { claims: [] as never[], verified: [] as never[], nowMs: NOW };

describe('cardState', () => {
  it('progress while below the goal, ready at the goal', () => {
    expect(cardState(scan, { ...base, value: 12 })).toEqual({ kind: 'progress', value: 12 });
    expect(cardState(scan, { ...base, value: 30 })).toEqual({ kind: 'ready' });
  });
  it('waiting while a claim for this period is unsettled', () => {
    const claims = [{ challengeId: 'scan-30', period: '2026-10-10', status: 'new' as const, reasons: null }];
    expect(cardState(scan, { ...base, claims, value: 30 })).toEqual({ kind: 'waiting' });
  });
  it('claimed after a verified claim for this period, but not for an older period', () => {
    expect(cardState(scan, { ...base, value: 30, verified: [{ type: 'challenge-claim', verified_ms: NOW, challenge: 'scan-30', period: '2026-10-10' }] })).toEqual({ kind: 'claimed' });
    expect(cardState(scan, { ...base, value: 30, verified: [{ type: 'challenge-claim', verified_ms: NOW, challenge: 'scan-30', period: '2026-10-09' }] })).toEqual({ kind: 'ready' });
  });
  it('a one-time challenge stays claimed forever', () => {
    expect(cardState(chest, { ...base, value: 1, verified: [{ type: 'challenge-claim', verified_ms: 1, challenge: 'first-chest', period: 'once' }] })).toEqual({ kind: 'claimed' });
  });
  it('a rejected claim shows the reason and can be claimed again when progress is still enough', () => {
    const claims = [{ challengeId: 'scan-30', period: '2026-10-10', status: 'rejected' as const, reasons: ['23 of 30 verified so far.'] }];
    expect(cardState(scan, { ...base, claims, value: 30 })).toEqual({ kind: 'rejected', value: 30, reason: '23 of 30 verified so far.' });
    expect(cardState(scan, { ...base, claims, value: 10 })).toEqual({ kind: 'progress', value: 10 });
  });
});
```

`QuestsScreen.test.tsx` — render the screen with `useChallenges` mocked (jest.mock with a `mock`-prefixed variable): assert that cards render their titles under the three section labels; an empty list shows 'No challenges right now.' and a failed first load shows the error text; a `progress` item shows a Go button that calls `navigation.navigate('Map')` (mock `@react-navigation/native`'s `useNavigation`), a `ready` item shows Claim and pressing it calls `claim('scan-30')`, `waiting` shows "Waiting for check", `claimed` shows "Claimed", and with no wallet it shows the connect text. Follow an existing screen test in `src/screens/*/__tests__` for how this repo renders screens (providers, mocks, `act`); read one first.

- [ ] **Step 2: Run to confirm failure** — `npx jest src/challenges src/screens/quests`.

- [ ] **Step 3: Implement** `cardState.ts` per the interface above using `periodKey` from `periods.ts`:

```ts
import type { NodeSummary } from '../network/api';
import type { Challenge } from './definitions';
import { periodKey } from './periods';
import type { VerifiedItem } from './progress';

export type CardState =
  | { kind: 'progress'; value: number }
  | { kind: 'ready' }
  | { kind: 'waiting' }
  | { kind: 'claimed' }
  | { kind: 'rejected'; value: number; reason: string };

export function cardState(
  c: Challenge,
  a: { value: number; claims: NodeSummary['claims']; verified: VerifiedItem[]; nowMs: number }
): CardState {
  const key = periodKey(c.period, a.nowMs);
  const mine = (a.claims ?? []).filter((x) => x.challengeId === c.id && x.period === key);
  const paid = a.verified.some((v) => v.type === 'challenge-claim' && v.challenge === c.id && v.period === key);
  if (paid || mine.some((x) => x.status === 'verified')) return { kind: 'claimed' };
  if (mine.some((x) => x.status === 'new')) return { kind: 'waiting' };
  const ready = a.value >= c.goal;
  const rejected = mine.find((x) => x.status === 'rejected');
  if (rejected && ready) return { kind: 'rejected', value: a.value, reason: rejected.reasons?.[0] ?? 'Not verified yet' };
  return ready ? { kind: 'ready' } : { kind: 'progress', value: a.value };
}
```

(`claims` from `node_summary` are ordered newest first, so `find` picks the newest rejection.)

Implement `useChallenges.ts` and `QuestsScreen.tsx` following the interfaces. Screen style: copy structure and imports from `ProfileScreen.tsx` (`Screen`, `GlassCard`, `SectionLabel`, `Button`, `Badge`, `colors`, `typography`); the progress bar is a `View` track with a filled `View` width `${Math.min(100, value / goal * 100)}%`. No new dependencies.

Navigation edits: add `Quests` to `RootTabParamList`, to `TAB_ICONS`, a `GuardedQuests = guarded(QuestsScreen)` and `<Tab.Screen name="Quests" component={GuardedQuests} />` between Satellites and Profile in `RootNavigator.tsx`.

- [ ] **Step 4: Run** — `npx jest src/challenges src/screens/quests && npm run typecheck && npx jest` → all green (report suite counts).

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 9: Docs, live check, final run

**Files:**
- Modify: `docs/IMPLEMENTATION.md` (append a dated section "Challenges (2026-10-10)")
- Modify: `server/.env.example` (no new variables are needed; do not add any)

**Interfaces:**
- Consumes: everything above plus the user having run `server/supabase/schema_challenges.sql`.

- [ ] **Step 1: Ask the user to run the SQL** — "Run `server/supabase/schema_challenges.sql` in the Supabase SQL editor (after `schema_azm.sql`), then tell me." Wait for the answer.

- [ ] **Step 2: Live check on devnet** (with `npm run admin` running and the log line `AZMTest payouts: on (devnet)`): insert a signed `challenge-claim` for `cells-20` for a test wallet that has enough verified new-cell reward rows in the period (or use `server/test/helpers.js` to sign the claim and insert via the Supabase REST API with the service key; for the progress, approve one real or crafted mapping report with at least 20 new cells first). Expected: within 30 seconds (or via "Check challenge claims now") the claim becomes `verified`, 5 AZMTest arrive (`spl-token balance --owner <wallet> <mint> --url devnet`), and the payouts panel shows it with a record link. Then insert a second claim for the same period: expected `rejected` with "already claimed for this period", no second transfer. Then a claim with too little progress: rejected with "N of M verified so far".

- [ ] **Step 3: Docs** — append a section describing: the Quests tab and the five seeded challenges (stored in the `challenges` table, edited in the Supabase table editor, fetched by the app, with the server's cache of up to 60 seconds and the validation rules), the claim flow, the server-side recheck and the UTC periods, the once-per-period rule (server and on-chain hash), the 30-second timer in the portal and that claims wait while the portal is off, the SQL to run, what was verified (tests, live devnet check) and what was not (the tab on a phone, the Seed Vault signing prompt for a claim, timezone behaviour near UTC midnight).

- [ ] **Step 4: Final full runs**

Run: `cd server && npm test`; `cd .. && npm run typecheck && npx jest`
Expected: everything passes. Report exact counts. Do not commit; the controller commits.

---

## Self-Review

**Spec coverage:** Quests tab, cards, Go and Claim (Task 8); automatic progress (Task 6); signed claim, one prompt (Task 7); server recheck from verified reports and reward rows with UTC periods (Tasks 1, 3, 4); automatic payment through the existing `reward` instruction, kind 3, with once-per-period on both sides (Tasks 1, 2, 4); portal timer and manual check (Task 5); `challenge-claim` type in the DB and summary fields for card states (Task 3); errors (unmet progress, stale period, duplicate, chain failure, no chain) in Task 4's tests; live check and docs (Task 9). Sonde challenge cut as in the spec. The spec's `ground-1mi` became `ground-weekly` with a goal of 70 cells (recorded as a ruling in Global Constraints).

**Placeholder scan:** none; the places that say "read the file first" (helpers, screen test style, type names) point at code that already exists and name what to adapt.

**Type consistency:** `Challenge` fields, `periodKey/previousPeriodKey/periodWindow/isClaimablePeriod` (same names and vectors in server and app), `onchainHash(id, key)`, `progressFor(metric, {reports, rewards}, newCellUsdc)`, `verifyClaim`, sink methods, `settleChallenges`, `payOnChain(hash, node, type, amount, chainHash)`, `NodeSummary.claims`, `VerifiedItem`, `cardState`, `useChallenges` are used with the same names and shapes across tasks.
