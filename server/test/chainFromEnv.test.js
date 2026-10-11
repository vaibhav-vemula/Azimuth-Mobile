'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Keypair } = require('@solana/web3.js');
const { chainFromEnv } = require('../lib/chainFromEnv');

test('returns null unless the three settings are present', () => {
  assert.equal(chainFromEnv({}), null);
  assert.equal(chainFromEnv({ AZM_PROGRAM_ID: Keypair.generate().publicKey.toBase58() }), null);
});

test('builds a chain from a keypair file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azm-'));
  const file = path.join(dir, 'k.json');
  fs.writeFileSync(file, JSON.stringify([...Keypair.generate().secretKey]));
  const chain = chainFromEnv({ AZM_AUTHORITY_KEYPAIR: file, AZM_PROGRAM_ID: Keypair.generate().publicKey.toBase58(), AZM_MINT: Keypair.generate().publicKey.toBase58() });
  assert.equal(typeof chain.reward, 'function');
});

test('a missing or malformed keypair file gives a clear error', () => {
  const ids = { AZM_PROGRAM_ID: Keypair.generate().publicKey.toBase58(), AZM_MINT: Keypair.generate().publicKey.toBase58() };
  assert.throws(() => chainFromEnv({ ...ids, AZM_AUTHORITY_KEYPAIR: '/no/such/file.json' }), /AZM_AUTHORITY_KEYPAIR/);
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'azm-')), 'bad.json');
  fs.writeFileSync(bad, '{"nope":1}');
  assert.throws(() => chainFromEnv({ ...ids, AZM_AUTHORITY_KEYPAIR: bad }), /AZM_AUTHORITY_KEYPAIR/);
});
