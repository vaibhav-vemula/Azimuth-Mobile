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
