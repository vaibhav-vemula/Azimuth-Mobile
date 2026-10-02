import { create } from 'zustand';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { MONITORED_SATELLITES } from '../data/satellites';
import { loadTle, TleResult } from '../data/tle/fetchTle';
import { predictPasses } from '../data/propagation/passes';
import { Observer, Pass } from '../types/satellite';
import { passId } from './passId';
import { SavedLocation, Settings, SettingsStorage, Units } from './settingsStorage';

export type LocationStatus = 'loading' | 'granted' | 'denied' | 'manual';

export interface SatellitePass extends Pass {
  /** Stable identity for lists and reminders. */
  id: string;
}

interface AppState {
  settings: Settings;
  location: Observer | null;
  locationStatus: LocationStatus;
  tles: Record<string, TleResult>;
  tleLoading: boolean;
  tleError: string | null;
  passes: SatellitePass[];
  passesComputing: boolean;
  passesComputedFor: string | null;
  notificationPermissionGranted: boolean;

  updateSettings: (patch: Partial<Settings>) => void;
  setSatelliteFrequency: (noradId: string, frequencyHz: number) => void;
  setUnits: (units: Units) => void;
  requestLocation: () => Promise<void>;
  setManualLocation: (lat: number, lon: number) => void;
  refreshTles: (force?: boolean) => Promise<void>;
  recomputePasses: () => void;
  requestNotificationPermission: () => Promise<boolean>;
}

const PASS_WINDOW_HOURS = 84;
const LOOKBACK_MS = 30 * 60_000;
const BUCKET_MS = 12 * 3600_000;

function toObserver(saved: SavedLocation): Observer {
  return { latitudeDeg: saved.latitudeDeg, longitudeDeg: saved.longitudeDeg, heightKm: saved.heightKm };
}

export const useAppStore = create<AppState>((set, get) => {
  const savedLocation = SettingsStorage.loadLocation();

  return {
    settings: SettingsStorage.load(),
    location: savedLocation ? toObserver(savedLocation) : null,
    locationStatus: savedLocation ? (savedLocation.manual ? 'manual' : 'granted') : 'loading',
    tles: {},
    tleLoading: false,
    tleError: null,
    passes: [],
    passesComputing: false,
    passesComputedFor: null,
    notificationPermissionGranted: false,

    updateSettings: (patch) => {
      const settings = { ...get().settings, ...patch };
      SettingsStorage.save(settings);
      set({ settings });
      if (patch.minElevationDeg !== undefined) get().recomputePasses();
    },

    setSatelliteFrequency: (noradId, frequencyHz) => {
      const current = get().settings;
      get().updateSettings({
        frequencyHzBySatellite: { ...current.frequencyHzBySatellite, [noradId]: frequencyHz },
      });
    },

    setUnits: (units) => get().updateSettings({ units }),

    requestLocation: async () => {
      if (get().locationStatus === 'manual') return;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!get().location) set({ locationStatus: 'denied' });
          return;
        }
        const last = await Location.getLastKnownPositionAsync();
        const position = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        const saved: SavedLocation = {
          latitudeDeg: position.coords.latitude,
          longitudeDeg: position.coords.longitude,
          heightKm: Math.max(0, (position.coords.altitude ?? 0) / 1000),
          manual: false,
        };
        SettingsStorage.saveLocation(saved);
        set({ location: toObserver(saved), locationStatus: 'granted' });
        get().recomputePasses();
      } catch {
        if (!get().location) set({ locationStatus: 'denied' });
      }
    },

    setManualLocation: (lat, lon) => {
      const saved: SavedLocation = { latitudeDeg: lat, longitudeDeg: lon, heightKm: 0, manual: true };
      SettingsStorage.saveLocation(saved);
      set({ location: toObserver(saved), locationStatus: 'manual' });
      get().recomputePasses();
    },

    refreshTles: async (force = false) => {
      set({ tleLoading: true, tleError: null });
      const results = await Promise.allSettled(
        MONITORED_SATELLITES.map((sat) => loadTle(sat.noradId, { force }))
      );
      const tles = { ...get().tles };
      const errors: string[] = [];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') tles[MONITORED_SATELLITES[i].noradId] = result.value;
        else errors.push(`${MONITORED_SATELLITES[i].shortName}: ${result.reason?.message ?? 'failed'}`);
      });
      set({ tles, tleLoading: false, tleError: errors.length ? errors.join('\n') : null });
      get().recomputePasses();
    },

    recomputePasses: () => {
      const { location, tles, settings } = get();
      if (!location || Object.keys(tles).length === 0) {
        set({ passes: [], passesComputedFor: null });
        return;
      }

      set({ passesComputing: true });
      // Let the "computing" state paint before the (CPU-bound) prediction runs.
      setTimeout(() => {
        const bucketStart = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
        const from = new Date(bucketStart - LOOKBACK_MS);
        const to = new Date(bucketStart + PASS_WINDOW_HOURS * 3600_000);
        const all: SatellitePass[] = [];
        for (const sat of MONITORED_SATELLITES) {
          const tle = get().tles[sat.noradId];
          if (!tle) continue;
          for (const pass of predictPasses(tle.record, location, from, to, {
            minElevationDeg: settings.minElevationDeg,
          })) {
            all.push({ ...pass, id: passId(sat.noradId, pass.riseTime) });
          }
        }
        all.sort((a, b) => a.riseTime.getTime() - b.riseTime.getTime());
        set({
          passes: all,
          passesComputing: false,
          passesComputedFor: `${location.latitudeDeg.toFixed(3)},${location.longitudeDeg.toFixed(3)}@${bucketStart}`,
        });
      }, 0);
    },

    requestNotificationPermission: async () => {
      try {
        const existing = await Notifications.getPermissionsAsync();
        if (existing.granted) {
          set({ notificationPermissionGranted: true });
          return true;
        }
        const requested = await Notifications.requestPermissionsAsync();
        set({ notificationPermissionGranted: requested.granted });
        return requested.granted;
      } catch {
        set({ notificationPermissionGranted: false });
        return false;
      }
    },
  };
});

/** Passes that have not finished yet, soonest first. */
export function selectUpcomingPasses(passes: SatellitePass[], now: number): SatellitePass[] {
  return passes.filter((p) => p.setTime.getTime() > now);
}
