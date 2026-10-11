# AZMTest Token and On-Chain Report Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin approves a report (mapping session, satellite pass, chest claim), the submitting wallet is paid AZMTest (a devnet, 0-decimal SPL token) and the report hash is stored on-chain against that wallet, exactly once.

**Architecture:** A new Anchor program `azimuth_registry` holds a Config PDA, a vault (ATA of the Config PDA) and one `ReportRecord` PDA per `(wallet, report_hash)`; its `reward` instruction, signed by the admin authority only, creates the record and transfers tokens. The admin portal server builds and sends that instruction right after approval (relayer model: the authority pays fees; the user signs nothing extra). The app only reads: AZMTest balance over RPC and a verified list from `node_summary`.

**Tech Stack:** Anchor 0.31 (Rust, `anchor-spl`), Mocha/ts-mocha tests, `@solana/web3.js` + `@solana/spl-token` (server and scripts), Node 22 `node:test` (server), Supabase REST (PostgREST), Expo/React Native + Jest (app).

**Spec:** `docs/superpowers/specs/2026-10-10-azmtest-registry-design.md`

## Global Constraints

- Everything runs on **devnet**. No mainnet code paths.
- Token name `AZMTest`, symbol `AZMTEST`, **0 decimals**: every amount (rules, program, portal, app) is a whole integer; nothing is rounded.
- Rejected reports are never written on-chain. The record is written at **approval time**.
- The user signs nothing extra and needs no devnet SOL (admin authority pays fees and rent).
- Report kinds: `0` mapping session, `1` satellite pass, `2` chest, `3` challenge (reserved, not used yet).
- Amount rules (whole AZMTest, env-overridable): mapping `min(50, floor(paidCells / 5))`, satellite pass `25`, chest claim `10`; zero means nothing is paid.
- A report pays once: `ReportRecord` PDA seeds `["report", wallet, report_hash]`; "already in use" on retry is treated as success.
- A failed chain call leaves the report **approved but unpaid** with `onchain_error` set and a Retry in the portal.
- Secrets stay out of git: `server/.env` untracked; the authority keypair is read from a path (`AZM_AUTHORITY_KEYPAIR`), never copied into the repo. `onchain/devnet.json` holds only public addresses.
- **Do NOT run `git add`, `git commit`, or anything that touches `.git`.** The user commits manually. Never add co-author lines. Where this plan says "checkpoint", just run the tests and report.
- Run the Supabase SQL (`server/supabase/schema_azm.sql`) is a manual step for the user in the Supabase SQL editor; tell them.

## Review Focus

- **Same report approved/retried twice** (portal double-click, retry after a lost response): must pay exactly once. Tested in program (repeated hash fails) and `chain.js` ("already in use" → success with no second payment).
- **Wallet with no token account:** `reward` creates it; the user needs no SOL. Tested in the program.
- **Vault empty / program paused / wrong authority key:** the portal must show a readable error and leave the report approved-unpaid, retryable. Tested in `review.test.js` (chain failure) and program tests.
- **Mapping session worth less than 5 new cells:** amount is 0 → no chain call, no error, no record. Tested in `azmRewards.test.js` and `review.test.js`.
- **Supabase columns not yet created / sink failing mid-approval:** approval must not crash after the report was marked verified; the error is surfaced. Tested in `review.test.js`.

---

## File Structure

| File | Responsibility |
|---|---|
| `onchain/programs/azimuth_registry/Cargo.toml`, `src/lib.rs` | Program: Config, ReportRecord, `initialize`, `reward`, `set_paused`, `set_max_reward` |
| `onchain/tests/azimuth_registry.ts` | Program tests (local validator) |
| `onchain/scripts/setup-azmtest.ts` | One-off: mint, initialize, fund vault, optional metadata, write `onchain/devnet.json` |
| `server/lib/azmRewards.js` | Pure amount rules and report-kind mapping |
| `server/lib/chain.js` | Builds/sends `reward` and `set_paused`, reads config/vault, injectable connection |
| `server/lib/supabase.js` | New sink methods `setOnchain`, `listPayouts`; `getReport` selects on-chain columns |
| `server/supabase/schema_azm.sql` | New `reports` columns and `node_summary` with `verified` list |
| `server/lib/review.js` | Pay after approve, `retryOnChain` |
| `server/admin/app.js`, `admin.html`, `admin.js` | Payout list, Retry, vault balance, pause switch |
| `server/admin/index.js`, `server/.env.example`, `server/package.json` | Wiring and config |
| `src/wallet/azmBalance.ts` (+ test) | ATA derivation and balance over RPC |
| `src/network/api.ts`, `supabaseApi.ts`, `config.ts`, `useSubmission.ts`, `src/screens/profile/ProfileScreen.tsx` | App side |

---

### Task 1: Anchor program `azimuth_registry` with tests

**Files:**
- Create: `onchain/programs/azimuth_registry/Cargo.toml`
- Create: `onchain/programs/azimuth_registry/src/lib.rs`
- Create: `onchain/tests/azimuth_registry.ts`
- Modify: `onchain/Anchor.toml` (add the program under `[programs.localnet]` and a `[programs.devnet]` section)

**Interfaces:**
- Produces (instruction layouts the server mirrors in Task 5):
  - `initialize(max_reward: u64)`; accounts in order: `authority` (mut, signer), `config` (PDA `["config"]`, init), `mint`, `vault` (ATA of config, init_if_needed), `token_program`, `associated_token_program`, `system_program`.
  - `reward(report_hash: [u8;32], kind: u8, amount: u64)`; accounts in order: `authority` (mut, signer), `config` (PDA), `mint`, `vault` (mut), `wallet` (unchecked), `wallet_token` (mut, init_if_needed ATA), `record` (PDA `["report", wallet, report_hash]`, init), `token_program`, `associated_token_program`, `system_program`. Data = 8-byte discriminator + 32 hash + 1 kind + 8 amount (u64 LE).
  - `set_paused(paused: bool)`; accounts: `authority` (signer), `config` (mut).
  - `set_max_reward(max_reward: u64)`; accounts: `authority` (signer), `config` (mut).
  - Config account data: 8 disc, authority 32, mint 32, max_reward u64, paused u8, bump u8.
  - Errors: `NotAuthority`, `Paused`, `ZeroAmount`, `OverCap`, `UnknownKind`.

- [ ] **Step 1: Create the crate**

`onchain/programs/azimuth_registry/Cargo.toml` (copy dependency versions from `onchain/programs/azimuth_bounty/Cargo.toml`; read it first and mirror it exactly, changing only the name):

```toml
[package]
name = "azimuth_registry"
version = "0.1.0"
description = "Stores report hashes per wallet and pays AZMTest after admin verification"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "azimuth_registry"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]

[dependencies]
anchor-lang = { version = "0.31.0", features = ["init-if-needed"] }
anchor-spl = "0.31.0"
```

- [ ] **Step 2: Register the program in `onchain/Anchor.toml`**

Add under `[programs.localnet]` the line `azimuth_registry = "11111111111111111111111111111111"` (temporary; Step 4 syncs the real id), and a new section:

```toml
[programs.devnet]
azimuth_registry = "11111111111111111111111111111111"
```

- [ ] **Step 3: Write the failing tests** in `onchain/tests/azimuth_registry.ts`

