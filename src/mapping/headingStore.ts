import { create } from 'zustand';

/**
 * The direction you are facing, kept apart from everything else on purpose. It changes about 20 times a second, and
 * only the few things that draw it (the arrow, the cone on your dot) listen. If it lived in the map screen's own state,
 * the whole screen, including the map, would redraw 20 times a second.
 */
interface HeadingState {
  heading: number | null;
  set: (heading: number | null) => void;
}

export const useHeadingStore = create<HeadingState>((set) => ({
  heading: null,
  set: (heading) => set({ heading }),
}));
