import { create } from 'zustand';
import { createAudioPlayer, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { createMMKV } from 'react-native-mmkv';
import { useReceiver } from '../../receiver/useReceiver';
import * as Location from 'expo-location';
import { Here, Station, clampFm, formatMHz, frequencyFromName, searchByFrequency, searchByName, searchNearby } from './radioBrowser';
import { deviceRegion, inMilesCountry } from '../../units/units';
import { EMPTY_BINS, audioBins, monoFrames, simulatedBins, smoothBins } from './audioSpectrum';

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
   * 'on': the bars follow the real sound; 'simulated': a made-up moving display, used when the real sound cannot be read
   * (Android only allows that with the microphone permission, which has not been given, or the phone cannot do it);
   * 'unknown': nothing playing yet.
   */
  sampling: 'unknown' | 'on' | 'simulated';
}
export const useAudioBars = create<BarsState>(() => ({ bins: EMPTY_BINS, sampling: 'unknown' }));
const BARS_INTERVAL_MS = 50;

/** Where the listener is, so the radio can favour stations near them. */
export interface Place {
  here: Here;
  countryCode: string | null;
}

/**
 * The country when the phone cannot say (no geocoder): the phone's region setting, checked against the position. Standing
 * in the United States or Canada with some other region set means the setting is out of date for where the phone is, and
 * a US or Canada setting while standing elsewhere is just as stale. When they disagree, tuning looks worldwide (null)
 * rather than at the wrong country.
 */
export function guessCountry(here: Here): string | null {
  const region = deviceRegion();
  const inNorthAmerica = inMilesCountry(here.latitudeDeg, here.longitudeDeg);
  const settingSaysNorthAmerica = region === 'US' || region === 'CA';
  if (inNorthAmerica) return settingSaysNorthAmerica ? region : 'US';
  return settingSaysNorthAmerica ? null : region;
}

async function locateWithPhone(): Promise<Place | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const fix = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (!fix) return null;
    const here = { latitudeDeg: fix.coords.latitude, longitudeDeg: fix.coords.longitude };
    let countryCode: string | null = null;
    try {
      const [place] = await Location.reverseGeocodeAsync(fix.coords);
      countryCode = place?.isoCountryCode ?? null;
    } catch {
      // No geocoder on this phone: the phone's region setting is the next best sign of the country.
    }
    return { here, countryCode: countryCode ?? guessCountry(here) };
  } catch {
    return null;
  }
}

let locator: () => Promise<Place | null> = locateWithPhone;
let placeCache: { at: number; value: Place | null } | null = null;
const PLACE_TTL_MS = 5 * 60_000;

/** Replaces how the position is found (used by tests). */
export function setLocator(fn: (() => Promise<Place | null>) | null) {
  locator = fn ?? locateWithPhone;
  placeCache = null;
}

/** The listener's position, kept for a few minutes so each tune does not ask the GPS again. */
async function locate(): Promise<Place | null> {
  if (placeCache && Date.now() - placeCache.at < PLACE_TTL_MS) return placeCache.value;
  const value = await locator();
  placeCache = { at: Date.now(), value };
  return value;
}

const NO_COUNTRY = 'Azimuth could not tell which country you are in, so it cannot pick local stations. Turn on location for Azimuth and try again.';

export type OnlineStatus = 'idle' | 'searching' | 'connecting' | 'playing' | 'nomatch' | 'error';

