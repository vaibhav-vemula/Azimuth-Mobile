# Ground-Anchored AR Chest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An AR chest that stands on the detected ground and stays fixed while the user walks around it (ARCore through ViroReact), with a real 3D chest model, shadow, glow ring and an opening effect, feeding the existing claim flow, with the current sensor AR view kept as the fallback.

**Architecture:** Add `@reactvision/react-viro` (spike-proven to build on Expo 57 / RN 0.86). A new `ChestARViro` view places the chest by hit-testing the detected floor and anchoring it. A pure placement state machine decides phases and range rules and is unit-tested; Viro pieces are thin and mocked in Jest. A new `ChestAR` entry picks the Viro view or the old `ChestARView`. A first, small task puts a spike screen on a device (**Gate A**) before anything else is built.

**Tech Stack:** Expo SDK 57, React Native 0.86.3 (new architecture), TypeScript, Jest, `@reactvision/react-viro` 3.0.3 (ARCore), EAS preview builds.

**Spec:** `docs/superpowers/specs/2026-10-10-ar-ground-chest-design.md` (spike evidence: `.superpowers/sdd/viro-spike-report.md`)

## Global Constraints

- Android only. Everything runs on devnet; no change to claim, reward, proximity or readiness rules (`useChestClaim`, `readinessOf`, `OPEN_RANGE_M = 30` stay as they are).
- `PLACE_RANGE_M = 30` (same as the open range): the chest is placed only when within 30 m of its real position.
- Hit results are accepted only when they are a plane (`ExistingPlaneUsingExtent`, `ExistingPlane` or `EstimatedHorizontalPlane`) between **0.5 m and 6 m** from the camera. Last resort after 10 s with no plane: "Place here" puts the chest 1 m ahead on estimated ground 1.3 m below the camera and labels it approximate.
- Viro owns the camera: the Viro view and the expo-camera view must never be mounted at the same time (fully unmount one before the other).
- The old `ChestARView.tsx`, `chestScene.ts` and `expo-gl` stay untouched (they are the fallback).
- ARCore stays "optional" in the manifest so non-ARCore phones can install; the app must handle absence at runtime. After the Viro plugin runs, `android/app/src/main/AndroidManifest.xml` must still contain the `android.hardware.usb.host` feature (needed for the RTL-SDR dongle); verify after prebuild.
- Installs and EAS builds need `legacy-peer-deps=true` (`.npmrc`) because of Viro's optional visionos peer.
- The chest model must be **CC0** with its licence text stored next to it (`assets/models/chest/LICENSE.txt`) and a credit line in `docs/IMPLEMENTATION.md`; at most 20,000 triangles and 1.5 MB; GLB format.
- **Git:** one commit per task made by the controller after review. Implementers never run `git add`/`git commit`. No co-author lines. Never touch `.git` otherwise. The folder `.claude/` (agent worktrees) must never be committed.
- Native/AR behaviour cannot be proven by Jest. Report honestly what is verified (typecheck, Jest, local debug build) and what needs the phone (Gates A and B).

## Review Focus

