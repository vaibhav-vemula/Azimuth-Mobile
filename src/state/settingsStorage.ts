import { createMMKV } from 'react-native-mmkv';
import { MONITORED_SATELLITES } from '../data/satellites';

const storage = createMMKV({ id: 'azimuth-settings' });

export type Units = 'metric' | 'imperial';

export interface SavedLocation {
  latitudeDeg: number;
  longitudeDeg: number;
  heightKm: number;
  manual: boolean;
}

export interface Settings {
  units: Units;
  minElevationDeg: number;
  notificationsEnabled: boolean;
  reminderMinutes: number;
  /** The antenna or LNA needs power from the receiver (bias-tee). Off unless the user turns it on in Settings. */
  biasTee: boolean;
  /** Testing aid: unlock Capture outside the pass window; such recordings last 2 minutes and are flagged as tests. */
  captureTestMode: boolean;
  /** Pick the LRPT downlink automatically from recent SatNOGS observations. */
  autoFrequency: boolean;
  /** LRPT downlink frequency per NORAD id. */
  frequencyHzBySatellite: Record<string, number>;
}

export function defaultSettings(): Settings {
  const frequencyHzBySatellite: Record<string, number> = {};
  for (const sat of MONITORED_SATELLITES) frequencyHzBySatellite[sat.noradId] = sat.defaultFrequencyHz;
  return {
    units: 'metric',
    minElevationDeg: 15,
    notificationsEnabled: true,
    reminderMinutes: 10,
    biasTee: false,
    captureTestMode: true,
    autoFrequency: true,
    frequencyHzBySatellite,
  };
}

const SETTINGS_KEY = 'settings.v1';
const LOCATION_KEY = 'location.v1';

export const SettingsStorage = {
  load(): Settings {
    const defaults = defaultSettings();
    const raw = storage.getString(SETTINGS_KEY);
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        ...defaults,
        ...parsed,
        frequencyHzBySatellite: { ...defaults.frequencyHzBySatellite, ...parsed.frequencyHzBySatellite },
      };
    } catch {
      return defaults;
    }
  },

  save(settings: Settings): void {
    storage.set(SETTINGS_KEY, JSON.stringify(settings));
  },

  loadLocation(): SavedLocation | null {
    const raw = storage.getString(LOCATION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as SavedLocation;
      if (Number.isFinite(parsed.latitudeDeg) && Number.isFinite(parsed.longitudeDeg)) return parsed;
      return null;
    } catch {
      return null;
    }
  },

  saveLocation(location: SavedLocation): void {
    storage.set(LOCATION_KEY, JSON.stringify(location));
  },
};