interface OnlineRadioState {
  mhz: number;
  status: OnlineStatus;
  /** Stations found for the frequency (or the name searched), best first. */
  stations: Station[];
  /** Where the listener is, once known. */
  here: Here | null;
  /** The country the stations are limited to. Stations from other countries are never shown. */
  scope: string | null;
  /** What the list of stations is: "All US stations on 103.5 MHz", or the words searched for. The dial can move on while a station from the list plays, so the list keeps its own name. */
  listTitle: string | null;
  /** Stations near the listener, nearest first, and how that search went. */
  nearby: Station[];
  nearbyStatus: 'idle' | 'loading' | 'ready' | 'empty' | 'no-location' | 'error';
  findNearby: () => Promise<void>;
  current: Station | null;
  error: string | null;
  volume: number;
  setFrequency: (mhz: number) => void;
  /** Looks for stations on the frequency and plays the best one. */
  tune: (mhz?: number) => Promise<void>;
  search: (text: string) => Promise<void>;
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

let simTimer: ReturnType<typeof setInterval> | null = null;
const SIM_INTERVAL_MS = 60;

function stopSimulation() {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
}

/** Moves the bars on their own while the real sound is not being read. Does nothing while the station is not playing. */
function startSimulation() {
  stopSimulation();
  useAudioBars.setState({ sampling: 'simulated' });
  const started = Date.now();
  simTimer = setInterval(() => {
    const { status, mhz, current } = useOnlineRadio.getState();
    if (useAudioBars.getState().sampling !== 'simulated') return stopSimulation();
    const seed = ((current?.id.length ?? 0) + Math.round(mhz * 10)) % 17;
    const target = status === 'playing' ? simulatedBins((Date.now() - started) / 1000, seed) : EMPTY_BINS;
    useAudioBars.setState({ bins: smoothBins(useAudioBars.getState().bins, target) });
  }, SIM_INTERVAL_MS);
}

function releasePlayer() {
  stopSimulation();
  useAudioBars.setState({ bins: EMPTY_BINS, sampling: 'unknown' });
  unsubscribe?.();
  unsubscribe = null;
  const old = player;
  player = null;
  if (!old) return;
  // On Android, remove() only forgets the player; it does not stop the sound. So it is paused and muted first.
  try {
    old.pause();
  } catch {
    // Already released.
  }
  try {
    old.volume = 0;
  } catch {
    // Already released.
  }
  try {
    old.remove();
  } catch {
    // Already released.
  }
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
      startSimulation();
      return stopSimulation;
    }
    const permission = await getRecordingPermissionsAsync();
    if (mine !== request || player !== next) return () => undefined;
    if (!permission.granted) {
      startSimulation();
      return stopSimulation;
    }
    next.setAudioSamplingEnabled(true);
    let lastBars = 0;
    sub = next.addListener('audioSampleUpdate', (sample) => {
      const now = Date.now();
      if (player !== next || now - lastBars < BARS_INTERVAL_MS) return;
      lastBars = now;
      const frames = monoFrames(sample.channels);
      if (frames.length < 32) return;
      stopSimulation();
      useAudioBars.setState({ bins: smoothBins(useAudioBars.getState().bins, audioBins(frames)), sampling: 'on' });
    });
    // Until the first real samples arrive, the bars move on their own.
    startSimulation();
  } catch {
    startSimulation();
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
  here: null,
  scope: null,
  listTitle: null,
  nearby: [],
  nearbyStatus: 'idle',
  current: null,
  error: null,
  volume: savedVolume(),

  setFrequency: (mhz) => {
    const next = clampFm(mhz);
    storage.set(FREQ_KEY, next);
    set({ mhz: next });
  },

  findNearby: async () => {
    set({ nearbyStatus: 'loading', nearby: [] });
    try {
      const place = await locate();
      if (!place) return set({ nearbyStatus: 'no-location' });
      set({ here: place.here });
      const stations = await searchNearby(place.here, { countryCode: place.countryCode });
      set({ nearby: stations, nearbyStatus: stations.length === 0 ? 'empty' : 'ready' });
    } catch (e) {
      set({ nearbyStatus: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  tune: async (mhz) => {
    const target = clampFm(mhz ?? get().mhz);
    get().setFrequency(target);
    const mine = ++request;
    // The old station stops the moment you tune, not when the new one is found.
    releasePlayer();
    set({ status: 'searching', error: null, stations: [], current: null });
    try {
      const place = await locate();
      if (mine !== request) return;
      if (place) set({ here: place.here });
      const country = place?.countryCode ?? null;
      if (!country) {
        // Without the country there is no way to leave other countries out, so nothing is tuned.
        releasePlayer();
        set({ status: 'error', error: NO_COUNTRY, stations: [], current: null, scope: null });
        return;
      }
      const stations = await searchByFrequency(target, { countryCode: country, here: place?.here ?? null });
      if (mine !== request) return;
      set({ stations, scope: country, listTitle: `All ${country} stations on ${formatMHz(target)} MHz` });
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

  search: async (text) => {
    const mine = ++request;
    set({ status: 'searching', error: null, stations: [] });
    try {
      const place = await locate();
      if (mine !== request) return;
      if (!place?.countryCode) {
        set({ status: 'error', error: NO_COUNTRY, stations: [] });
        return;
      }
      const stations = await searchByName(text, { countryCode: place.countryCode, here: place.here });
      if (mine !== request) return;
      set({ stations, status: stations.length === 0 ? 'nomatch' : 'idle', listTitle: `Results for “${text.trim()}”` });
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
    // Whatever station plays, the dial shows its frequency (when its name gives one).
    const named = frequencyFromName(station.name);
    if (named !== null) get().setFrequency(named);
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
