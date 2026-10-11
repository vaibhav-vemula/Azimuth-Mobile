# Challenges tab (Quests) with AZMTest rewards — design

Status: draft for review. Piece 2 of three (1: AZMTest registry, built; 3: ground-anchored AR chest). Devnet only.

## Goal

A new **Quests** tab lists challenges ("Scan for 30 minutes", "Explore 1 square mile of new ground"). The app tracks progress by itself from what the user already does. A **Go** button takes the user to the screen where the challenge is done. When a challenge is complete the user taps **Claim**, signs once, and the server checks the claim against that wallet's already-verified reports and **pays AZMTest automatically** (same on-chain `reward`, kind 3), with no admin click.

## Decisions already made

- Reward flow: **Claim, then paid automatically** after the server checks it (user choice). The server never trusts the phone's numbers; it recomputes progress from the wallet's reports that an admin already verified.
- Challenge set (v1): **daily + weekly + one-time**, a fixed list shipped in the app and mirrored on the server.
- Rewards are whole AZMTest; the on-chain `reward` instruction and cap (100) are reused unchanged.
- Name of the tab: **Quests** (shorter than Challenges; fits the tab bar).

## Non-goals

Server-editable challenge lists, leaderboards, streaks, notifications, the AR chest, anything on mainnet.

## Challenges (v1, all progress server-verifiable)

Progress is measured from the wallet's **verified** reports in the period (`status = 'verified'`, by `verified_at`), so a challenge can only complete after the usual review.

| id | period | goal | measured from | reward |
|---|---|---|---|---|
| `scan-30` | daily | 30 minutes of mapping | sum of `checks.durationSec` of verified mapping-session reports | 5 |
| `cells-20` | daily | 20 new cells | sum of the `new-cells` reward rows' paid cells (amount / `newCellUsdc`) | 5 |
| `ground-1mi` | weekly | 1 square mile of new ground | paid new cells × 120 m hex area (about 0.0374 km² each) ≥ 2.59 km² | 40 |
| `passes-3` | weekly | 3 satellite passes | count of verified satellite-pass reports | 30 |
| `first-chest` | one-time | open a chest | one verified chest-claim report | 20 |
| `first-sonde` | one-time | hunt a sonde | **cut from v1**: sonde hunts are not reported to the server, so they cannot be verified | — |

Periods: a day is a UTC calendar day, a week is an ISO week (Monday–Sunday UTC), both labelled with a `period` key (`2026-10-10`, `2026-W41`, `once`). UTC keeps phone and server in agreement.

## Components

### 1. Shared definitions

One JSON file, `challenges.json` at the repo root, lists every challenge (id, title, period, metric, goal, reward). The app imports it through `src/challenges/definitions.ts`; the server loads it from `../challenges.json` in `server/lib/challenges.js`. One source of truth, and a test on each side that every entry has a known metric, a positive whole reward of at most 100, and a valid period.

### 2. App

- `src/challenges/progress.ts`: pure functions turning local data (session history, chests opened, passes captured) into live progress per challenge for the current period. Display only; the server decides.
- `src/challenges/useChallenges.ts`: loads progress, the claimed set (from `node_summary`), exposes `claim(id)`.
- Quests tab (`src/screens/quests/`): cards with a progress bar, reward, state (in progress / ready to claim / claimed / waiting for check), **Go** (daily and weekly mapping challenges → Map tab; satellite → Satellites tab; chest → Map tab), **Claim**.
- Claim: builds a `challenge-claim` report `{ type, node, challengeId, period }`, signs it with the wallet (one Seed Vault prompt), inserts it like any report.
- Profile and the existing "verified" list show these payouts too (they are on-chain records).

### 3. Server and database

- `reports.type` check gains `'challenge-claim'`; the anon insert grant is unchanged (`schema_challenges.sql`).
- `lib/challenges.js`: `progressFor(challenge, period, rows)` and `settle(claim)`: finds the wallet's verified reports in the period, computes progress, and returns `{ ok, amount }` or reasons.
- `lib/review.js`: `settleChallenges()` processes new `challenge-claim` reports. For each one: verify the signed envelope (`verifyEnvelope`, type column matches the body, same checks as other reports), look up the challenge, check the period is the current or just-ended one, compute progress, and if the goal is met mark the report `verified` and pay on-chain, otherwise `rejected` with a reason ("23 of 30 minutes"). Payment goes through the existing `payOnChain` with kind 3.
- **Once per challenge and period** is enforced twice: the on-chain `report_hash` for a challenge is `sha256("challenge:" + id + ":" + period)`, not the claim's own hash, so the registry's record PDA refuses a second payment; and the server skips a claim when a verified claim for the same wallet, id and period already exists.
- The admin portal runs `settleChallenges()` on a timer (every 30 s) while it is open, and has a "Challenge claims" line in the payouts panel. Claims wait until the portal is running; nothing is paid when it is off.

## Data flow

1. User works (maps, captures a pass, opens a chest); those reports are verified in the portal as today.
2. The Quests tab shows progress live from local data.
3. Goal met → **Claim** → signed `challenge-claim` inserted.
4. Portal timer settles it: recomputes progress from verified reports, pays AZMTest or rejects with the reason.
5. The app shows "Claimed" and the payout under Verified on next refresh.

## Error handling

- Local progress ahead of verified progress (reports not reviewed yet): the claim is rejected with "23 of 30 minutes verified so far"; the card goes back to in-progress and can be claimed again once more reports are verified.
- Chain failure: the claim stays verified-but-unpaid with the error and the portal's existing Retry.
- Replay or double claim: refused by the period rule and by the registry.
- Phone clock wrong: periods are checked against the server's UTC time at settlement, not the claim's timestamp alone (the claim's period must be today's or yesterday's/last week's).

## Testing

- App (Jest): progress functions for each metric and period boundary (UTC midnight, ISO week), card states, Claim builds the right report.
- Server (node:test): `progressFor` per metric; settle accepts a met goal, rejects an unmet one with numbers, rejects an unknown challenge, a stale period and a duplicate; hash derivation; `settleChallenges` pays kind 3 once; failure leaves it retryable; the type-column check.
- Live: complete a daily challenge with verified reports on devnet, claim, confirm the payout and the record.

## Risks and notes

- This is the first path where a payment has no human click. The safety is that only verified reports count and amounts are small and capped at 100 on-chain; the portal's pause switch stops it too.
- A user can only claim what a human already verified, so a claim made right after mapping waits until the next review pass. The UI must say "waiting for verification" instead of looking broken.
- The one shared `challenges.json` keeps phone and server lists identical; changing a challenge needs an app update.
- Sonde challenge is deferred until sonde hunts have a verifiable report.
- Not yet verified: any of this on a phone.
