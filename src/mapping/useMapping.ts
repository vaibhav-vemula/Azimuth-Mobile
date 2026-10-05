import { create } from 'zustand';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { getCapabilities, scan, startMapping, stopMapping } from '../../modules/signal-scan';
import type { ScanResult } from '../../modules/signal-scan';
import { useAppStore } from '../state/useAppStore';
import { buildReport } from '../reports/report';
import type { Report } from '../reports/report';
import { cellIdAt, distanceM, neighbors, parseCellId, cellId as toCellId } from './hexGrid';
import type { LatLon } from './hexGrid';
import { requestMappingPermissions } from './permissions';
import { probeRadio, probeSonde } from './radioProbe';
import { MAX_REVEAL_ACCURACY_M, cellsWithin } from './explore';
import { stepDistance } from './hudFormat';
import { SessionAccumulator, SessionTotals, emptyTotals, withoutIds } from './sessionStats';
import { CellSignal, SIGNAL_CELL_M, addReading } from './signalLayer';
import { useChests } from '../network/useChests';
import { hexDistance } from './hexGrid';
import type { MappedScan } from './aggregate';
import type { RadioReading, SondeReading } from './radio';
import {
  loadBluetoothEnabled,
  loadRadioEnabled,
  saveRadioEnabled,
  loadHome,
  loadVisited,
  loadExplored,
  saveExplored,
  loadSignals,
  saveSignals,
  FogStyle,
  loadFogStyle,
  saveFogStyle,
  saveBluetoothEnabled,
  saveHome,
  saveVisited,
} from './mappingStorage';
import { HomeExclusion, SessionRecorder } from './session';

export type MappingStatus = 'idle' | 'starting' | 'running' | 'stopping';

export const SCAN_INTERVAL_MS = 20_000;
/** Bluetooth scans take about 2 s and use more battery, so they run on every third reading. */
const BLUETOOTH_EVERY = 3;
/** A dongle reading takes about 2 s and holds the dongle, so it runs once every three readings (about a minute). */
const RADIO_EVERY = 3;

interface MappingState {
  status: MappingStatus;
  error: string | null;
  /** Reporting cells in which readings were recorded (cell id to first time). Used for session counts. */
  visited: Record<string, number>;
  /** Ground cleared from the fog, as fog-grid cells. Local to the phone. */
  explored: Record<string, number>;
  /** What was measured in each reporting cell, for the signal map. Local to the phone. */
  signals: Record<string, CellSignal>;
  currentCellId: string | null;
  newCellsThisSession: number;
  scansThisSession: number;
  /** Ground covered on foot this session, in metres. */
  sessionDistanceM: number;
  /** Fog cells cleared this session (not counting ground that was already clear). */
  sessionClearedCells: number;
  /** Towers, networks and devices found this session, as numbers. Kept after the session ends, until the next one. */
  sessionTotals: SessionTotals;
  lastScan: MappedScan | null;
  startedAtMs: number | null;
  bluetoothEnabled: boolean;
  /** Take dongle readings during mapping when a dongle is connected. */
  radioEnabled: boolean;
  /** The look of unmapped ground. */
  fogStyle: FogStyle;
  setFogStyle: (style: FogStyle) => void;
  /** Result of the latest dongle attempt, for the Map screen. */
  radioStatus: 'off' | 'skipped' | 'ok';
  home: HomeExclusion | null;
  /** The report built when the last session was stopped, ready to sign. */
  lastReport: Report | null;

  load: () => void;
  start: () => Promise<boolean>;
  stop: (node: string | null) => Promise<Report | null>;
  setBluetoothEnabled: (enabled: boolean) => void;
  setRadioEnabled: (enabled: boolean) => void;
  setHome: (home: HomeExclusion | null) => void;
  clearFog: () => void;
  /** Clears the fog around a position. Returns how many new cells were cleared. */
  revealAt: (position: LatLon) => number;
  /** Readings recorded so far this session in or next to the given cell. */
  readingsNear: (cellId: string) => number;
  /** Dongle readings recorded so far this session in or next to the given cell. */
  radioReadingsNear: (cellId: string) => number;
  /** Times the sonde frequency was actually heard in or next to the given cell this session. */
  sondeDetectionsNear: (cellId: string) => number;
  /** Builds a chest-claim report from the running session without stopping it. */
  buildChestReport: (node: string, chest: { id: string; cellId: string }) => Promise<Report | null>;
}

