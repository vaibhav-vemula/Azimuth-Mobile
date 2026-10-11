'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Keypair, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const { createChain, discriminator } = require('../lib/chain');

const programId = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const authority = Keypair.generate();
const wallet = Keypair.generate().publicKey;
const HASH = 'ab'.repeat(32);

function fakeConnection(over = {}) {
  const sent = [];
  return {
    sent,
    async getLatestBlockhash() { return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 }; },
    async sendRawTransaction(bytes) { sent.push(bytes); if (over.sendError) throw over.sendError; return 'SIG' + sent.length; },
    async confirmTransaction() { return { value: { err: over.confirmErr || null } }; },
    async getAccountInfo(pk) { return over.accounts ? over.accounts(pk) : null; },
    async getTokenAccountBalance() { return { value: { amount: '1234' } }; },
    ...over.methods,
  };
}
const recordFor = () => PublicKey.findProgramAddressSync([Buffer.from('report'), wallet.toBuffer(), Buffer.from(HASH, 'hex')], programId)[0].toBase58();
const make = (conn) => createChain({ connection: conn, authority, programId, mint });

test('discriminator is the first 8 bytes of sha256("global:<name>")', () => {
  assert.deepEqual([...discriminator('reward')], [...crypto.createHash('sha256').update('global:reward').digest().subarray(0, 8)]);
});

test('reward builds the instruction with the right accounts and data, signed by the authority', async () => {
  const conn = fakeConnection();
  const out = await make(conn).reward({ wallet: wallet.toBase58(), hash: HASH, kind: 1, amount: 25 });
  assert.equal(out.signature, 'SIG1');
  assert.equal(out.existed, false);

  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
  const [record] = PublicKey.findProgramAddressSync([Buffer.from('report'), wallet.toBuffer(), Buffer.from(HASH, 'hex')], programId);
  assert.equal(out.record, record.toBase58());

  const { Transaction } = require('@solana/web3.js');
  const tx = Transaction.from(conn.sent[0]);
  const ix = tx.instructions[0];
  assert.equal(ix.programId.toBase58(), programId.toBase58());
  assert.deepEqual(ix.keys.map((k) => k.pubkey.toBase58()), [
    authority.publicKey, config, mint, getAssociatedTokenAddressSync(mint, config, true), wallet,
    getAssociatedTokenAddressSync(mint, wallet), record,
    new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
    new PublicKey('11111111111111111111111111111111'),
  ].map((k) => k.toBase58()));
  assert.equal(ix.keys[0].isSigner, true);
  assert.equal(ix.keys[0].isWritable, true);
  assert.equal(ix.keys[3].isWritable, true);
  assert.equal(ix.keys[5].isWritable, true);
  assert.equal(ix.keys[6].isWritable, true);

  assert.equal(ix.data.length, 8 + 32 + 1 + 8);
  assert.deepEqual([...ix.data.subarray(0, 8)], [...discriminator('reward')]);
  assert.equal(ix.data.subarray(8, 40).toString('hex'), HASH);
  assert.equal(ix.data[40], 1);
  assert.equal(ix.data.readBigUInt64LE(41), 25n);
});

test('an "already in use" failure means the report was already recorded: success, no second payment', async () => {
  const err = Object.assign(new Error('Transaction simulation failed: custom program error: 0x0'), { logs: [`Allocate: account Address { address: ${recordFor()} } already in use`] });
  const out = await make(fakeConnection({ sendError: err })).reward({ wallet: wallet.toBase58(), hash: HASH, kind: 0, amount: 3 });
  assert.equal(out.existed, true);
  assert.equal(out.signature, null);
});

test('other failures are thrown with a readable message', async () => {
  const err = Object.assign(new Error('Simulation failed'), { logs: ['Program log: AnchorError ... Error Code: Paused. Error Message: Rewards are paused.'] });
  await assert.rejects(make(fakeConnection({ sendError: err })).reward({ wallet: wallet.toBase58(), hash: HASH, kind: 0, amount: 3 }), /paused/i);
});

test('a confirmed transaction that failed on-chain is an error', async () => {
  await assert.rejects(make(fakeConnection({ confirmErr: { InstructionError: [0, 'Custom'] } })).reward({ wallet: wallet.toBase58(), hash: HASH, kind: 0, amount: 3 }), /failed on-chain/i);
});

