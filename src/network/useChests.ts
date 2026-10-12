import { create } from 'zustand';
import { Chest, fetchChests } from './api';
import { verifierConfigured } from './config';
import { buildTreasureChests } from './treasure';
import { loadOpenedChests, saveOpenedChests } from '../mapping/mappingStorage';
import type { LatLon } from '../mapping/hexGrid';

interface ChestsState {
  chests: Chest[];
  loading: boolean;
  error: string | null;
  loadedAtMs: number | null;
  refresh: () => Promise<void>;
  /** A chest was opened: it leaves the map and the list for good (this phone remembers it). */
  markOpened: (id: string) => void;
  /** Three treasure chests at once: one where you stand and two about 200 m away. They exist only on this phone. */
  addTreasureChests: (position: LatLon, facingDeg?: number | null) => Chest[];
  clearTreasureChests: () => void;
}

/** Chests that live only on this phone are kept apart from the real ones so a refresh from the network does not remove them. */
let testChests: Chest[] = [];
/** Ids of chests already opened here. Kept off the map even if the network still lists them as open. */
let opened = new Set<string>(loadOpenedChests());
const notOpened = (list: Chest[]) => list.filter((c) => !opened.has(c.id));

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
      set({ chests: notOpened([...testChests, ...chests]), loading: false, loadedAtMs: Date.now() });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
  markOpened: (id) => {
    opened = new Set([...opened, id]);
    saveOpenedChests([...opened]);
    testChests = testChests.filter((c) => c.id !== id);
    set({ chests: get().chests.filter((c) => c.id !== id) });
  },
  addTreasureChests: (position, facingDeg = null) => {
    // The first sits exactly where you stand; the other two are about 200 m away. All are placed together, and none
    // appears later when one is opened.
    const fresh = buildTreasureChests(position, facingDeg);
    testChests = [...fresh, ...testChests];
    set({ chests: [...fresh, ...get().chests] });
    return fresh;
  },
  clearTreasureChests: () => {
    testChests = [];
    set({ chests: get().chests.filter((c) => c.spec.test !== true) });
  },
}));
