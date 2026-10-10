# Azimuth token plan

A plan for Azimuth's own token, given for opening chests, for verified mapping sessions and for successful satellite captures. It builds on the review and payout flow that already exists. Nothing here is built yet. SKR is left out on purpose for now.

## 1. Decide these first

| Decision | Suggestion |
|---|---|
| Name and ticker | Pick from the shortlist at the end. Check it is not already used on Solscan and Jupiter. |
| Total supply | Fixed, minted once. For example 1,000,000,000 with 6 decimals. |
| Share for rewards | 60% of the supply, paid out over several years so emissions stay small and steady. |
| How rewards are paid | A weekly pool shared by points (section 3). |
| Who controls the treasury | A multisig wallet, not a single phone wallet. |
| Legal route | Talk to a lawyer before any real-money launch (section 8). |

## 2. The token itself

- **Type:** a classic SPL token. It is simple and works in every wallet. Use Token-2022 only if special features are needed.
- **Create it on devnet first**, then repeat on mainnet. Create the mint, create the treasury token account, mint the full supply once, then **revoke the mint authority** so nobody can ever print more. Anyone can check that on-chain.
- **Metadata:** name, ticker and logo (one of the logos in `assets/logos/` as a PNG) hosted on `azimuth.space`, set with Metaplex token-metadata.
- **Suggested split:** 60% community rewards, 15% treasury and operations, 15% team (locked and vested over a few years with a lock service), 10% liquidity and partners.
- **Cost:** well under 0.05 SOL to create. Each new reward recipient needs a token account, about 0.002 SOL, which the treasury pays.

## 3. What earns tokens

Points per approved action, then each week's pool is split by points. Fixed amounts per action can drain the budget if more people join; a weekly pool cannot.

| Action | Points (example) | Paid when |
|---|---|---|
| Open a chest | 100, plus 50 with a dongle, plus 100 for a sonde | the chest claim is approved |
| Verified mapping session | 1 per **new** 120 m cell, plus a small bonus for readings | the session report is approved |
| Successful satellite capture | 300, plus a bonus for strong signal | the pass receipt passes the orbit check |

- **Weekly pool:** a fixed number of tokens for the week (for example 0.2% of the reward allocation). A wallet's tokens = pool x its points / everyone's points.
- **Per-wallet weekly cap:** stops one person taking most of the pool.
- **Cool-down:** a cell pays only once per 7 days, so walking back and forth earns nothing.
- **Easiest first:** new-area points. Capture needs better proof (section 6).

## 4. Backend changes (this repo)

1. **Database** (`server/supabase/schema.sql`): add an `asset` column to `rewards` ('usdc' or the token) and new `kind` values `mapping` and `capture`. Add a `points` column. Add a `reward_epochs` table: week, pool size, status.
2. **Points rules:** a new module beside `server/lib/rules.js` that turns an approved report into points (cells, chest kind, capture quality). Pure functions, with tests.
3. **Review step:** approving a report in the admin portal writes points rows. Manual approval stays.
4. **Admin portal:** a Rewards tab showing the week's pool, points per wallet, estimated tokens, and a button to close the week.
5. **Payout script:** a new `payout-token` script like the USDC one. It reads closed epochs, creates token accounts as needed, sends in batches, and writes a journal so nothing is paid twice. **Dry run by default**, with a hard cap and a treasury-balance check.

## 5. App changes

- **Profile:** token balance (read from the wallet's token account), plus points this week, approved and paid. Estimated tokens are labelled as estimates.
- **Result text:** after opening a chest, or a session being approved, a short "+N points" message. Chests still show no amount before opening.
- **Nothing new to sign:** payouts are sent to the wallet. Users only connect.

## 6. Making it hard to cheat

Already in place: one device per Seeker (SGT check), mock-location flags, speed checks, manual approval. Add:

- Per-wallet and per-day caps on points.
- Duplicate and overlap checks across wallets, so two phones cannot claim the same walk.
- **Stronger capture proof.** A signal receipt is weak. Best: a decoded satellite image checked on the server. At least: strict SNR and recording-size rules, plus a comparison with the predicted pass.
- A "paused" switch so payouts can be stopped instantly.

## 7. Phases

1. **Devnet pilot:** mint, database changes, points rules, admin Rewards tab, dry-run payouts. Test with fake data.
2. **Wallet side:** balance in Profile and the result messages.
3. **Capture verification** upgrade.
4. **Closed beta on mainnet:** tiny pool, a few trusted testers, every payout reviewed by hand first.
5. **Open launch:** after the legal review, with caps, monitoring and a public explanation of the rules.

## 8. Legal and policy

Giving a token for activity can be treated as a security, a money-transmission service, or taxable income, depending on where users and the operator are. Get advice before mainnet. Typical steps: written terms, no promises of price or profit, blocking sanctioned countries, and checking the Solana dApp Store's rules for apps that pay tokens. This is not legal advice.

## 9. Build first

The database changes, the points rules with tests, and the dry-run payout script on devnet. They can be built and tested without real money.

## Name shortlist

Tickers on Solana are not unique and copies are common, so check each one. Avoid anything containing "Seeker", "SKR" or "Solana".

| Name | Ticker | Why |
|---|---|---|
| Azimuth | AZM | Matches the app and the domain azimuth.space. |
| Cairn | CAIRN | A stack of stones that marks a trail: exploration and mapping. |
| Waypoint | WYPT | A place on a route; fits chests and the map. |
| Squelch | SQLCH | Radio slang for cutting noise; memorable. |
| Sonde | SONDE | The balloon radio you hunt. |
| Bearing | BRNG | An angle read off a compass, close to azimuth. |
| Meridian | MRDN | A line of longitude; widely used by others. |
| Beacon | BCN | A signal others find; generic. |
| Fathom | FTHM | To measure and understand. |
| Orbit | ORBT | Satellites; common name, expect clashes. |

First picks: **Azimuth (AZM)** for brand consistency, or **Cairn** for a distinct name.
