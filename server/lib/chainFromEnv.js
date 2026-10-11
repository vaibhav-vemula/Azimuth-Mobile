'use strict';
const fs = require('node:fs');
const os = require('node:os');
const { Connection, Keypair } = require('@solana/web3.js');
const { createChain } = require('./chain');

/** The on-chain payout client from environment settings, or null when payouts are not configured. */
function chainFromEnv(env = process.env) {
  const file = env.AZM_AUTHORITY_KEYPAIR;
  if (!file || !env.AZM_PROGRAM_ID || !env.AZM_MINT) return null;
  let authority;
  try {
    const raw = JSON.parse(fs.readFileSync(file.replace(/^~(?=\/)/, os.homedir()), 'utf8'));
    authority = Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch (e) {
    throw new Error(`AZM_AUTHORITY_KEYPAIR could not be read as a Solana keypair file: ${e.message}`);
  }
  const connection = new Connection(env.SOLANA_RPC || 'https://api.devnet.solana.com', 'confirmed');
  return createChain({ connection, authority, programId: env.AZM_PROGRAM_ID, mint: env.AZM_MINT });
}

module.exports = { chainFromEnv };
