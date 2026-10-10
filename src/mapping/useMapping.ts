import { create } from 'zustand';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { getCapabilities, scan, startMapping, stopMapping } from '../../modules/signal-scan';
import type { ScanResult } from '../../modules/signal-scan';
import { useAppStore } from '../state/useAppStore';
import { buildReport } from '../reports/report';
import type { Report } from '../reports/report';
import { cellIdAt, distanceM, hexCenter, neighbors, parseCellId, cellId as toCellId } from './hexGrid';
import type { LatLon } from './hexGrid';
import { requestMappingPermissions } from './permissions';
import { Snapshot, mergeSnapshots } from '../backup/snapshot';
import { MAX_SESSION_CELLS, SessionRecord, buildSessionRecord, reconstructSessions, sortSessions } from './sessionHistory';
import { levelDbfs } from './radio';
import { ensureDongle, probeRadio, probeSonde } from './radioProbe';
import { MAX_REVEAL_ACCURACY_M, cellsWithin, exploredAreaKm2, pointsAlong } from './explore';
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
  loadSessions,
  saveSessions,
  loadSessionCells,
  saveSessionCells,
  removeSessionCells,
  loadBackfilled,
  saveBackfilled,
  loadPending,
  savePending,
  saveBluetoothEnabled,
  saveHome,
  saveVisited,
} from './mappingStorage';
import { HomeExclusion, SessionRecorder } from './session';

export type MappingStatus = 'idle' | 'starting' | 'running' | 'stopping';

export const SCAN_INTERVAL_MS = 20_000;

/**
 * How long to wait before the next reading, by how fast you are moving. Walking, every 20 seconds is plenty; in a car that
 * would be a reading every few hundred metres, which draws as separate dots on the signal map, so readings come more often.
 */
export function scanIntervalFor(speedMps: number): number {
  if (!Number.isFinite(speedMps) || speedMps < 3) return SCAN_INTERVAL_MS;
  if (speedMps < 10) return 10_000;
  return 6_000;
}
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
  /** Finished sessions, newest first. */
  sessions: SessionRecord[];
  /** Removes one finished session from the history (the fog it cleared stays cleared). */
  removeSession: (id: string) => void;
  /** The finished session's report has been sent, so it no longer needs to be kept. */
  reportSent: () => void;

  load: () => void;
  start: () => Promise<boolean>;
  stop: (node: string | null) => Promise<Report | null>;
  setBluetoothEnabled: (enabled: boolean) => void;
  setRadioEnabled: (enabled: boolean) => void;
  setHome: (home: HomeExclusion | null) => void;
  clearFog: () => void;
  /** The map progress as a snapshot, for backup. */
  progress: () => Snapshot;
  /** Merges a backup into this phone's progress (cells are only added). Only when no session is running. */
  importProgress: (snapshot: Snapshot) => boolean;
  /** Clears the fog around a position. Returns how many new cells were cleared. */
  revealAt: (position: LatLon) => number;
  /** Clears the fog around each of the points on the way and around the new position, in one go. Returns how many new cells were cleared. */
  revealPath: (between: LatLon[], position: LatLon) => number;
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
let scanTimer: ReturnType<typeof setTimeout> | null = null;
/** How fast the phone is moving now, in metres per second, from the last two position fixes. */
let speedMps = 0;
/** Latitude of a reporting cell, or Washington's if there is none (area per cell varies only a little with it). */
function latitudeOf(cellId: string | null): number {
  const parsed = cellId ? parseCellId(cellId) : null;
  return parsed ? hexCenter(parsed.hex, parsed.sizeM).latitudeDeg : 38.9;
}

/** The report left over from a finished session that was not submitted before the app closed, if it is still readable. */
function restorePendingReport(): Report | null {
  try {
    const raw = loadPending();
    const parsed = raw ? (JSON.parse(raw) as Partial<Report>) : null;
    return parsed && parsed.type === 'mapping-session' && typeof parsed.node === 'string' && Array.isArray(parsed.buckets) ? (parsed as Report) : null;
  } catch {
    return null;
  }
}

/** Fog cells this session has cleared (new ones only), and the radio level so far, for the session history. */
let sessionCellIds: string[] = [];
let radioLevelSum = 0;
let radioLevelN = 0;

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

