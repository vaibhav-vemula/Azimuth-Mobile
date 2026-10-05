import {
  AR_RANGE_M,
  MAX_RENDER_M,
  MIN_RENDER_M,
  OPEN_RANGE_M,
  Quat,
  cameraQuaternion,
  chestPoint,
  chestWorldPosition,
  forwardOf,
  headingOf,
  offsetEnu,
  pitchOf,
  projectToScreen,
  qFromAxisAngle,
  qMul,
  qRotate,
  relativeBearingDeg,
  renderDistance,
  smoothAngleDeg,
  smoothValue,
  toChest,
  walkingHeadingDeg,
} from '../orientation';

const rad = (d: number) => (d * Math.PI) / 180;
const here = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };

/**
 * The sensor quaternion for a phone held upright, back camera facing `headingDeg`, tilted up by `tiltDeg`.
 * Earth frame: x east, y north, z up. Upright and facing north is a +90 degree turn about x (y up the screen becomes
 * up, z out of the screen becomes south). Turning clockwise by the heading is a negative turn about z (up).
 */
function sensorFor(headingDeg: number, tiltDeg = 0): Quat {
  const upright = qFromAxisAngle([1, 0, 0], rad(90 + tiltDeg));
  const turn = qFromAxisAngle([0, 0, 1], -rad(headingDeg));
  return qMul(turn, upright);
}

describe('camera orientation from the sensor', () => {
  it('upright and facing north looks north, level', () => {
    const cam = cameraQuaternion(sensorFor(0), 0);
    expect(headingOf(cam)).toBeCloseTo(0, 4);
    expect(pitchOf(cam)).toBeCloseTo(0, 4);
    const f = forwardOf(cam);
    expect(f[0]).toBeCloseTo(0, 6);
    expect(f[2]).toBeCloseTo(-1, 6); // north is -z
  });

  it('reads the heading in every direction', () => {
    for (const h of [0, 45, 90, 135, 180, 225, 270, 315]) {
      expect(headingOf(cameraQuaternion(sensorFor(h), 0))).toBeCloseTo(h, 3);
    }
  });

  it('reads the tilt above and below the horizon', () => {
    expect(pitchOf(cameraQuaternion(sensorFor(90, 30), 0))).toBeCloseTo(30, 3);
    expect(pitchOf(cameraQuaternion(sensorFor(200, -20), 0))).toBeCloseTo(-20, 3);
    expect(headingOf(cameraQuaternion(sensorFor(200, -20), 0))).toBeCloseTo(200, 3);
  });

  it('turns magnetic north into true north using the declination', () => {
    // Washington has a declination of about -10 degrees (west): true = magnetic + declination.
    expect(headingOf(cameraQuaternion(sensorFor(0), -10))).toBeCloseTo(350, 3);
    expect(headingOf(cameraQuaternion(sensorFor(90), 12))).toBeCloseTo(102, 3);
  });

  it('keeps a unit quaternion even if the sensor value is slightly off', () => {
    const q = cameraQuaternion({ w: 0.7072, x: 0.7071, y: 0, z: 0 }, 0);
    expect(Math.hypot(q.w, q.x, q.y, q.z)).toBeCloseTo(1, 9);
  });
});