test('inputs are validated before anything is sent', async () => {
  const conn = fakeConnection();
  const chain = make(conn);
  await assert.rejects(chain.reward({ wallet: wallet.toBase58(), hash: 'zz', kind: 0, amount: 3 }), /hash/);
  await assert.rejects(chain.reward({ wallet: wallet.toBase58(), hash: HASH, kind: 0, amount: 0 }), /amount/);
  await assert.rejects(chain.reward({ wallet: wallet.toBase58(), hash: HASH, kind: 0, amount: 1.5 }), /amount/);
  await assert.rejects(chain.reward({ wallet: 'not-a-wallet', hash: HASH, kind: 0, amount: 1 }), /wallet/);
  assert.equal(conn.sent.length, 0);
});

test('status reads the config account and the vault balance', async () => {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
  const data = Buffer.alloc(8 + 32 + 32 + 8 + 1 + 1);
  authority.publicKey.toBuffer().copy(data, 8);
  mint.toBuffer().copy(data, 40);
  data.writeBigUInt64LE(100n, 72);
  data[80] = 1;
  const conn = fakeConnection({ accounts: (pk) => (pk.equals(config) ? { data } : null) });
  const s = await make(conn).status();
  assert.deepEqual(s, { vaultBalance: 1234, paused: true, maxReward: 100, authority: authority.publicKey.toBase58() });
});

test('"already in use" naming a different address is not treated as already rewarded', async () => {
  const err = Object.assign(new Error('failed'), { logs: [`Allocate: account Address { address: ${Keypair.generate().publicKey.toBase58()} } already in use`] });
  await assert.rejects(make(fakeConnection({ sendError: err })).reward({ wallet: wallet.toBase58(), hash: HASH, kind: 0, amount: 3 }), /already in use/);
});

test('setPaused builds the admin instruction signed by the authority', async () => {
  const { Transaction } = require('@solana/web3.js');
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
  for (const paused of [true, false]) {
    const conn = fakeConnection();
    const out = await make(conn).setPaused(paused);
    assert.equal(out.signature, 'SIG1');
    const tx = Transaction.from(conn.sent[0]);
    assert.equal(tx.feePayer.toBase58(), authority.publicKey.toBase58());
    const ix = tx.instructions[0];
    assert.equal(ix.programId.toBase58(), programId.toBase58());
    assert.equal(ix.keys.length, 2);
    assert.equal(ix.keys[0].pubkey.toBase58(), authority.publicKey.toBase58());
    assert.equal(ix.keys[0].isSigner, true);
    // The authority is the fee payer, so the wire message always marks it writable; the instruction itself declares it read-only.
    assert.equal(ix.keys[1].pubkey.toBase58(), config.toBase58());
    assert.equal(ix.keys[1].isWritable, true);
    assert.equal(ix.data.length, 9);
    assert.deepEqual([...ix.data.subarray(0, 8)], [...discriminator('set_paused')]);
    assert.equal(ix.data[8], paused ? 1 : 0);
  }
});

test('kind above 3 is rejected locally', async () => {
  const conn = fakeConnection();
  await assert.rejects(make(conn).reward({ wallet: wallet.toBase58(), hash: HASH, kind: 4, amount: 1 }), /kind/);
  assert.equal(conn.sent.length, 0);
});

test('an off-curve wallet reads as invalid wallet', async () => {
  const [offCurve] = PublicKey.findProgramAddressSync([Buffer.from('x')], programId);
  await assert.rejects(make(fakeConnection()).reward({ wallet: offCurve.toBase58(), hash: HASH, kind: 0, amount: 1 }), /invalid wallet/);
});

test('status reports an uninitialized registry before touching the vault', async () => {
  let vaultCalls = 0;
  const conn = fakeConnection({ methods: { async getTokenAccountBalance() { vaultCalls++; throw new Error('vault'); } } });
  await assert.rejects(make(conn).status(), /not initialized/);
  assert.equal(vaultCalls, 0);
});

test('status rejects a short config account', async () => {
  const conn = fakeConnection({ accounts: () => ({ data: Buffer.alloc(40) }) });
  await assert.rejects(make(conn).status(), /malformed/);
});