/** A sonde chest within a short walk: listen for its frequency instead of the usual radio reading. */
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
    if (radio) {
      result.radio = radio;
      radioLevelSum += levelDbfs(radio.rms);
      radioLevelN += 1;
    }
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
  if (scanTimer) clearTimeout(scanTimer);
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
  sessions: [],

  load: () => {
    const explored = loadExplored();
    let sessions = sortSessions(loadSessions());
    // Sessions mapped before history existed are rebuilt once from the fog map's timestamps.
    if (!loadBackfilled()) {
      const oldest = sessions.length > 0 ? sessions[sessions.length - 1].startedMs : Infinity;
      const rebuilt = reconstructSessions(explored, oldest);
      for (const { record, cells } of rebuilt) saveSessionCells(record.id, cells.slice(0, MAX_SESSION_CELLS));
      if (rebuilt.length > 0) {
        sessions = sortSessions([...sessions, ...rebuilt.map((r) => r.record)]);
        saveSessions(sessions);
      }
      saveBackfilled(true);
    }
    set({ lastReport: restorePendingReport(), sessions, visited: loadVisited(), explored, signals: loadSignals(), fogStyle: loadFogStyle(), home: loadHome(), bluetoothEnabled: loadBluetoothEnabled(), radioEnabled: loadRadioEnabled() });
  },

  start: async () => {
    if (get().status !== 'idle') return false;
    set({ status: 'starting', error: null, newCellsThisSession: 0, scansThisSession: 0, sessionDistanceM: 0, sessionClearedCells: 0, sessionTotals: emptyTotals(), lastScan: null, lastReport: null });
    sessionCellIds = [];
    radioLevelSum = 0;
    radioLevelN = 0;
    savePending(null); // a new session replaces the previous unsent report
    try {
      const permissions = await requestMappingPermissions();
      if (!permissions.location) throw new Error('Location permission is needed to place readings on the map.');

      await getCapabilities();
      await useAppStore.getState().requestNotificationPermission();

      // If a dongle is plugged in, connect to it now so radio readings run from the first minute. Never blocks mapping.
      if (get().radioEnabled) await ensureDongle(true);

      lastFix = null;
      accumulator.reset();
      recorder = new SessionRecorder(new Set(Object.keys(get().visited)), { home: get().home });
      tick = 0;
      await startMapping();

      positionWatch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 3 },
        (loc) => {
          if (loc.mocked !== true && (loc.coords.accuracy ?? 999) <= MAX_REVEAL_ACCURACY_M) {
            const fix = { latitudeDeg: loc.coords.latitude, longitudeDeg: loc.coords.longitude };
            const previous = lastFix;
            const seconds = (loc.timestamp - lastFixAtMs) / 1000;
            const step = previous ? stepDistance(distanceM(previous, fix), seconds) : 0;
            speedMps = seconds > 0 ? step / seconds : 0;
            lastFix = fix;
            lastFixAtMs = loc.timestamp;
            // Clearing the fog happens only here, while a mapping session is running. The fog is cleared along the line from
            // the last fix to this one as well as around this fix, so driving leaves one continuous road, not separate circles.
            const cleared = get().revealPath(previous && step > 0 ? pointsAlong(previous, fix, seconds) : [], fix);
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
      speedMps = 0;
      const scheduleScan = () => {
        scanTimer = setTimeout(() => {
          void scanOnce(set, get);
          if (scanTimer !== null) scheduleScan();
        }, scanIntervalFor(speedMps));
      };
      scheduleScan();
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
    const endedMs = Date.now();
    const record = buildSessionRecord({
      startedMs: get().startedAtMs ?? endedMs,
      endedMs,
      distanceM: get().sessionDistanceM,
      clearedCells: get().sessionClearedCells,
      areaKm2: exploredAreaKm2(get().sessionClearedCells, latitudeOf(get().currentCellId)),
      newCells: get().newCellsThisSession,
      readings: get().scansThisSession,
      totals: get().sessionTotals,
      radioLevelSum,
      radioLevelN,
    });
    let sessions = get().sessions;
    if (record) {
      saveSessionCells(record.id, sessionCellIds.slice(0, MAX_SESSION_CELLS));
      sessions = sortSessions([record, ...sessions]);
      saveSessions(sessions);
    }
    sessionCellIds = [];
    // Keep a report that has not been sent yet, so it can still be signed and submitted after the app is closed.
    if (report) savePending(JSON.stringify(report));
    set({ status: 'idle', startedAtMs: null, lastReport: report, sessions });
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

  progress: () => {
    const s = get();
    const sessionCells: Record<string, string[]> = {};
    for (const r of s.sessions) sessionCells[r.id] = loadSessionCells(r.id);
    return { v: 1 as const, savedMs: Date.now(), explored: s.explored, visited: s.visited, signals: s.signals, sessions: s.sessions, sessionCells };
  },

  importProgress: (snapshot) => {
    if (get().status !== 'idle') return false;
    const merged = mergeSnapshots(get().progress(), snapshot);
    saveVisited(merged.visited);
    saveExplored(merged.explored);
    saveSignals(merged.signals);
    const sessions = sortSessions(merged.sessions ?? []);
    for (const r of sessions) if (loadSessionCells(r.id).length === 0 && merged.sessionCells?.[r.id]?.length) saveSessionCells(r.id, merged.sessionCells[r.id]);
    saveSessions(sessions);
    set({ visited: merged.visited, explored: merged.explored, signals: merged.signals, sessions });
    return true;
  },

  reportSent: () => savePending(null),

  removeSession: (id) => {
    const sessions = get().sessions.filter((r) => r.id !== id);
    removeSessionCells(id);
    saveSessions(sessions);
    set({ sessions });
  },

  clearFog: () => {
    if (get().status !== 'idle') return;
    for (const r of get().sessions) removeSessionCells(r.id);
    saveSessions([]);
    saveVisited({});
    saveExplored({});
    saveSignals({});
    set({ visited: {}, explored: {}, signals: {}, sessions: [], currentCellId: null });
  },

  revealAt: (position) => get().revealPath([], position),

  revealPath: (between, position) => {
    const explored = get().explored;
    let next: Record<string, number> | null = null;
    let added = 0;
    const now = Date.now();
    const recording = get().status === 'running';
    for (const point of [...between, position]) {
      for (const id of cellsWithin(point)) {
        if ((next ?? explored)[id]) continue;
        next ??= { ...explored };
        next[id] = now;
        added += 1;
        if (recording && sessionCellIds.length < MAX_SESSION_CELLS) sessionCellIds.push(id);
      }
    }
    if (next) {
      set({ explored: next });
      scheduleExploredSave();
    }
    return added;
  },
}));
