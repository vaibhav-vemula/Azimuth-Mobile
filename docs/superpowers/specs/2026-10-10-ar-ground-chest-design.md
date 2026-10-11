# Ground-anchored AR chest (ViroReact / ARCore) — design

Status: draft for review. Piece 3 of three (1: AZMTest registry, built; 2: Challenges, built). Android only (Seeker). Needs a native rebuild and a real-device test.

## Goal

The chest stands **on the ground** and **stays where it was placed** while the user walks around it, tilts the phone or moves closer, like a Pokémon GO encounter. It looks like a real object: a proper 3D chest model with a soft shadow and a glow ring, opening with an effect, then the existing claim flow runs.

Today's AR (`src/ar/ChestARView.tsx`) is sensor-only (compass, GPS, three.js on expo-gl): it cannot hold position when the phone translates and it assumes a 1.3 m camera height. Real anchoring needs ARCore tracking (visual-inertial SLAM, plane detection, anchors); GPS is only used to decide *when* a chest is near.

## Research summary

- Pokémon GO and similar apps use ARKit/ARCore for world tracking and ground planes; GPS and compass only give coarse placement.
- **ViroReact (`@reactvision/react-viro` 3.0.3, published 2026-10-07)** pins `expo >=57 <58` and `react-native >=0.86 <0.87`, ships an Expo config plugin and prebuilt ARCore libraries. A spike build (`.superpowers/sdd/viro-spike-report.md`) compiled into our app on the first try: new architecture on, arm64 only, no fixes, about +12 MB. API: `ViroARSceneNavigator`, `ViroARScene` with `anchorDetectionTypes` and `onAnchorFound`/`onAnchorUpdated`, `performARHitTestWithPoint`/`WithRay`, `createAnchoredNode`. **Not yet run on a device.**
- Viro owns the camera, so it cannot share it with our `expo-camera` AR view, and the existing three.js chest scene cannot be reused inside it.

## Decisions already made

- Spike result accepted: use ViroReact rather than writing a native ARCore module. If the device gate below fails, stop and re-plan (custom module).
- Chest look: a **free CC0 3D chest model** (GLB), bundled in the app, with a licence note kept in the repo.
- The existing sensor AR view stays as the fallback (phones without ARCore, or if Viro fails to start).

## Non-goals

iOS, persistent anchors across app launches, multi-user shared AR, anything on mainnet, changing the claim, reward or proximity rules.

## Behaviour

1. **Finding it far away** is unchanged: the map, the compass arrow and the distance (existing HUD pieces). The new AR view opens the same way the old one does.
2. **Near the chest** (within `PLACE_RANGE_M` = 30 m of its real position, GPS filtered as today): the AR view asks the user to "Point at the ground and move slowly". When ARCore reports a horizontal plane under the screen centre, the chest is **placed there** (hit test at the screen centre, 1–4 m away), anchored with `createAnchoredNode`, with a shadow and a glow ring. It then never moves.
3. **Not near**: the view shows the direction arrow and distance and does not place a chest ("Get within 30 m").
4. **Opening** is unchanged in rule: tap the chest when within `OPEN_RANGE_M` of the real position **and** the readings requirement (`readinessOf`) is met; otherwise show the same reason text as today. Opening plays an effect (hop, light burst, particles) and then the existing `useChestClaim` flow runs (claiming, done, error states and messages unchanged).
5. **Tracking trouble**: when ARCore tracking is limited or lost, a banner says "Tracking lost. Move the phone slowly". The chest stays anchored and reappears when tracking recovers.
6. **Place again**: a small button re-runs placement (for when the chest ended up inside a wall or on a wrong surface). It resets only the placement, not the claim.
7. **Fallback**: if ARCore is unsupported, not installed, or Viro fails to initialise, the existing `ChestARView` is shown and a one-time note explains that this phone uses basic AR.

## Components

- **Dependency and build**: add `@reactvision/react-viro` 3.0.3 and its config plugin to `app.json` (`provider: none`, `android.xRMode: ["AR"]`, no VR, no iOS), `.npmrc` with `legacy-peer-deps=true` so installs and EAS builds do not fail on Viro's optional visionos peer, `metro.config.js` asset extension for `glb`, and the chest asset in `assets/models/chest/` with `LICENSE-chest.txt` naming the author, source URL and CC0 status. Rebuild required (EAS preview).
- **`src/ar/viro/`**: `ChestARViro.tsx` (scene, hit test, anchored chest, ring, shadow, opening effect, banners), `placement.ts` (pure state machine: `searching → placed → opening → claiming → done`, range rules, tracking state mapping), `viroSupport.ts` (is Viro available and does the device support AR; wraps the native check and returns a reason string).
- **`src/ar/ChestAR.tsx`**: the entry used by the screens: chooses `ChestARViro` or the existing `ChestARView` using `viroSupport`; same props as `ChestARView`, so callers change by one import.
- **Spike screen** `src/ar/spike/ViroGroundSpike.tsx` (from the spike) is kept only until the device gate passes, then deleted.

## Device gates (a real phone is the test)

- **Gate A (before building the real feature):** a preview build with the spike screen reachable from Settings; on the Seeker the box stays fixed on the floor for 30 seconds of walking around it, holds when the phone is tilted and covered briefly, and the user reports it looks stable. If this fails, stop and re-plan.
- **Gate B (after the feature):** the real chest placed on the floor, stable, opens and pays through the claim flow; fallback view appears when AR is forced off; the old AR view still works.

## Error handling

- Camera permission denied: the existing permission prompt/text; no AR view.
- ARCore missing or outdated: `viroSupport` returns the reason; fallback view and note. (Viro/ARCore may prompt to install/update ARCore; handled by the library.)
- No plane found after 10 s: hint "Try a surface with more texture and light"; the user can tap "Place here" to place at the screen centre one metre ahead on the estimated ground (below the camera by an assumed 1.3 m) as a last resort, labelled as approximate.
- Chest model fails to load: a plain placeholder box is placed so the flow still works, and an error is logged.

## Testing

- Jest: `placement.ts` (phase transitions, range rules, hit-test result acceptance: only horizontal planes, 0.5–6 m, tracking state mapping), `viroSupport` (native module absent, unsupported device, supported), `ChestAR` chooses the right view, and the existing AR tests keep passing. Viro components are mocked; no AR rendering is tested in Jest.
- Device: Gates A and B above, reported honestly as unverified until the user has tried them.

## Risks and notes

- Anchoring quality on the Seeker is the unknown; Gate A exists to find out cheaply.
- App size grows by about 12 MB and the camera becomes a "required" hardware feature in the manifest (Seeker has one).
- Viro pins React Native to 0.86.x; a future RN upgrade needs a newer Viro.
- The CC0 model's real appearance is not known until chosen; the plan includes picking one and checking its licence file and polygon count (small enough for a phone).
- The old three.js chest scene and `expo-gl` stay in place for the fallback.
