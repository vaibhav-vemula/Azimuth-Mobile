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
  addTestChest: (position: LatLon, facingDeg?: number | null) => Chest;
  clearTestChests: () => void;
}

/** Test chests are kept apart from the real ones so a refresh from the network does not remove them. */
let testChests: Chest[] = [];

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
  addTestChest: (position, facingDeg = null) => {
    // Exactly where you stand. GPS cannot tell which way a point under your feet lies, so in AR it is drawn in front of
    // you, in the direction you were facing when you dropped it (see computeFrame).
    const at = { latitudeDeg: position.latitudeDeg, longitudeDeg: position.longitudeDeg };
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
      spec: { minSamples: 1, lat: at.latitudeDeg, lon: at.longitudeDeg, test: true, ...(facingDeg !== null ? { facingDeg } : {}) },
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