- **Chest placed with no plane / bad hit** (floating in air, 20 m away, on the ceiling): rejected by range and plane-type rules; tested in `placement.test.ts`.
- **Tracking lost or limited**: banner shows, chest stays anchored, opening is not blocked by the banner; mapping of tracking constants tested.
- **ARCore missing or Viro native module absent** (Expo Go, old phone, init failure): falls back to the old view with a note, never a crash or a black screen. Tested in `viroSupport.test.ts` and `ChestAR.test.tsx`.
- **Two cameras at once**: switching between Viro and the old view never mounts both. Tested in `ChestAR.test.tsx`.
- **Far from the chest**: no chest is placed; arrow and distance are shown; getting within range starts scanning. Tested in `placement.test.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `.npmrc`, `package.json`, `package-lock.json`, `app.json`, `metro.config.js` | Dependency, plugin, `glb` asset type |
| `src/ar/spike/ViroGroundSpike.tsx`, `src/screens/settings/ArSpikeCard.tsx` | Gate A test screen (deleted in Task 7) |
| `src/ar/viro/placement.ts` | Pure state machine, hit acceptance, tracking banner text |
| `src/ar/viro/viroSupport.ts` | Is Viro/ARCore usable on this phone |
| `src/ar/viro/useChestDistance.ts` | Distance (and bearing) from the phone to the real chest |
| `assets/models/chest/*` | The CC0 GLB and its licence |
| `src/ar/viro/ChestARViro.tsx` | Scene, anchored chest, ring, shadow, effect, HUD and panel |
| `src/ar/ChestAR.tsx` | Entry choosing Viro or the old view |
| `src/screens/map/MapScreen.tsx` | Uses `ChestAR` instead of `ChestARView` |

---

### Task 1: Dependency, build and Gate A spike (STOP for the phone test)

**Files:**
- Create: `.npmrc`
- Modify: `package.json`, `package-lock.json`, `app.json`, `metro.config.js`
- Create: `src/ar/spike/ViroGroundSpike.tsx`, `src/screens/settings/ArSpikeCard.tsx`
- Modify: `src/screens/settings/SettingsScreen.tsx` (render `<ArSpikeCard />` below `<TestChestCard />`)

**Interfaces:**
- Produces: `ViroGroundSpike` (default export, no props); `ArSpikeCard()` (a card with a button that opens the spike in a full-screen `Modal` with a Close button).

- [ ] **Step 1: Install**

Run (repo root): `printf 'legacy-peer-deps=true\n' > .npmrc && npm install @reactvision/react-viro@3.0.3`
Expected: `package.json` gains `"@reactvision/react-viro": "^3.0.3"` and `package-lock.json` updates, no ERESOLVE (the `.npmrc` handles Viro's optional visionos peer). Run `npm ls @reactvision/react-viro` to confirm one version.

- [ ] **Step 2: Add the plugin to `app.json`** — in `expo.plugins`, immediately before `"./plugins/withArm64Only"`:

```json
[
  "@reactvision/react-viro",
  {
    "provider": "none",
    "android": { "xRMode": ["AR"] }
  }
],
```

- [ ] **Step 3: Metro asset type** — in `metro.config.js` after `const config = getDefaultConfig(__dirname);` add:

```js
if (!config.resolver.assetExts.includes('glb')) config.resolver.assetExts.push('glb');
```

- [ ] **Step 4: Write `src/ar/spike/ViroGroundSpike.tsx`**

```tsx
// Gate A test: a box that must stay fixed on the floor. Removed once the real chest view has passed Gate B.
import { useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { ViroAmbientLight, ViroARScene, ViroARSceneNavigator, ViroBox, ViroDirectionalLight, ViroMaterials, ViroNode } from '@reactvision/react-viro';

ViroMaterials.createMaterials({ spikeWood: { diffuseColor: '#8B5A2B', lightingModel: 'Blinn' } });

type Pos = [number, number, number];

function GroundScene() {
  const sceneRef = useRef<any>(null);
  const [chestPos, setChestPos] = useState<Pos | null>(null);
  const { width, height } = Dimensions.get('window');

  const place = async () => {
    const results = await sceneRef.current?.performARHitTestWithPoint(width / 2, height / 2);
    const hit = results?.find((r: any) => r.type === 'ExistingPlaneUsingExtent' || r.type === 'ExistingPlane');
    if (hit) {
      const p = hit.transform.position;
      setChestPos([p[0], p[1], p[2]]);
    }
  };

  return (
    <ViroARScene ref={sceneRef} anchorDetectionTypes={['PlanesHorizontal']} onAnchorFound={() => { if (!chestPos) place().catch(() => {}); }} onClick={() => { place().catch(() => {}); }}>
      <ViroAmbientLight color="#ffffff" intensity={400} />
      <ViroDirectionalLight color="#ffffff" direction={[0, -1, -0.3]} />
      {chestPos ? (
        <ViroNode position={chestPos}>
          <ViroBox position={[0, 0.15, 0]} scale={[0.6, 0.3, 0.4]} materials={['spikeWood']} />
        </ViroNode>
      ) : null}
    </ViroARScene>
  );
}

export default function ViroGroundSpike() {
  const [started] = useState(true);
  return (
    <View style={styles.fill}>
      {started ? <ViroARSceneNavigator autofocus initialScene={{ scene: GroundScene }} style={styles.fill} /> : null}
      <View style={styles.hint} pointerEvents="none">
        <Text style={styles.text}>Point at the floor. The box appears on it. Tap to place it again. Walk around it.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hint: { position: 'absolute', bottom: 48, left: 16, right: 16, alignItems: 'center' },
  text: { color: '#fff', backgroundColor: '#000a', padding: 8, borderRadius: 8, textAlign: 'center' },
});
```

(Read `node_modules/@reactvision/react-viro` types if a prop name does not typecheck and fix it; the spike build proved these names compile.)

- [ ] **Step 5: Write `src/screens/settings/ArSpikeCard.tsx`**

```tsx
import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { GlassCard } from '../../components/GlassCard';
import { Button, SectionLabel } from '../../components/ui';
import { colors, typography } from '../../theme';
import ViroGroundSpike from '../../ar/spike/ViroGroundSpike';

/** Gate A: tries ground-anchored AR with a plain box. Temporary; removed once the real chest view passes its device test. */
export function ArSpikeCard() {
  const [open, setOpen] = useState(false);
  return (
    <GlassCard style={{ gap: 10 }}>
      <SectionLabel>Ground AR test</SectionLabel>
      <Text style={styles.hint}>Opens the camera and puts a box on the floor. Walk around it: it should stay put.</Text>
      <Button label="Open ground AR test" icon="cube-outline" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent presentationStyle="fullScreen">
        {open ? (
          <View style={styles.fill}>
            <ViroGroundSpike />
            <View style={styles.close}>
              <Button label="Close" variant="secondary" onPress={() => setOpen(false)} />
            </View>
          </View>
        ) : null}
      </Modal>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary },
  fill: { flex: 1, backgroundColor: '#000' },
  close: { position: 'absolute', top: 48, right: 16 },
});
```

Add `<ArSpikeCard />` after `<TestChestCard />` in `SettingsScreen.tsx` (and its import).

- [ ] **Step 6: Typecheck and tests** — run `npm run typecheck && npx jest`. Expected: clean typecheck, all suites pass (add a trivial render test only if an existing Settings test breaks because Viro cannot load in Jest: then add a `jest.mock('@reactvision/react-viro', () => ({}))`-style mock file at `src/ar/viro/__mocks__`/jest setup, following how other native modules are mocked in this repo, and report).

- [ ] **Step 7: Local debug build proof** — in this repo: `AZIMUTH_ARM64_ONLY=1 npx expo prebuild --platform android --no-install` (the existing ignored `android/` folder is regenerated; fine), then `cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a` (JAVA 21 and `ANDROID_HOME` are set; the spike took about 1.5 minutes). Expected: BUILD SUCCESSFUL. Then check the manifest: `grep -n "usb.host\|com.google.ar.core\|hardware.camera" android/app/src/main/AndroidManifest.xml` must show `usb.host` still present and `com.google.ar.core` as `optional`. Report the APK size.

- [ ] **Step 8: STOP — Gate A (needs the user's phone)**. Do not start Task 2. Report to the controller: what was verified (typecheck, Jest, debug build) and that the user must (1) build a preview APK: `eas build --profile preview --platform android` (or the local build command they used before), (2) install it, (3) Settings > Ground AR test: point at the floor, wait for the box, walk around it for 30 seconds, tilt and cover the camera briefly. Pass criteria: the box stays fixed on the floor. Wait for the user's result. If it fails, the plan stops and is re-made around a custom ARCore module.

---

### Task 2: Placement state machine (pure)

**Files:**
- Create: `src/ar/viro/placement.ts`
- Test: `src/ar/viro/__tests__/placement.test.ts`

**Interfaces:**
- Produces:
  - `PLACE_RANGE_M = 30`, `MIN_HIT_M = 0.5`, `MAX_HIT_M = 6`, `NO_PLANE_HINT_MS = 10_000`
  - `type Vec3 = [number, number, number]`
  - `type Phase = 'far' | 'scanning' | 'placed' | 'opening' | 'claiming' | 'done'`
  - `interface PlacementState { phase: Phase; chestPos: Vec3 | null; approximate: boolean; scanStartedMs: number | null }`
  - `initialPlacement(): PlacementState` (phase `'far'`)
  - `type PlacementEvent = { type: 'distance'; distanceM: number | null; nowMs: number } | { type: 'placed'; pos: Vec3; approximate: boolean } | { type: 'reset-placement'; nowMs: number } | { type: 'open' } | { type: 'claiming' } | { type: 'done' }`
  - `reducePlacement(state, event): PlacementState`
  - `pickHit(results: HitResult[], camera: Vec3): Vec3 | null` where `HitResult = { type: string; transform: { position: Vec3 } }` — first result that is a plane type within `[MIN_HIT_M, MAX_HIT_M]` of `camera` (straight-line distance); otherwise `null`
  - `approximateGroundSpot(camera: Vec3, forward: Vec3): Vec3` — 1 m ahead horizontally, 1.3 m below the camera (`forward` is normalised from the camera transform; use only its x and z, normalised; if that is zero use `[0,0,-1]`)
  - `trackingBanner(state: number): string | null` — `1` (unavailable) → `'Tracking lost. Move the phone slowly.'`, `2` (limited) → `'Tracking is weak. Move slowly and point at a textured surface.'`, `3` (normal) or anything else → `null`
  - `shouldShowNoPlaneHint(state: PlacementState, nowMs: number): boolean` — true only in `'scanning'` and at least `NO_PLANE_HINT_MS` after `scanStartedMs`

- [ ] **Step 1: Write the failing tests**

```ts
import {
  PLACE_RANGE_M, initialPlacement, reducePlacement, pickHit, approximateGroundSpot, trackingBanner, shouldShowNoPlaneHint,
} from '../placement';