```ts
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createMint, mintTo, getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { assert } from 'chai';

describe('azimuth_registry', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.azimuthRegistry as Program<any>;
  const authority = (provider.wallet as anchor.Wallet).payer;
  const MAX = new anchor.BN(50);

  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  let mint: PublicKey;
  let vault: PublicKey;

  const hash = (n: number) => Array.from({ length: 32 }, (_, i) => (i === 0 ? n : 7));
  const recordFor = (wallet: PublicKey, h: number[]) =>
    PublicKey.findProgramAddressSync([Buffer.from('report'), wallet.toBuffer(), Buffer.from(h)], program.programId)[0];

  const rewardAccounts = (wallet: PublicKey, h: number[], signer = authority.publicKey) => ({
    authority: signer,
    config,
    mint,
    vault,
    wallet,
    walletToken: getAssociatedTokenAddressSync(mint, wallet),
    record: recordFor(wallet, h),
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  });

  const expectFail = async (p: Promise<unknown>, needle: RegExp) => {
    try { await p; } catch (e: any) { assert.match(String(e), needle); return; }
    assert.fail('expected the call to fail');
  };

  before(async () => {
    mint = await createMint(provider.connection, authority, authority.publicKey, null, 0);
    vault = getAssociatedTokenAddressSync(mint, config, true);
    await program.methods.initialize(MAX).accounts({
      authority: authority.publicKey, config, mint, vault,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).rpc();
    await mintTo(provider.connection, authority, mint, vault, authority, 1000);
  });

  it('pays once, creates the token account, writes the record, and drops the vault by exactly the amount', async () => {
    const wallet = Keypair.generate().publicKey;
    const h = hash(1);
    const before = (await getAccount(provider.connection, vault)).amount;
    await program.methods.reward(h, 0, new anchor.BN(12)).accounts(rewardAccounts(wallet, h)).rpc();
    const got = await getAccount(provider.connection, getAssociatedTokenAddressSync(mint, wallet));
    assert.equal(got.amount, 12n);
    assert.equal(before - (await getAccount(provider.connection, vault)).amount, 12n);
    const rec = await program.account.reportRecord.fetch(recordFor(wallet, h));
    assert.equal(rec.wallet.toBase58(), wallet.toBase58());
    assert.equal(rec.amount.toNumber(), 12);
    assert.equal(rec.kind, 0);
  });

  it('refuses to pay the same wallet and hash twice', async () => {
    const wallet = Keypair.generate().publicKey;
    const h = hash(2);
    await program.methods.reward(h, 1, new anchor.BN(5)).accounts(rewardAccounts(wallet, h)).rpc();
    await expectFail(program.methods.reward(h, 1, new anchor.BN(5)).accounts(rewardAccounts(wallet, h)).rpc(), /already in use|custom program error/i);
    const bal = await getAccount(provider.connection, getAssociatedTokenAddressSync(mint, wallet));
    assert.equal(bal.amount, 5n);
  });

  it('refuses a signer that is not the authority', async () => {
    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(stranger.publicKey, 1e9));
    const wallet = Keypair.generate().publicKey;
    const h = hash(3);
    await expectFail(
      program.methods.reward(h, 0, new anchor.BN(1)).accounts(rewardAccounts(wallet, h, stranger.publicKey)).signers([stranger]).rpc(),
      /NotAuthority|has_one|constraint/i
    );
  });

  it('refuses zero, over-cap and unknown kind', async () => {
    const wallet = Keypair.generate().publicKey;
    await expectFail(program.methods.reward(hash(4), 0, new anchor.BN(0)).accounts(rewardAccounts(wallet, hash(4))).rpc(), /ZeroAmount/);
    await expectFail(program.methods.reward(hash(5), 0, new anchor.BN(51)).accounts(rewardAccounts(wallet, hash(5))).rpc(), /OverCap/);
    await expectFail(program.methods.reward(hash(6), 9, new anchor.BN(1)).accounts(rewardAccounts(wallet, hash(6))).rpc(), /UnknownKind/);
  });

  it('refuses while paused and works again after unpausing', async () => {
    const wallet = Keypair.generate().publicKey;
    await program.methods.setPaused(true).accounts({ authority: authority.publicKey, config }).rpc();
    await expectFail(program.methods.reward(hash(7), 0, new anchor.BN(1)).accounts(rewardAccounts(wallet, hash(7))).rpc(), /Paused/);
    await program.methods.setPaused(false).accounts({ authority: authority.publicKey, config }).rpc();
    await program.methods.reward(hash(7), 0, new anchor.BN(1)).accounts(rewardAccounts(wallet, hash(7))).rpc();
  });

  it('lets the authority change the cap', async () => {
    await program.methods.setMaxReward(new anchor.BN(60)).accounts({ authority: authority.publicKey, config }).rpc();
    const wallet = Keypair.generate().publicKey;
    await program.methods.reward(hash(8), 0, new anchor.BN(55)).accounts(rewardAccounts(wallet, hash(8))).rpc();
    await program.methods.setMaxReward(MAX).accounts({ authority: authority.publicKey, config }).rpc();
  });
});
```

- [ ] **Step 4: Run to confirm it fails, then generate the program id**

Run: `cd onchain && anchor keys list` (creates the keypair in `target/deploy/` if missing; if it prints nothing for azimuth_registry, run `anchor build` once, which creates it).
Run: `anchor keys sync` (writes the real id into `Anchor.toml` and `declare_id!`). Expected: `Anchor.toml` now has a real address for `azimuth_registry`; the program has no `lib.rs` yet so the build fails: that is the expected red state.

- [ ] **Step 5: Write `onchain/programs/azimuth_registry/src/lib.rs`**

(`declare_id!` is overwritten by `anchor keys sync`; keep the line, the value below is replaced.)

```rust
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("11111111111111111111111111111111");

/// Whole-token amounts: the AZMTest mint has 0 decimals.
const KIND_MAX: u8 = 3;

#[program]
pub mod azimuth_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, max_reward: u64) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.mint = ctx.accounts.mint.key();
        c.max_reward = max_reward;
        c.paused = false;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn reward(ctx: Context<Reward>, report_hash: [u8; 32], kind: u8, amount: u64) -> Result<()> {
        let c = &ctx.accounts.config;
        require!(!c.paused, RegistryError::Paused);
        require!(amount > 0, RegistryError::ZeroAmount);
        require!(amount <= c.max_reward, RegistryError::OverCap);
        require!(kind <= KIND_MAX, RegistryError::UnknownKind);

        let rec = &mut ctx.accounts.record;
        rec.wallet = ctx.accounts.wallet.key();
        rec.report_hash = report_hash;
        rec.kind = kind;
        rec.amount = amount;
        rec.rewarded_at = Clock::get()?.unix_timestamp;
        rec.bump = ctx.bumps.record;

        let seeds: &[&[u8]] = &[b"config", &[c.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.wallet_token.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit!(Rewarded { wallet: rec.wallet, report_hash, kind, amount });
        Ok(())
    }

    pub fn set_paused(ctx: Context<Admin>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    pub fn set_max_reward(ctx: Context<Admin>, max_reward: u64) -> Result<()> {
        ctx.accounts.config.max_reward = max_reward;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed, payer = authority,
        associated_token::mint = mint, associated_token::authority = config, associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(report_hash: [u8; 32])]
pub struct Reward<'info> {
    #[account(mut, address = config.authority @ RegistryError::NotAuthority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = mint)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint, associated_token::authority = config, associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: only used as the owner of the token account and in the record seeds.
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init_if_needed, payer = authority,
        associated_token::mint = mint, associated_token::authority = wallet, associated_token::token_program = token_program
    )]
    pub wallet_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init, payer = authority, space = 8 + ReportRecord::INIT_SPACE,
        seeds = [b"report", wallet.key().as_ref(), report_hash.as_ref()], bump
    )]
    pub record: Account<'info, ReportRecord>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(address = config.authority @ RegistryError::NotAuthority)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub max_reward: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ReportRecord {
    pub wallet: Pubkey,
    pub report_hash: [u8; 32],
    pub kind: u8,
    pub amount: u64,
    pub rewarded_at: i64,
    pub bump: u8,
}

#[event]
pub struct Rewarded {
    pub wallet: Pubkey,
    pub report_hash: [u8; 32],
    pub kind: u8,
    pub amount: u64,
}

#[error_code]
pub enum RegistryError {
    #[msg("Only the authority can do this")]
    NotAuthority,
    #[msg("Rewards are paused")]
    Paused,
    #[msg("Amount must be above zero")]
    ZeroAmount,
    #[msg("Amount is above the per-report cap")]
    OverCap,
    #[msg("Unknown report kind")]
    UnknownKind,
}
```

- [ ] **Step 6: Run the tests**

Run: `cd onchain && anchor test --skip-deploy=false 2>&1 | tail -40` (the existing `package.json` script `test` adds `--features short-grace` for the bounty program; for this program run `anchor test` directly, or `anchor test -- --features short-grace` if the bounty tests are also in the run).
Expected: all `azimuth_registry` tests pass. If an error-message regex fails because Anchor prints the code differently, fix the regex to the printed message, never loosen it to match anything.
If the build reports `init_if_needed` needs the feature: it is enabled in Step 1's `anchor-lang` line.

- [ ] **Step 7: Checkpoint** — report test output. Do not commit.

---

### Task 2: Setup script `setup-azmtest.ts`

**Files:**
- Create: `onchain/scripts/setup-azmtest.ts`
- Modify: `onchain/package.json` (add script `"setup:azmtest": "ts-node scripts/setup-azmtest.ts"`; if `ts-node` is not installed, use `npx ts-node`)
- Create (by running): `onchain/devnet.json`

**Interfaces:**
- Consumes: Task 1 program, `target/idl/azimuth_registry.json`, `target/types`.
- Produces: `onchain/devnet.json` = `{ "cluster": "devnet", "programId": "...", "mint": "...", "config": "...", "vault": "...", "authority": "..." }` (all public).

- [ ] **Step 1: Write the script**

