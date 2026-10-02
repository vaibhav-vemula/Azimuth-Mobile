import { create } from 'zustand';
import Constants from 'expo-constants';
import {
  addRecordingListener,
  getFreeStorageBytes,
  setGain,
  startRecording,
  stopRecording,
  writeRecordingMetadata,
} from '../../modules/rtl-sdr';
import type { RecordingStatusEvent } from '../../modules/rtl-sdr';
import { MonitoredSatellite } from '../data/satellites';
import { TleRecord } from '../types/satellite';
import { SatellitePass, useAppStore } from '../state/useAppStore';
import { frameCollector } from '../receiver/frameCollector';
import { errorMessage, useReceiver } from '../receiver/useReceiver';
import { CLIP_GUARD, nextLowerGain, shouldReduceGain } from './autoGain';
import { SetupPlan } from './autoSetup';
import { useAutoSetup } from './autoSetupStore';
import {
  GainChange,
  POST_PASS_MARGIN_SEC,
  buildSigmfMetadata,
  recordingName,
  requiredFreeBytes,
} from './sigmf';
import { setupInputFor } from './setupInput';
import { formatBytes } from '../utils/format';
import { TEST_RECORDING_SEC, captureWindow, isTestRun } from './window';

export type CapturePhase = 'idle' | 'preparing' | 'recording' | 'finishing' | 'complete' | 'error';

export interface CaptureResult {
  name: string;
  directory: string;
  bytes: number;
  samples: number;
  droppedBlocks: number;
  durationSec: number;
  interrupted: boolean;
  error: string | null;
}

/** Which pass to record. Frequency, gain and everything else is chosen automatically. */
export interface StartCaptureOptions {
  pass: SatellitePass;
  satellite: MonitoredSatellite;
  tle: TleRecord | null;
}

interface CaptureState {
  phase: CapturePhase;
  options: StartCaptureOptions | null;
  /** The settings the automatic set-up chose and the recording is using. */
  plan: SetupPlan | null;
  /** Gain currently applied; drops a step if the front end starts to clip. */
  currentGainDb: number | null;
  name: string | null;
  directory: string | null;
  startedAt: Date | null;
  progress: RecordingStatusEvent | null;
  result: CaptureResult | null;
  error: string | null;
  /** True when this capture is a testing-mode run rather than a recording of the real pass. */
  testRun: boolean;

  init: () => void;
  /** Remembers which pass the recorder screen is set up for, without starting anything. */
  prepare: (options: StartCaptureOptions) => void;
  start: (options: StartCaptureOptions) => Promise<void>;
  stop: (reason?: 'user' | 'pass-ended') => Promise<void>;
  reset: () => void;
}

const appVersion = Constants.expoConfig?.version ?? '1.0.0';
const GUARD_INTERVAL_MS = CLIP_GUARD.windowSec * 1000;

let stopTimer: ReturnType<typeof setTimeout> | null = null;
let guardTimer: ReturnType<typeof setInterval> | null = null;
let gainLog: GainChange[] = [];
let listening = false;

function clearTimers() {
  if (stopTimer) clearTimeout(stopTimer);
  if (guardTimer) clearInterval(guardTimer);
  stopTimer = null;
  guardTimer = null;
}

function metadataFor(
  options: StartCaptureOptions,
  plan: SetupPlan,
  startedAt: Date,
  status: 'recording' | 'complete' | 'interrupted' | 'failed',
  testRun: boolean,
  extra: { endedAt?: Date; stats?: { bytes: number; samples: number; droppedBlocks: number }; error?: string | null } = {}
) {
  const location = useAppStore.getState().location ?? { latitudeDeg: 0, longitudeDeg: 0, heightKm: 0 };
  return JSON.stringify(
    buildSigmfMetadata({
      satellite: options.satellite,
      frequencyHz: plan.frequencyHz,
      gainDb: plan.gainDb,
      biasTee: useAppStore.getState().settings.biasTee,
      deviceName: useReceiver.getState().deviceName,
      pass: options.pass,
      tle: options.tle,
      observer: location,
      startedAt,
      status,
      appVersion,
      testRecording: testRun,
      autoSetup: { frequencySource: plan.frequencySource, gainReason: plan.gainReason, signalSnrDb: plan.signalSnrDb },
      gainChanges: gainLog,
      ...extra,
    }),
    null,
    2
  );
}

/** While recording, watches for the front end overloading and steps the gain down if it persists. */
function startClipGuard(getElapsedSec: () => number, set: (partial: Partial<CaptureState>) => void, get: () => CaptureState) {
  frameCollector.reset();
  guardTimer = setInterval(() => {
    const snap = frameCollector.snapshot();
    frameCollector.reset();
    const current = get().currentGainDb;
    if (current === null || get().phase !== 'recording') return;
    if (!shouldReduceGain(snap.clip, GUARD_INTERVAL_MS / 1000)) return;

    const lower = nextLowerGain(useReceiver.getState().gains, current);
    if (lower === null) return;
    setGain(lower)
      .then(() => {
        gainLog.push({ atSec: getElapsedSec(), gainDb: lower, reason: 'clipping' });
        set({ currentGainDb: lower });
      })
      .catch(() => undefined);
  }, GUARD_INTERVAL_MS);
}