const hit = (type: string, p: [number, number, number]) => ({ type, transform: { position: p } });

describe('reducePlacement', () => {
  it('starts far and scans only inside the placing range', () => {
    let s = initialPlacement();
    expect(s.phase).toBe('far');
    s = reducePlacement(s, { type: 'distance', distanceM: PLACE_RANGE_M + 1, nowMs: 1000 });
    expect(s.phase).toBe('far');
    s = reducePlacement(s, { type: 'distance', distanceM: null, nowMs: 1000 });
    expect(s.phase).toBe('far');
    s = reducePlacement(s, { type: 'distance', distanceM: PLACE_RANGE_M, nowMs: 2000 });
    expect(s.phase).toBe('scanning');
    expect(s.scanStartedMs).toBe(2000);
  });

  it('places the chest once and keeps it fixed even if the phone walks away', () => {
    let s = reducePlacement(initialPlacement(), { type: 'distance', distanceM: 10, nowMs: 0 });
    s = reducePlacement(s, { type: 'placed', pos: [1, -1.3, -2], approximate: false });
    expect(s.phase).toBe('placed');
    expect(s.chestPos).toEqual([1, -1.3, -2]);
    s = reducePlacement(s, { type: 'distance', distanceM: 200, nowMs: 10 }); // GPS noise or walking away
    expect(s.phase).toBe('placed');
    expect(s.chestPos).toEqual([1, -1.3, -2]);
    s = reducePlacement(s, { type: 'placed', pos: [9, 9, 9], approximate: false }); // a second hit must not move it
    expect(s.chestPos).toEqual([1, -1.3, -2]);
  });

  it('ignores a placement when not scanning', () => {
    const s = reducePlacement(initialPlacement(), { type: 'placed', pos: [1, 1, 1], approximate: false });
    expect(s.phase).toBe('far');
    expect(s.chestPos).toBeNull();
  });

  it('place again returns to scanning without touching later phases', () => {
    let s = reducePlacement(initialPlacement(), { type: 'distance', distanceM: 5, nowMs: 0 });
    s = reducePlacement(s, { type: 'placed', pos: [0, 0, -2], approximate: true });
    expect(s.approximate).toBe(true);
    s = reducePlacement(s, { type: 'reset-placement', nowMs: 5000 });
    expect(s).toMatchObject({ phase: 'scanning', chestPos: null, approximate: false, scanStartedMs: 5000 });
    s = reducePlacement(s, { type: 'placed', pos: [0, 0, -2], approximate: false });
    s = reducePlacement(s, { type: 'open' });
    s = reducePlacement(s, { type: 'reset-placement', nowMs: 6000 });
    expect(s.phase).toBe('opening');
  });

  it('walks through opening, claiming and done in order only from placed', () => {
    let s = reducePlacement(initialPlacement(), { type: 'distance', distanceM: 5, nowMs: 0 });
    expect(reducePlacement(s, { type: 'open' }).phase).toBe('scanning'); // cannot open before placed
    s = reducePlacement(s, { type: 'placed', pos: [0, 0, -2], approximate: false });
    s = reducePlacement(s, { type: 'open' });
    expect(s.phase).toBe('opening');
    s = reducePlacement(s, { type: 'claiming' });
    expect(s.phase).toBe('claiming');
    s = reducePlacement(s, { type: 'done' });
    expect(s.phase).toBe('done');
  });
});

