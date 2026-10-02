import { create } from 'zustand';
import Constants from 'expo-constants';
import {
  addRecordingListener,
  getFreeStorageBytes,
  startRecording,
  stopRecording,
  writeRecordingMetadata,
} from '../../modules/rtl-sdr';
import type { RecordingStatusEvent } from '../../modules/rtl-sdr';
import { MonitoredSatellite } from '../data/satellites';
import { TleRecord } from '../types/satellite';
import { SatellitePass, useAppStore } from '../state/useAppStore';
import { errorMessage, useReceiver } from '../receiver/useReceiver';
import {
  POST_PASS_MARGIN_SEC,
  buildSigmfMetadata,
  recordingName,
  requiredFreeBytes,
} from './sigmf';
import { formatBytes } from '../utils/format';

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

export interface StartCaptureOptions {
  pass: SatellitePass;
  satellite: MonitoredSatellite;
  frequencyHz: number;
  gainDb: number | null;
  biasTee: boolean;
  tle: TleRecord | null;
}

interface CaptureState {
  phase: CapturePhase;
  options: StartCaptureOptions | null;
  name: string | null;
  directory: string | null;
  startedAt: Date | null;
  progress: RecordingStatusEvent | null;
  result: CaptureResult | null;
  error: string | null;

  init: () => void;
  /** Remembers which pass the recorder screen is set up for, without starting anything. */
  prepare: (options: StartCaptureOptions) => void;
  start: (options: StartCaptureOptions) => Promise<void>;
  stop: (reason?: 'user' | 'pass-ended') => Promise<void>;
  reset: () => void;
}

const appVersion = Constants.expoConfig?.version ?? '1.0.0';
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function clearStopTimer() {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
}

function metadataFor(
  options: StartCaptureOptions,
  startedAt: Date,
  status: 'recording' | 'complete' | 'interrupted' | 'failed',
  extra: { endedAt?: Date; stats?: { bytes: number; samples: number; droppedBlocks: number }; error?: string | null } = {}
) {
  const location = useAppStore.getState().location ?? { latitudeDeg: 0, longitudeDeg: 0, heightKm: 0 };
  return JSON.stringify(
    buildSigmfMetadata({
      satellite: options.satellite,
      frequencyHz: options.frequencyHz,
      gainDb: options.gainDb,
      biasTee: options.biasTee,
      deviceName: useReceiver.getState().deviceName,
      pass: options.pass,
      tle: options.tle,
      observer: location,
      startedAt,
      status,
      appVersion,
      ...extra,
    }),
    null,
    2
  );
}

export const useCapture = create<CaptureState>((set, get) => ({
  phase: 'idle',
  options: null,
  name: null,
  directory: null,
  startedAt: null,
  progress: null,
  result: null,
  error: null,

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
    clearStopTimer();
    set({ phase: 'idle', options, name: null, directory: null, startedAt: null, progress: null, result: null, error: null });
  },

  start: async (options) => {
    const { phase } = get();
    if (phase === 'preparing' || phase === 'recording' || phase === 'finishing') return;

    set({ phase: 'preparing', options, error: null, result: null, progress: null });
    const receiver = useReceiver.getState();

    try {
      if (!(await receiver.connect())) {
        throw new Error(useReceiver.getState().error ?? 'Could not connect to the receiver.');
      }

      const now = Date.now();
      const remainingSec = Math.max(0, (options.pass.setTime.getTime() - now) / 1000) + POST_PASS_MARGIN_SEC;
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

      await receiver.enterSatelliteMode({
        frequencyHz: options.frequencyHz,
        gainDb: options.gainDb,
        biasTee: options.biasTee,
      });

      const startedAt = new Date();
      const name = recordingName(options.satellite, startedAt);
      const maxDurationMs = remainingSec * 1000 + 15_000;
      const started = await startRecording(name, `${options.satellite.name} pass`, maxDurationMs);
      await writeRecordingMetadata(name, metadataFor(options, startedAt, 'recording'));

      set({ phase: 'recording', name, directory: started.directory, startedAt });

      clearStopTimer();
      stopTimer = setTimeout(() => {
        void get().stop('pass-ended');
      }, remainingSec * 1000);
    } catch (e) {
      clearStopTimer();
      await useReceiver.getState().leaveSatelliteMode();
      set({ phase: 'error', error: errorMessage(e) });
    }
  },

  stop: async (reason = 'user') => {
    const { phase, options, name, directory, startedAt } = get();
    if (phase !== 'recording' || !options || !name || !startedAt) return;

    clearStopTimer();
    set({ phase: 'finishing' });

    try {
      const summary = await stopRecording();
      const endedAt = new Date();
      const stats = { bytes: summary.bytes, samples: summary.samples, droppedBlocks: summary.droppedBlocks };
      const interrupted = reason === 'user' && endedAt.getTime() < options.pass.setTime.getTime();
      const failed = !!summary.error;
      await writeRecordingMetadata(
        name,
        metadataFor(options, startedAt, failed ? 'failed' : interrupted ? 'interrupted' : 'complete', {
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
    clearStopTimer();
    set({ phase: 'idle', options: null, name: null, directory: null, startedAt: null, progress: null, result: null, error: null });
  },
}));
