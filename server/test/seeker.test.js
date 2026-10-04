'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../lib/store');
const { createSeekerGate, findSeekerMint, SGT_METADATA_ADDRESS, SGT_GROUP_ADDRESS, TOKEN_2022_PROGRAM } = require('../lib/seeker');

const sgtMint = (extra = {}) => ({
  data: { parsed: { info: { extensions: [
    { extension: 'metadataPointer', state: { metadataAddress: SGT_METADATA_ADDRESS } },
    { extension: 'tokenGroupMember', state: { group: SGT_GROUP_ADDRESS } },
  ], ...extra } } },
});
const otherMint = { data: { parsed: { info: { extensions: [] } } } };

/** A fake chain: wallets map to token accounts, mints map to account info. */
function fakeRpc(wallets, mints) {
  return async (method, params) => {
    if (method === 'getTokenAccountsByOwner') {
      assert.equal(params[1].programId, TOKEN_2022_PROGRAM);
      return { value: (wallets[params[0]] || []).map(([mint, amount]) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount: String(amount) } } } } } })) };
    }
    if (method === 'getAccountInfo') return { value: mints[params[0]] };
    throw new Error('unexpected ' + method);
  };
}

test('finds an SGT among other tokens and ignores zero balances', async () => {
  const rpc = fakeRpc(
    { alice: [['spam', 1], ['old', 0], ['sgt1', 1]], bob: [['old', 0]] },
    { spam: otherMint, old: sgtMint(), sgt1: sgtMint() }
  );
  assert.equal(await findSeekerMint(rpc, 'alice'), 'sgt1');
  assert.equal(await findSeekerMint(rpc, 'bob'), null, 'a transferred-away SGT leaves a zero-balance account');
  assert.equal(await findSeekerMint(rpc, 'nobody'), null);
});

test('binds one SGT to one node and refuses reuse', async () => {
  const store = openStore(':memory:');
  const rpc = fakeRpc({ alice: [['sgt1', 1]], bob: [['sgt1', 1]], carol: [['spam', 1]] }, { sgt1: sgtMint(), spam: otherMint });
  const gate = createSeekerGate({ rpc, store });

  assert.deepEqual(await gate('alice'), { ok: true, mint: 'sgt1' });
  assert.equal((await gate('alice')).ok, true, 'same node again is fine');
  const bob = await gate('bob');
  assert.equal(bob.ok, false);
  assert.match(bob.reason, /already linked/);
  const carol = await gate('carol');
  assert.match(carol.reason, /does not hold/);
});

test('fails closed when the chain cannot be reached', async () => {
  const gate = createSeekerGate({ rpc: async () => { throw new Error('down'); }, store: openStore(':memory:') });
  const out = await gate('alice');
  assert.equal(out.ok, false);
  assert.match(out.reason, /could not check/);
});
