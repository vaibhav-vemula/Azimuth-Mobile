# Azimuth Network: DePIN design for Solana Seeker

Status: design proposal, 2 October 2026. Nothing in this document is built yet except what is listed under
"Already built". Claims that come from web research are linked in section 12; claims I could not verify are listed
in section 11.

---

## 1. Thesis

> A network of **Seeker phones**, optionally paired with a **$40 RTL-SDR dongle**, that produce **verifiable
> measurements of the radio environment** (what can actually be received at a place and time) and **satellite
> receptions**, paid for by **requesters who fund bounties**.

The unit of value is not "data" in general. It is a **trusted answer to a specific question about a specific place**,
for example: "Does NOAA Weather Radio actually reach this valley?", "Is 915 MHz clean at this ridge?", "Where does
cell service fail along this road?"

### Why this is worth building (and where it is not)

Verified by research:

- When networks fail, radio matters (Hurricane Helene: total cellular loss in 11 NC counties, 150,000+ people
  isolated, radio was the lifeline).
- Official coverage is a prediction. NWS itself says NOAA Weather Radio reception depends on terrain, distance and
  receiver. FCC mobile coverage maps are challengeable.
- Crowd-sourced radio sensing works (Electrosense) and crowd coverage mapping is wanted (MeshMapper, Helium Mobile
  mapping). Radio DePINs with real buyers exist (Wingbits for ADS-B, GEODNET for RTK).

Honest weaknesses:

- Every individual feature already exists somewhere free: SatDump for Android decodes satellites, Look4Sat predicts
  passes, SDR ProTrack does direction finding, MeshMapper maps mesh coverage, Electrosense maps spectrum from fixed
  sensors.
- Nobody has *demonstrated* paying demand for reception ground-truth. This is the biggest open question and Phase 0
  exists to answer it.
- The addressable supply (Seeker owners) is small, on the order of 100,000+ users per the SKR airdrop figures.

---

## 2. The five DePIN questions

| Question | Answer |
|---|---|
| **Who supplies the physical work?** | Seeker owners. Tier A: phone only (cellular, Wi-Fi, Bluetooth, GNSS health). Tier B: phone + RTL-SDR (NOAA Weather Radio, FM, ISM bands, satellites). |
| **Who pays?** | Requesters funding bounties in USDC: community and emergency groups, county or campground managers, mesh and IoT deployers, researchers, broadcasters verifying coverage. Later, data licences and API subscriptions (the GEODNET and WeatherXM pattern). |
| **How is the work verified?** | Layered: device identity, location and time plausibility, physics, content and signal evidence, witnesses, staking. See section 5. |
| **What stops cheating?** | One device = one node (Seeker Genesis Token), cost of forging evidence exceeding the reward, reputation, stake and slashing, caps per device and per cell. |
| **Why a Seeker?** | Hardware-anchored sybil resistance (SGT), a hardware-backed signing key (Seed Vault), a built-in wallet (Mobile Wallet Adapter), mobility, USB-C host, a crypto-native community, and dApp Store distribution. |

---

## 3. Nodes and identity

**Registration**

1. The user connects through Mobile Wallet Adapter and proves control of the wallet (Sign-In With Solana).
2. The app proves the wallet holds a **Seeker Genesis Token** (SGT): a soulbound NFT minted once per Seeker into the
   Seed Vault wallet. Verify via the Token-2022 mint (for example a DAS `searchAssets` query).
3. A **Node account (PDA)** is created, keyed by the SGT mint. One SGT = one node; the program rejects duplicates.
   This also implements the "has this SGT already claimed a reward" check the Solana Mobile docs recommend.
4. Reports are signed with the Seed Vault key.

**What the key proves and does not prove.** Seed Vault proves *this Seeker signed this report*. It does **not** prove
the radio reading is genuine: a modified app could sign invented numbers. Everything in section 5 exists because of
that gap.

**Tier C (later): non-Seeker Android.** Lower trust: reduced rewards, mandatory corroboration, no SGT. Widens supply
without weakening the premium tier.

---

## 4. Work types and the measurement protocol

A reading is only meaningful if it is comparable. Every work type gets a versioned **measurement protocol**:

