/**
 * One-off devnet setup: creates the AZMTest mint (0 decimals), initializes the registry, funds the vault.
 * Requires ANCHOR_WALLET (authority keypair path) and ANCHOR_PROVIDER_URL; neither is defaulted. Writes only public addresses.
 * Resumable: if devnet.json is missing but the registry is already initialized, reuses its mint and tops up balances.
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/devnet.json npx ts-node scripts/setup-azmtest.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createMint, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, mintTo, getAccount,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const TOTAL = 1_000_000_000; // whole AZMTest
const VAULT = 100_000_000;
const MAX_REWARD = 100; // per-report cap enforced on-chain (the server rules never exceed 50)

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const conn = provider.connection;
  const authority = (provider.wallet as anchor.Wallet).payer;
  const program = anchor.workspace.azimuthRegistry as Program<any>;
  const out = path.join(__dirname, '..', 'devnet.json');
  const endpoint = conn.rpcEndpoint;
  const cluster = /devnet/.test(endpoint) ? 'devnet' : /mainnet/.test(endpoint) ? 'mainnet-beta' : 'localnet';

  if (fs.existsSync(out)) {
    console.log(`${out} already exists. Delete it only if you really want a new mint.\n`, fs.readFileSync(out, 'utf8'));
    return;
  }

  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const existing = await program.account.config.fetchNullable(config);
  let mint: PublicKey;
  if (existing) {
    mint = existing.mint as PublicKey;
    console.log('resuming: registry already initialized, mint', mint.toBase58());
  } else {
    mint = await createMint(conn, authority, authority.publicKey, null, 0);
    console.log('mint', mint.toBase58());
  }
  const vault = getAssociatedTokenAddressSync(mint, config, true);

  if (!existing) {
    await program.methods.initialize(new anchor.BN(MAX_REWARD)).accounts({
      authority: authority.publicKey, config, mint, vault,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();
  }

  // Write addresses right away so a failure below can never orphan the initialized registry.
  fs.writeFileSync(out, JSON.stringify({
    cluster, programId: program.programId.toBase58(), mint: mint.toBase58(),
    config: config.toBase58(), vault: vault.toBase58(), authority: authority.publicKey.toBase58(),
  }, null, 2) + '\n');
  console.log('wrote', out);

  // Top up to targets (idempotent: never double-mints on resume).
  const mine = await getOrCreateAssociatedTokenAccount(conn, authority, mint, authority.publicKey);
  const haveMine = Number((await getAccount(conn, mine.address)).amount);
  if (haveMine < TOTAL - VAULT) await mintTo(conn, authority, mint, mine.address, authority, TOTAL - VAULT - haveMine);
  const haveVault = Number((await getAccount(conn, vault)).amount);
  if (haveVault < VAULT) await mintTo(conn, authority, mint, vault, authority, VAULT - haveVault);

  await tryMetadata(mint, authority);
}

/** Best effort: the token works without metadata, wallets just show it as unknown. */
async function tryMetadata(mint: PublicKey, authority: anchor.web3.Keypair) {
  try {
    // Module names go through variables so tsc/ts-node do not fail when the optional deps are absent.
    const imp = (m: string): Promise<any> => import(m);
    const { createUmi } = await imp('@metaplex-foundation/umi-bundle-defaults');
    const { createSignerFromKeypair, signerIdentity, publicKey, percentAmount } = await imp('@metaplex-foundation/umi');
    const { mplTokenMetadata, createV1, TokenStandard } = await imp('@metaplex-foundation/mpl-token-metadata');
    const umi = createUmi(process.env.ANCHOR_PROVIDER_URL || 'https://api.devnet.solana.com').use(mplTokenMetadata());
    const kp = umi.eddsa.createKeypairFromSecretKey(authority.secretKey);
    umi.use(signerIdentity(createSignerFromKeypair(umi, kp)));
    await createV1(umi, {
      mint: publicKey(mint.toBase58()), authority: umi.identity,
      name: 'AZMTest', symbol: 'AZMTEST', uri: '', sellerFeeBasisPoints: percentAmount(0),
      tokenStandard: TokenStandard.Fungible,
    }).sendAndConfirm(umi);
    console.log('metadata set: AZMTest / AZMTEST');
  } catch (e) {
    console.warn('Metadata step skipped (install @metaplex-foundation/umi, umi-bundle-defaults, mpl-token-metadata to enable):', (e as Error).message);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
