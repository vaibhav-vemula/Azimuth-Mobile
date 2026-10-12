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

/** Walking faster than this, the direction of travel from GPS is steadier and truer than the phone's compass. */
export const COURSE_MIN_MPS = 1.2;
/** A direction of travel older than this is not used any more. */
export const COURSE_FRESH_MS = 4000;

export interface Course {
  deg: number;
  atMs: number;
}

/** The direction of travel from a GPS fix, or null when you are not moving fast enough or the phone did not give one. */
export function courseFrom(speedMps: number | null | undefined, headingDeg: number | null | undefined, atMs: number): Course | null {
  if (typeof speedMps !== 'number' || !Number.isFinite(speedMps) || speedMps < COURSE_MIN_MPS) return null;
  if (typeof headingDeg !== 'number' || !Number.isFinite(headingDeg) || headingDeg < 0) return null;
  return { deg: headingDeg % 360, atMs };
}

/** What to show as "the way I am facing": the direction of travel while moving, otherwise the phone's compass. */
export function chooseHeading(sensorDeg: number | null, course: Course | null, nowMs: number): number | null {
  if (course && nowMs - course.atMs <= COURSE_FRESH_MS) return course.deg;
  return sensorDeg;
}

/** A compass direction as it appears on a map that is itself turned by `mapBearingDeg` (markers do not turn with the map). */
export function onTurnedMap(headingDeg: number, mapBearingDeg: number): number {
  return (((headingDeg - mapBearingDeg) % 360) + 360) % 360;
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
  /** How far the map is turned from north-up, in degrees. */
  mapBearing: number;
  setMapBearing: (deg: number) => void;
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
  mapBearing: 0,
  setMapBearing: (deg) => {
    const next = Number.isFinite(deg) ? deg : 0;
    if (Math.abs(get().mapBearing - next) >= 1) set({ mapBearing: next });
  },
  set: (heading) => set({ heading }),
  setNeedsCalibration: (needs) => {
    if (get().needsCalibration !== needs) set({ needsCalibration: needs });
  },
  setActivity: (activity) => {
    if (get().activity !== activity) set({ activity });
  },
}));