describe('angles and smoothing', () => {
  it('measures the signed angle to a bearing the short way', () => {
    expect(relativeBearingDeg(90, 0)).toBe(90);
    expect(relativeBearingDeg(10, 350)).toBe(20);
    expect(relativeBearingDeg(350, 10)).toBe(-20);
    expect(relativeBearingDeg(180, 0)).toBe(180);
  });

  it('smooths an angle across north without swinging the long way', () => {
    expect(smoothAngleDeg(null, 40, 0.5)).toBe(40);
    expect(smoothAngleDeg(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(smoothAngleDeg(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(smoothValue(null, 5, 0.3)).toBe(5);
    expect(smoothValue(10, 20, 0.5)).toBe(15);
  });
});

describe('where the chest is', () => {
  it('measures metres east and north', () => {
    const north = offsetEnu(here, { ...here, latitudeDeg: here.latitudeDeg + 0.001 });
    expect(north.north).toBeCloseTo(111.2, 0);
    expect(Math.abs(north.east)).toBeLessThan(0.01);
    const east = offsetEnu(here, { ...here, longitudeDeg: here.longitudeDeg + 0.001 });
    expect(east.east).toBeCloseTo(111.2 * Math.cos(rad(38.9)), 0);
  });

  it('gives distance and bearing to a chest', () => {
    const t = toChest(here, { ...here, longitudeDeg: here.longitudeDeg + 0.0005 });
    expect(Math.round(t.bearingDeg)).toBe(90);
    expect(t.distanceM).toBeGreaterThan(40);
    expect(t.distanceM).toBeLessThan(50);
  });

  it('draws the chest in the direction of its real bearing, on the ground', () => {
    const [x, y, z] = chestWorldPosition(20, 90); // due east
    expect(x).toBeCloseTo(20, 6);
    expect(y).toBeLessThan(0);
    expect(z).toBeCloseTo(0, 6);
    const north = chestWorldPosition(20, 0);
    expect(north[2]).toBeCloseTo(-20, 6);
  });

  it('keeps near chests big enough to tap and far ones in view', () => {
    expect(renderDistance(1)).toBe(MIN_RENDER_M);
    expect(renderDistance(18)).toBe(18);
    expect(renderDistance(500)).toBe(MAX_RENDER_M);
    expect(OPEN_RANGE_M).toBeLessThan(AR_RANGE_M);
  });

  it('uses exact coordinates when the requester gave them, else the cell centre', () => {
    const cell = { latitudeDeg: 1, longitudeDeg: 2 };
    expect(chestPoint({}, cell)).toEqual(cell);
    expect(chestPoint({ lat: 38.9, lon: -77 }, cell)).toEqual({ latitudeDeg: 38.9, longitudeDeg: -77 });
    expect(chestPoint({ lat: 38.9 }, cell)).toEqual(cell);
  });
});

describe('putting the chest on screen', () => {
  const FOV = 60;
  const ASPECT = 9 / 19.5;

  it('puts a chest dead ahead in the middle of the screen', () => {
    const cam = cameraQuaternion(sensorFor(90), 0);
    const p = projectToScreen(chestWorldPosition(10, 90), cam, FOV, ASPECT)!;
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.inView).toBe(true);
  });

  it('moves a chest to the right when it is to the right, and off screen when far to the side', () => {
    const cam = cameraQuaternion(sensorFor(90), 0);
    const right = projectToScreen(chestWorldPosition(10, 100), cam, FOV, ASPECT)!;
    expect(right.x).toBeGreaterThan(0);
    const left = projectToScreen(chestWorldPosition(10, 80), cam, FOV, ASPECT)!;
    expect(left.x).toBeLessThan(0);
    expect(projectToScreen(chestWorldPosition(10, 160), cam, FOV, ASPECT)!.inView).toBe(false);
  });

  it('puts a ground chest below the middle when looking level, and returns null when it is behind you', () => {
    const cam = cameraQuaternion(sensorFor(0), 0);
    expect(projectToScreen(chestWorldPosition(10, 0), cam, FOV, ASPECT)!.y).toBeLessThan(0);
    expect(projectToScreen(chestWorldPosition(10, 180), cam, FOV, ASPECT)).toBeNull();
  });

  it('brings a ground chest up to the middle when you look down at it', () => {
    const level = projectToScreen(chestWorldPosition(6, 0), cameraQuaternion(sensorFor(0, 0), 0), FOV, ASPECT)!;
    const down = projectToScreen(chestWorldPosition(6, 0), cameraQuaternion(sensorFor(0, -13), 0), FOV, ASPECT)!;
    expect(Math.abs(down.y)).toBeLessThan(Math.abs(level.y));
  });
});

describe('quaternion basics', () => {
  it('rotates a vector a quarter turn about up', () => {
    const q = qFromAxisAngle([0, 1, 0], Math.PI / 2);
    const v = qRotate(q, [1, 0, 0]);
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[2]).toBeCloseTo(-1, 9);
  });
});

describe('walking heading (the compass arrow)', () => {
  const flat = (headingDeg: number): Quat => qFromAxisAngle([0, 0, 1], -rad(headingDeg)); // top of the phone points that way
  const upright = (headingDeg: number, tiltDeg = 0): Quat => sensorFor(headingDeg, tiltDeg);

  it('reads the top of the phone when it is held flat', () => {
    for (const h of [0, 45, 90, 180, 270, 315]) expect(walkingHeadingDeg(flat(h), 0)).toBeCloseTo(h, 3);
  });

  it('reads the camera direction when it is held upright', () => {
    for (const h of [0, 45, 90, 180, 270, 315]) expect(walkingHeadingDeg(upright(h), 0)).toBeCloseTo(h, 3);
  });

  it('gives the same heading all the way between flat and upright, so it does not jump as you tilt', () => {
    for (const tilt of [0, 15, 30, 45, 60, 75, 90]) {
      // Tilt the phone up from flat by `tilt` degrees about its own x axis, then turn it to face 120 degrees.
      const q = qMul(qFromAxisAngle([0, 0, 1], -rad(120)), qFromAxisAngle([1, 0, 0], rad(tilt)));
      expect(walkingHeadingDeg(q, 0)).toBeCloseTo(120, 3);
    }
  });

  it('turns magnetic north into true north', () => {
    expect(walkingHeadingDeg(flat(0), -10)).toBeCloseTo(350, 3);
    expect(walkingHeadingDeg(upright(90), 12)).toBeCloseTo(102, 3);
  });

  it('follows a turn: rotating the phone by an angle changes the heading by that angle', () => {
    const before = walkingHeadingDeg(flat(40), 0);
    const after = walkingHeadingDeg(flat(70), 0);
    expect(after - before).toBeCloseTo(30, 3);
  });
});