```ts
/**
 * One-off devnet setup: creates the AZMTest mint (0 decimals), initializes the registry, funds the vault.
 * Reads the authority keypair from $ANCHOR_WALLET or ~/.config/solana/devnet.json. Writes only public addresses.
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/devnet.json npx ts-node scripts/setup-azmtest.ts
 */
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import {
  createMint, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, mintTo,
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

  if (fs.existsSync(out)) {
    console.log(`${out} already exists. Delete it only if you really want a new mint.\n`, fs.readFileSync(out, 'utf8'));
    return;
  }

  const mint = await createMint(conn, authority, authority.publicKey, null, 0);
  console.log('mint', mint.toBase58());

  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const vault = getAssociatedTokenAddressSync(mint, config, true);

  await program.methods.initialize(new anchor.BN(MAX_REWARD)).accounts({
    authority: authority.publicKey, config, mint, vault,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).rpc();

  const mine = await getOrCreateAssociatedTokenAccount(conn, authority, mint, authority.publicKey);
  await mintTo(conn, authority, mint, mine.address, authority, TOTAL - VAULT);
  await mintTo(conn, authority, mint, vault, authority, VAULT);

  fs.writeFileSync(out, JSON.stringify({
    cluster: 'devnet', programId: program.programId.toBase58(), mint: mint.toBase58(),
    config: config.toBase58(), vault: vault.toBase58(), authority: authority.publicKey.toBase58(),
  }, null, 2) + '\n');
  console.log('wrote', out);

  await tryMetadata(mint, authority);
}

/** Best effort: the token works without metadata, wallets just show it as unknown. */
async function tryMetadata(mint: PublicKey, authority: anchor.web3.Keypair) {
  try {
    const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
    const { createSignerFromKeypair, signerIdentity, publicKey, percentAmount } = await import('@metaplex-foundation/umi');
    const { mplTokenMetadata, createV1, TokenStandard } = await import('@metaplex-foundation/mpl-token-metadata');
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
```

- [ ] **Step 2: Dry-run on the local validator** to prove the script works before spending devnet SOL

Run: `cd onchain && anchor localnet` is not needed; use `anchor test --skip-local-validator`? Simpler: start a validator `solana-test-validator --reset --bpf-program <PROGRAM_ID> target/deploy/azimuth_registry.so` in a second terminal (get the id from `anchor keys list`), then
`ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/setup-azmtest.ts`
Expected: prints `mint ...`, `wrote .../devnet.json`, and the metadata step prints either success or the "skipped" warning (a skip is acceptable locally). Delete the generated `onchain/devnet.json` and stop the validator afterwards.

- [ ] **Step 3: Checkpoint** — report output. Do not commit.

---

### Task 3: Deploy to devnet and run the live setup

**Files:**
- Modify: none in source (writes `onchain/devnet.json`, `target/` is already untracked)

**Interfaces:**
- Produces: a deployed program and `onchain/devnet.json` that Task 9 reads into `server/.env`.

- [ ] **Step 1: Confirm cluster and balance**

Run: `solana config get; solana balance --keypair ~/.config/solana/devnet.json --url devnet`
Expected: RPC `https://api.devnet.solana.com`; balance at least 2 SOL (it was 3.78). If lower, `solana airdrop 2 --keypair ~/.config/solana/devnet.json --url devnet`.

- [ ] **Step 2: Build and deploy**

Run: `cd onchain && anchor build && anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/devnet.json --program-name azimuth_registry`
Expected: `Program Id: <address>` matching `anchor keys list`. This costs roughly 1.5–2 SOL of refundable rent. State the cost to the user in the report.

- [ ] **Step 3: Run the setup against devnet**

Run: `cd onchain && ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/devnet.json npx ts-node scripts/setup-azmtest.ts`
Expected: mint printed, `onchain/devnet.json` written.

- [ ] **Step 4: Verify on-chain**

Run: `spl-token supply $(node -p "require('./devnet.json').mint") --url devnet; spl-token balance --address $(node -p "require('./devnet.json').vault") --url devnet`
Expected: supply `1000000000`, vault balance `100000000`.

- [ ] **Step 5: Checkpoint** — report the program id, mint, and the explorer link `https://explorer.solana.com/address/<mint>?cluster=devnet`. Do not commit (`onchain/devnet.json` contains public addresses only and may be committed by the user).

---

### Task 4: Server `azmRewards.js` (amount rules)

**Files:**
- Create: `server/lib/azmRewards.js`
- Test: `server/test/azmRewards.test.js`

**Interfaces:**
- Produces:
  - `KIND = { mapping: 0, satellite: 1, chest: 2, challenge: 3 }`
  - `kindFor(type: string): number | null` — `'mapping-session'→0`, `'satellite-pass'→1`, `'chest-claim'→2`, else `null`.
  - `azmAmount({ type, rows, newCellUsdc }, env = process.env): number` — a non-negative integer; `rows` are reward rows `{ kind, ref, amountUsdc }` as returned by `service.rewardsFor`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { azmAmount, kindFor, KIND } = require('../lib/azmRewards');

const cells = (n) => [{ kind: 'new-cells', ref: '', amountUsdc: Math.round(n * 0.001 * 1e6) / 1e6 }];
const base = { newCellUsdc: 0.001 };

test('mapping pays one token per 5 paid cells, capped at 50, whole numbers only', () => {
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: cells(12) }, {}), 2);
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: cells(4) }, {}), 0);
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: cells(1000) }, {}), 50);
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: [] }, {}), 0);
});

test('satellite pass and chest claim pay fixed amounts', () => {
  assert.equal(azmAmount({ ...base, type: 'satellite-pass', rows: [] }, {}), 25);
  assert.equal(azmAmount({ ...base, type: 'chest-claim', rows: [] }, {}), 10);
});

test('amounts can be changed by environment and bad values fall back to the defaults', () => {
  assert.equal(azmAmount({ ...base, type: 'satellite-pass', rows: [] }, { AZM_SATELLITE: '40' }), 40);
  assert.equal(azmAmount({ ...base, type: 'satellite-pass', rows: [] }, { AZM_SATELLITE: 'lots' }), 25);
  assert.equal(azmAmount({ ...base, type: 'satellite-pass', rows: [] }, { AZM_SATELLITE: '2.5' }), 25);
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: cells(100) }, { AZM_CELLS_PER_TOKEN: '10', AZM_MAPPING_MAX: '8' }), 8);
});

