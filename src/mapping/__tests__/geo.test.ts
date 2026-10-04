import { arrowRotationDeg, bearingDeg, compassPoint, formatDistanceShort, nearestOf } from '../geo';

import { hexAt, hexCenter, neighbors, cellId } from '../hexGrid';
import { FOG_CELL_M } from '../explore';

const here = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
const at = (dLat: number, dLon: number) => ({ latitudeDeg: here.latitudeDeg + dLat, longitudeDeg: here.longitudeDeg + dLon });

describe('bearing and arrow', () => {
  it('points the cardinal directions', () => {
    expect(Math.round(bearingDeg(here, at(0.01, 0)))).toBe(0);
    expect(Math.round(bearingDeg(here, at(0, 0.01)))).toBe(90);
    expect(Math.round(bearingDeg(here, at(-0.01, 0)))).toBe(180);
    expect(Math.round(bearingDeg(here, at(0, -0.01)))).toBe(270);
  });

  it('rotates the arrow relative to where the phone faces', () => {
    expect(arrowRotationDeg(90, 0)).toBe(90); // target east, facing north: turn right
    expect(arrowRotationDeg(90, 90)).toBe(0); // facing it
    expect(arrowRotationDeg(0, 90)).toBe(-90); // target north, facing east: turn left
    expect(arrowRotationDeg(10, 350)).toBe(20); // wraps through north
    expect(arrowRotationDeg(350, 10)).toBe(-20);
    expect(arrowRotationDeg(180, 0)).toBe(180);
    expect(arrowRotationDeg(45, null)).toBe(45); // no compass: relative to north
  });

  it('names compass points and short distances', () => {
    expect([0, 44, 46, 90, 225, 359].map(compassPoint)).toEqual(['N', 'NE', 'NE', 'E', 'SW', 'N']);
    expect(formatDistanceShort(3)).toBe('5 m');
    expect(formatDistanceShort(118)).toBe('120 m');
    expect(formatDistanceShort(1460)).toBe('1.5 km');
    expect(formatDistanceShort(25_000)).toBe('25 km');
    expect(formatDistanceShort(Infinity)).toBe('—');
  });

  it('finds the nearest of several with its bearing', () => {
    const near = nearestOf(here, [
      { item: 'far', position: at(0.05, 0) },
      { item: 'near', position: at(0, 0.002) },
      { item: 'mid', position: at(0.01, 0) },
    ]);
    expect(near?.item).toBe('near');
    expect(Math.round(near!.bearingDeg)).toBe(90);
    expect(near!.distanceM).toBeGreaterThan(100);
    expect(near!.distanceM).toBeLessThan(250);
    expect(nearestOf(here, [])).toBeNull();
  });
});

