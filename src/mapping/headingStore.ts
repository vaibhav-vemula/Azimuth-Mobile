import { create } from 'zustand';

/** What you are doing, judged from how fast the phone moves: it decides whether your marker stands, strides or drives. */
export type Activity = 'still' | 'walking' | 'driving';

/** Speed above which you count as walking, and above which as driving, in metres per second. */
export const WALKING_MPS = 0.8;
export const DRIVING_MPS = 6;

export function activityFor(speedMps: number | null | undefined): Activity {
  if (typeof speedMps !== 'number' || !Number.isFinite(speedMps) || speedMps < WALKING_MPS) return 'still';
  return speedMps >= DRIVING_MPS ? 'driving' : 'walking';
}

/**
 * The direction you are facing, kept apart from everything else on purpose. It changes about 20 times a second, and
 * only the few things that draw it (the arrow, the cone on your dot) listen. If it lived in the map screen's own state,
 * the whole screen, including the map, would redraw 20 times a second.
 */
interface HeadingState {
  heading: number | null;
  /** True when the compass says it is not accurate (a figure-8 wave of the phone usually fixes it). */
  needsCalibration: boolean;
  activity: Activity;
  set: (heading: number | null) => void;
  setNeedsCalibration: (needs: boolean) => void;
  setActivity: (activity: Activity) => void;
}

/** Heading error beyond this, in radians (about 25 degrees), is too much to trust an arrow. */
export const POOR_HEADING_RAD = 0.44;

/** Whether a sensor reading says the compass needs calibrating. */
export function compassNeedsCalibration(status: number | undefined, accuracyRad: number | null): boolean {
  if (typeof status === 'number' && status <= 1) return true;
  return accuracyRad !== null && accuracyRad > POOR_HEADING_RAD;
}

export const useHeadingStore = create<HeadingState>((set, get) => ({
  heading: null,
  needsCalibration: false,
  activity: 'still',
  set: (heading) => set({ heading }),
  setNeedsCalibration: (needs) => {
    if (get().needsCalibration !== needs) set({ needsCalibration: needs });
  },
  setActivity: (activity) => {
    if (get().activity !== activity) set({ activity });
  },
}));