test('unknown report types pay nothing and have no kind', () => {
  assert.equal(azmAmount({ ...base, type: 'mystery', rows: cells(100) }, {}), 0);
  assert.equal(kindFor('mystery'), null);
  assert.equal(kindFor('mapping-session'), KIND.mapping);
  assert.equal(kindFor('satellite-pass'), KIND.satellite);
  assert.equal(kindFor('chest-claim'), KIND.chest);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd server && node --test test/azmRewards.test.js`
Expected: FAIL, "Cannot find module '../lib/azmRewards'".

- [ ] **Step 3: Implement**

```js
'use strict';

/** Whole AZMTest amounts for approved reports. The token has 0 decimals, so everything here is an integer. */
const KIND = { mapping: 0, satellite: 1, chest: 2, challenge: 3 };
const TYPE_KIND = { 'mapping-session': KIND.mapping, 'satellite-pass': KIND.satellite, 'chest-claim': KIND.chest };

/** A positive whole number from the environment, or the fallback. */
function whole(env, name, fallback) {
  const v = env[name];
  return typeof v === 'string' && /^[1-9]\d*$/.test(v.trim()) ? Number(v.trim()) : fallback;
}

function kindFor(type) {
  return Object.prototype.hasOwnProperty.call(TYPE_KIND, type) ? TYPE_KIND[type] : null;
}

function azmAmount({ type, rows, newCellUsdc }, env = process.env) {
  if (type === 'satellite-pass') return whole(env, 'AZM_SATELLITE', 25);
  if (type === 'chest-claim') return whole(env, 'AZM_CHEST', 10);
  if (type === 'mapping-session') {
    const usdc = (rows || []).filter((r) => r.kind === 'new-cells').reduce((n, r) => n + Number(r.amountUsdc), 0);
    const paidCells = newCellUsdc > 0 ? Math.round(usdc / newCellUsdc) : 0;
    const perToken = whole(env, 'AZM_CELLS_PER_TOKEN', 5);
    return Math.min(whole(env, 'AZM_MAPPING_MAX', 50), Math.floor(paidCells / perToken));
  }
  return 0;
}

module.exports = { KIND, kindFor, azmAmount };
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd server && node --test test/azmRewards.test.js`
Expected: 4 passing.

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 5: Server `chain.js` (instruction builder and sender)

**Files:**
- Create: `server/lib/chain.js`
- Test: `server/test/chain.test.js`
- Modify: `server/package.json` (dependencies)

**Interfaces:**
- Consumes: `kind` numbers from Task 4; instruction layouts from Task 1.
- Produces: `createChain({ connection, authority, programId, mint }): Chain` where
  - `authority`: a web3.js `Keypair`; `programId`, `mint`: `PublicKey` or base58 string; `connection`: object with `getLatestBlockhash()`, `sendRawTransaction(bytes)`, `confirmTransaction({signature, blockhash, lastValidBlockHeight}, commitment)`, `getAccountInfo(pubkey)`, `getTokenAccountBalance(pubkey)`.
  - `chain.reward({ wallet: string, hash: string(64 hex), kind: number, amount: number }): Promise<{ signature: string | null, record: string, existed: boolean }>`
  - `chain.setPaused(paused: boolean): Promise<{ signature: string }>`
  - `chain.status(): Promise<{ vaultBalance: number, paused: boolean, maxReward: number, authority: string }>`
  - also exports `buildRewardIx`, `discriminator(name)`.

- [ ] **Step 1: Add dependencies**

Run: `cd server && npm install @solana/web3.js@^1.99.0 @solana/spl-token@^0.4.9`
Expected: `server/package.json` gains both under `dependencies`. (If `server/` has its own `package-lock.json`, it updates too.)

- [ ] **Step 2: Write the failing test**

```js
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
  const err = Object.assign(new Error('Transaction simulation failed: custom program error: 0x0'), { logs: ['Allocate: account Address { address: X } already in use'] });
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
```

- [ ] **Step 3: Run to confirm it fails**

Run: `cd server && node --test test/chain.test.js`
Expected: FAIL, "Cannot find module '../lib/chain'".

- [ ] **Step 4: Implement `server/lib/chain.js`**

```js
'use strict';
const crypto = require('node:crypto');
const { PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');

/**
 * Talks to the azimuth_registry program. Instructions are built by hand from the program's layout (see
 * onchain/programs/azimuth_registry/src/lib.rs), so a change there must be mirrored here and in test/chain.test.js.
 */
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
    if (!Number.isInteger(kind) || kind < 0 || kind > 255) throw new Error('invalid kind');
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('invalid amount: expected a whole number above zero');
    const hashBytes = Buffer.from(hash, 'hex');
    const [record] = PublicKey.findProgramAddressSync([Buffer.from('report'), w.toBuffer(), hashBytes], program);
    const data = Buffer.alloc(8 + 32 + 1 + 8);
    discriminator('reward').copy(data, 0);
    hashBytes.copy(data, 8);
    data[40] = kind;
    data.writeBigUInt64LE(BigInt(amount), 41);
    const ix = new TransactionInstruction({
      programId: program,
      keys: [
        key(authority.publicKey, true, true), key(config, false, false), key(mintKey, false, false), key(vault, false, true),
        key(w, false, false), key(getAssociatedTokenAddressSync(mintKey, w), false, true), key(record, false, true),
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
        if (/already in use/i.test(text)) return { signature: null, record: record.toBase58(), existed: true };
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
      const [acct, bal] = await Promise.all([connection.getAccountInfo(config), connection.getTokenAccountBalance(vault)]);
      if (!acct) throw new Error('the registry is not initialized on this cluster');
      const d = Buffer.from(acct.data);
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
```

- [ ] **Step 5: Run to confirm it passes**

Run: `cd server && node --test test/chain.test.js`
Expected: 7 passing. (If `Transaction.from` fails to parse because the fake blockhash is not valid base58 of 32 bytes: it is, since it comes from `Keypair.generate().publicKey.toBase58()`.)

- [ ] **Step 6: Checkpoint** — report. Do not commit.

---

### Task 6: Supabase schema and sink methods

**Files:**
- Create: `server/supabase/schema_azm.sql`
- Modify: `server/lib/supabase.js` (`getReport` select; new `setOnchain`, `listPayouts`)
- Test: `server/test/supabase.test.js` (add tests; keep the existing ones)

**Interfaces:**
- Produces:
  - `sink.setOnchain(hash: string, patch: { onchain_tx?: string|null, onchain_record?: string|null, onchain_error?: string|null, onchain_amount?: number }): Promise<void>` — only these four keys are sent; anything else throws.
  - `sink.listPayouts(limit = 30): Promise<{ hash, node, type, status, verified_at, onchain_tx, onchain_record, onchain_error, onchain_amount }[]>` — verified reports with `onchain_amount > 0`, newest first.
  - `sink.getReport(hash)` rows now also carry `onchain_tx, onchain_record, onchain_error, onchain_amount`.

- [ ] **Step 1: Write the SQL** `server/supabase/schema_azm.sql` (the user runs it in the Supabase SQL editor)

```sql
-- AZMTest on-chain payouts. Run once in the Supabase SQL editor (after schema_direct.sql).
alter table public.reports add column if not exists onchain_tx text;
alter table public.reports add column if not exists onchain_record text;
alter table public.reports add column if not exists onchain_error text;
alter table public.reports add column if not exists onchain_amount integer;
create index if not exists reports_onchain_idx on public.reports (status, onchain_tx) where onchain_amount > 0;

-- node_summary now also lists the wallet's reports that were recorded on-chain. The public key still cannot read
-- the reports table; only these few fields of a wallet's own recorded reports come out, like the reward totals.
create or replace function public.node_summary(p_node text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'address', p_node,
    'pendingReports',  (select count(*) from public.reports where node = p_node and status = 'new'),
    'rejectedReports', (select count(*) from public.reports where node = p_node and status = 'rejected'),
    'pendingUsdc',  coalesce(sum(amount_usdc) filter (where status = 'pending'), 0),
    'approvedUsdc', coalesce(sum(amount_usdc) filter (where status = 'approved'), 0),
    'paidUsdc',     coalesce(sum(amount_usdc) filter (where status = 'paid'), 0),
    'chestsOpened', count(*) filter (where kind = 'chest' and status <> 'rejected'),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('kind', r.kind, 'ref', r.ref, 'amount_usdc', r.amount_usdc, 'status', r.status, 'created_ms', (extract(epoch from r.created_at) * 1000)::bigint) order by r.created_at desc)
      from (select * from public.rewards where node = p_node order by created_at desc limit 50) r
    ), '[]'::jsonb),
    'azmTotal', (select coalesce(sum(onchain_amount), 0) from public.reports where node = p_node and onchain_record is not null),
    'verified', coalesce((
      select jsonb_agg(jsonb_build_object('hash', v.hash, 'type', v.type, 'amount', v.onchain_amount, 'record', v.onchain_record, 'verified_ms', (extract(epoch from v.verified_at) * 1000)::bigint) order by v.verified_at desc)
      from (select hash, type, onchain_amount, onchain_record, verified_at from public.reports where node = p_node and onchain_record is not null order by verified_at desc limit 50) v
    ), '[]'::jsonb)
  )
  from public.rewards where node = p_node;
$$;
revoke all on function public.node_summary(text) from public;
grant execute on function public.node_summary(text) to anon;
```

Note for the executor: before finalizing, diff the first part of this function against the live `node_summary` in `schema_direct.sql` (lines ~90–109) and keep every existing key identical.

Important caveat to state to the user: `from public.rewards where node = p_node` returns **no row** for a wallet that has no rewards rows yet, so `azmTotal`/`verified` would be missing for a brand-new wallet. That is already how the existing function behaves for `entries`; the app treats missing fields as empty (Task 10).

- [ ] **Step 2: Write the failing tests** (append to `server/test/supabase.test.js`; reuse its `fakeFetch` helper, whose shape is shown at the top of that file — read it first and match the local names)

```js
test('setOnchain patches only the on-chain columns', async () => {
  const f = fakeFetch([{ status: 204 }]);
  const sink = createSupabaseSink({ url: 'https://x.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: f.impl });
  await sink.setOnchain('a'.repeat(64), { onchain_tx: 'SIG', onchain_record: 'REC', onchain_error: null });
  assert.equal(f.calls[0].init.method, 'PATCH');
  assert.match(f.calls[0].url, /\/reports\?hash=eq\.a{64}$/);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { onchain_tx: 'SIG', onchain_record: 'REC', onchain_error: null });
  await assert.rejects(sink.setOnchain('a'.repeat(64), { status: 'verified' }), /not an on-chain column/);
});

test('listPayouts asks for verified reports with a payout, newest first', async () => {
  const f = fakeFetch([{ status: 200, body: [{ hash: 'h' }] }]);
  const sink = createSupabaseSink({ url: 'https://x.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: f.impl });
  assert.deepEqual(await sink.listPayouts(10), [{ hash: 'h' }]);
  assert.match(f.calls[0].url, /status=eq\.verified/);
  assert.match(f.calls[0].url, /onchain_amount=gt\.0/);
  assert.match(f.calls[0].url, /order=verified_at\.desc/);
  assert.match(f.calls[0].url, /limit=10/);
});
```

(If the existing file's `fakeFetch` stores calls differently, adapt the property names; keep the assertions.)

- [ ] **Step 3: Run to confirm failure**

Run: `cd server && node --test test/supabase.test.js`
Expected: the two new tests FAIL ("sink.setOnchain is not a function").

- [ ] **Step 4: Implement in `server/lib/supabase.js`**

Change `getReport`'s select to `select=hash,node,type,received_at,body,status,onchain_tx,onchain_record,onchain_error,onchain_amount`. Add inside the returned object, after `insertRewards`:

```js
    /** Records the on-chain payout state of a report. Only the four on-chain columns can be written. */
    async setOnchain(hash, patch) {
      const allowed = ['onchain_tx', 'onchain_record', 'onchain_error', 'onchain_amount'];
      for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw new Error(`${k} is not an on-chain column`);
      await call('PATCH', `/reports?hash=eq.${encodeURIComponent(hash)}`, patch, { prefer: 'return=minimal' });
    },

    /** Verified reports that carry an AZMTest payout, newest first, whether paid on-chain or not yet. */
    async listPayouts(limit = 30) {
      return call('GET', `/reports?status=eq.verified&onchain_amount=gt.0&order=verified_at.desc&limit=${limit}&select=hash,node,type,verified_at,onchain_tx,onchain_record,onchain_error,onchain_amount`);
    },
```

- [ ] **Step 5: Run to confirm all supabase tests pass**

Run: `cd server && node --test test/supabase.test.js`
Expected: all pass, including the existing `getReport` test if it asserts the URL; update that assertion to the new select list if so.

- [ ] **Step 6: Checkpoint** — report; tell the user the SQL file must be run in Supabase before the live check. Do not commit.

---

### Task 7: `review.js` pays on-chain after approval

**Files:**
- Modify: `server/lib/review.js`
- Test: `server/test/review.test.js` (add `setOnchain` and a fake chain to the existing `fakeSupabase`, new tests)

**Interfaces:**
- Consumes: `azmAmount`, `kindFor` (Task 4); `chain.reward` (Task 5); `sink.setOnchain`, `sink.getReport` columns (Task 6).
- Produces:
  - `createReviewer({ ..., chain = null, azmEnv = process.env })`. With `chain` null nothing on-chain happens and existing behavior is unchanged.
  - `approve(hash)` result gains `onchain: null | { ok: true, amount, signature: string|null, record: string } | { ok: false, amount, error: string }`.
  - `reviewer.retryOnChain(hash): Promise<{ hash, status: 'missing'|'not-verified'|'nothing-to-pay'|'already-paid'|'paid'|'failed', onchain? }>`.

- [ ] **Step 1: Write the failing tests**

In `fakeSupabase()` add to `sink`:

```js
    async setOnchain(hash, patch) { Object.assign(db.reports.get(hash), patch); },
```

Then append (the helpers `newNode, bucket, signedReport, NOW, reviewer, fakeSupabase` already exist in the file):

```js
function fakeChain(over = {}) {
  const calls = [];
  return {
    calls,
    async reward(args) {
      calls.push(args);
      if (over.fail) throw new Error(over.fail);
      return { signature: 'SIG', record: 'REC', existed: false };
    },
  };
}
const manyCells = (n) => Array.from({ length: n }, (_, i) => bucket(`h120:1:${i + 1}`, NOW - 3600_000));

test('approving a mapping report with enough new cells pays AZMTest and stores the transaction', async () => {
  const fake = fakeSupabase();
  const chain = fakeChain();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake, { chain }).approve(env.hash);
  assert.equal(out.status, 'verified');
  assert.deepEqual(out.onchain, { ok: true, amount: 2, signature: 'SIG', record: 'REC' });
  assert.deepEqual(chain.calls, [{ wallet: env.report.node, hash: env.hash, kind: 0, amount: 2 }]);
  const row = fake.db.reports.get(env.hash);
  assert.equal(row.onchain_amount, 2);
  assert.equal(row.onchain_tx, 'SIG');
  assert.equal(row.onchain_record, 'REC');
  assert.equal(row.onchain_error, null);
});

test('a report worth less than one token makes no chain call and no error', async () => {
  const fake = fakeSupabase();
  const chain = fakeChain();
  const env = signedReport(newNode(), manyCells(3));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake, { chain }).approve(env.hash);
  assert.equal(out.status, 'verified');
  assert.equal(out.onchain, null);
  assert.equal(chain.calls.length, 0);
  assert.equal(fake.db.reports.get(env.hash).onchain_error, undefined);
});

test('a chain failure keeps the report verified, stores the error and the amount, and can be retried', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const broken = await reviewer(fake, { chain: fakeChain({ fail: 'Rewards are paused' }) }).approve(env.hash);
  assert.equal(broken.status, 'verified');
  assert.deepEqual(broken.onchain, { ok: false, amount: 2, error: 'Rewards are paused' });
  const row = fake.db.reports.get(env.hash);
  assert.equal(row.status, 'verified');
  assert.equal(row.onchain_error, 'Rewards are paused');
  assert.equal(row.onchain_tx, undefined);

  const good = fakeChain();
  const rev = reviewer(fake, { chain: good });
  const retried = await rev.retryOnChain(env.hash);
  assert.equal(retried.status, 'paid');
  assert.equal(good.calls[0].amount, 2);
  assert.equal(fake.db.reports.get(env.hash).onchain_error, null);
  assert.equal((await rev.retryOnChain(env.hash)).status, 'already-paid');
  assert.equal(good.calls.length, 1, 'no second payment');
});

test('retry refuses reports that are not verified or have nothing to pay', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(3));
  fake.insertReport(env, NOW);
  const rev = reviewer(fake, { chain: fakeChain() });
  assert.equal((await rev.retryOnChain('f'.repeat(64))).status, 'missing');
  assert.equal((await rev.retryOnChain(env.hash)).status, 'not-verified');
  await rev.approve(env.hash);
  assert.equal((await rev.retryOnChain(env.hash)).status, 'nothing-to-pay');
});

test('if saving the amount fails, approval still completes and reports the problem', async () => {
  const fake = fakeSupabase();
  fake.sink.setOnchain = async () => { throw new Error('column onchain_amount does not exist'); };
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake, { chain: fakeChain() }).approve(env.hash);
  assert.equal(out.status, 'verified');
  assert.equal(out.onchain.ok, false);
  assert.match(out.onchain.error, /onchain_amount/);
});

