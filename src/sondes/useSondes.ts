import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';
import type { LatLon } from '../mapping/hexGrid';
import { DEFAULT_RADIUS_KM, Sonde, fetchSondes } from './sondehub';

const storage = createMMKV({ id: 'azimuth-sondes' });
const TRACKED = 'tracked';

function loadTracked(): string[] {
  try {
    const raw = storage.getString(TRACKED);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

interface SondesState {
  sondes: Sonde[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  updatedMs: number | null;
  /** The sondes you chose to follow, by serial. They stay at the top of the list. */
  tracked: string[];
  radiusKm: number;
  refresh: (here: LatLon) => Promise<void>;
  toggleTracked: (serial: string) => void;
}

export const useSondes = create<SondesState>((set, get) => ({
  sondes: [],
  status: 'idle',
  error: null,
  updatedMs: null,
  tracked: loadTracked(),
  radiusKm: DEFAULT_RADIUS_KM,

  refresh: async (here) => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const found = await fetchSondes(here, { radiusKm: get().radiusKm });
      // A sonde you follow that has dropped out of this search (it drifted away, or went quiet) keeps its last known entry.
      const kept = get().sondes.filter((s) => get().tracked.includes(s.serial) && !found.some((f) => f.serial === s.serial));
      set({ sondes: [...found, ...kept], status: 'ready', updatedMs: Date.now() });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  toggleTracked: (serial) => {
    const tracked = get().tracked.includes(serial) ? get().tracked.filter((s) => s !== serial) : [...get().tracked, serial];
    storage.set(TRACKED, JSON.stringify(tracked));
    set({ tracked });
  },
}));
