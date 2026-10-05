'use strict';

const BUCKET_MS = 15 * 60_000;
const MAX_BUCKETS = 500;
const MAX_REPORT_AGE_MS = 72 * 3600_000;
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_SAMPLES_PER_BUCKET = 120;
const MAX_PLAUSIBLE_SPEED_MPS = 70;
const CELL_ID = /^h(\d+):(-?\d+):(-?\d+)$/;

const isInt = (v) => Number.isInteger(v);
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * Plausibility checks on the contents of a report whose signature has already been verified.
 * These catch honest mistakes and cheap fabrication; they cannot prove the radio readings are real.
 * @returns {string[]} problems, empty when the report is plausible
 */
function checkReport(report, now = Date.now()) {
  const problems = [];
  if (!['mapping-session', 'chest-claim', 'satellite-pass'].includes(report.type)) problems.push(`unknown report type "${report.type}"`);
  if (!report.device || typeof report.device.model !== 'string' || report.device.model.length > 64) problems.push('bad device info');

  const buckets = Array.isArray(report.buckets) ? report.buckets : [];
  if (buckets.length === 0 || buckets.length > MAX_BUCKETS) problems.push(`bucket count ${buckets.length} outside 1..${MAX_BUCKETS}`);

  let totalSamples = 0;
  const seen = new Set();
  for (const [i, b] of buckets.entries()) {
    const tag = `bucket ${i}`;
    if (typeof b.cellId !== 'string' || !CELL_ID.test(b.cellId)) { problems.push(`${tag}: bad cell id`); continue; }
    if (!isInt(b.bucketStartMs) || b.bucketStartMs % BUCKET_MS !== 0) problems.push(`${tag}: time is not on a bucket boundary`);
    else if (b.bucketStartMs < now - MAX_REPORT_AGE_MS) problems.push(`${tag}: older than ${MAX_REPORT_AGE_MS / 3600_000} h`);
    else if (b.bucketStartMs > now + MAX_FUTURE_MS) problems.push(`${tag}: in the future`);
    const key = `${b.cellId}@${b.bucketStartMs}`;
    if (seen.has(key)) problems.push(`${tag}: duplicate cell and time`);
    seen.add(key);

    if (!isInt(b.samples) || b.samples < 1 || b.samples > MAX_SAMPLES_PER_BUCKET) { problems.push(`${tag}: sample count out of range`); continue; }
    totalSamples += b.samples;

    const c = b.cellular || {};
    if (c.seen + c.none > b.samples) problems.push(`${tag}: more cellular readings than samples`);
    if (c.seen > 0) {
      const mean = c.bestDbmSum / c.seen;
      if (!inRange(mean, -140, -30)) problems.push(`${tag}: cellular level ${mean.toFixed(0)} dBm is not physical`);
      if (!(c.bestDbmMin <= mean + 1e-6 && mean <= c.bestDbmMax + 1e-6)) problems.push(`${tag}: cellular min/mean/max are inconsistent`);
    }
    const w = b.wifi || {};
    if (w.samples > b.samples) problems.push(`${tag}: more Wi-Fi readings than samples`);
    if (w.samples > 0 && (w.countMax < 0 || w.countSum > w.countMax * w.samples || w.countMax > 400)) problems.push(`${tag}: Wi-Fi counts are inconsistent`);
    const bt = b.bluetooth || {};
    if (bt.samples > b.samples) problems.push(`${tag}: more Bluetooth readings than samples`);
    if (bt.samples > 0 && (bt.countMax < 0 || bt.countSum > bt.countMax * bt.samples || bt.countMax > 2000)) problems.push(`${tag}: Bluetooth counts are inconsistent`);
    const sd = b.sonde;
    if (sd) {
      if (!inRange(sd.frequencyHz, 400_000_000, 406_000_000)) problems.push(`${tag}: sonde frequency is outside 400 to 406 MHz`);
      else if (!(sd.samples >= 1 && sd.samples <= b.samples) || sd.detected > sd.samples || sd.detected < 0) problems.push(`${tag}: sonde counts are inconsistent`);
      else if (!inRange(sd.peakDbMax, 0, 80) || !inRange(sd.rmsMax, 0, 1) || !inRange(sd.clipMax, 0, 1)) problems.push(`${tag}: sonde levels are not physical`);
    }
    const bc = b.beacon;
    if (bc) {
      if (typeof bc.name !== 'string' || bc.name.length < 1 || bc.name.length > 32) problems.push(`${tag}: bad beacon name`);
      else if (!(bc.samples >= 1 && bc.samples <= b.samples) || bc.seen > bc.samples || bc.seen < 0) problems.push(`${tag}: beacon counts are inconsistent`);
      else if (bc.seen > 0 && !inRange(bc.rssiMax, -127, 0)) problems.push(`${tag}: beacon signal level is not physical`);
    }
    const r = b.radio;
    if (r) {
      if (!(r.samples >= 1 && r.samples <= b.samples)) problems.push(`${tag}: radio reading count is inconsistent`);
      else if (r.carriers > r.samples) problems.push(`${tag}: more Meteor carriers than radio readings`);
      else if (!inRange(r.peakDbMax, 0, 80) || r.peakDbSum > r.peakDbMax * r.samples + 1e-6) problems.push(`${tag}: radio levels are not physical`);
      else if (!inRange(r.rmsMax, 0, 1) || !inRange(r.clipMax, 0, 1)) problems.push(`${tag}: radio input level is not physical`);
    }
    const g = b.gnss || {};
    if (g.samples > 0 && !inRange(g.cn0Sum / g.samples, 5, 60)) problems.push(`${tag}: GNSS signal level is not physical`);
  }

  const k = report.checks || {};
  if (k.mockedFixes > 0) problems.push('the phone flagged mock locations during this session');
  if (!(k.maxSpeedMps <= MAX_PLAUSIBLE_SPEED_MPS)) problems.push('movement speed is not plausible');
  if (!(k.durationSec >= 30)) problems.push('session too short to count');
  if (k.samples !== totalSamples) problems.push(`check total ${k.samples} does not match bucket total ${totalSamples}`);
  // A session cannot contain more readings than its length allows (one every ~20 s, with some slack).
  if (k.durationSec > 0 && totalSamples > Math.ceil(k.durationSec / 10) + 2) problems.push('more readings than the session length allows');
  return problems;
}

