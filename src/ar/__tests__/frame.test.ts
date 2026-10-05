import { computeFrame, FrameInput, VISIBLE_RANGE_M } from '../frame';
import { OPEN_RANGE_M, Quat, qFromAxisAngle, qMul } from '../orientation';

const rad = (d: number) => (d * Math.PI) / 180;
const here = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
/** About `m` metres east of `here`. */
const east = (m: number) => ({ ...here, longitudeDeg: here.longitudeDeg + m / (111320 * Math.cos(rad(here.latitudeDeg))) });
const north = (m: number) => ({ ...here, latitudeDeg: here.latitudeDeg + m / 111320 });

/** A phone held upright facing `headingDeg`, as the sensor reports it. */
function sensor(headingDeg: number): Quat {
  return qMul(qFromAxisAngle([0, 0, 1], -rad(headingDeg)), qFromAxisAngle([1, 0, 0], rad(90)));
}

const base = (over: Partial<FrameInput> = {}): FrameInput => ({
  device: sensor(90),
  declinationDeg: 0,
  user: here,
  target: east(20),
  previous: { distanceM: null, bearingDeg: null },
  dtSec: 1 / 60,
  ready: false,
  screenAspect: 9 / 19.5,
  ...over,
});

describe('computeFrame', () => {
  it('has nothing to draw until there is a position', () => {
    expect(computeFrame(base({ user: null }))).toBeNull();
  });

  it('puts a chest dead ahead in view', () => {
    const f = computeFrame(base())!;
    expect(f.distanceM).toBeCloseTo(20, 0);
    expect(f.bearingDeg).toBeCloseTo(90, 0);
    expect(f.headingDeg).toBeCloseTo(90, 3);
    expect(f.relativeDeg).toBeCloseTo(0, 0);
    expect(f.inView).toBe(true);
    expect(f.world[0]).toBeCloseTo(20, 0); // east
  });

  it('says which way to turn when the chest is off to the side', () => {
    const facingNorth = computeFrame(base({ device: sensor(0) }))!;
    expect(facingNorth.inView).toBe(false);
    expect(facingNorth.relativeDeg).toBeCloseTo(90, 0); // turn right
    const facingSouth = computeFrame(base({ device: sensor(180) }))!;
    expect(facingSouth.relativeDeg).toBeCloseTo(-90, 0); // turn left
  });

  it('turns the mood from far to near to ready as you get close and have your readings', () => {
    expect(computeFrame(base({ target: east(OPEN_RANGE_M + 15) }))!.mood).toBe('far');
    expect(computeFrame(base({ target: east(OPEN_RANGE_M - 10) }))!.mood).toBe('near');
    expect(computeFrame(base({ target: east(OPEN_RANGE_M - 10), ready: true }))!.mood).toBe('ready');
    expect(computeFrame(base({ target: east(OPEN_RANGE_M + 15), ready: true }))!.mood).toBe('far');
    expect(computeFrame(base({ target: east(10) }))!.withinOpenRange).toBe(true);
  });

  it('draws the chest at a size you can see when you are very close, and keeps far ones in view', () => {
    const close = computeFrame(base({ target: east(1) }))!;
    expect(Math.hypot(close.world[0], close.world[2])).toBeGreaterThanOrEqual(3.99);
    const far = computeFrame(base({ target: east(150) }))!;
    expect(Math.hypot(far.world[0], far.world[2])).toBeLessThanOrEqual(40.01);
    expect(far.visible).toBe(true);
    expect(computeFrame(base({ target: east(VISIBLE_RANGE_M + 100) }))!.visible).toBe(false);
  });

  it('still works before the sensor reports, and says so', () => {
    const f = computeFrame(base({ device: null }))!;
    expect(f.oriented).toBe(false);
    expect(f.headingDeg).toBeCloseTo(0, 6);
  });

  it('smooths GPS steps instead of jumping', () => {
    const first = computeFrame(base({ target: north(30) }))!;
    const jumped = computeFrame(base({ target: north(10), previous: first.next, dtSec: 1 / 60 }))!;
    expect(jumped.distanceM).toBeLessThan(first.distanceM);
    expect(jumped.distanceM).toBeGreaterThan(25); // barely moved in one frame
    let prev = first.next;
    let f = first;
    for (let i = 0; i < 240; i++) {
      f = computeFrame(base({ target: north(10), previous: prev, dtSec: 1 / 60 }))!;
      prev = f.next;
    }
    expect(f.distanceM).toBeCloseTo(10, 0); // settles after a few seconds
  });

  it('smooths the bearing across north the short way', () => {
    const prev = { distanceM: 20, bearingDeg: 359 };
    const f = computeFrame(base({ target: { ...here, latitudeDeg: here.latitudeDeg + 0.0002, longitudeDeg: here.longitudeDeg + 0.0000001 }, previous: prev, dtSec: 0.5 }))!;
    expect(f.bearingDeg === 0 || f.bearingDeg > 355 || f.bearingDeg < 5).toBe(true);
  });
});