test('without a chain nothing changes', async () => {
  const fake = fakeSupabase();
  const env = signedReport(newNode(), manyCells(12));
  fake.insertReport(env, NOW);
  const out = await reviewer(fake).approve(env.hash);
  assert.equal(out.status, 'verified');
  assert.equal(out.onchain, null);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && node --test test/review.test.js`
Expected: the new tests FAIL (`onchain` undefined / `retryOnChain` not a function); existing tests still pass.

- [ ] **Step 3: Implement in `server/lib/review.js`**

Add the require at the top: `const { azmAmount, kindFor } = require('./azmRewards');`

Change the signature to `function createReviewer({ sink, store = openStore(':memory:'), checkNode, tleFor, config, chain = null, azmEnv = process.env, log = () => undefined })`.

Add inside `createReviewer`, before `approve`:

```js
  /** Sends the AZMTest payout for a verified report and records the outcome. Never throws. */
  async function payOnChain(hash, node, type, amount) {
    try {
      const out = await chain.reward({ wallet: node, hash, kind: kindFor(type), amount });
      await sink.setOnchain(hash, { onchain_tx: out.signature || 'already-recorded', onchain_record: out.record, onchain_error: null });
      return { ok: true, amount, signature: out.signature, record: out.record };
    } catch (e) {
      const error = String((e && e.message) || e).slice(0, 300);
      await sink.setOnchain(hash, { onchain_error: error }).catch(() => undefined);
      return { ok: false, amount, error };
    }
  }

  /** Pays again a verified report whose payout failed. Safe to repeat: the program pays each report once. */
  async function retryOnChain(hash) {
    if (!chain) return { hash, status: 'failed', onchain: { ok: false, amount: 0, error: 'on-chain payouts are not configured' } };
    const r = await sink.getReport(hash);
    if (!r) return { hash, status: 'missing' };
    if (r.status !== 'verified') return { hash, status: 'not-verified' };
    if (r.onchain_tx) return { hash, status: 'already-paid' };
    const amount = Number(r.onchain_amount) || 0;
    if (amount <= 0) return { hash, status: 'nothing-to-pay' };
    const onchain = await payOnChain(hash, r.node, r.type, amount);
    return { hash, status: onchain.ok ? 'paid' : 'failed', onchain };
  }
```

In `approve`, replace the last two lines and return:

```js
    await sink.insertRewards(hash, r.node, rows, status);
    await sink.finishReport(hash, 'verified', null);

    let onchain = null;
    if (chain) {
      const amount = azmAmount({ type: r.type, rows, newCellUsdc: service.config.newCellUsdc }, azmEnv);
      if (amount > 0) {
        try {
          await sink.setOnchain(hash, { onchain_amount: amount });
          onchain = await payOnChain(hash, r.node, r.type, amount);
        } catch (e) {
          onchain = { ok: false, amount, error: String((e && e.message) || e).slice(0, 300) };
        }
      }
    }
    return { hash, status: 'verified', rewards: rows, onchain };
```

Add `retryOnChain` to the returned object: `return { run, preview, approve, reject, retryOnChain, syncChests, processDeletions, service, store };`

Check `service.config` exists: `grep -n "config" server/lib/service.js | head` — the service built by `createService(store, { ..., config })` must expose its merged config (`newCellUsdc` default 0.001 at `service.js:14`). If `service.config` is not exposed, add `config` to the object `createService` returns (one-line change) and add a test line asserting `service.config.newCellUsdc === 0.001`.

- [ ] **Step 4: Run all server tests**

Run: `cd server && npm test`
Expected: all pass (the new six plus all existing).

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 8: Admin portal API and UI

**Files:**
- Modify: `server/admin/app.js`
- Modify: `server/admin/admin.html`
- Modify: `server/admin/admin.js`
- Test: `server/test/admin.test.js` (add tests; read the file first and reuse its request helper and fakes)

**Interfaces:**
- Consumes: `reviewer.retryOnChain` (Task 7), `sink.listPayouts` (Task 6), `chain.status`, `chain.setPaused` (Task 5).
- Produces (HTTP, all behind the existing Basic auth):
  - `GET /api/payouts` → `{ enabled: boolean, status: { vaultBalance, paused, maxReward, authority } | null, statusError: string|null, items: [{ hash, node, type, amount, state: 'paid'|'failed'|'pending', error: string|null, record: string|null, tx: string|null, verifiedAt }] }`
  - `POST /api/payouts/:hash/retry` → 200 `{ status:'paid' }`; 409 with `{ status, onchain? }` otherwise
  - `POST /api/pause` body `{ paused: boolean }` → `{ ok: true, paused }`; 400 when `paused` is not a boolean; 503 when on-chain payouts are not configured.
  - `createAdminApp({ reviewer, sink, chain = null, password })`

- [ ] **Step 1: Write failing tests** (adapt to `admin.test.js`'s existing helper, which makes requests against `createAdminApp(...)` with a Basic header; read it first)

```js
test('payouts list shows paid, failed and pending items with the vault status', async () => {
  const sink = fakeSink({ payouts: [
    { hash: 'a'.repeat(64), node: 'N1', type: 'mapping-session', verified_at: '2026-10-10T10:00:00Z', onchain_tx: 'SIG', onchain_record: 'REC', onchain_error: null, onchain_amount: 2 },
    { hash: 'b'.repeat(64), node: 'N2', type: 'satellite-pass', verified_at: '2026-10-10T09:00:00Z', onchain_tx: null, onchain_record: null, onchain_error: 'Rewards are paused', onchain_amount: 25 },
    { hash: 'c'.repeat(64), node: 'N3', type: 'chest-claim', verified_at: '2026-10-10T08:00:00Z', onchain_tx: null, onchain_record: null, onchain_error: null, onchain_amount: 10 },
  ] });
  const chain = { status: async () => ({ vaultBalance: 99, paused: false, maxReward: 100, authority: 'AUTH' }), setPaused: async () => ({ signature: 'S' }) };
  const res = await call({ sink, chain }, 'GET', '/api/payouts');
  assert.equal(res.status, 200);
  assert.equal(res.json.enabled, true);
  assert.equal(res.json.status.vaultBalance, 99);
  assert.deepEqual(res.json.items.map((i) => i.state), ['paid', 'failed', 'pending']);
  assert.equal(res.json.items[1].error, 'Rewards are paused');
});

test('payouts report enabled:false when no chain is configured', async () => {
  const res = await call({ sink: fakeSink({ payouts: [] }), chain: null }, 'GET', '/api/payouts');
  assert.equal(res.json.enabled, false);
  assert.deepEqual(res.json.items, []);
});

test('retry runs the reviewer retry and maps failures to 409', async () => {
  const reviewer = { retryOnChain: async (h) => ({ hash: h, status: 'paid' }) };
  assert.equal((await call({ reviewer }, 'POST', `/api/payouts/${'a'.repeat(64)}/retry`)).status, 200);
  const bad = { retryOnChain: async (h) => ({ hash: h, status: 'failed', onchain: { ok: false, error: 'Rewards are paused' } }) };
  assert.equal((await call({ reviewer: bad }, 'POST', `/api/payouts/${'a'.repeat(64)}/retry`)).status, 409);
});

test('pause switch validates input and needs a chain', async () => {
  const chain = { paused: null, status: async () => ({}), setPaused: async function (p) { chain.paused = p; return { signature: 'S' }; } };
  assert.equal((await call({ chain }, 'POST', '/api/pause', { paused: 'yes' })).status, 400);
  const ok = await call({ chain }, 'POST', '/api/pause', { paused: true });
  assert.equal(ok.status, 200);
  assert.equal(chain.paused, true);
  assert.equal((await call({ chain: null }, 'POST', '/api/pause', { paused: true })).status, 503);
});
```

`call(deps, method, path, body)` and `fakeSink(...)` stand for the existing helpers in `admin.test.js`; if they have different names or shapes, extend them minimally (add `payouts` to the fake sink: `async listPayouts() { return payouts; }`; let `call` pass `chain` through to `createAdminApp`).

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && node --test test/admin.test.js`
Expected: new tests FAIL with 404s.

- [ ] **Step 3: Implement the routes in `server/admin/app.js`**

Change the signature to `function createAdminApp({ reviewer, sink, chain = null, password })`. Add a helper above `createAdminApp`:

```js
const PAY_STATE = (r) => (r.onchain_tx ? 'paid' : r.onchain_error ? 'failed' : 'pending');
```

Add these routes before the final `return send(404, ...)`:

```js
      if (req.method === 'GET' && p === '/api/payouts') {
        if (!chain) return send(200, { enabled: false, status: null, statusError: null, items: [] });
        let status = null;
        let statusError = null;
        try { status = await chain.status(); } catch (e) { statusError = String(e.message || e).slice(0, 200); }
        const rows = await sink.listPayouts(30);
        return send(200, {
          enabled: true, status, statusError,
          items: rows.map((r) => ({
            hash: r.hash, node: r.node, type: r.type, amount: r.onchain_amount, state: PAY_STATE(r),
            error: r.onchain_error || null, record: r.onchain_record || null, tx: r.onchain_tx || null, verifiedAt: r.verified_at,
          })),
        });
      }

      m = /^\/api\/payouts\/([0-9a-f]{64})\/retry$/.exec(p);
      if (req.method === 'POST' && m) {
        const result = await reviewer.retryOnChain(m[1]);
        return send(result.status === 'paid' ? 200 : 409, result);
      }

      if (req.method === 'POST' && p === '/api/pause') {
        const body = await readJson(req);
        if (typeof body.paused !== 'boolean') return send(400, { error: 'paused must be true or false' });
        if (!chain) return send(503, { error: 'on-chain payouts are not configured' });
        await chain.setPaused(body.paused);
        return send(200, { ok: true, paused: body.paused });
      }
```

(`m` is already declared with `let m` above these routes in the handler; keep using it.)

- [ ] **Step 4: UI**

In `admin.html`, after the "Waiting for review" / detail grid (find the closing of the two `<section class="panel">` elements around lines 44–45) add:

```html
<section class="panel" id="payouts-panel" style="margin-top:12px">
  <h2 style="margin-top:0;font-size:15px">AZMTest payouts</h2>
  <div id="vault" class="muted">Loading…</div>
  <div id="payouts" class="muted"></div>
</section>
```

In `admin.js`, add before the `$('reload')` line:

```js
  var EXPLORER = 'https://explorer.solana.com/address/';
  function loadPayouts() {
    api('GET', '/api/payouts').then(function (r) {
      var vault = $('vault'), box = $('payouts');
      vault.textContent = ''; box.textContent = '';
      if (r.status !== 200) { vault.textContent = (r.json && r.json.error) || 'Could not load payouts.'; return; }
      var d = r.json;
      if (!d.enabled) { vault.textContent = 'On-chain payouts are not configured on this server (see .env.example).'; return; }
      if (d.statusError) vault.appendChild(el('span', { class: 'tag bad', text: d.statusError }));
      if (d.status) {
        vault.appendChild(el('span', { text: 'Vault: ' + d.status.vaultBalance + ' AZMTest · cap per report ' + d.status.maxReward + ' · ' }));
        vault.appendChild(el('span', { class: 'tag ' + (d.status.paused ? 'bad' : 'good'), text: d.status.paused ? 'paused' : 'active' }));
        vault.appendChild(el('button', { class: 'ghost', text: d.status.paused ? 'Resume payouts' : 'Pause payouts', on: { click: function () {
          api('POST', '/api/pause', { paused: !d.status.paused }).then(loadPayouts);
        } } }));
      }
      if (!d.items.length) { box.textContent = 'No payouts yet.'; return; }
      d.items.forEach(function (i) {
        var row = el('div', { class: 'item' }, [
          el('div', { class: 'top' }, [
            el('span', { class: 'mono', text: short(i.node) }),
            el('span', { class: 'tag ' + (i.state === 'paid' ? 'good' : i.state === 'failed' ? 'bad' : ''), text: i.state === 'paid' ? 'paid on-chain' : i.state === 'failed' ? 'failed' : 'not paid yet' }),
          ]),
          el('div', { class: 'muted', text: i.type + ' · ' + i.amount + ' AZMTest · ' + when(i.verifiedAt) }),
        ]);
        if (i.error) row.appendChild(el('div', { class: 'muted', text: i.error }));
        if (i.record) row.appendChild(el('a', { href: EXPLORER + i.record + '?cluster=devnet', target: '_blank', rel: 'noopener noreferrer', text: 'record on explorer' }));
        if (i.state !== 'paid') row.appendChild(el('button', { class: 'ghost', text: 'Retry', on: { click: function (ev) {
          ev.target.disabled = true;
          api('POST', '/api/payouts/' + i.hash + '/retry').then(loadPayouts);
        } } }));
        box.appendChild(row);
      });
    });
  }
```

Change `loadOverview(); loadList();` at the bottom and in the reload handler to also call `loadPayouts()`, and in `decide()` after a successful approve show the on-chain result:

```js
        var oc = x.json.onchain;
        $('detail').textContent = action === 'approve'
          ? 'Approved.' + (oc ? (oc.ok ? ' Sent ' + oc.amount + ' AZMTest on-chain.' : ' Payout not sent yet: ' + oc.error + ' (retry under AZMTest payouts).') : ' Rewards are ready for the weekly payout.')
          : 'Rejected.';
        loadPayouts();
```

(The previous line that set `$('detail').textContent` for approve/reject is replaced by the block above; keep `selected = null;` and the two reload calls.)

- [ ] **Step 5: Run all server tests**

Run: `cd server && npm test`
Expected: all pass.

- [ ] **Step 6: Manual look** (no device needed): `cd server && ADMIN_PASSWORD=testtest1 SUPABASE_URL=https://x.supabase.co SUPABASE_SERVICE_KEY=sb_secret_x node admin/index.js`, open `http://127.0.0.1:8788`, confirm the payouts panel renders "On-chain payouts are not configured…" (the Supabase calls will fail; that is fine, only the panel text is checked). Stop the server.

- [ ] **Step 7: Checkpoint** — report. Do not commit.

---

### Task 9: Wire the server and document configuration

**Files:**
- Modify: `server/admin/index.js`
- Modify: `server/.env.example`
- Create: `server/lib/chainFromEnv.js`
- Test: `server/test/chainFromEnv.test.js`

**Interfaces:**
- Produces: `chainFromEnv(env = process.env): Chain | null` — `null` unless all of `AZM_AUTHORITY_KEYPAIR`, `AZM_PROGRAM_ID`, `AZM_MINT` are set; throws a readable error if the keypair file is unreadable or malformed.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && node --test test/chainFromEnv.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `server/lib/chainFromEnv.js`**

```js
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
```

- [ ] **Step 4: Wire `server/admin/index.js`**

Add `const { chainFromEnv } = require('../lib/chainFromEnv');` with the other requires, then change the reviewer/app construction:

```js
const chain = chainFromEnv();
const reviewer = createReviewer({ sink, store, checkNode, chain, tleFor: fileTleProvider(path.join(__dirname, '..', 'data', 'tles.json')) });

const handle = createAdminApp({ reviewer, sink, chain, password: process.env.ADMIN_PASSWORD });
```

and after the `listen` log line add: `console.log(chain ? 'AZMTest payouts: on (devnet)' : 'AZMTest payouts: off (set AZM_AUTHORITY_KEYPAIR, AZM_PROGRAM_ID, AZM_MINT)');`

- [ ] **Step 5: Append to `server/.env.example`**

```
# AZMTest on-chain payouts (devnet). Leave these out to run without paying tokens.
# The authority keypair pays fees and signs rewards. Keep the file outside the repo.
# AZM_AUTHORITY_KEYPAIR=~/.config/solana/devnet.json
# AZM_PROGRAM_ID=   # from onchain/devnet.json
# AZM_MINT=         # from onchain/devnet.json
# SOLANA_RPC=https://api.devnet.solana.com
# Amounts in whole AZMTest (defaults shown)
# AZM_MAPPING_MAX=50
# AZM_CELLS_PER_TOKEN=5
# AZM_SATELLITE=25
# AZM_CHEST=10
```

- [ ] **Step 6: Run all server tests**

Run: `cd server && npm test`
Expected: all pass.

- [ ] **Step 7: Checkpoint** — report. Do not commit.

---

### Task 10: App — AZMTest balance, verified list, submit message

**Files:**
- Create: `src/wallet/azmBalance.ts`
- Test: `src/wallet/__tests__/azmBalance.test.ts`
- Modify: `src/network/config.ts`
- Modify: `src/network/api.ts` (`NodeSummary`)
- Modify: `src/network/supabaseApi.ts` (`fetchNodeSummary`)
- Test: `src/network/__tests__/supabaseApi.test.ts` (append)
- Modify: `src/network/useSubmission.ts` (`rewardMessage`)
- Modify: `src/screens/profile/ProfileScreen.tsx`

**Interfaces:**
- Produces:
  - `config.ts`: `AZM_MINT: string` (from `EXPO_PUBLIC_AZM_MINT`, default `''`), `DEVNET_RPC: string` (from `EXPO_PUBLIC_SOLANA_RPC`, default `'https://api.devnet.solana.com'`).
  - `azmBalance.ts`: `azmTokenAccount(owner: string, mint: string): string` (base58 ATA) and `fetchAzmBalance(owner: string, opts?: { mint?: string, rpc?: string, fetchImpl?: typeof fetch }): Promise<number>` — whole tokens; `0` when the wallet has no token account; throws on other RPC errors; returns `0` immediately when no mint is configured.
  - `NodeSummary` gains `azmTotal?: number` and `verified?: { hash: string; type: string; amount: number; record: string; verified_ms: number }[]`.

- [ ] **Step 1: Write the failing balance tests**

```ts
import { PublicKey } from '@solana/web3.js';
import { azmTokenAccount, fetchAzmBalance } from '../azmBalance';

const OWNER = '5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SYcfbshpAqPG';
const MINT = 'So11111111111111111111111111111111111111112';

const rpc = (body: unknown, status = 200) =>
  (async () => ({ status, json: async () => body })) as unknown as typeof fetch;

describe('azmTokenAccount', () => {
  it('derives the associated token account', () => {
    const a = azmTokenAccount(OWNER, MINT);
    expect(new PublicKey(a).toBase58()).toBe(a);
    expect(a).not.toBe(OWNER);
    expect(azmTokenAccount(OWNER, MINT)).toBe(a);
  });
});

describe('fetchAzmBalance', () => {
  it('returns the whole-token amount', async () => {
    expect(await fetchAzmBalance(OWNER, { mint: MINT, rpc: 'x', fetchImpl: rpc({ result: { value: { amount: '37', decimals: 0 } } }) })).toBe(37);
  });

  it('returns 0 for a wallet with no token account yet', async () => {
    const missing = rpc({ error: { code: -32602, message: 'Invalid param: could not find account' } });
    expect(await fetchAzmBalance(OWNER, { mint: MINT, rpc: 'x', fetchImpl: missing })).toBe(0);
  });

  it('throws on other RPC errors', async () => {
    await expect(fetchAzmBalance(OWNER, { mint: MINT, rpc: 'x', fetchImpl: rpc({ error: { code: -32005, message: 'Node is behind' } }) })).rejects.toThrow(/behind/);
    await expect(fetchAzmBalance(OWNER, { mint: MINT, rpc: 'x', fetchImpl: rpc({}, 503) })).rejects.toThrow(/503/);
  });

  it('returns 0 without any request when no mint is configured', async () => {
    const f = jest.fn();
    expect(await fetchAzmBalance(OWNER, { mint: '', rpc: 'x', fetchImpl: f as unknown as typeof fetch })).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx jest src/wallet/__tests__/azmBalance.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement config and balance**

Append to `src/network/config.ts`:

```ts
/** The AZMTest mint on devnet (from onchain/devnet.json). Empty hides the balance. */
export const AZM_MINT: string = process.env.EXPO_PUBLIC_AZM_MINT ?? '';
export const DEVNET_RPC: string = process.env.EXPO_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com';
```

`src/wallet/azmBalance.ts`:

```ts
import { PublicKey } from '@solana/web3.js';
import { AZM_MINT, DEVNET_RPC } from '../network/config';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** The wallet's associated token account for a mint (base58). */
export function azmTokenAccount(owner: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
    ASSOCIATED_PROGRAM
  );
  return ata.toBase58();
}

/** Whole AZMTest in the wallet. Zero when it has no token account yet. */
export async function fetchAzmBalance(
  owner: string,
  opts: { mint?: string; rpc?: string; fetchImpl?: typeof fetch } = {}
): Promise<number> {
  const mint = opts.mint ?? AZM_MINT;
  if (!mint) return 0;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.rpc ?? DEVNET_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountBalance', params: [azmTokenAccount(owner, mint)] }),
  });
  if (res.status !== 200) throw new Error(`Could not read the AZMTest balance (HTTP ${res.status}).`);
  const json = (await res.json()) as { result?: { value?: { amount?: string } }; error?: { message?: string } };
  if (json.error) {
    if (/could not find account/i.test(json.error.message ?? '')) return 0;
    throw new Error(json.error.message ?? 'Could not read the AZMTest balance.');
  }
  return Number(json.result?.value?.amount ?? 0);
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npx jest src/wallet/__tests__/azmBalance.test.ts`
Expected: 5 passing. (If Jest cannot resolve `PublicKey.findProgramAddressSync` because `@solana/web3.js` needs polyfills in this environment, look at how `src/wallet/__tests__/wallet.test.ts` imports web3.js and follow it.)

- [ ] **Step 5: Failing test for the summary mapping** (append to `src/network/__tests__/supabaseApi.test.ts`, inside the `describe`)

```ts
  it('maps the AZMTest total and the verified list from node_summary, and tolerates their absence', async () => {
    const f = fakeFetch([
      { status: 200, body: { pendingUsdc: 0, approvedUsdc: 0, paidUsdc: 0, entries: [], azmTotal: 14, verified: [{ hash: 'h', type: 'mapping-session', amount: 14, record: 'REC', verified_ms: 5 }] } },
      { status: 200, body: { pendingUsdc: 0, approvedUsdc: 0, paidUsdc: 0, entries: [] } },
    ]);
    const a = api(f);
    const full = await a.fetchNodeSummary('Addr');
    expect(full.azmTotal).toBe(14);
    expect(full.verified).toEqual([{ hash: 'h', type: 'mapping-session', amount: 14, record: 'REC', verified_ms: 5 }]);
    const bare = await a.fetchNodeSummary('Addr');
    expect(bare.azmTotal).toBe(0);
    expect(bare.verified).toEqual([]);
  });