let recorder: SessionRecorder | null = null;
/** The latest usable position, so a reading can be painted onto the signal map where it was taken. */
let lastFix: LatLon | null = null;
let lastFixAtMs = 0;
/** Counts distinct towers, networks and devices for the session. Lives in memory only and is reset at every start. */
const accumulator = new SessionAccumulator();
let positionWatch: Location.LocationSubscription | null = null;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let scanning = false;
let tick = 0;

function appVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0';
}

/** The advertised name of a venue tag worth listening for: from an open visit chest within a few cells. */
const BEACON_LISTEN_CELLS = 5;
function nearbyBeacon(currentCellId: string | null): string | null {
  const here = currentCellId ? parseCellId(currentCellId) : null;
  if (!here) return null;
  let best: { name: string; distance: number } | null = null;
  for (const chest of useChests.getState().chests) {
    const name = chest.spec.beaconName;
    if (chest.kind !== 'visit' || !name) continue;
    const there = parseCellId(chest.cellId);
    if (!there || there.sizeM !== here.sizeM) continue;
    const distance = hexDistance(here.hex, there.hex);
    if (distance <= BEACON_LISTEN_CELLS && (!best || distance < best.distance)) best = { name, distance };
  }
  return best ? best.name : null;
}

/** A sonde chest within a short walk: listen for its frequency instead of the usual NOAA reading. */
const SONDE_LISTEN_CELLS = 12;
/** Detections within this many cells of the landing point count towards a sonde chest. */
export const SONDE_CLAIM_CELLS = 8;
function nearbySonde(currentCellId: string | null): number | null {
  const here = currentCellId ? parseCellId(currentCellId) : null;
  if (!here) return null;
  let best: { frequencyHz: number; distance: number } | null = null;
  for (const chest of useChests.getState().chests) {
    const frequencyHz = chest.spec.frequencyHz;
    if (chest.kind !== 'sonde' || !frequencyHz) continue;
    const there = parseCellId(chest.cellId);
    if (!there || there.sizeM !== here.sizeM) continue;
    const distance = hexDistance(here.hex, there.hex);
    if (distance <= SONDE_LISTEN_CELLS && (!best || distance < best.distance)) best = { frequencyHz, distance };
  }
  return best ? best.frequencyHz : null;
}

async function scanOnce(set: (p: Partial<MappingState>) => void, get: () => MappingState) {
  if (scanning || !recorder) return;
  scanning = true;
  try {
    const includeBluetooth = get().bluetoothEnabled && tick % BLUETOOTH_EVERY === 0;
    tick += 1;
    const sondeHz = get().radioEnabled ? nearbySonde(get().currentCellId) : null;
    const includeRadio = get().radioEnabled && sondeHz === null && tick % RADIO_EVERY === 1;
    const beaconName = nearbyBeacon(get().currentCellId);
    const phone = await scan(includeBluetooth || beaconName !== null, beaconName);
    let radio: RadioReading | undefined;
    let sonde: SondeReading | undefined;
    if (includeRadio) {
      const probed = await probeRadio();
      if (typeof probed !== 'string') {
        radio = probed;
      }
    }
    if (sondeHz !== null) {
      const heard = await probeSonde(sondeHz);
      if (typeof heard !== 'string') sonde = heard;
    }
    // Count distinct towers, networks and devices, then drop the anonymous ids so nothing below keeps them.
    const totals = accumulator.add(phone);
    let result: MappedScan = withoutIds(phone);
    if (radio) result.radio = radio;
    if (sonde) result.sonde = sonde;
    if (beaconName) result = { ...result, beaconName };
    if (!recorder) return;
    const outcome = recorder.addScan(result, Date.now());
    const patch: Partial<MappingState> = { lastScan: result, sessionTotals: totals };
    if (includeRadio || sondeHz !== null) patch.radioStatus = radio || sonde ? 'ok' : 'skipped';
    if (outcome.recorded) {
      patch.scansThisSession = get().scansThisSession + 1;
      patch.currentCellId = outcome.cellId;
      if (lastFix) {
        const id = cellIdAt(lastFix, SIGNAL_CELL_M);
        patch.signals = { ...get().signals, [id]: addReading(get().signals[id], result, Date.now()) };
        scheduleSignalsSave();
      }
      if (outcome.newCell && outcome.cellId) {
        const visited = { ...get().visited, [outcome.cellId]: Date.now() };
        saveVisited(visited);
        patch.visited = visited;
        patch.newCellsThisSession = get().newCellsThisSession + 1;
      }
    }
    set(patch);
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    scanning = false;
  }
}