describe('pickHit', () => {
  const cam: [number, number, number] = [0, 0, 0];
  it('accepts the first plane between 0.5 and 6 metres', () => {
    expect(pickHit([hit('FeaturePoint', [0, -1, -2]), hit('ExistingPlaneUsingExtent', [0, -1.3, -2])], cam)).toEqual([0, -1.3, -2]);
    expect(pickHit([hit('EstimatedHorizontalPlane', [0, -1, -1.5])], cam)).toEqual([0, -1, -1.5]);
  });
  it('refuses too near, too far, non-planes and empty results', () => {
    expect(pickHit([hit('ExistingPlane', [0, -0.1, -0.2])], cam)).toBeNull();
    expect(pickHit([hit('ExistingPlane', [0, -1, -20])], cam)).toBeNull();
    expect(pickHit([hit('DepthPoint', [0, -1, -2])], cam)).toBeNull();
    expect(pickHit([], cam)).toBeNull();
    expect(pickHit(undefined as never, cam)).toBeNull();
  });
});

describe('approximateGroundSpot', () => {
  it('is one metre ahead and 1.3 m below, ignoring the pitch of the camera', () => {
    const p = approximateGroundSpot([2, 1.5, 3], [0, -0.7, -0.7]);
    expect(p[0]).toBeCloseTo(2);
    expect(p[1]).toBeCloseTo(0.2);
    expect(p[2]).toBeCloseTo(2);
  });
  it('falls back to straight ahead when the camera looks straight down', () => {
    const p = approximateGroundSpot([0, 1.5, 0], [0, -1, 0]);
    expect(p).toEqual([0, 0.2, -1]);
  });
});

