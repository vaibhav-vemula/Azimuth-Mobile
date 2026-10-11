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
