# AZMTest token and on-chain report registry (devnet) — design

Status: draft for review. Piece 1 of three (2: Challenges tab, 3: ground-anchored AR chest). Everything runs on **devnet**.

## Goal

When a report is **verified in the admin portal**, the wallet that submitted it is paid **AZMTest** (a devnet SPL token), and the report's hash is stored on-chain against that wallet. Applies to mapping sessions, satellite passes and chest claims; challenges (piece 2) will reuse it.

Success looks like:

1. An admin approves a report in the portal and, without further steps, the wallet receives AZMTest and an on-chain record exists for `(wallet, report hash)`.
2. The same report can never be paid twice, even if the portal retries or is run twice.
3. The user signs nothing extra and needs no devnet SOL: the existing signed report is all they do.
4. The Profile shows the wallet's AZMTest balance and which reports were verified on-chain.

## Decisions already made

- A small Anchor program holds the records and the payout logic (not a memo, not an off-chain payout script).
- The **admin authority pays** the transaction fee and the record rent (relayer model). The record is therefore written at **approval time**, not at submit time.
- Rejected reports are never written on-chain.
- Reward amounts are decided off-chain (server rules file); the program only enforces a cap.
- The token is named **AZMTest** (symbol `AZMTEST`) and has **0 decimals**: it only exists in whole units, so every amount in the rules, the program, the portal and the app is a whole number and nothing is ever rounded.

## Non-goals

Mainnet, the Challenges tab, the AR chest, a public token launch, USDC bounties (unchanged), anything with SKR.

## Components

### 1. Program `azimuth_registry` (`onchain/programs/azimuth_registry`)

Accounts:

- `Config` PDA (`["config"]`): `authority: Pubkey`, `mint: Pubkey`, `max_reward: u64` (whole tokens: the token has 0 decimals, so one unit is one AZMTest), `paused: bool`, `bump: u8`.
- `Vault`: the associated token account of the `Config` PDA for the mint. Holds the AZMTest to pay out.
- `ReportRecord` PDA (`["report", wallet, report_hash]`): `wallet: Pubkey`, `report_hash: [u8; 32]`, `kind: u8`, `amount: u64`, `rewarded_at: i64` (unix time), `bump: u8`.

Report kinds: `0` mapping session, `1` satellite pass, `2` chest, `3` challenge.

Instructions:

- `initialize(max_reward)`: creates `Config` with the signer as authority and the given mint; creates the vault.
- `reward(report_hash, kind, amount)`, signed by `authority` only. In one transaction it
  1. fails if `paused`, if `amount == 0` or `amount > max_reward`, or if `kind` is unknown;
  2. creates the `ReportRecord` (the PDA seeds make a second call for the same wallet and hash fail, so a report pays once);
  3. creates the wallet's token account if missing (paid by the authority);
  4. transfers `amount` from the vault to the wallet, signing as the `Config` PDA;
  5. emits `Rewarded { wallet, report_hash, kind, amount }`.
- `set_paused(paused)` and `set_max_reward(max_reward)`, authority only.

### 2. Token setup script (`onchain/scripts/setup-azmtest.ts`)

One-off, idempotent where it can be: create the mint with **0 decimals** (whole tokens only, no fractions), attach Metaplex metadata (name `AZMTest`, symbol `AZMTEST`, logo URI), mint 1,000,000,000 whole tokens to the authority, call `initialize`, then move 100,000,000 into the vault. Writes the mint address and program ID to `onchain/devnet.json` and prints them. Keypairs are read from `~/.config/solana/devnet.json` by default; nothing secret is written to the repo.

### 3. Server (`server/lib`)

- `azmRewards.js`: pure functions, amounts in whole AZMTest (always integers): mapping `min(50, floor(newCells / 5))` (zero means nothing to pay), satellite pass `25`, chest `10`; all overridable by environment variables. Tested.
- `chain.js`: builds and sends the `reward` transaction with `@solana/web3.js` (instruction built by hand from the IDL layout; no browser SDK). Takes an injectable connection so tests use a fake. Returns `{ signature, record }`.
- `review.js`: after a successful `approve`, call `chain.reward` for the report's wallet. On success store `onchain_tx` and `onchain_record` on the report row. On failure leave the report **approved but unpaid** and record the error.
- Supabase: `reports` gets `onchain_tx text`, `onchain_record text`, `onchain_error text`, `onchain_amount numeric`. `node_summary` returns them so the app can list verified reports. RLS is unchanged (the public key still cannot read reports; the summary function exposes only the owner's own rows by wallet address as it does today).
- Admin portal: a "Pay on-chain" status per report (paid with explorer link, failed with the error and a **Retry** button), a wallet-balance line for the vault, and a pause switch.
- Config in `server/.env` (git-ignored): `AZM_AUTHORITY_KEYPAIR` (path), `AZM_PROGRAM_ID`, `AZM_MINT`, `SOLANA_RPC` (default devnet).

### 4. App

- Profile: AZMTest balance (read the wallet's associated token account over RPC; zero if none), and a "Verified" list from `node_summary` with links to the explorer (devnet cluster).
- Submit result text: "Submitted. You will receive AZMTest when it is verified."
- No change to signing, and no wallet transaction.

## Data flow

1. User signs and submits (unchanged) → report row `new` in Supabase.
2. Admin reviews and approves in the portal → existing approval logic runs.
3. Portal calls `reward` on devnet; the program writes the record and pays the wallet.
4. Portal stores the transaction and record address on the report; the app shows it on next refresh.

## Error handling

- Chain call fails: report stays approved, `onchain_error` is set, **Retry** is offered. Retrying is safe: the record PDA makes a double payment impossible.
- The transaction succeeded but the response was lost: a retry fails with "record already exists"; the server treats that as success and looks up the existing record to fill in the row.
- Vault empty or program paused: the error says which; nothing is written.
- Wrong authority key: the program refuses; the portal shows it.

## Testing

- **Program** (local validator, Mocha): pays once; refuses a different authority, a repeated hash, zero amount, over-cap amount, unknown kind, and paused; creates the token account when missing; vault balance drops by exactly the amount.
- **Server** (node:test): amounts rules; `chain.js` against a fake connection (builds the right accounts and data); approval stores the signature; failure keeps the report approved with an error; retry treats "already exists" as success.
- **App** (Jest): balance display for zero, some and no token account; the verified list.
- **Live devnet check:** run the setup script, approve one test report, confirm the balance changes and the record exists.

## Risks and notes

- The authority key is a hot key on the admin's computer. It can only pay up to `max_reward` per report and only while unpaused. Fine for devnet; mainnet needs a multisig or a separate payer.
- The program must be deployed to devnet (about 1.5 SOL); the current devnet wallet has enough.
- A new program means a new IDL and instruction layout; the server builds instructions by hand, so layout changes must be mirrored in `chain.js` and its tests.

## Open items for later pieces

- Challenge rewards (piece 2) call the same instruction with kind `3` and a challenge id folded into the hash.
- Mainnet needs a token launch decision (see `docs/TOKEN_PLAN.md`).
