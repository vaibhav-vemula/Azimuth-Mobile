import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ExpoWebGLRenderingContext, GLView } from 'expo-gl';
import * as THREE from 'three';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addOrientationListener, startOrientation, stopOrientation } from '../../modules/signal-scan';
import { Badge, Button } from '../components/ui';
import { colors, typography } from '../theme';
import type { Chest } from '../network/api';
import type { LatLon } from '../mapping/hexGrid';
import { useDevicePose } from '../mapping/useDevicePose';
import { formatDistanceShort } from '../mapping/geo';
import { DirectionArrow } from '../screens/map/components/DirectionArrow';
import { CHEST_KIND } from '../screens/chests/chestInfo';
import { ChestScene, createChestScene } from './chestScene';
import { useChestClaim } from './claim';
import { FrameOutput, computeFrame } from './frame';
import { OPEN_RANGE_M, Quat } from './orientation';

interface Props {
  visible: boolean;
  chest: Chest | null;
  /** The chest's real position. */
  target: LatLon | null;
  mappingRunning: boolean;
  scans: number;
  onClose: () => void;
}

type Phase = 'searching' | 'opening' | 'claiming' | 'done';

interface Hud {
  distanceM: number | null;
  relativeDeg: number;
  inView: boolean;
  withinOpen: boolean;
  oriented: boolean;
  headingDeg: number;
}

const OPEN_ANIMATION_MS = 1500;
/** A compass this far off (radians, about 20 degrees) needs calibrating. */
const POOR_ACCURACY_RAD = 0.35;

/**
 * Looks for a chest through the camera. A 3D chest is drawn at the chest's real position, held still in the world by the
 * phone's orientation sensor, with a beam of light so it can be found from afar. Tap it when you are close enough
 * and have your readings, and it opens and claims the reward.
 */
export function ChestARView({ visible, chest, target, mappingRunning, scans, onClose }: Props) {
  if (!chest || !target) return null;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      {visible ? <Inner chest={chest} target={target} mappingRunning={mappingRunning} scans={scans} onClose={onClose} /> : null}
    </Modal>
  );
}