- fixed dwell time and number of samples per channel;
- fixed manual gain (never the tuner AGC) recorded with the reading, plus device model and antenna class;
- outdoor / indoor / vehicle flag;
- relative metrics (level above local noise, occupancy, percentile levels) rather than absolute dBm, because RTL-SDR
  hardware is uncalibrated.

### Work types

1. **Reception report (core).** For a map cell: NOAA Weather Radio (162.400 to 162.550 MHz: carrier present, level
   above noise, optional tone), FM broadcast (stations found, level, RDS identity), cellular (carrier, band, signal
   level, from the phone), Wi-Fi and Bluetooth density (counts only), optional ISM noise (433/868/915 MHz).
2. **Satellite pass receipt.** A Meteor-M2 3 / M2-4 recording with metadata and a quality summary. (Already built as a
   recorder.)
3. **Noise survey.** A walk-around measurement of noise level at a chosen frequency, with an evidence report.
4. **Later:** radiosonde recovery, ISS SSTV events, ADS-B.

### Privacy by design

- Never store or transmit SSIDs, BSSIDs, Bluetooth addresses or any device identifier. Counts, signal levels and
  salted hashes only.
- **Wi-Fi, Bluetooth and cellular density over time.** Each map cell stores counts and signal levels per time bucket
  (for example 15 minutes), so the atlas can show how crowded a place is at different times of day and week. The
  timestamp is rounded to the bucket, not exact, because an exact time plus an exact position would let someone
  reconstruct one person's trail. Distinct-network counting uses only the counts seen in a scan; the optional salted
  hash of addresses for de-duplicating is off by default and needs a privacy review (hashed addresses can still be
  linked to a device across time). The exact-timestamp raw log stays on the phone.
- Only measure and identify by frequency allocation. Never decode private or encrypted communications. Maintain an
  allow-list of bands the app may measure (broadcast, NOAA, ISM, satellite downlinks).
- Fuzz published locations to cell level; delay publication of live positions; allow users to exclude areas around
  their home.
- Receive-only. The app never transmits.

---

## 4a. The main loop: mapping sessions, fog of war and bounty chests

The core experience has three layers. Mapping is **opt-in per session**: nothing is logged until the user turns it
on, and it stops when they turn it off.

### Layer 1: mapping session (user-started)

1. The user taps **Start mapping**. A foreground service runs with a visible notification (required by Android for
   background location, and it keeps the user aware that logging is on).
2. While on, the phone logs Tier A signals: cellular signal, band and cell ID; Wi-Fi and Bluetooth counts and
   levels (never names or addresses); GNSS signal quality. With a dongle plugged in it also logs Tier B signals
   (NOAA, FM, noise). Android throttles Wi-Fi scans, so scans are bursty.
3. **Stop mapping** ends the session. The session is summarised into cell-level measurements and signed.
4. Satellite passes remain a separate, already-built capture flow.

### Layer 2: fog of war (personal and local)

- The map starts fogged. Cells the user has visited while mapping are cleared. The fog state and the trail are stored
  **on the phone only**.
- **Two kinds of discovery stay separate.** *New to you* clears fog (free, for fun). *New to the network* is the only
  thing that can earn a reward, because only that adds data value. Paying for re-walking one's own street would
  invite farming. Later measurements of a cell pay less unless a bounty asks for a refresh.

### Layer 3: bounty chests

1. **Chests appear on the map.** A chest is a bounty cell: a place where a measurement is missing, stale or wanted by
   a requester, funded by requesters or network-detected gaps.
2. **The player walks there** with mapping on.
3. **Close by, the player opens the chest.** An AR camera step is the interaction. It is cosmetic: it proves nothing.
4. **The app builds a signed report** from the session and the measurement at the chest, and submits it.
5. **The verifier checks it** (section 5). On success the escrowed reward is released to the player.

### Chest types

| Type | Needs | Purpose |
|---|---|---|
| Gap chest | Phone | Measure an unmapped or stale cell |
| Dead-zone chest | Phone | Confirm or refute cellular / Wi-Fi coverage; highest pay for confirmed dead zones |
| Weather-radio chest | Dongle | NOAA Weather Radio reception ground truth |
| Noise chest | Dongle | Find and characterise local interference |
| Beacon chest | Phone or dongle | Track a real hidden low-power beacon by signal strength (fox hunting) |
| Raid chest | Dongle | Timed event: many players record the same satellite pass from different places, which gives built-in witnesses |
| Recovery chest | Dongle | Track and recover a weather-balloon radiosonde |

