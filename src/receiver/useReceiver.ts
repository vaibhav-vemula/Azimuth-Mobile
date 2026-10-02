import { create } from 'zustand';
import {
  FM_SAMPLE_RATE_HZ,
  MAX_FREQUENCY_HZ,
  MIN_FREQUENCY_HZ,
  SATELLITE_SAMPLE_RATE_HZ,
  addSignalListener,
  addStatusListener,
  connect as nativeConnect,
  disconnect as nativeDisconnect,
  getGains,
  setAudioEnabled,
  setBiasTee,
  setGain,
  setSampleRate,
  setVolume,
  startStream,
  stopStream,
  tune,
} from '../../modules/rtl-sdr';
import type { RtlSdrStatus } from '../../modules/rtl-sdr';

const EMPTY_BINS: number[] = new Array(64).fill(0);
const DEFAULT_FM_HZ = 100_000_000;
const DEFAULT_VOLUME = 0.8;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ReceiverState {
  status: RtlSdrStatus;
  deviceName: string | null;
  frequencyHz: number;
  sampleRate: number;
  bins: number[];
  gains: number[];
  listening: boolean;
  volume: number;
  error: string | null;
  busy: boolean;

  init: () => void;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  setError: (message: string | null) => void;

  tuneTo: (frequencyHz: number) => Promise<void>;
  startReceiving: () => Promise<void>;
  stopReceiving: () => Promise<void>;
  setListening: (listening: boolean) => Promise<void>;
  changeVolume: (volume: number) => Promise<void>;

  /** Switches to the 2.4 MS/s FM/general mode (stops the stream; the caller restarts it). */
  enterFmMode: () => Promise<void>;
  /** Switches to 2.304 MS/s, tunes, applies gain/bias-tee and starts the stream, ready to record. */
  enterSatelliteMode: (options: { frequencyHz: number; gainDb: number | null; biasTee: boolean }) => Promise<void>;
  leaveSatelliteMode: () => Promise<void>;
}

let initialized = false;

export const useReceiver = create<ReceiverState>((set, get) => ({
  status: 'disconnected',
  deviceName: null,
  frequencyHz: DEFAULT_FM_HZ,
  sampleRate: FM_SAMPLE_RATE_HZ,
  bins: EMPTY_BINS,
  gains: [],
  listening: false,
  volume: DEFAULT_VOLUME,
  error: null,
  busy: false,

  init: () => {
    if (initialized) return;
    initialized = true;
    addSignalListener((event) => set({ bins: event.bins }));
    addStatusListener((event) =>
      set((state) => ({
        status: event.status,
        deviceName: event.deviceName,
        frequencyHz: event.frequency,
        sampleRate: event.sampleRate ?? state.sampleRate,
        bins: event.status === 'disconnected' ? EMPTY_BINS : state.bins,
        gains: event.status === 'disconnected' ? [] : state.gains,
        listening: event.status === 'disconnected' || event.status === 'error' ? false : state.listening,
      }))
    );
  },

  setError: (message) => set({ error: message }),

  connect: async () => {
    const { status } = get();
    if (status === 'connected' || status === 'streaming') return true;
    set({ busy: true, error: null });
    try {
      await nativeConnect();
      try {
        set({ gains: await getGains() });
      } catch {
        set({ gains: [] });
      }
      return true;
    } catch (e) {
      set({ error: errorMessage(e) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  disconnect: async () => {
    set({ busy: true, error: null, listening: false });
    try {
      await nativeDisconnect();
    } catch (e) {
      set({ error: errorMessage(e) });
    } finally {
      set({ busy: false });
    }
  },

  tuneTo: async (frequencyHz) => {
    if (!Number.isFinite(frequencyHz) || frequencyHz < MIN_FREQUENCY_HZ || frequencyHz > MAX_FREQUENCY_HZ) {
      throw new Error(
        `Enter a frequency between ${(MIN_FREQUENCY_HZ / 1e6).toFixed(1)} and ${(MAX_FREQUENCY_HZ / 1e6).toFixed(0)} MHz.`
      );
    }
    await tune(frequencyHz);
    set({ frequencyHz });
  },

  startReceiving: async () => {
    await startStream();
  },

  stopReceiving: async () => {
    await stopStream();
  },

  setListening: async (listening) => {
    await setAudioEnabled(listening);
    set({ listening });
    if (listening && get().status === 'connected') {
      await startStream();
    }
  },

  changeVolume: async (volume) => {
    const next = Math.min(1, Math.max(0, volume));
    set({ volume: next });
    await setVolume(next);
  },

  enterFmMode: async () => {
    const { status, sampleRate } = get();
    if (status !== 'connected' && status !== 'streaming') return;
    if (sampleRate === FM_SAMPLE_RATE_HZ) return;
    if (status === 'streaming') await stopStream();
    await setSampleRate(FM_SAMPLE_RATE_HZ);
  },

  enterSatelliteMode: async ({ frequencyHz, gainDb, biasTee }) => {
    if (get().status === 'streaming') await stopStream();
    await setAudioEnabled(false);
    set({ listening: false });
    await setSampleRate(SATELLITE_SAMPLE_RATE_HZ);
    await tune(frequencyHz);
    await setGain(gainDb);
    await setBiasTee(biasTee);
    await startStream();
    set({ frequencyHz });
  },

  leaveSatelliteMode: async () => {
    try {
      if (get().status === 'streaming') await stopStream();
      await setBiasTee(false);
      await setSampleRate(FM_SAMPLE_RATE_HZ);
    } catch {
      // The dongle may already be gone; nothing further to restore.
    }
  },
}));
