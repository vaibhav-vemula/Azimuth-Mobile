import type { LatLon } from '../mapping/hexGrid';
import type { ChestMood } from './chestScene';
import {
  IDENTITY,
  OPEN_RANGE_M,
  Quat,
  Vec3,
  cameraQuaternion,
  chestWorldPosition,
  MIN_RENDER_M,
  headingOf,
  projectToScreen,
  relativeBearingDeg,
  smoothAngleDeg,
  smoothValue,
  toChest,
} from './orientation';

/** The camera's vertical field of view as it appears on screen (the preview is cropped to fill the display). */
export const AR_VERTICAL_FOV_DEG = 58;
/** The chest is drawn (as a beam of light) from up to this far away. */
export const VISIBLE_RANGE_M = 200;
/** While you stand still, a change smaller than this (GPS noise) does not move the chest. */
export const HOLD_M = 2.5;

/** Metres between two places given as distance and bearing from the same point. */
function gapBetweenM(d1: number, b1: number, d2: number, b2: number): number {
  const r1 = (b1 * Math.PI) / 180;
  const r2 = (b2 * Math.PI) / 180;
  return Math.hypot(d1 * Math.sin(r1) - d2 * Math.sin(r2), d1 * Math.cos(r1) - d2 * Math.cos(r2));
}

/** GPS jumps in steps; smoothing over about this long keeps the chest from jittering. */
const SMOOTHING_SECONDS = 0.45;

export interface FrameInput {
  /** The phone's orientation from the sensor, or null until it has reported one. */
  device: Quat | null;
  declinationDeg: number;
  user: LatLon | null;
  target: LatLon;
  /** Distance and bearing smoothed so far, to be fed back in. */
  previous: { distanceM: number | null; bearingDeg: number | null };
  dtSec: number;
  /** Everything needed to open the chest is in place. */
  ready: boolean;
  screenAspect: number;
  /** Which way to draw the chest while you stand closer than the nearest drawing distance, where GPS cannot give a direction. */
  nearBearingDeg?: number | null;
  /** You are standing still: the chest stays exactly where it is unless the new position is clearly different. */
  stationary?: boolean;
}

export interface FrameOutput {
  camera: Quat;
  world: Vec3;
  visible: boolean;
  mood: ChestMood;
  distanceM: number;
  bearingDeg: number;
  /** Compass heading the camera faces. */
  headingDeg: number;
  /** Angle from where the camera faces to the chest; positive is to the right. */
  relativeDeg: number;
  inView: boolean;
  withinOpenRange: boolean;
  /** False until the sensor has reported an orientation. */
  oriented: boolean;
  next: { distanceM: number; bearingDeg: number };
}

/** Works out what to draw this frame, from the sensors and the chest's position. Null until there is a position. */
export function computeFrame(i: FrameInput): FrameOutput | null {
  if (!i.user) return null;
  const raw = toChest(i.user, i.target);
  const alpha = 1 - Math.exp(-Math.max(0, i.dtSec) / SMOOTHING_SECONDS);
  const anchored = typeof i.nearBearingDeg === 'number' && raw.distanceM < MIN_RENDER_M;
  const rawBearing = anchored ? (i.nearBearingDeg as number) : raw.bearingDeg;
  const prev = i.previous;
  let distanceM: number;
  let bearing: number;
  if (prev.distanceM !== null && prev.bearingDeg !== null && i.stationary && gapBetweenM(prev.distanceM, prev.bearingDeg, raw.distanceM, rawBearing) < HOLD_M) {
    // Standing still and the new reading is only GPS noise away: do not move the chest at all.
    distanceM = prev.distanceM;
    bearing = prev.bearingDeg;
  } else {
    distanceM = smoothValue(prev.distanceM, raw.distanceM, alpha);
    bearing = anchored ? rawBearing : smoothAngleDeg(prev.bearingDeg, raw.bearingDeg, alpha);
  }

  const oriented = i.device !== null;
  const camera = i.device ? cameraQuaternion(i.device, i.declinationDeg) : IDENTITY;
  const world = chestWorldPosition(distanceM, bearing);
  const heading = headingOf(camera);
  const screen = projectToScreen(world, camera, AR_VERTICAL_FOV_DEG, i.screenAspect);
  const withinOpenRange = distanceM <= OPEN_RANGE_M;

  return {
    camera,
    world,
    visible: distanceM <= VISIBLE_RANGE_M,
    mood: !withinOpenRange ? 'far' : i.ready ? 'ready' : 'near',
    distanceM,
    bearingDeg: bearing,
    headingDeg: heading,
    relativeDeg: relativeBearingDeg(bearing, heading),
    inView: !!screen && screen.inView,
    withinOpenRange,
    oriented,
    next: { distanceM, bearingDeg: bearing },
  };
}