```

Run: `npx jest src/network/__tests__/supabaseApi.test.ts` → the new test FAILS.

- [ ] **Step 6: Implement**

In `src/network/api.ts`, add to `NodeSummary` (after `paidUsdc?`):

```ts
  /** Whole AZMTest recorded on-chain for this wallet's verified reports. */
  azmTotal?: number;
  /** Reports recorded on-chain, newest first. */
  verified?: { hash: string; type: string; amount: number; record: string; verified_ms: number }[];
```

In `src/network/supabaseApi.ts` `fetchNodeSummary`, extend the cast type with `azmTotal?: number; verified?: NodeSummary['verified']` and add to the returned object:

```ts
        azmTotal: Number(j.azmTotal ?? 0),
        verified: j.verified ?? [],
```

Run: `npx jest src/network/__tests__/supabaseApi.test.ts` → passes.

- [ ] **Step 7: Submit message** — in `src/network/useSubmission.ts` change the first line of `rewardMessage` to:

```ts
  if (accepted && pending) return 'Submitted. You will receive AZMTest when it is verified. Check Profile for the result.';
```

Check no test asserts the old text: `grep -rn "It will be checked soon" src` — update any hit.

- [ ] **Step 8: Profile screen** — in `src/screens/profile/ProfileScreen.tsx`:

Add imports: `import { AZM_MINT } from '../../network/config';` (extend the existing config import if there is one) and `import { fetchAzmBalance } from '../../wallet/azmBalance';` and `Linking` from `react-native` if not already imported.

Add state next to `summary`:

```tsx
  const [azm, setAzm] = useState<number | null>(null);