const PASS_SATELLITES = { '57166': 'Meteor-M2 3', '59051': 'Meteor-M2 4' };
const PASS_SAMPLE_RATES = [2_304_000, 288_000];

/** Shape and consistency checks for the `pass` section of a satellite-pass report. */
function checkPassShape(report, now = Date.now()) {
  const p = report.pass;
  if (!p || typeof p !== 'object') return ['satellite-pass report has no pass section'];
  const problems = [];
  if (!PASS_SATELLITES[p.noradId]) problems.push(`satellite ${p.noradId} is not supported`);
  if (!isInt(p.startMs) || !isInt(p.endMs) || p.endMs <= p.startMs) problems.push('pass window is invalid');
  else {
    const duration = (p.endMs - p.startMs) / 1000;
    if (duration < 60 || duration > 1200) problems.push(`pass window of ${duration.toFixed(0)} s is not realistic`);
    if (p.endMs > now + MAX_FUTURE_MS) problems.push('pass ends in the future');
    if (p.startMs < now - MAX_REPORT_AGE_MS) problems.push('pass is older than 72 hours');
  }
  if (!inRange(p.maxElevationDeg, 0, 90)) problems.push('peak elevation is out of range');
  if (!inRange(p.frequencyHz, 137_000_000, 138_000_000)) problems.push('frequency is outside the Meteor LRPT band');
  const rec = p.recording;
  if (!rec || !PASS_SAMPLE_RATES.includes(rec.sampleRateHz)) problems.push('recording sample rate is not recognised');
  else {
    if (!(rec.samples > 0) || !(rec.bytes > 0)) problems.push('recording is empty');
    const recSec = rec.samples / rec.sampleRateHz;
    const window = (p.endMs - p.startMs) / 1000;
    if (recSec < 30) problems.push('recording is too short to count');
    if (recSec > window + 180) problems.push('recording is longer than the pass window allows');
    // Signed 8-bit I/Q is two bytes per sample.
    if (Math.abs(rec.bytes - rec.samples * 2) > 4096) problems.push('recording size does not match its sample count');
    if (!(rec.droppedBlocks >= 0)) problems.push('dropped block count is invalid');
  }
  return problems;
}

function parseCell(id) {
  const m = CELL_ID.exec(id);
  return m ? { size: Number(m[1]), q: Number(m[2]), r: Number(m[3]) } : null;
}

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** The cell and its six neighbours. */
function cellAndNeighbours(id) {
  const c = parseCell(id);
  if (!c) return [];
  return [id, ...DIRS.map(([dq, dr]) => `h${c.size}:${c.q + dq}:${c.r + dr}`)];
}

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

module.exports = { checkReport, checkPassShape, parseCell, cellAndNeighbours, hexDistance, BUCKET_MS, PASS_SATELLITES };
