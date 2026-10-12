import { FOG_CELL_M, VISION_RADIUS_M, cellsWithin, exploredAreaKm2, formatArea } from '../explore';
import { cellId, distanceM, hexAt, hexCenter, neighbors, parseCellId } from '../hexGrid';
import { useUnits } from '../../units/units';

const here = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };

describe('clearing the fog around you', () => {
  it('clears a bubble of about the vision radius, centred on you', () => {
    const ids = cellsWithin(here);
    expect(ids.length).toBeGreaterThan(1400);
    expect(ids.length).toBeLessThan(2400);
    for (const id of ids) {
      const p = parseCellId(id)!;
      expect(p.sizeM).toBe(FOG_CELL_M);
      expect(distanceM(here, hexCenter(p.hex, p.sizeM))).toBeLessThanOrEqual(VISION_RADIUS_M);
    }
    expect(ids).toContain(cellId(hexAt(here, FOG_CELL_M), FOG_CELL_M));
  });

  it('is the same bubble for the same spot, and moves with you', () => {
    expect(cellsWithin(here)).toEqual(cellsWithin(here));
    const east = { ...here, longitudeDeg: here.longitudeDeg + 0.0006 }; // about 50 m, inside the bubble's reach
    const a = new Set(cellsWithin(here));
    const b = cellsWithin(east);
    expect(b.some((id) => !a.has(id))).toBe(true); // new ground
    expect(b.some((id) => a.has(id))).toBe(true); // overlapping ground is not cleared twice
  });

  it('has no gaps along a walk', () => {
    const cleared = new Set<string>();
    for (let i = 0; i <= 20; i++) cellsWithin({ ...here, longitudeDeg: here.longitudeDeg + i * 0.0002 }).forEach((id) => cleared.add(id));
    // Every cell between the start and the end centre line is cleared.
    for (let i = 0; i <= 200; i++) {
      const p = { ...here, longitudeDeg: here.longitudeDeg + i * 0.00002 };
      expect(cleared.has(cellId(hexAt(p, FOG_CELL_M), FOG_CELL_M))).toBe(true);
    }
  });

  it('measures and formats area', () => {
    expect(exploredAreaKm2(0, 39)).toBe(0);
    const km2 = exploredAreaKm2(1000, 38.9);
    expect(km2).toBeGreaterThan(0.03);
    expect(km2).toBeLessThan(0.06);
    useUnits.getState().setPreference('metric');
    expect(formatArea(0.0004)).toBe('400 m²');
    expect(formatArea(0.42)).toBe('0.42 km²');
    expect(formatArea(1234.5)).toBe('1,235 km²');
    // The same area in miles and feet when that is the setting, so every screen agrees.
    useUnits.getState().setPreference('imperial');
    expect(formatArea(0.0004)).toMatch(/ sq ft$/);
    expect(formatArea(0.42)).toBe('0.16 mi²');
    expect(formatArea(1234.5)).toBe('477 mi²');
    useUnits.getState().setPreference('auto');
  });
});

