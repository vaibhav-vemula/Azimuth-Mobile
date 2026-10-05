import { create } from 'zustand';
import { Chest, fetchChests } from './api';
import { verifierConfigured } from './config';
import { cellIdAt } from '../mapping/hexGrid';
import type { LatLon } from '../mapping/hexGrid';

interface ChestsState {
  chests: Chest[];
  loading: boolean;
  error: string | null;
  loadedAtMs: number | null;
  refresh: () => Promise<void>;
  /** A chest that exists only on this phone, a few metres from `position`, for trying the opening without any network. */
  addTestChest: (position: LatLon, metresNorth?: number) => Chest;
  clearTestChests: () => void;
}

/** Test chests are kept apart from the real ones so a refresh from the network does not remove them. */
let testChests: Chest[] = [];
const METRES_PER_DEGREE = 111_320;

export const useChests = create<ChestsState>((set, get) => ({
  chests: [],
  loading: false,
  error: null,
  loadedAtMs: null,
  refresh: async () => {
    if (get().loading || !verifierConfigured) return;
    set({ loading: true, error: null });
    try {
      const chests = await fetchChests();
      set({ chests: [...testChests, ...chests], loading: false, loadedAtMs: Date.now() });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  addTestChest: (position, metresNorth = 6) => {
    const at = { latitudeDeg: position.latitudeDeg + metresNorth / METRES_PER_DEGREE, longitudeDeg: position.longitudeDeg };
    const chest: Chest = {
      id: `test-${Date.now()}`,
      title: 'Test chest',
      kind: 'visit',
      cellId: cellIdAt(at),
      rewardUsdc: 1,
      remaining: 1,
      expiresMs: Date.now() + 2 * 3_600_000,
      requester: 'Azimuth test',
      requires: 'phone',
      // One reading is enough, and the exact spot is given so it sits where you are.
      spec: { minSamples: 1, lat: at.latitudeDeg, lon: at.longitudeDeg, test: true },
    };
    testChests = [chest, ...testChests];
    set({ chests: [chest, ...get().chests] });
    return chest;
  },
  clearTestChests: () => {
    testChests = [];
    set({ chests: get().chests.filter((c) => c.spec.test !== true) });
  },
}));
