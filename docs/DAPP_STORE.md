# Publishing to the Solana dApp Store

Steps and requirements below come from the Solana Mobile documentation (submission guide and publisher policy). Check them again before submitting; they change.

## Before submitting

1. **Release build, signed.** A release-ready, signed APK is required. Make a release keystore, keep it safe (you need the same key for every update), and build with `npx expo run:android --variant release` or EAS.
2. **Point the app at a real verifier.** Set `EXPO_PUBLIC_VERIFIER_URL` to an HTTPS address when building. Run the verifier with `REQUIRE_SEEKER=1`, `REQUESTER_KEY` and `OPERATOR_KEY` set, behind HTTPS.
3. **Switch the wallet network.** `SOLANA_CHAIN` in `src/wallet/useWallet.ts` is `solana:devnet`. Change it to `solana:mainnet` only after the escrow program is audited and deployed.
4. **App identity.** Replace the placeholder identity (`https://azimuth.app`, `favicon.png`) in `src/wallet/useWallet.ts` and `src/wallet/signReport.ts` with a real domain and icon you control.
5. **Privacy policy.** Host a privacy policy at a public URL. A draft is in `server/public/privacy.html` (served at `/privacy`); it must be reviewed and completed (contact details, retention, jurisdiction) before use.
6. **Real device testing** on a Seeker: wallet connect and signing, mapping with the screen off, battery, dongle readings. See "Not verified" in [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Policy points that apply to this app

From the publisher policy:
- Apps that collect location and signal data must disclose their practices in a privacy policy that complies with applicable law.
- Precise geolocation is "Regulated Data": collect only the minimum needed. Azimuth uploads cell-level (~100 m hex) aggregates in 15-minute windows, never the trail.
- Users must be able to delete their account and the associated data. Profile has "Delete my data from the network" (signed request) and "Erase fog map on this phone".
- Do not use deceptive or coercive means to obtain consent. Mapping is off until the user starts it, with a visible notification while on.
- Apps that provide financial services must have the documentation the law requires. Paying crypto rewards may count; take legal advice before launch, including on age limits.

## Submission (from the guide)

1. Create a publisher account at publish.solanamobile.com and complete KYC/KYB.
2. Connect the publisher wallet (a browser wallet). Keep it safe: it is required for every future submission of this app. Have about 0.2 SOL for fees.
3. Choose storage (ArDrive is recommended; it needs a prepaid balance).
4. Add the dApp: name, description, screenshots, icon.
5. Upload the signed APK as a new version and approve the signing prompts.
6. Review takes 3 to 5 business days. Approved apps go live under a category.

Asset sizes and CLI details were not in the pages I read; check the portal.