Phone-only chests must be enjoyable on their own, because most players will not own a dongle.

### Two roles

| Role | Needs | Job |
|---|---|---|
| **Walker** | Seeker only | Goes to chests and logs what the phone itself senses on the way: cellular signal, band and cell ID; Wi-Fi and Bluetooth counts and levels (never names or addresses); GNSS signal quality (Android raw GNSS measurements, to be checked on the Seeker); motion and barometer for walk plausibility |
| **Radio operator** | Seeker + RTL-SDR | Takes the radio-specific chests for higher pay, and provides calibrated reference readings for the same area |

A bounty can ask for both: walkers cover the area and one operator in the zone gives a reference reading of the same
spot, which doubles as a witness (section 5). Phone-reported signal strength differs between models, so walker data
uses relative metrics and records the phone model.

### Rules that keep it honest

- **Reward source.** Chests pay from requester-funded USDC escrow. Any network-funded top-up is a small, capped,
  decaying subsidy, clearly labelled. SKR is a bonus or multiplier, not the base payment. Newly printed tokens as the
  main payout would invite farming and collapse.
- **Camera is not verification.** Verification comes from the walk's radio data, sensor consistency and the layers in
  section 5.
- **Anti-spoofing** (the main attack, as Pokémon Go shows): one SGT per player, mock-location detection, motion-sensor
  consistency, and cross-checking the claimed place against the Wi-Fi and cell environment the phone actually sees.
- **Placement and safety.** Chests are never placed on roads, private property, hazardous or restricted sites. The app
  warns against using the phone while moving, rate-limits chest density, and applies an age policy to any monetary
  reward.
- **Privacy.** Walks are summarised into cell-level measurements. Trails are not published; no device identifiers
  are stored (section 4).
- **Receive-only.** Beacon chests use the operator's own low-power beacons; the app itself never transmits.

### Progression (optional, later)