export const useCapture = create<CaptureState>((set, get) => ({
  phase: 'idle',
  options: null,
  plan: null,
  currentGainDb: null,
  name: null,
  directory: null,
  startedAt: null,
  progress: null,
  result: null,
  error: null,
  testRun: false,

  init: () => {
    if (listening) return;
    listening = true;
    addRecordingListener((event) => {
      const { phase } = get();
      if (phase !== 'recording' && phase !== 'finishing') return;
      set({ progress: event });
      // The native side ends a recording by itself on a write error or at its safety limit.
      if (!event.active && phase === 'recording') {
        void get().stop('pass-ended');
      }
    });
  },

  prepare: (options) => {
    const { phase } = get();
    if (phase === 'preparing' || phase === 'recording' || phase === 'finishing') return;
    clearTimers();
    set({ phase: 'idle', options, plan: null, currentGainDb: null, name: null, directory: null, startedAt: null, progress: null, result: null, error: null, testRun: false });
  },

  start: async (options) => {
    const { phase } = get();
    if (phase === 'preparing' || phase === 'recording' || phase === 'finishing') return;

    set({ phase: 'preparing', options, plan: null, error: null, result: null, progress: null });
    gainLog = [];
    const receiver = useReceiver.getState();

    try {
      if (!(await receiver.connect())) {
        throw new Error(useReceiver.getState().error ?? 'Could not connect to the receiver.');
      }

      const now = Date.now();
      const testMode = useAppStore.getState().settings.captureTestMode;
      const testRun = isTestRun(captureWindow(options.pass.riseTime.getTime(), options.pass.setTime.getTime(), now), testMode);
      // A real capture ends shortly after the satellite sets; a test run just lasts a fixed couple of minutes.
      const remainingSec = testRun
        ? TEST_RECORDING_SEC
        : Math.max(0, (options.pass.setTime.getTime() - now) / 1000) + POST_PASS_MARGIN_SEC;
      const needed = requiredFreeBytes(remainingSec);
      const free = await getFreeStorageBytes();
      if (free < needed) {
        throw new Error(
          `Not enough free storage: this pass needs about ${formatBytes(needed)} but only ${formatBytes(free)} is free.`
        );
      }

      // Android 13+ only shows the "recording" foreground notification once this is granted. A refusal
      // does not stop the recording, so the answer is deliberately ignored.
      await useAppStore.getState().requestNotificationPermission();

      // Use the automatic set-up already running on the capture screen; wait for it if it is mid-sweep,
      // and make one now if there is none. Its monitoring loop is stopped first so it cannot fight the final tune.
      const auto = useAutoSetup.getState();
      let plan = auto.freshPlan(options.satellite.noradId);
      if (!plan && auto.status === 'working') plan = await auto.waitForPlan();
      await auto.stop();
      if (!plan) plan = await auto.calibrateOnce(setupInputFor(options.satellite.noradId));

      await receiver.enterSatelliteMode({
        frequencyHz: plan.frequencyHz,
        gainDb: plan.gainDb,
        biasTee: useAppStore.getState().settings.biasTee,
      });

      const startedAt = new Date();
      const name = recordingName(options.satellite, startedAt);
      const maxDurationMs = remainingSec * 1000 + 15_000;
      const started = await startRecording(name, `${options.satellite.name} pass`, maxDurationMs);
      await writeRecordingMetadata(name, metadataFor(options, plan, startedAt, 'recording', testRun));

      set({ phase: 'recording', plan, currentGainDb: plan.gainDb, name, directory: started.directory, startedAt, testRun });

      clearTimers();
      startClipGuard(() => (Date.now() - startedAt.getTime()) / 1000, set, get);
      stopTimer = setTimeout(() => {
        void get().stop('pass-ended');
      }, remainingSec * 1000);
    } catch (e) {
      clearTimers();
      await useReceiver.getState().leaveSatelliteMode();
      set({ phase: 'error', error: errorMessage(e) });
    }
  },

  stop: async (reason = 'user') => {
    const { phase, options, plan, name, directory, startedAt, testRun } = get();
    if (phase !== 'recording' || !options || !plan || !name || !startedAt) return;

    clearTimers();
    set({ phase: 'finishing' });

    try {
      const summary = await stopRecording();
      const endedAt = new Date();
      const stats = { bytes: summary.bytes, samples: summary.samples, droppedBlocks: summary.droppedBlocks };
      const interrupted = !testRun && reason === 'user' && endedAt.getTime() < options.pass.setTime.getTime();
      const failed = !!summary.error;
      await writeRecordingMetadata(
        name,
        metadataFor(options, plan, startedAt, failed ? 'failed' : interrupted ? 'interrupted' : 'complete', testRun, {
          endedAt,
          stats,
          error: summary.error,
        })
      );
      set({
        phase: 'complete',
        result: {
          name,
          directory: directory ?? '',
          bytes: summary.bytes,
          samples: summary.samples,
          droppedBlocks: summary.droppedBlocks,
          durationSec: summary.samples / 288_000,
          interrupted,
          error: summary.error,
        },
      });
    } catch (e) {
      set({ phase: 'error', error: errorMessage(e) });
    } finally {
      await useReceiver.getState().leaveSatelliteMode();
    }
  },

  reset: () => {
    const { phase } = get();
    if (phase === 'recording' || phase === 'preparing' || phase === 'finishing') return;
    clearTimers();
    set({ phase: 'idle', options: null, plan: null, currentGainDb: null, name: null, directory: null, startedAt: null, progress: null, result: null, error: null, testRun: false });
  },
}));
