#!/usr/bin/env node
/**
 * Independent verifier for an Azimuth signed report. It shares no code with the app: it re-implements the
 * canonical JSON rule, base58 decoding and the signature check using only Node's standard library.
 *
 *   node server/lib/verify-report.cjs report.json
 *
 * Exit code 0 = valid, 1 = invalid.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');

const SIGNING_PREFIX = 'azimuth-report-v1\n';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// DER prefix of an ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

function base58Decode(text) {
  let n = 0n;
  for (const ch of text) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) throw new Error(`invalid base58 character "${ch}"`);
    n = n * 58n + BigInt(digit);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros++;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

/** @returns {{valid: boolean, problems: string[], hash?: string, node?: string}} */
function verifyEnvelope(envelope) {
  const problems = [];
  const report = envelope && envelope.report;
  if (!report || typeof report !== 'object') return { valid: false, problems: ['missing report'] };
  if (report.version !== 1) problems.push(`unsupported report version ${report.version}`);
  if (typeof report.node !== 'string') problems.push('missing node address');

  const canonical = canonicalize(report);
  const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  if (hash !== envelope.hash) problems.push('hash does not match the report contents');

  try {
    const publicKey = base58Decode(report.node);
    if (publicKey.length !== 32) throw new Error(`node address decodes to ${publicKey.length} bytes, expected 32`);
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: 'der', type: 'spki' });
    const signature = Buffer.from(envelope.signature || '', 'base64');
    if (signature.length !== 64) throw new Error(`signature is ${signature.length} bytes, expected 64`);
    const ok = crypto.verify(null, Buffer.from(SIGNING_PREFIX + canonical, 'utf8'), key, signature);
    if (!ok) problems.push('signature is not valid for this node and report');
  } catch (e) {
    problems.push(e.message);
  }

  // Structural sanity: counts and levels only, no identifiers.
  const buckets = Array.isArray(report.buckets) ? report.buckets : [];
  if (buckets.length === 0) problems.push('report has no buckets');
  const text = canonical.toLowerCase();
  for (const forbidden of ['ssid', 'bssid', 'macaddress']) {
    if (text.includes(`"${forbidden}"`)) problems.push(`report contains a forbidden field: ${forbidden}`);
  }

  return { valid: problems.length === 0, problems, hash, node: report.node };
}

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

/** Checks an ed25519 signature over a UTF-8 message by the wallet at a base58 address. */
function verifyMessage(addressBase58, message, signatureBase64) {
  try {
    const publicKey = base58Decode(addressBase58);
    if (publicKey.length !== 32) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: 'der', type: 'spki' });
    const signature = Buffer.from(signatureBase64 || '', 'base64');
    return signature.length === 64 && crypto.verify(null, Buffer.from(message, 'utf8'), key, signature);
  } catch {
    return false;
  }
}

module.exports = { canonicalize, base58Decode, verifyEnvelope, verifyClaim, verifyMessage };

function cli(argv) {
  const file = argv[2];
  if (!file) {
    console.error('usage: node server/lib/verify-report.cjs <report.json>');
    process.exit(2);
  }
  const result = verifyEnvelope(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (result.valid) {
    console.log(`VALID  node=${result.node}  sha256=${result.hash}`);
    process.exit(0);
  }
  console.log('INVALID');
  for (const p of result.problems) console.log(`  - ${p}`);
  process.exit(1);
}

module.exports.cli = cli;
if (require.main === module) cli(process.argv);
