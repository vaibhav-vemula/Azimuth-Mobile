import { create } from 'zustand';
import { createAudioPlayer, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { createMMKV } from 'react-native-mmkv';
import { useReceiver } from '../../receiver/useReceiver';
import { Station, clampFm, formatMHz, searchByFrequency, searchByName } from './radioBrowser';
import { EMPTY_BINS, audioBins, monoFrames, smoothBins } from './audioSpectrum';

const storage = createMMKV({ id: 'azimuth-radio' });
const FREQ_KEY = 'onlineMhz';
const VOLUME_KEY = 'onlineVolume';

/**
 * The bars for the audio that is playing. Kept apart from the rest of the radio state because it changes about 20 times a
 * second, and only the bar display listens to it.
 */
interface BarsState {
  bins: number[];
  /**
   * 'on': audio samples are coming; 'off': this phone cannot give them out; 'needs-permission': Android only lets an app read
   * the sound it is playing if it holds the microphone permission, which has not been given; 'unknown': not known yet.
   */
  sampling: 'unknown' | 'on' | 'off' | 'needs-permission';
}
export const useAudioBars = create<BarsState>(() => ({ bins: EMPTY_BINS, sampling: 'unknown' }));
const BARS_INTERVAL_MS = 50;

export type OnlineStatus = 'idle' | 'searching' | 'connecting' | 'playing' | 'nomatch' | 'error';

interface OnlineRadioState {
  mhz: number;
  status: OnlineStatus;
  /** Stations found for the frequency (or the name searched), best first. */
  stations: Station[];
  current: Station | null;
  error: string | null;
  volume: number;
  setFrequency: (mhz: number) => void;
  /** Looks for stations on the frequency and plays the best one. */
  tune: (mhz?: number, countryCode?: string | null) => Promise<void>;
  search: (text: string, countryCode?: string | null) => Promise<void>;
  play: (station: Station) => Promise<void>;
  stop: () => void;
  setVolume: (volume: number) => void;
  /** Asks for the permission Android wants before the signal bars can read the sound, then starts them. */
  enableBars: () => Promise<boolean>;
}

let player: AudioPlayer | null = null;
let unsubscribe: (() => void) | null = null;
/** Each tune or play gets a number, so a slow answer for an old frequency cannot replace the newer one. */
let request = 0;

function savedFrequency(): number {
  const saved = storage.getNumber(FREQ_KEY);
  return typeof saved === 'number' ? clampFm(saved) : 98.7;
}

function savedVolume(): number {
  const saved = storage.getNumber(VOLUME_KEY);
  return typeof saved === 'number' ? Math.min(1, Math.max(0, saved)) : 0.8;
}

function releasePlayer() {
  useAudioBars.setState({ bins: EMPTY_BINS, sampling: 'unknown' });
  unsubscribe?.();
  unsubscribe = null;
  try {
    player?.remove();
  } catch {
    // Already released.
  }
  player = null;
}

let barsStop: (() => void) | null = null;

/**
 * Starts the signal bars for a player. Returns a function that stops them. Android reads the playing sound through a
 * "visualizer", which it only allows for an app that holds the microphone permission (nothing is recorded: it is the
 * sound the app itself is playing).
 */
async function attachBars(next: AudioPlayer, mine: number): Promise<() => void> {
  let sub: { remove: () => void } | null = null;
  try {
    if (!next.isAudioSamplingSupported) {
      useAudioBars.setState({ sampling: 'off' });
      return () => undefined;
    }
    const permission = await getRecordingPermissionsAsync();
    if (mine !== request || player !== next) return () => undefined;
    if (!permission.granted) {
      useAudioBars.setState({ sampling: 'needs-permission' });
      return () => undefined;
    }
    next.setAudioSamplingEnabled(true);
    let lastBars = 0;
    sub = next.addListener('audioSampleUpdate', (sample) => {
      const now = Date.now();
      if (player !== next || now - lastBars < BARS_INTERVAL_MS) return;
      lastBars = now;
      const frames = monoFrames(sample.channels);
      if (frames.length < 32) return;
      useAudioBars.setState({ bins: smoothBins(useAudioBars.getState().bins, audioBins(frames)), sampling: 'on' });
    });
  } catch {
    useAudioBars.setState({ sampling: 'off' });
  }
  return () => {
    sub?.remove();
    try {
      next.setAudioSamplingEnabled(false);
    } catch {
      // The player is already gone.
    }
  };
}

export const useOnlineRadio = create<OnlineRadioState>((set, get) => ({
  mhz: savedFrequency(),
  status: 'idle',
  stations: [],
  current: null,
  error: null,
  volume: savedVolume(),

  setFrequency: (mhz) => {
    const next = clampFm(mhz);
    storage.set(FREQ_KEY, next);
    set({ mhz: next });
  },

  tune: async (mhz, countryCode = null) => {
    const target = clampFm(mhz ?? get().mhz);
    get().setFrequency(target);
    const mine = ++request;
    // The old station stops the moment you tune, not when the new one is found.
    releasePlayer();
    set({ status: 'searching', error: null, stations: [], current: null });
    try {
      const stations = await searchByFrequency(target, { countryCode });
      if (mine !== request) return;
      set({ stations });
      if (stations.length === 0) {
        releasePlayer();
        set({ status: 'nomatch', current: null, error: null });
        return;
      }
      await get().play(stations[0]);
    } catch (e) {
      if (mine !== request) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  search: async (text, countryCode = null) => {
    const mine = ++request;
    set({ status: 'searching', error: null, stations: [] });
    try {
      const stations = await searchByName(text, { countryCode });
      if (mine !== request) return;
      set({ stations, status: stations.length === 0 ? 'nomatch' : 'idle' });
    } catch (e) {
      if (mine !== request) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  play: async (station) => {
    const mine = ++request;
    // Whatever was playing stops first, so two streams are never heard together.
    releasePlayer();
    // The dongle's own audio would play over this, so it is switched off first.
    const receiver = useReceiver.getState();
    if (receiver.listening) await receiver.setListening(false).catch(() => undefined);
    set({ current: station, status: 'connecting', error: null });
    try {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' });
      if (mine !== request) return;
      releasePlayer(); // again, in case another station started while the audio mode was being set
      const next = createAudioPlayer({ uri: station.url });
      player = next;
      next.volume = get().volume;
      const sub = next.addListener('playbackStatusUpdate', (s) => {
        if (player !== next || mine !== request) return;
        if (s.error) set({ status: 'error', error: 'This station is not playing right now. Pick another one.' });
        else if (s.playing && !s.isBuffering) set({ status: 'playing' });
        else if (s.isBuffering || !s.isLoaded) set({ status: 'connecting' });
      });
      // The bars: ask the player for the audio it is playing, if this phone can give it out and the permission is there.
      const stopBars = await attachBars(next, mine);
      unsubscribe = () => {
        sub.remove();
        stopBars();
        barsStop = null;
      };
      barsStop = stopBars;
      next.play();
    } catch (e) {
      if (mine !== request) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  stop: () => {
    request += 1;
    releasePlayer();
    set({ status: 'idle', current: null, error: null });
  },

  enableBars: async () => {
    const result = await requestRecordingPermissionsAsync().catch(() => ({ granted: false }));
    if (!result.granted || !player) return false;
    barsStop?.();
    barsStop = await attachBars(player, request);
    return true;
  },

  setVolume: (volume) => {
    const next = Math.min(1, Math.max(0, Math.round(volume * 100) / 100));
    storage.set(VOLUME_KEY, next);
    if (player) player.volume = next;
    set({ volume: next });
  },
}));

export { formatMHz };
