import { create } from 'zustand';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { createMMKV } from 'react-native-mmkv';
import { useReceiver } from '../../receiver/useReceiver';
import { Station, clampFm, formatMHz, searchByFrequency, searchByName } from './radioBrowser';

const storage = createMMKV({ id: 'azimuth-radio' });
const FREQ_KEY = 'onlineMhz';
const VOLUME_KEY = 'onlineVolume';

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
  unsubscribe?.();
  unsubscribe = null;
  try {
    player?.remove();
  } catch {
    // Already released.
  }
  player = null;
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
      unsubscribe = () => sub.remove();
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

  setVolume: (volume) => {
    const next = Math.min(1, Math.max(0, Math.round(volume * 100) / 100));
    storage.set(VOLUME_KEY, next);
    if (player) player.volume = next;
    set({ volume: next });
  },
}));

export { formatMHz };
