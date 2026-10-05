import { LatLon, distanceM } from '../mapping/hexGrid';
import { bearingDeg } from '../mapping/geo';

/**
 * Maths for the AR view. The world used for drawing is: x east, y up, z south (so north is -z). A camera with no
 * rotation looks along -z, which is north. Distances are in metres.
 */
export interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}
export type Vec3 = [number, number, number];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export const IDENTITY: Quat = { w: 1, x: 0, y: 0, z: 0 };

export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qFromAxisAngle(axis: Vec3, radians: number): Quat {
  const s = Math.sin(radians / 2);
  return { w: Math.cos(radians / 2), x: axis[0] * s, y: axis[1] * s, z: axis[2] * s };
}

export function qConjugate(q: Quat): Quat {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q.w, q.x, q.y, q.z) || 1;
  return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  const p: Quat = { w: 0, x: v[0], y: v[1], z: v[2] };
  const r = qMul(qMul(q, p), qConjugate(q));
  return [r.x, r.y, r.z];
}

/** Earth frame (x east, y north, z up) to drawing world (x east, y up, z south): a quarter turn about x. */
const EARTH_TO_WORLD = qFromAxisAngle([1, 0, 0], -Math.PI / 2);

/**
 * The camera's orientation in the drawing world, from the sensor's quaternion.
 *
 * `device` maps device axes (x right, y up the screen, z out of the screen) to the earth frame, relative to magnetic
 * north. The back camera looks along -z of the device, which is also the direction a camera looks by default in the
 * drawing world, so only the frame change and the declination (magnetic to true north) are needed.
 */
export function cameraQuaternion(device: Quat, declinationDeg: number): Quat {
  const turn = qFromAxisAngle([0, 1, 0], -rad(declinationDeg)); // adding to a heading turns clockwise from above
  return qNormalize(qMul(turn, qMul(EARTH_TO_WORLD, qNormalize(device))));
}

export function forwardOf(q: Quat): Vec3 {
  return qRotate(q, [0, 0, -1]);
}

/** Compass heading the camera faces, 0 to 360, clockwise from true north. */
export function headingOf(q: Quat): number {
  const f = forwardOf(q);
  return (deg(Math.atan2(f[0], -f[2])) + 360) % 360;
}

/** How far above (positive) or below the horizon the camera points. */
export function pitchOf(q: Quat): number {
  return deg(Math.asin(Math.max(-1, Math.min(1, forwardOf(q)[1]))));
}

/** Signed angle from where the camera faces to a bearing, -180 to 180. Positive is to the right. */
export function relativeBearingDeg(targetBearing: number, headingDeg: number): number {
  const d = (((targetBearing - headingDeg) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** Moves an angle part of the way to a new one by the short way round. */
export function smoothAngleDeg(previous: number | null, next: number, alpha: number): number {
  if (previous === null) return next;
  return (previous + relativeBearingDeg(next, previous) * alpha + 360) % 360;
}

export function smoothValue(previous: number | null, next: number, alpha: number): number {
  return previous === null ? next : previous + (next - previous) * alpha;
}

/** Metres east and north from one place to another (accurate over the short distances AR deals with). */
export function offsetEnu(from: LatLon, to: LatLon): { east: number; north: number } {
  const north = ((to.latitudeDeg - from.latitudeDeg) * Math.PI * 6371000) / 180;
  const east = ((to.longitudeDeg - from.longitudeDeg) * Math.PI * 6371000 * Math.cos(rad((from.latitudeDeg + to.latitudeDeg) / 2))) / 180;
  return { east, north };
}

/** How far the chest is drawn from you, however far it really is. Near is kept at a size you can see and tap; far is kept in view. */
export const MIN_RENDER_M = 4;
export const MAX_RENDER_M = 40;
/** The phone is about this far above the ground. */
export const CAMERA_HEIGHT_M = 1.4;
/** Close enough to look for the chest in AR, and to open it. */
export const AR_RANGE_M = 60;
export const OPEN_RANGE_M = 30;

export function renderDistance(realDistanceM: number): number {
  return Math.min(MAX_RENDER_M, Math.max(MIN_RENDER_M, realDistanceM));
}

/** Where to draw the chest, on the ground in the direction of its real position. */
export function chestWorldPosition(realDistanceM: number, bearing: number): Vec3 {
  const r = renderDistance(realDistanceM);
  return [Math.sin(rad(bearing)) * r, -CAMERA_HEIGHT_M, -Math.cos(rad(bearing)) * r];
}

/** Distance and bearing from the user to the chest. */
export function toChest(user: LatLon, chest: LatLon): { distanceM: number; bearingDeg: number } {
  return { distanceM: distanceM(user, chest), bearingDeg: bearingDeg(user, chest) };
}

export interface ScreenPoint {
  /** -1 (left) to 1 (right). */
  x: number;
  /** -1 (bottom) to 1 (top). */
  y: number;
  inView: boolean;
}

/** Where a point in the world lands on screen, or null if it is behind the camera. */
export function projectToScreen(world: Vec3, camera: Quat, verticalFovDeg: number, aspect: number): ScreenPoint | null {
  const local = qRotate(qConjugate(camera), world);
  if (local[2] >= -1e-6) return null;
  const t = Math.tan(rad(verticalFovDeg) / 2);
  const x = local[0] / -local[2] / (t * aspect);
  const y = local[1] / -local[2] / t;
  return { x, y, inView: Math.abs(x) <= 1 && Math.abs(y) <= 1 };
}

/** The chest's real position as a point on the map: exact coordinates if the requester gave them, else its cell. */
export function chestPoint(spec: { lat?: number; lon?: number }, cellCentre: LatLon): LatLon {
  return typeof spec.lat === 'number' && typeof spec.lon === 'number' ? { latitudeDeg: spec.lat, longitudeDeg: spec.lon } : cellCentre;
}

/**
 * The compass heading of the direction you are facing while holding the phone, however you hold it, 0 to 360 clockwise
 * from true north. Held flat like a compass, "forward" is the top of the phone; held upright to look through, it is the
 * back camera's direction. In between, the two are blended by how much of each points along the ground, so the heading
 * does not jump as you tilt the phone. `device` is the sensor quaternion (device axes to earth frame: x east, y north,
 * z up, relative to magnetic north).
 */
export function walkingHeadingDeg(device: Quat, declinationDeg: number): number {
  const q = qNormalize(device);
  const top = qRotate(q, [0, 1, 0]);
  const back = qRotate(q, [0, 0, -1]);
  const east = top[0] + back[0];
  const north = top[1] + back[1];
  return (deg(Math.atan2(east, north)) + declinationDeg + 720) % 360;
}
