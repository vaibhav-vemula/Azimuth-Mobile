'use strict';
const crypto = require('node:crypto');
const { PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');

/**
 * Talks to the azimuth_registry program. Instructions are built by hand from the program's layout (see
 * onchain/programs/azimuth_registry/src/lib.rs), so a change there must be mirrored here and in test/chain.test.js.
 */
/** Highest valid report kind; mirrors KIND_MAX in lib.rs. */
const KIND_MAX = 3;
const discriminator = (name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const key = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const toKey = (v, what) => {
  try { return v instanceof PublicKey ? v : new PublicKey(v); } catch { throw new Error(`invalid ${what}`); }
};

/** Error text from a failed send, including the program log lines when the node returned them. */
function describe(e) {
  const logs = Array.isArray(e && e.logs) ? e.logs.join(' ') : '';
  return `${(e && e.message) || e} ${logs}`.trim();
}

function createChain({ connection, authority, programId, mint }) {
  const program = toKey(programId, 'program id');
  const mintKey = toKey(mint, 'mint');
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program);
  const vault = getAssociatedTokenAddressSync(mintKey, config, true);

  async function send(ix) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: authority.publicKey, recentBlockhash: blockhash }).add(ix);
    tx.sign(authority);
    const signature = await connection.sendRawTransaction(tx.serialize());
    const done = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (done && done.value && done.value.err) throw new Error(`the transaction failed on-chain: ${JSON.stringify(done.value.err)}`);
    return signature;
  }

  function buildRewardIx({ wallet, hash, kind, amount }) {
    const w = toKey(wallet, 'wallet');
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('invalid hash: expected 64 hex characters');
    if (!Number.isInteger(kind) || kind < 0 || kind > KIND_MAX) throw new Error('invalid kind');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('invalid amount: expected a whole number above zero');
    const hashBytes = Buffer.from(hash, 'hex');
    const [record] = PublicKey.findProgramAddressSync([Buffer.from('report'), w.toBuffer(), hashBytes], program);
    let walletToken;
    try { walletToken = getAssociatedTokenAddressSync(mintKey, w); } catch { throw new Error('invalid wallet'); }
    const data = Buffer.alloc(8 + 32 + 1 + 8);
    discriminator('reward').copy(data, 0);
    hashBytes.copy(data, 8);
    data[40] = kind;
    data.writeBigUInt64LE(BigInt(amount), 41);
    const ix = new TransactionInstruction({
      programId: program,
      keys: [
        key(authority.publicKey, true, true), key(config, false, false), key(mintKey, false, false), key(vault, false, true),
        key(w, false, false), key(walletToken, false, true), key(record, false, true),
        key(TOKEN_PROGRAM_ID, false, false), key(ASSOCIATED_TOKEN_PROGRAM_ID, false, false), key(SystemProgram.programId, false, false),
      ],
      data,
    });
    return { ix, record };
  }

  return {
    /** Pays a verified report. A report that was already recorded counts as success (existed: true, no signature). */
    async reward(args) {
      const { ix, record } = buildRewardIx(args);
      try {
        return { signature: await send(ix), record: record.toBase58(), existed: false };
      } catch (e) {
        const text = describe(e);
        if (/already in use/i.test(text) && text.includes(record.toBase58())) return { signature: null, record: record.toBase58(), existed: true };
        const named = /Error Message: ([^.]+)\./.exec(text);
        throw new Error(named ? named[1] : text.slice(0, 300));
      }
    },

    async setPaused(paused) {
      const data = Buffer.alloc(9);
      discriminator('set_paused').copy(data, 0);
      data[8] = paused ? 1 : 0;
      const ix = new TransactionInstruction({ programId: program, keys: [key(authority.publicKey, true, false), key(config, false, true)], data });
      return { signature: await send(ix) };
    },

    /** Vault balance and the program's switches, for the portal. */
    async status() {
      const acct = await connection.getAccountInfo(config);
      if (!acct) throw new Error('the registry is not initialized on this cluster');
      const d = Buffer.from(acct.data);
      if (d.length < 82) throw new Error('the registry config account is malformed');
      const bal = await connection.getTokenAccountBalance(vault);
      return {
        vaultBalance: Number(bal.value.amount),
        paused: d[80] === 1,
        maxReward: Number(d.readBigUInt64LE(72)),
        authority: new PublicKey(d.subarray(8, 40)).toBase58(),
      };
    },
  };
}

module.exports = { createChain, discriminator };