```

In the existing `useFocusEffect` callback, after the `fetchNodeSummary` chain, add (inside the same callback, before `return`):

```tsx
      if (AZM_MINT) {
        fetchAzmBalance(address)
          .then((n) => !cancelled && setAzm(n))
          .catch(() => undefined);
      }
```

In the "Your activity" card, add a stat and, below the muted text, the verified list:

```tsx
          {AZM_MINT ? <Stat label="AZMTest" value={azm === null ? '—' : String(azm)} unit="devnet" /> : null}
```
(placed inside the `<View style={styles.stats}>`), and after the existing `<Text style={styles.muted}>…</Text>`:

```tsx
        {summary?.verified?.length ? (
          <View style={{ gap: 6 }}>
            <SectionLabel>Verified on-chain</SectionLabel>
            {summary.verified.slice(0, 5).map((v) => (
              <LinkRow
                key={v.hash}
                icon="checkmark-circle-outline"
                label={`${v.type.replace('-', ' ')} · +${v.amount} AZMTest`}
                onPress={() => void Linking.openURL(`https://explorer.solana.com/address/${v.record}?cluster=devnet`)}
              />
            ))}
          </View>
        ) : null}
```

(`LinkRow` already exists at the bottom of the file with props `{ icon, label, onPress }`.)

- [ ] **Step 9: Typecheck and run the full app test suite**

Run: `npm run typecheck && npx jest`
Expected: no type errors; all tests pass (the pre-existing suite plus the new ones).

- [ ] **Step 10: Checkpoint** — report. Tell the user the app needs `EXPO_PUBLIC_AZM_MINT=<mint from onchain/devnet.json>` in its environment (and in EAS env for cloud builds) for the balance to show. Do not commit.

---

### Task 11: Live devnet end-to-end check and docs

**Files:**
- Modify: `docs/IMPLEMENTATION.md` (append a dated section)
- Modify: `docs/TOKEN_PLAN.md` (one paragraph at the top: devnet pilot is AZMTest, 0 decimals, relayer model, pointer to the spec)

**Interfaces:**
- Consumes: everything above plus the user having run `server/supabase/schema_azm.sql`.

- [ ] **Step 1: Ask the user to run the SQL** — "Run `server/supabase/schema_azm.sql` in the Supabase SQL editor, then tell me." Wait.

- [ ] **Step 2: Fill `server/.env`** (untracked) with `AZM_AUTHORITY_KEYPAIR=~/.config/solana/devnet.json`, `AZM_PROGRAM_ID`, `AZM_MINT` from `onchain/devnet.json`. Never print the key file.

- [ ] **Step 3: Start the portal** — `cd server && npm run admin`; expected log `AZMTest payouts: on (devnet)`; the payouts panel shows the vault balance `100000000`.

- [ ] **Step 4: Insert and approve one real test report.** Use the existing path: submit a mapping session from a build of the app, or, without a phone, craft a signed report with the test helpers (`server/test/helpers.js` `signedReport`) for a fresh devnet wallet with at least 5 new cells and insert it into `reports` through the Supabase REST API with the service key. Approve it in the portal.
Expected: the detail pane says `Approved. Sent N AZMTest on-chain.`; the payouts panel lists it as `paid on-chain` with an explorer link.

- [ ] **Step 5: Verify on-chain independently**

Run: `spl-token balance --owner <wallet> $(node -p "require('./onchain/devnet.json').mint") --url devnet` → `N`.
Run: `solana account <record address from the portal> --url devnet` → the account exists and is owned by the program id.

- [ ] **Step 6: Verify the retry path** — stop paying by pausing in the portal, approve a second test report (expect `failed` + `Rewards are paused`), resume, press Retry (expect `paid`), press Retry again on that row's API (expect no second transfer: the wallet balance is unchanged).

- [ ] **Step 7: Docs** — append to `docs/IMPLEMENTATION.md` a section "AZMTest registry (2026-10-10)" listing: the program id, mint, new files, env settings, how to run setup/deploy, the SQL to run, amount rules, and what is verified (program tests, server tests, live devnet run) versus not verified (the app's Profile on a real device, the Metaplex metadata step if it was skipped).

- [ ] **Step 8: Final full runs**

Run: `cd onchain && anchor test`; `cd ../server && npm test`; `cd .. && npm run typecheck && npx jest`
Expected: everything passes. Report the exact counts. Do not commit; list the changed files for the user.

---

## Self-Review

**Spec coverage:** Program and PDA layout, kinds, caps, pause (Task 1); setup script with 0 decimals, metadata best-effort, 1,000,000,000 mint / 100,000,000 vault, `devnet.json` (Tasks 2–3); `azmRewards.js` rules and env overrides (Task 4); `chain.js` with injectable connection, hand-built instruction, "already in use" as success (Task 5); Supabase columns and `node_summary` verified list (Task 6); `review.js` integration, failure stays approved with error, retry (Task 7); portal status, Retry, vault balance, pause switch (Task 8); env config (Task 9); app balance, verified list with explorer links, submit text (Task 10); live devnet check (Task 11). Spec says the lost-response retry "looks up the existing record to fill in the row": covered by `existed: true` plus the deterministic record address returned without a lookup (the PDA is derivable, so no RPC read is needed).

**Placeholder scan:** The only intentional temporary value is the all-ones program id in Task 1, replaced by `anchor keys sync` in the same task. Tasks 6, 7, 8 tell the executor to read named existing test helpers and adapt names; the assertions are given in full.

**Type consistency:** `azmAmount({type, rows, newCellUsdc}, env)`, `kindFor(type)`, `chain.reward({wallet, hash, kind, amount}) → {signature, record, existed}`, `sink.setOnchain(hash, patch)`, `sink.listPayouts(limit)`, `reviewer.retryOnChain(hash)`, `createAdminApp({reviewer, sink, chain, password})`, `chainFromEnv(env)`, `fetchAzmBalance(owner, opts)` are used with the same names and shapes across tasks. `onchain_tx` equals `'already-recorded'` when `existed`; the portal treats any non-null `onchain_tx` as paid.
