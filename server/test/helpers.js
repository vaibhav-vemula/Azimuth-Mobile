'use strict';
const crypto = require('node:crypto');
const { canonicalize } = require('../lib/verify-report.cjs');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(buf) {
  let n = BigInt('0x' + (buf.toString('hex') || '0'));
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const byte of buf) { if (byte === 0) out = '1' + out; else break; }
  return out;
}

function newNode() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey, address: base58Encode(raw) };
}

const BUCKET = 15 * 60_000;
const floorBucket = (t) => Math.floor(t / BUCKET) * BUCKET;

function bucket(cellId, atMs, over = {}) {
  return {
    cellId,
    bucketStartMs: floorBucket(atMs),
    samples: 3,
    cellular: { seen: 3, none: 0, bestDbmSum: -270, bestDbmMin: -92, bestDbmMax: -88, maxCells: 2, techs: ['lte'] },
    wifi: { samples: 3, countSum: 12, countMax: 5, strongestDbmMax: -50 },
    bluetooth: { samples: 1, countSum: 8, countMax: 8 },
    gnss: { samples: 3, cn0Sum: 90, usedSum: 24 },
    ...over,
  };
}

function signedReport(node, buckets, over = {}, now = Date.now()) {
  const total = buckets.reduce((n, b) => n + b.samples, 0);
  const report = {
    version: 1,
    type: 'mapping-session',
    node: node.address,
    device: { model: 'Seeker', app: '1.0.0' },
    firstBucketMs: buckets[0].bucketStartMs,
    buckets,
    checks: { samples: total, mockedFixes: 0, poorAccuracyFixes: 0, maxSpeedMps: 1.5, durationSec: Math.max(60, total * 20) },
    ...over,
  };
  const message = Buffer.from('azimuth-report-v1\n' + canonicalize(report), 'utf8');
  return {
    report,
    signature: crypto.sign(null, message, node.privateKey).toString('base64'),
    hash: crypto.createHash('sha256').update(canonicalize(report), 'utf8').digest('hex'),
  };
}

/** Re-signs an envelope after its report was edited (so tests can add fields before signing). */
function resign(envelope, node) {
  const message = Buffer.from('azimuth-report-v1\n' + canonicalize(envelope.report), 'utf8');
  return {
    report: envelope.report,
    signature: crypto.sign(null, message, node.privateKey).toString('base64'),
    hash: crypto.createHash('sha256').update(canonicalize(envelope.report), 'utf8').digest('hex'),
  };
}

function signText(node, text) {
  return crypto.sign(null, Buffer.from(text, 'utf8'), node.privateKey).toString('base64');
}

module.exports = { signText, newNode, bucket, signedReport, floorBucket, resign };