Teams and seasons, readiness drills funded by towns or emergency groups ("which neighbourhoods can hear weather
radio?"), and reputation tiers that unlock higher-value chests.

### Sonde add-on (dongle)

Radiosonde recovery chests are a later add-on bounty. Radiosondes launch twice daily from weather-service sites
(Sterling, Virginia is the one near Washington, DC). Tracking them means decoding sonde telemetry (SondeHub-style),
which is a substantial port. A first version could rely on signal strength and recovery as the proof. SondeHub's
own rules have not been checked and should be before designing the reward.

### Build order

1. Wallet, SGT and node registration.
2. Mapping session (Start/Stop) with the phone logger and the local fog-of-war map on a hex grid.
3. Signed cell-level upload with the new-to-network reward, and verifier v1.
4. Bounty chests (phone-only gap and dead-zone chests first).
5. Dongle scans folded into the same map and radio chests (weather radio, noise).
6. Satellite pass receipts as signed events, beacon chests and raid events.
7. Sonde recovery bounties.

## 4b. Venue chests

Local businesses and places are the most promising non-crypto paying customer: they want visitors, and they want
their wireless quality known.

- **Sponsored visit chests.** A cafe or shop funds a chest at its door in USDC. The player must be physically there;
  the venue gets visits and a wireless-quality measurement.
- **Proof of presence from the venue's own signal.** A cheap Bluetooth tag or the venue's Wi-Fi acts as the check-in.
  The app confirms that signal at a plausible strength. Indoors this is stronger than GPS. (Count and level only;
  the venue opts in.)
- **Remote-work spot ratings.** Measured Wi-Fi and cellular quality in cafes, libraries and coworking spaces, shown as
  a "where can I work" map built from measurements, not reviews.
- **Dead-spot audits.** Malls, campuses, stadiums and hospitals fund floor-by-floor walk-throughs of cellular and
  Wi-Fi dropouts.
- **Event chests.** Festivals, markets and conferences place chests to spread people out and reveal where the network
  jams.
- **Quest trails.** A neighbourhood trail of venue-funded chests with a completion bonus.
- **Emergency-readiness stops.** A town marks community buildings and shelters; players confirm weather-radio and
  cellular coverage there.
- **Interference diagnosis (dongle).** Finding the source of a venue's flaky Wi-Fi or payment-terminal trouble.
- **Time-based chests.** Chests that open only at certain hours, so the same place is measured at different loads.
- **Drop-and-find.** Players hide rewards for others, with a signal reading logged at the spot.

Limits: venue demand is unproven (test by asking about 10 local venues whether they would pay roughly $20 for 20
visits); indoor GPS is poor, hence the venue-signal check; cap visits per player per venue per day to stop farming;
never record other people's devices.

**First pilot:** sponsored visit chests combined with Wi-Fi and cellular quality ratings in a few cafes in Washington,
DC. Phone-only, with every chest backed by a sponsor and a useful output.

## 4c. Competitors and what they show

| Project | What it does | Relevance |
|---|---|---|
| **Kage (Chirp)** | Play-to-earn game where players detect Wi-Fi, Bluetooth and cellular networks to build a geolocation database; reported close to 1M players. Chirp is on Sui | Phone-only network mapping for rewards already exists at scale |
| **375go (375ai)** | Solana DePIN; free app tests network quality while walking or driving and rewards covered hexes; EAT token mainnet 29 Oct 2025; "Proof of Data" verification described as planned | Same, on Solana. Its anti-spoofing is unverified by me |
| **TokenRun (Solana Mobile + GEODNET)** | Location treasure hunt on Seeker, now also on Android; chests with partner tokens and NFTs; players can bury rewards; claimed GEODNET Proof of Location; Seeker bonus rewards | The chest mechanic on Seeker already exists, backed by the platform |

Consequences for Azimuth:

- Generic Wi-Fi/cellular mapping and a plain chest game are not differentiated. Compete on bounty-defined,
  requester-paid measurements with signed evidence, plus the dongle tier (NOAA, noise, satellite, beacon chests).
- Find out how TokenRun and 375go verify and pay before building (I only read news and aggregator summaries).
- Consider being a work type inside an existing hunt app or using GEODNET-style location proof instead of building
  our own.
- Whether anyone pays for radio ground truth remains the open question (Phase 0).

## 5. Verification (proof of physical work)

No single check is enough. The design stacks checks so that **forging a report costs more than the reward**.

| Layer | What it checks | Weakness |
|---|---|---|
| 1. Device identity | SGT ownership, Seed Vault signature, one node per SGT | Proves the device, not the data |
| 2. Location and time | GNSS fix, mock-location flag, speed plausibility, motion-sensor consistency, Wi-Fi/cell fingerprint agreeing with the claimed cell | GNSS can be spoofed |
| 3. Physics | Measured vs expected for **known** transmitters. NOAA Weather Radio and FM station locations and powers are public (FM contour data from the FCC; NWS station list), so a path-loss model gives an expected range. Satellite reception must follow the predicted elevation curve and Doppler | Models have error bars; terrain |
| 4. Content evidence | Evidence that depends on the actual broadcast at that moment: FM RDS identity and RDS clock-time group, NOAA broadcast content matched against the station's own stream by audio fingerprint, satellite frame counters and onboard timestamps | A forger could replay an internet stream |
| 5. Signal evidence | Keep a hash chain of the raw samples (per-second chunks, Merkle root on-chain). The verifier can re-demodulate and check that the audio matches the RF and that noise statistics look physical. Forging consistent RF is possible but expensive | Needs the evidence stored |
| 6. Witnesses | Two nodes in the same cell and time window must agree within tolerance; the verifier may request a re-measurement from a nearby node | Needs density; thin in rural areas |
| 7. Stake and reputation | A small stake, slashed on proven fraud; reputation multiplies rewards and unlocks high-value bounties | Capital barrier |

In low-density areas, where witnesses are scarce, low-confidence data is paid less rather than rejected.

**Reference patterns from other DePINs:** Helium proof of coverage (neighbours challenge and witness), Wingbits
(reception validated by neighbouring nodes), Witness Chain proof of location, and a Libre Space framework for
blockchain-verified ground infrastructure that uses GNSS-derived pseudorandom challenges.

---

## 6. On-chain design (Solana)

Programs (Anchor), minimal first:

- **Node:** PDA per SGT mint: owner wallet, stake, reputation score, protocol versions supported.
- **Bounty:** escrowed USDC; hash of the specification; target cells; reward per cell and maximum fills; protocol
  version; minimum reputation; deadline; refund rules.
- **Submission:** report hash, evidence Merkle root, cell, time bucket, metrics summary, node signature.
- **Settlement:** verifier attestation(s) release payment; a dispute window precedes payout.
- **Reputation:** updated by settlements and slashing.

Cost control: batch submissions into daily Merkle roots and keep raw evidence off-chain (object storage with the
hash on-chain). Evaluate state compression (for example Light Protocol's ZK compression) before creating one account
per report. Check current rent and fee numbers rather than assuming.

**Verifier evolution**

1. **v1:** one operator runs an open-source scoring service; anyone can re-run it on the evidence.
2. **v2:** a permissioned committee of N verifiers with threshold signatures and an optimistic dispute window.
3. **v3:** staked verifiers (SKR or USDC) with slashing for provably wrong attestations.

Be explicit about v1 being trusted.

---

## 7. Incentives and token

Lessons from other DePINs: emissions attract supply but not customers, and networks without paying demand lose
their supply when emissions fall. Hivemapper shifted rewards toward uncovered roads and added peer review.

- **Launch with no new token.** Pay from bounty escrow in USDC.
- **Gap bonuses:** a capped treasury budget that tilts pay toward unmapped cells (clearly labelled as a subsidy, with
  decay).
- **SKR integration (meaningful, optional):** stake SKR for reputation and a reward multiplier; later, stake SKR to run
  a verifier. SKR is the Solana Mobile ecosystem token (staking to Guardians, governance, curation), so this fits its
  intended use.
- **Data product:** open atlas (CC0 or ODbL, to be decided), plus paid API and report exports for enterprises.
- Consider a token only after there is revenue to anchor it (a burn-and-mint or revenue-share design), never before.

---

## 8. Data product

- **Atlas:** per-cell, per-hour aggregates by channel, with confidence scores. Public, with fuzzed locations.
- **Readiness Report:** a signed, exportable PDF and GeoJSON per place: what can be received without internet,
  with method, confidence and the evidence roots.
- **API:** cell and region queries; webhooks for requesters when a bounty fills.
- **Time series:** change over months (new transmitters, new interference).

---

## 9. Already built (reusable foundation)

- Android app on Expo SDK 57 with a Kotlin/C++ native module for the RTL-SDR Blog V4 (driver, async streaming, FFT, FM demodulator, recorder, foreground service).
- Pass prediction (verified against Skyfield), ground track and sky plot, reminders; automatic frequency and gain; full-band and compact recording with SigMF.
- Wallet connection, signed reports, mapping sessions with a native phone-signal scanner, fog-of-war map, chests (phone and dongle kinds, venue tags, satellite passes, sonde hunts), pass receipts, privacy controls and data deletion.
- Verifier service, requester console, Seeker Genesis Token gate, orbit physics check, and an Anchor escrow program with a settlement script.

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for details, tests, and what has not been verified on a device.

---

## 10. Roadmap with exit criteria

**Phase 0: validate (before building much).**
- Calibration study: measure known NOAA and FM transmitters at known distances with the V4, compare with the
  path-loss model, establish error bars and a protocol. *Exit: repeatable measurements within a stated tolerance.*
- Interview 10 to 15 target users (ARES/CERT, emergency managers, rural communities, mesh groups, broadcasters, IoT
  deployers). *Exit: at least 2 who would fund or use a bounty, in writing.*
- Competitive review (DecenSpace, Wingbits, Electrosense, SondeHub, MeshMapper, Helium Mobile mapping) and a legal
  review (receive-only, privacy, data licence).

**Phase 1: identity and measurement.**
Mobile Wallet Adapter, SIWS, SGT check, Node program, the Start/Stop mapping session with phone logging and the local
fog-of-war map, the reception-report protocol and band scans, local quality checks, canonical report format,
evidence hash chain. Test Android background limits and battery on a real Seeker early. *Exit: a signed report from
a real Seeker that an independent script can verify end to end.*

**Phase 2: marketplace.**
Bounty program and escrow, verifier v1, payouts, atlas, requester console. *Exit: a real funded bounty filled and
paid on devnet, then mainnet with small amounts.*

**Phase 3: verification hardening.**
Physics scoring, witness assignment, content evidence (RDS, audio fingerprint), anomaly detection, stake and
slashing, dispute flow, verifier committee. *Exit: red-team results: a documented attempt to fake reports and its
cost.*

**Phase 4: incentives.**
Gap bonuses, SKR staking and reputation, reward tuning from observed fraud and fill rates. Decide on a token only if
revenue exists.

**Phase 5: reach.**
Non-Seeker tier, in-app satellite decoding, more bands and work types, dedicated low-cost nodes if justified.

**Metrics to watch:** cells covered and repeat-covered, bounty fill rate and time to fill, verification precision and
measured fraud rate, cost per verified measurement, requester retention, node retention, share of revenue from
non-crypto customers.

---

## 11. Risks and what is not verified

- **Demand is unproven.** Phase 0 exists to test it. Do not assume a market.
- **Hardware barrier.** Most Seeker owners will not buy a dongle; Tier A (phone only) must be useful on its own.
- **Measurement quality.** RTL-SDR readings are uncalibrated and antenna-dependent. Use relative metrics, record the
  setup, and publish error bars.
- **Verification is probabilistic.** Say so. v1 uses one trusted verifier.
- **Android limits.** Wi-Fi scanning is throttled to 4 scans per 2 minutes in the foreground and 1 per 30 minutes in
  the background, so scans are bursty.
- **Legal and privacy.** Receive-only measurement of allocated broadcast, ISM and satellite bands should be fine, but
  confirm per jurisdiction (for example rules on intercepting certain communications). Never store identifiers.
- **Competition.** DecenSpace (ground stations on Solana) and Wingbits (ADS-B) are real. Differentiate on mobility,
  low cost and the ground-truth question.
- **Not verified by me:** DecenSpace's actual verification and token design; exact SGT verification calls (read the
  Solana Mobile docs and test on a device); compatibility of the Mobile Wallet Adapter packages with Expo SDK 57 and
  React Native 0.86 (test first); exact Solana rent and compression costs; availability of public FM contour and
  NOAA transmitter data in a usable format (believed public, confirm).

---

## 12. Sources

- Seeker Genesis Token: https://docs.solanamobile.com/solana-mobile-stack/seeker-genesis-token.md
- Seed Vault: https://docs.solanamobile.com/solana-mobile-stack/seed-vault.md
- Solana Mobile React Native quickstart: https://docs.solanamobile.com/react-native/quickstart
- SKR: https://solanamobile.com/blog/skr-is-live
- DePIN overview and verification patterns: https://eco.com/support/en/articles/15284396-what-is-depin
- Witness Chain proof of location: https://www.eigenlabs.org/blog/verifying-the-physical-world/
- Wingbits: https://www.kucoin.com/blog/en-wingbits-deep-dive-the-aerospace-grade-depin-revolution-2026-edition
- GEODNET: https://medium.com/@done_71651/geodnet-geod-in-depth-research-report-the-real-yield-king-of-the-depin-sector-35d3e4a6733f
- DePIN demand and Hivemapper: https://github.com/Ricosworks1/depin-research-reports/releases/tag/depin-dispatch-nodes-cluster-where-unneeded-20260923
- Libre Space blockchain-verified ground infrastructure: https://events.libre.space/event/9/contributions/229/attachments/173/260/A%20Framework%20for%20Blockchain-Verified%20Ground%20Infrastructure.pdf
- Electrosense: https://www.rtl-sdr.com/electrosense-rtl-sdr-based-crowd-sourced-spectrum-monitoring-with-a-dc-to-6-ghz-rtl-sdr-up-downconverter/
- Hurricane Helene communications: https://www.preventionweb.net/news/bridging-communication-gaps-lessons-hurricane-helene
- NOAA Weather Radio reception: https://www.weather.gov/mqt/nwrpg_reception
- FCC coverage challenges: https://www.fcc.gov/BroadbandData/consumers
- MeshMapper: https://apps.apple.com/app/id6758073991
- Android Wi-Fi scan limits: https://developer.android.com/develop/connectivity/wifi/wifi-scan
- Safecast (how crowd data becomes trusted): https://en.wikipedia.org/wiki/Safecast