describe('trackingBanner and the no-plane hint', () => {
  it('maps tracking states to messages', () => {
    expect(trackingBanner(1)).toMatch(/lost/i);
    expect(trackingBanner(2)).toMatch(/weak/i);
    expect(trackingBanner(3)).toBeNull();
    expect(trackingBanner(99)).toBeNull();
  });
  it('shows the no-plane hint only while scanning and after 10 seconds', () => {
    const scanning = reducePlacement(initialPlacement(), { type: 'distance', distanceM: 5, nowMs: 1000 });
    expect(shouldShowNoPlaneHint(scanning, 10_999)).toBe(false);
    expect(shouldShowNoPlaneHint(scanning, 11_000)).toBe(true);
    expect(shouldShowNoPlaneHint(initialPlacement(), 99_999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `npx jest src/ar/viro/__tests__/placement.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/ar/viro/placement.ts`**

```ts
export const PLACE_RANGE_M = 30;
export const MIN_HIT_M = 0.5;
export const MAX_HIT_M = 6;
export const NO_PLANE_HINT_MS = 10_000;
const CAMERA_HEIGHT_M = 1.3;

export type Vec3 = [number, number, number];
export type Phase = 'far' | 'scanning' | 'placed' | 'opening' | 'claiming' | 'done';

export interface PlacementState {
  phase: Phase;
  chestPos: Vec3 | null;
  /** True when the user placed it with the last-resort button, so the height is a guess. */
  approximate: boolean;
  scanStartedMs: number | null;
}

export type PlacementEvent =
  | { type: 'distance'; distanceM: number | null; nowMs: number }
  | { type: 'placed'; pos: Vec3; approximate: boolean }
  | { type: 'reset-placement'; nowMs: number }
  | { type: 'open' }
  | { type: 'claiming' }
  | { type: 'done' };

export const initialPlacement = (): PlacementState => ({ phase: 'far', chestPos: null, approximate: false, scanStartedMs: null });

export function reducePlacement(state: PlacementState, e: PlacementEvent): PlacementState {
  switch (e.type) {
    case 'distance':
      // Only the 'far' phase reacts to distance: once placed, the chest is fixed in the world whatever the GPS says.
      if (state.phase === 'far' && e.distanceM !== null && e.distanceM <= PLACE_RANGE_M) return { ...state, phase: 'scanning', scanStartedMs: e.nowMs };
      return state;
    case 'placed':
      if (state.phase !== 'scanning') return state;
      return { ...state, phase: 'placed', chestPos: e.pos, approximate: e.approximate };
    case 'reset-placement':
      if (state.phase !== 'placed' && state.phase !== 'scanning') return state;
      return { phase: 'scanning', chestPos: null, approximate: false, scanStartedMs: e.nowMs };
    case 'open':
      return state.phase === 'placed' ? { ...state, phase: 'opening' } : state;
    case 'claiming':
      return state.phase === 'opening' ? { ...state, phase: 'claiming' } : state;
    case 'done':
      return state.phase === 'claiming' || state.phase === 'opening' ? { ...state, phase: 'done' } : state;
  }
}

export interface HitResult {
  type: string;
  transform: { position: Vec3 };
}

const PLANE_TYPES = ['ExistingPlaneUsingExtent', 'ExistingPlane', 'EstimatedHorizontalPlane'];

/** The first hit on a plane that is a sensible distance from the camera, or null. */
export function pickHit(results: HitResult[] | undefined | null, camera: Vec3): Vec3 | null {
  for (const r of results ?? []) {
    if (!PLANE_TYPES.includes(r.type)) continue;
    const p = r.transform.position;
    const d = Math.hypot(p[0] - camera[0], p[1] - camera[1], p[2] - camera[2]);
    if (d >= MIN_HIT_M && d <= MAX_HIT_M) return [p[0], p[1], p[2]];
  }
  return null;
}

/** Last resort when no plane is found: one metre ahead of the camera, standing height below it. */
export function approximateGroundSpot(camera: Vec3, forward: Vec3): Vec3 {
  const len = Math.hypot(forward[0], forward[2]);
  const dx = len > 1e-6 ? forward[0] / len : 0;
  const dz = len > 1e-6 ? forward[2] / len : -1;
  return [camera[0] + dx, camera[1] - CAMERA_HEIGHT_M, camera[2] + dz];
}

export function trackingBanner(state: number): string | null {
  if (state === 1) return 'Tracking lost. Move the phone slowly.';
  if (state === 2) return 'Tracking is weak. Move slowly and point at a textured surface.';
  return null;
}

export function shouldShowNoPlaneHint(state: PlacementState, nowMs: number): boolean {
  return state.phase === 'scanning' && state.scanStartedMs !== null && nowMs - state.scanStartedMs >= NO_PLANE_HINT_MS;
}
```

- [ ] **Step 4: Run** — `npx jest src/ar/viro/__tests__/placement.test.ts && npm run typecheck` → 12 passing, clean.

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 3: Support check, distance hook and the chest asset

**Files:**
- Create: `src/ar/viro/viroSupport.ts`, `src/ar/viro/useChestDistance.ts`
- Create: `assets/models/chest/chest.glb`, `assets/models/chest/LICENSE.txt`
- Modify: `docs/IMPLEMENTATION.md` (credit line is added in Task 7)
- Test: `src/ar/viro/__tests__/viroSupport.test.ts`

**Interfaces:**
- Produces:
  - `type ViroSupport = { ok: true } | { ok: false; reason: string }`
  - `getViroSupport(requireImpl?: (m: string) => unknown): ViroSupport` — synchronous. `ok: false` with a reason when the native module is absent (the `require('@reactvision/react-viro')` throws, or `NativeModules.VRTARSceneModule` is missing) or `Platform.OS !== 'android'`. (ARCore being installed/up to date is handled by the Viro view itself: Task 5 treats "tracking never normal within 20 s" as an init failure and falls back.)
  - `useChestDistance(target: LatLon | null): { distanceM: number | null; bearingDeg: number | null }` — updates from the phone's position with the same accuracy-weighted filter the old view uses (`PositionFilter` in `src/ar/stabilize.ts`); read `ChestARView.tsx` (how `startOrientation`/Location watch and `PositionFilter` produce `distanceM` and bearing) and reuse the same helpers (`computeFrame` is NOT needed; use `offsetEnu` from `src/ar/orientation.ts` and `haversine`-style helpers already in `src/mapping/geo.ts`).

- [ ] **Step 1: Failing test** `viroSupport.test.ts`

```ts
import { getViroSupport } from '../viroSupport';

jest.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: { VRTARSceneModule: {} } }));

describe('getViroSupport', () => {
  it('is ok when the module loads', () => {
    expect(getViroSupport(() => ({}))).toEqual({ ok: true });
  });
  it('explains when the Viro package cannot be loaded', () => {
    const r = getViroSupport(() => { throw new Error('Cannot find module'); });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not available/i);
  });
});

describe('getViroSupport without the native module', () => {
  it('reports missing native code', () => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: {} }));
    const { getViroSupport: fresh } = require('../viroSupport');
    const r = fresh(() => ({}));
    expect(r.ok).toBe(false);
  });
  it('reports non-android platforms', () => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' }, NativeModules: { VRTARSceneModule: {} } }));
    const { getViroSupport: fresh } = require('../viroSupport');
    expect(fresh(() => ({})).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `npx jest src/ar/viro/__tests__/viroSupport.test.ts`.

- [ ] **Step 3: Implement `viroSupport.ts`**

```ts
import { NativeModules, Platform } from 'react-native';

export type ViroSupport = { ok: true } | { ok: false; reason: string };

/** Whether the ground-anchored AR view can start on this phone. */
export function getViroSupport(requireImpl: (m: string) => unknown = (m) => require(m)): ViroSupport {
  if (Platform.OS !== 'android') return { ok: false, reason: 'Ground AR is only available on Android.' };
  try {
    requireImpl('@reactvision/react-viro');
  } catch {
    return { ok: false, reason: 'AR support is not available in this build.' };
  }
  if (!(NativeModules as Record<string, unknown>).VRTARSceneModule) return { ok: false, reason: 'AR support is not installed in this build.' };
  return { ok: true };
}
```

- [ ] **Step 4: Implement `useChestDistance.ts`** following `ChestARView.tsx` for the position source: a foreground location watch (the app already requests location), `PositionFilter` from `./stabilize` (import path `../stabilize`), distance/bearing from the filtered position to `target` using the helpers in `src/mapping/geo.ts` (find the distance and bearing functions used by `computeFrame` in `src/ar/frame.ts` and reuse them). Clean up the watch on unmount. No test (location); keep it under 60 lines and typecheck it.

- [ ] **Step 5: Get the chest model.** Find a free CC0 low-poly treasure chest in GLB: candidates are Kenney (kenney.nl, e.g. the Pirate Kit or Survival Kit packs, all CC0) and Poly Pizza CC0 items. Download it with `curl`, read the licence file in the archive and confirm it says CC0 / public domain, then copy the single GLB to `assets/models/chest/chest.glb` and the licence text, author and source URL to `assets/models/chest/LICENSE.txt`. Check size (at most 1.5 MB) and triangle count (open it with `node -e` using the `three` GLTFLoader from `three/examples/jsm/loaders/GLTFLoader.js`, or `npx gltf-transform inspect` if available, otherwise report the file size and say triangles were not counted). If no CC0 model can be downloaded, create no asset, say so in the report, and Task 5 will use the placeholder box.

- [ ] **Step 6: Run** — `npx jest src/ar/viro && npm run typecheck`.

- [ ] **Step 7: Checkpoint** — report the model's source, licence, size, triangles. Do not commit.

---

### Task 4: `ChestARViro` view

**Files:**
- Create: `src/ar/viro/ChestARViro.tsx`
- Test: `src/ar/viro/__tests__/ChestARViro.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`reducePlacement`, `pickHit`, `approximateGroundSpot`, `trackingBanner`, `shouldShowNoPlaneHint`, `initialPlacement`), Task 3 (`useChestDistance`, the GLB), `useChestClaim(chest, mappingRunning, scans)` from `../claim`, `OPEN_RANGE_M` from `../orientation`, UI pieces used by `ChestARView.tsx` (`Badge`, `Button`, `DirectionArrow`, `CHEST_KIND`, `formatDistanceShort`, `rangeLabel`, `useUnitSystem`, `colors`, `typography`).
- Produces: `ChestARViro(props: { chest: Chest; target: LatLon; mappingRunning: boolean; scans: number; onClose: () => void; onUnavailable: (reason: string) => void })` default-exported as a named export `ChestARViro`. It renders the full-screen AR view itself (the caller wraps it in the `Modal`). `onUnavailable` is called once if AR never reaches normal tracking within 20 s of mounting, or if the Viro navigator reports an error, so the entry can fall back.

Behaviour (all pure decisions come from `placement.ts`):
- Mount `ViroARSceneNavigator` (`autofocus`, `initialScene` = the scene below) inside a `View`; overlays are plain React Native views above it.
- Scene (`ViroARScene`): `anchorDetectionTypes={['PlanesHorizontal']}`, `onTrackingUpdated={(state) => …}` (store the number for the banner; mark "tracking was normal once" when state is 3), `onCameraTransformUpdate` (store the camera position and forward in refs, used by hit tests and the last-resort placement), `onAnchorFound` and a 500 ms interval while `phase === 'scanning'`: call `performARHitTestWithPoint(width/2, height/2)`, run `pickHit(results, cameraPos)`, and on a hit dispatch `{type:'placed', pos, approximate:false}`. Lights: `ViroAmbientLight` plus a `ViroSpotLight` with `castsShadow` pointing down at the chest.
- Placed chest: a `ViroNode` at `chestPos` containing: `Viro3DObject` (`source={require('../../../assets/models/chest/chest.glb')}`, `type="GLB"`, scale chosen so the chest is about 0.7 m wide — measure the model's bounds and set the scale constant `CHEST_SCALE` with a comment, `onError` → sets a `modelFailed` flag that renders a `ViroBox` placeholder `[0.7, 0.4, 0.45]` instead), a `ViroQuad` shadow receiver on the ground (`arShadowReceiver`), and a pulsing glow ring (`ViroImage`/`ViroQuad` with an emissive material and a looping scale animation registered with `ViroAnimations`). If the asset is missing (Task 3 reported none), only the placeholder is used.
- Tapping the chest (`onClick` on the node): if `withinOpen` (`distanceM <= OPEN_RANGE_M`) and `claim.ready` → dispatch `open`, play the effect (a short "hop" animation plus a `ViroParticleEmitter` light burst, 1.2 s), then dispatch `claiming` and call `claim.claim()`, then `done` when `claim.state.phase` is `done`/`error`; otherwise show a toast with `claim.hint` or `"{distance} away. Get within {range} to open it."` exactly like `ChestARView`.
- HUD and panel (React Native overlay, same look as `ChestARView`): top bar with Close, distance pill; the `DirectionArrow` and "Get within 30 m" while `phase === 'far'`; "Point at the ground and move slowly" while scanning; after `shouldShowNoPlaneHint` an extra line "Try a surface with more texture and light" and a **Place here** button that dispatches `placed` with `approximateGroundSpot(cameraPos, cameraForward)` and `approximate: true` (and a small "approximate" tag later); a **Place again** button while `placed`; the tracking banner from `trackingBanner`; the claim panel states (hint + Open chest button, "Opening…", "Sending…", "Waiting for your wallet…", done/error with Badge and message, Done button) copied in wording from `ChestARView.tsx`.
- Keep the file under about 400 lines; extract the overlay panel to `src/ar/viro/ChestPanel.tsx` if it grows.

- [ ] **Step 1: Failing tests** — mock `@reactvision/react-viro` (all Viro components as simple `View`s that render children; `ViroARSceneNavigator` renders its `initialScene.scene` component with a stub; `ViroMaterials.createMaterials`, `ViroAnimations.registerAnimations` as no-ops), mock `react-native` modules only if the repo's other screen tests do (follow `src/screens/map/__tests__/chestCompass.test.tsx` or `mappingButton.test.tsx` for the rendering style), mock `useChestDistance` and `useChestClaim`. Assert:
  - far (distance 100): shows "Get within 30 m" text (use `rangeLabel`) and no chest node;
  - scanning (distance 10): shows "Point at the ground"; after advancing fake timers 10 s it shows the no-plane hint and a **Place here** button; pressing it places an approximate chest (the node renders and a "Place again" button appears);
  - placed and claim ready and within open range: pressing the chest calls `claim.claim` once; not within range: shows the distance toast and does not call it;
  - tracking state 1 shows the "Tracking lost" banner and does not remove the chest;
  - `onUnavailable` is called with a reason after 20 s of fake time when tracking never became normal, and not called when it did.
  (If rendering the scene function through the mock is impractical, test `ChestARViro`'s overlay and state logic by exposing a small `useChestAr` hook from the same file and testing that hook plus the overlay component; keep the Viro scene itself untested and say so.)

- [ ] **Step 2: Run to confirm failure** — `npx jest src/ar/viro/__tests__/ChestARViro.test.tsx`.

- [ ] **Step 3: Implement** the component per the behaviour above. Verify every Viro prop and event name against `node_modules/@reactvision/react-viro/components` types (`ViroARScene.tsx`, `ViroARSceneNavigator.tsx`, `Viro3DObject.tsx`, `ViroSpotLight.tsx`, `ViroQuad.tsx`, `ViroParticleEmitter.tsx`, `ViroAnimations.ts`); where a name in this plan differs from the types, use the types and list the difference in the report. For the camera transform event shape and the hit-test result shape use `ViroCameraTransform` and `ViroARHitTestResult` from the package types.

- [ ] **Step 4: Run** — `npx jest src/ar && npm run typecheck && npx jest` → all green.

- [ ] **Step 5: Checkpoint** — report which parts are untestable in Jest (scene, anchoring, shadows, particles). Do not commit.

---

### Task 5: Entry component, MapScreen swap and fallback

**Files:**
- Create: `src/ar/ChestAR.tsx`
- Modify: `src/screens/map/MapScreen.tsx` (line ~26 import and line ~383 usage)
- Test: `src/ar/__tests__/ChestAR.test.tsx`

**Interfaces:**
- Consumes: `getViroSupport`, `ChestARViro`, `ChestARView` (unchanged).
- Produces: `ChestAR(props: { visible: boolean; chest: Chest | null; target: LatLon | null; mappingRunning: boolean; scans: number; onClose: () => void })` — same props as `ChestARView`. Behaviour: `getViroSupport()` not ok → renders `ChestARView` and shows a one-time note ("This phone uses basic AR.") via a small banner (once per app run, module-level flag). Ok → renders a full-screen `Modal` with `ChestARViro`; when `ChestARViro` calls `onUnavailable(reason)` the Viro tree is unmounted first (state `fallback = reason`) and only then `ChestARView` is rendered (never both at once). A `visible=false` renders nothing and mounts neither.

- [ ] **Step 1: Failing tests** (mock both views as stubs that record mount/unmount; mock `getViroSupport`):
  - unsupported → only the old view mounts, and the note text appears once across two opens;
  - supported → only the Viro view mounts;
  - Viro calls `onUnavailable` → the Viro stub is unmounted before the old stub is mounted (record an event log and assert the order `viro:mount, viro:unmount, old:mount`);
  - `visible=false` → neither mounts.

- [ ] **Step 2: Run to confirm failure** — `npx jest src/ar/__tests__/ChestAR.test.tsx`.

- [ ] **Step 3: Implement** `ChestAR.tsx`; change `MapScreen.tsx` to `import { ChestAR } from '../../ar/ChestAR';` and render `<ChestAR visible=… chest=… target=… mappingRunning={running} scans={scans} onClose=… />` in place of `<ChestARView … />` (same props).

- [ ] **Step 4: Run** — `npx jest && npm run typecheck` → all green.

- [ ] **Step 5: Checkpoint** — report. Do not commit.

---

### Task 6: Cleanup, docs and build proof

**Files:**
- Delete: `src/ar/spike/ViroGroundSpike.tsx`, `src/screens/settings/ArSpikeCard.tsx` (and their use in `SettingsScreen.tsx`) — **only after the user reports Gate A passed**; the controller tells the implementer so in the dispatch.
- Modify: `docs/IMPLEMENTATION.md` (section "Ground-anchored AR chest (2026-10-10)")
- Verify: local debug build.

- [ ] **Step 1: Remove the spike screen and card** and run `npm run typecheck && npx jest`.

- [ ] **Step 2: Docs** — append the section: what changed (Viro dependency, plugin settings, `.npmrc`, glb asset type, new files), how the view works (placement rules, 0.5–6 m plane hit, 10 s hint and last-resort "Place here", tracking banner, opening effect, fallback conditions, never two cameras), the chest model credit (author, source URL, licence) from `assets/models/chest/LICENSE.txt`, what is verified (typecheck, Jest, local debug build, Gate A result as reported by the user) and what is NOT verified until Gate B (the real chest on the floor on the Seeker, shadows/ring/particles look, claim flow from the new view, the fallback on a phone without ARCore, behaviour in sunlight and on shiny floors).

- [ ] **Step 3: Build proof** — `AZIMUTH_ARM64_ONLY=1 npx expo prebuild --platform android --no-install && cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a` → BUILD SUCCESSFUL; re-check the manifest for `usb.host`, camera and optional ARCore; report the APK size.

- [ ] **Step 4: Final runs** — `npm run typecheck && npx jest`; report counts.

- [ ] **Step 5: Gate B (user)** — tell the user to build a preview APK and, on the Seeker: Settings > Drop a test chest > Map > start mapping > open AR; check the chest lands on the floor within a few seconds, stays fixed while walking around, tilting and briefly covering the camera; open it (test chest: nothing is submitted); then try the same with AR forced off by testing on a phone without ARCore if one is available. Wait for the result and fix problems found.

---

## Self-Review

**Spec coverage:** anchored placement within 30 m with hit test (Tasks 2, 4); shadow, ring, model, opening effect, tracking banner, place again, last-resort placement, no-plane hint (Tasks 2, 4); unchanged claim and open rules (Task 4 consumes `useChestClaim`/`OPEN_RANGE_M`); fallback and never two cameras (Task 5); dependency, plugin, `.npmrc`, `glb` (Task 1); CC0 model with licence (Task 3); Gate A before the real feature (Task 1 Step 8) and Gate B (Task 6); docs and honest verification (Task 6). Spec's "ARCore missing" fallback is implemented as the support check plus a 20-second "tracking never normal" failure path.

**Placeholder scan:** none; items that depend on reading installed package types (Viro prop names, camera transform shape) name the file to read and require reporting differences.

**Type consistency:** `PlacementState`, `PlacementEvent`, `pickHit`, `approximateGroundSpot`, `trackingBanner`, `shouldShowNoPlaneHint`, `getViroSupport`, `useChestDistance`, `ChestARViro` props and `ChestAR` props are used with the same names across tasks.
