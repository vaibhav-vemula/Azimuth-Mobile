import { create } from 'zustand';
import { Chest, fetchChests } from './api';
import { verifierConfigured } from './config';

interface ChestsState {
  chests: Chest[];
  loading: boolean;
  error: string | null;
  loadedAtMs: number | null;
  refresh: () => Promise<void>;
}

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
      set({ chests, loading: false, loadedAtMs: Date.now() });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