function Inner({ chest, target, mappingRunning, scans, onClose }: { chest: Chest; target: LatLon; mappingRunning: boolean; scans: number; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kind = CHEST_KIND[chest.kind];
  const [permission, requestPermission] = useCameraPermissions();
  const pose = useDevicePose(true);
  const claim = useChestClaim(chest, mappingRunning, scans);

  const [phase, setPhase] = useState<Phase>('searching');
  const [toast, setToast] = useState<string | null>(null);
  const [sensorError, setSensorError] = useState<string | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [accuracyPoor, setAccuracyPoor] = useState(false);
  const [hud, setHud] = useState<Hud>({ distanceM: null, relativeDeg: 0, inView: false, withinOpen: false, oriented: false, headingDeg: 0 });

  // Shared with the render loop, which runs outside React.
  const device = useRef<Quat | null>(null);
  const declination = useRef(0);
  const user = useRef<LatLon | null>(null);
  const ready = useRef(false);
  const targetRef = useRef(target);
  const sceneRef = useRef<ChestScene | null>(null);
  const frameRef = useRef<FrameOutput | null>(null);
  const size = useRef({ w: 1, h: 1 });
  const stopped = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  user.current = pose.position;
  ready.current = claim.ready;
  targetRef.current = target;

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // The phone's orientation. Started once there is a position, so the compass can be corrected to true north.
  const started = useRef(false);
  useEffect(() => {
    if (!pose.position || started.current) return;
    started.current = true;
    const sub = addOrientationListener((e) => {
      device.current = { w: e.w, x: e.x, y: e.y, z: e.z };
      declination.current = e.declinationDeg;
      setAccuracyPoor(e.accuracyRad !== null && e.accuracyRad > POOR_ACCURACY_RAD);
    });
    startOrientation(pose.position.latitudeDeg, pose.position.longitudeDeg).catch((e) => setSensorError(e instanceof Error ? e.message : String(e)));
    return () => {
      sub.remove();
      void stopOrientation().catch(() => undefined);
      started.current = false;
    };
  }, [pose.position]);

  // Stop everything when the view goes away.
  useEffect(
    () => () => {
      stopped.current = true;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    try {
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      // three.js expects a canvas; expo-gl has none, so this gives it the few things it reads.
      const canvas = { width: w, height: h, clientWidth: w, clientHeight: h, style: {}, addEventListener: () => undefined, removeEventListener: () => undefined, getContext: () => gl } as unknown as HTMLCanvasElement;
      const renderer = new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGLRenderingContext, antialias: false, alpha: true });
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;

      const scene = createChestScene();
      scene.setSize(w, h);
      sceneRef.current = scene;

      let previous: { distanceM: number | null; bearingDeg: number | null } = { distanceM: null, bearingDeg: null };
      let last = Date.now();
      let hudClock = 0;

      const tick = () => {
        if (stopped.current) {
          scene.dispose();
          renderer.dispose();
          return;
        }
        const now = Date.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        const f = computeFrame({
          device: device.current,
          declinationDeg: declination.current,
          user: user.current,
          target: targetRef.current,
          previous,
          dtSec: dt,
          ready: ready.current,
          screenAspect: size.current.w / Math.max(1, size.current.h),
        });
        if (f) {
          previous = f.next;
          frameRef.current = f;
          scene.setView(f.camera);
          scene.setChest(f.world, f.visible);
          scene.setMood(f.mood);
        }
        scene.update(dt);
        renderer.render(scene.scene, scene.camera);
        gl.endFrameEXP();

        hudClock += dt;
        if (hudClock > 0.2 && f) {
          hudClock = 0;
          setHud({ distanceM: f.distanceM, relativeDeg: f.relativeDeg, inView: f.inView, withinOpen: f.withinOpenRange, oriented: f.oriented, headingDeg: f.headingDeg });
        }
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const openIt = useCallback(async () => {
    if (phase !== 'searching') return;
    setPhase('opening');
    sceneRef.current?.open();
    await new Promise((r) => setTimeout(r, sceneRef.current ? OPEN_ANIMATION_MS : 300));
    setPhase('claiming');
    await claim.claim();
    setPhase('done');
  }, [phase, claim]);

  const canOpen = hud.withinOpen && claim.ready;

  const onTap = useCallback(
    (x: number, y: number) => {
      if (phase !== 'searching') return;
      const f = frameRef.current;
      if (!f) return showToast('Finding your position…');
      const hit = sceneRef.current?.hitTest((x / size.current.w) * 2 - 1, -((y / size.current.h) * 2 - 1)) ?? false;
      if (!hit) return showToast(f.inView ? 'Tap the chest' : 'Turn toward the chest');
      if (!f.withinOpenRange) return showToast(`${formatDistanceShort(f.distanceM)} away. Get within ${OPEN_RANGE_M} m to open it.`);
      if (!ready.current) return showToast(claim.hint);
      void openIt();
    },
    [phase, showToast, claim.hint, openIt]
  );

  const failed = sensorError !== null || glError !== null;
  const cameraDenied = permission !== null && !permission.granted;

  return (
    <View style={styles.root} onLayout={(e) => (size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {permission?.granted ? <CameraView style={StyleSheet.absoluteFill as never} facing="back" /> : <View style={[StyleSheet.absoluteFill as never, { backgroundColor: '#05070D' }]} />}
      {permission?.granted && !failed ? <GLView style={styles.fill} onContextCreate={onContextCreate} pointerEvents="none" /> : null}

      {/* Taps land here, and are checked against the 3D chest. */}
      {permission?.granted && !failed && phase === 'searching' ? (
        <Pressable style={styles.fill} onPress={(e) => onTap(e.nativeEvent.locationX, e.nativeEvent.locationY)} accessibilityLabel="Tap the chest to open it" />
      ) : null}

      {/* Top bar */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={onClose} style={styles.round} accessibilityRole="button" accessibilityLabel="Close AR">
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>
            {chest.title}
          </Text>
          <Text style={styles.sub}>
            {hud.distanceM === null ? 'Finding you…' : formatDistanceShort(hud.distanceM)} · {chest.rewardUsdc} USDC
          </Text>
        </View>
        <Ionicons name={kind.icon} size={22} color={kind.color} />
      </View>

      {/* Which way to turn, when the chest is off screen */}
      {!failed && permission?.granted && hud.oriented && !hud.inView && phase === 'searching' && hud.distanceM !== null ? (
        <View style={styles.arrowWrap} pointerEvents="none">
          <DirectionArrow bearingDeg={hud.relativeDeg} headingDeg={0} size={64} color={kind.color} />
          <Text style={styles.arrowText}>{hud.relativeDeg > 0 ? 'Turn right' : 'Turn left'}</Text>
        </View>
      ) : null}

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {/* Bottom status */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {cameraDenied ? (
          <Panel>
            <Text style={styles.panelTitle}>Camera access needed</Text>
            <Text style={styles.panelText}>AR uses your camera to show the chest where it really is.</Text>
            <Button label={permission?.canAskAgain === false ? 'Open settings' : 'Allow camera'} icon="camera-outline" onPress={() => (permission?.canAskAgain === false ? void Linking.openSettings() : void requestPermission())} />
            <Button label="Back to map" variant="ghost" onPress={onClose} />
          </Panel>
        ) : permission === null ? null : failed ? (
          <Panel>
            <Text style={styles.panelTitle}>AR is not available here</Text>
            <Text style={styles.panelText}>{sensorError ?? 'This phone could not start 3D drawing.'} You can still open the chest without AR.</Text>
            <Text style={styles.panelText}>{claim.hint}</Text>
            <Button label="Open chest" icon="cube-outline" disabled={!claim.ready || !hud.withinOpen} onPress={() => void openIt()} />
          </Panel>
        ) : phase === 'done' ? (
          <Panel>
            {claim.state.phase === 'done' ? (
              <>
                <Badge label={claim.state.pending ? 'Submitted for review' : claim.state.accepted ? 'Opened' : 'Not accepted'} color={claim.state.accepted ? (claim.state.pending ? colors.accent : colors.success) : colors.danger} />
                <Text style={styles.panelText}>{claim.state.message}</Text>
              </>
            ) : claim.state.phase === 'error' ? (
              <Text style={[styles.panelText, { color: colors.danger }]}>{claim.state.message}</Text>
            ) : null}
            <Button label="Done" onPress={onClose} />
          </Panel>
        ) : phase !== 'searching' ? (
          <Panel>
            <Text style={styles.panelTitle}>{phase === 'opening' ? 'Opening…' : claim.state.phase === 'sending' ? 'Sending…' : 'Waiting for your wallet…'}</Text>
          </Panel>
        ) : (
          <View style={styles.statusBox}>
            {!hud.oriented ? <Text style={styles.warn}>Starting the compass…</Text> : accuracyPoor ? <Text style={styles.warn}>Compass is off. Wave your phone in a figure 8 to calibrate it.</Text> : null}
            <Text style={styles.status}>
              {hud.distanceM === null
                ? 'Finding your position…'
                : !hud.withinOpen
                  ? `Walk to the light. ${formatDistanceShort(hud.distanceM)} to go.`
                  : claim.ready
                    ? 'Tap the chest to open it.'
                    : claim.hint}
            </Text>
            {canOpen ? <Button label="Open chest" icon="cube-outline" onPress={() => void openIt()} /> : null}
          </View>
        )}
      </View>
    </View>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(5,7,13,0.45)', paddingBottom: 10 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,15,26,0.85)', borderColor: colors.surfaceBorder, borderWidth: 1 },
  titleBox: { flex: 1 },
  title: { ...typography.subheading, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary },
  arrowWrap: { position: 'absolute', left: 0, right: 0, top: '38%', alignItems: 'center', gap: 6 },
  arrowText: { ...typography.subheading, color: colors.textPrimary, textShadowColor: '#000', textShadowRadius: 6 },
  toast: { position: 'absolute', left: 24, right: 24, top: '24%', alignItems: 'center' },
  toastText: { ...typography.body, color: colors.textPrimary, backgroundColor: 'rgba(11,15,26,0.92)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16, overflow: 'hidden', textAlign: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, gap: 10 },
  statusBox: { gap: 10, backgroundColor: 'rgba(11,15,26,0.82)', borderRadius: 18, padding: 14, borderColor: colors.surfaceBorder, borderWidth: 1 },
  status: { ...typography.subheading, color: colors.textPrimary, textAlign: 'center' },
  warn: { ...typography.caption, color: colors.warning, textAlign: 'center' },
  panel: { gap: 10, backgroundColor: 'rgba(11,15,26,0.94)', borderRadius: 18, padding: 16, borderColor: colors.surfaceBorder, borderWidth: 1 },
  panelTitle: { ...typography.subheading, color: colors.textPrimary, textAlign: 'center' },
  panelText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