let exploredSaveTimer: ReturnType<typeof setTimeout> | null = null;
/** Writes the cleared ground to storage at most every few seconds, so walking does not hammer the disk. */
function scheduleExploredSave() {
  if (exploredSaveTimer) return;
  exploredSaveTimer = setTimeout(() => {
    exploredSaveTimer = null;
    saveExplored(useMapping.getState().explored);
  }, 3000);
}

let signalsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSignalsSave() {
  if (signalsSaveTimer) return;
  signalsSaveTimer = setTimeout(() => {
    signalsSaveTimer = null;
    saveSignals(useMapping.getState().signals);
  }, 3000);
}

async function teardown() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = null;
  positionWatch?.remove();
  positionWatch = null;
  try {
    await stopMapping();
  } catch {
    // The service may already be gone.
  }
}

export const useMapping = create<MappingState>((set, get) => ({
  status: 'idle',
  error: null,
  visited: {},
  explored: {},
  signals: {},
  currentCellId: null,
  newCellsThisSession: 0,
  scansThisSession: 0,
  sessionDistanceM: 0,
  sessionClearedCells: 0,
  sessionTotals: emptyTotals(),
  lastScan: null,
  startedAtMs: null,
  bluetoothEnabled: true,
  radioEnabled: true,
  fogStyle: 'terrain',
  radioStatus: 'off',
  home: null,
  lastReport: null,

  load: () => {
    set({ visited: loadVisited(), explored: loadExplored(), signals: loadSignals(), fogStyle: loadFogStyle(), home: loadHome(), bluetoothEnabled: loadBluetoothEnabled(), radioEnabled: loadRadioEnabled() });
  },

  start: async () => {
    if (get().status !== 'idle') return false;
    set({ status: 'starting', error: null, newCellsThisSession: 0, scansThisSession: 0, sessionDistanceM: 0, sessionClearedCells: 0, sessionTotals: emptyTotals(), lastScan: null, lastReport: null });
    try {
      const permissions = await requestMappingPermissions();
      if (!permissions.location) throw new Error('Location permission is needed to place readings on the map.');

      await getCapabilities();
      await useAppStore.getState().requestNotificationPermission();

      lastFix = null;
      accumulator.reset();
      recorder = new SessionRecorder(new Set(Object.keys(get().visited)), { home: get().home });
      tick = 0;
      await startMapping();

      positionWatch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 },
        (loc) => {
          if (loc.mocked !== true && (loc.coords.accuracy ?? 999) <= MAX_REVEAL_ACCURACY_M) {
            const fix = { latitudeDeg: loc.coords.latitude, longitudeDeg: loc.coords.longitude };
            const step = lastFix ? stepDistance(distanceM(lastFix, fix), (loc.timestamp - lastFixAtMs) / 1000) : 0;
            lastFix = fix;
            lastFixAtMs = loc.timestamp;
            // Clearing the fog happens only here, while a mapping session is running.
            const cleared = get().revealAt(fix);
            if (step > 0 || cleared > 0) {
              set({ sessionDistanceM: get().sessionDistanceM + step, sessionClearedCells: get().sessionClearedCells + cleared });
            }
          }
          recorder?.addFix({
            latitudeDeg: loc.coords.latitude,
            longitudeDeg: loc.coords.longitude,
            atMs: loc.timestamp,
            accuracyM: loc.coords.accuracy,
            mocked: loc.mocked === true,
          });
          set({ currentCellId: cellIdAt({ latitudeDeg: loc.coords.latitude, longitudeDeg: loc.coords.longitude }) });
        }
      );
      scanTimer = setInterval(() => void scanOnce(set, get), SCAN_INTERVAL_MS);
      void scanOnce(set, get);
      set({ status: 'running', startedAtMs: Date.now() });
      return true;
    } catch (e) {
      await teardown();
      recorder = null;
      set({ status: 'idle', error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  stop: async (node) => {
    if (get().status !== 'running' || !recorder) return null;
    set({ status: 'stopping' });
    const finished = recorder;
    await teardown();
    recorder = null;
    accumulator.dropIds(); // the anonymous ids are not needed once the session is over

    const buckets = [...finished.buckets.values()];
    let report: Report | null = null;
    if (node && buckets.length > 0) {
      const caps = await getCapabilities().catch(() => null);
      report = buildReport({
        type: 'mapping-session',
        node,
        device: { model: caps?.model ?? 'unknown', app: appVersion() },
        buckets,
        checks: finished.checks(),
      });
    }
    set({ status: 'idle', startedAtMs: null, lastReport: report });
    return report;
  },

  setBluetoothEnabled: (enabled) => {
    saveBluetoothEnabled(enabled);
    set({ bluetoothEnabled: enabled });
  },

  setFogStyle: (style) => {
    saveFogStyle(style);
    set({ fogStyle: style });
  },

  setRadioEnabled: (enabled) => {
    saveRadioEnabled(enabled);
    set({ radioEnabled: enabled });
  },

  setHome: (home) => {
    saveHome(home);
    set({ home });
  },

  readingsNear: (cellId) => {
    if (!recorder) return 0;
    const parsed = parseCellId(cellId);
    if (!parsed) return 0;
    const near = new Set([cellId, ...neighbors(parsed.hex).map((h) => toCellId(h, parsed.sizeM))]);
    let n = 0;
    for (const b of recorder.buckets.values()) if (near.has(b.cellId)) n += b.samples;
    return n;
  },

  radioReadingsNear: (cellId) => {
    if (!recorder) return 0;
    const parsed = parseCellId(cellId);
    if (!parsed) return 0;
    const near = new Set([cellId, ...neighbors(parsed.hex).map((h) => toCellId(h, parsed.sizeM))]);
    let n = 0;
    for (const b of recorder.buckets.values()) if (near.has(b.cellId)) n += b.radio?.samples ?? 0;
    return n;
  },

  sondeDetectionsNear: (cellId) => {
    if (!recorder) return 0;
    const parsed = parseCellId(cellId);
    if (!parsed) return 0;
    let n = 0;
    for (const b of recorder.buckets.values()) {
      const there = parseCellId(b.cellId);
      if (there && there.sizeM === parsed.sizeM && hexDistance(there.hex, parsed.hex) <= SONDE_CLAIM_CELLS) n += b.sonde?.detected ?? 0;
    }
    return n;
  },

  buildChestReport: async (node, chest) => {
    if (!recorder) return null;
    const caps = await getCapabilities().catch(() => null);
    return buildReport({
      type: 'chest-claim',
      node,
      device: { model: caps?.model ?? 'unknown', app: appVersion() },
      buckets: [...recorder.buckets.values()],
      checks: recorder.checks(),
      chest,
    });
  },

  clearFog: () => {
    if (get().status !== 'idle') return;
    saveVisited({});
    saveExplored({});
    saveSignals({});
    set({ visited: {}, explored: {}, signals: {}, currentCellId: null });
  },

  revealAt: (position) => {
    const explored = get().explored;
    let next: Record<string, number> | null = null;
    let added = 0;
    const now = Date.now();
    for (const id of cellsWithin(position)) {
      if (explored[id]) continue;
      next ??= { ...explored };
      next[id] = now;
      added += 1;
    }
    if (next) {
      set({ explored: next });
      scheduleExploredSave();
    }
    return added;
  },
}));
