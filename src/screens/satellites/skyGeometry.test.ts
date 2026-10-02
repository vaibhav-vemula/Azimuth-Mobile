import { polarPoint } from './skyGeometry';

describe('polarPoint', () => {
  it('puts the zenith at the centre', () => {
    const p = polarPoint(123, 90, 100, 10, 20);
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(20, 9);
  });

  it('puts the horizon on the outer circle at the right compass point', () => {
    const north = polarPoint(0, 0, 100);
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.y).toBeCloseTo(-100, 9);
    const east = polarPoint(90, 0, 100);
    expect(east.x).toBeCloseTo(100, 9);
    expect(east.y).toBeCloseTo(0, 9);
    const south = polarPoint(180, 0, 100);
    expect(south.y).toBeCloseTo(100, 9);
    const west = polarPoint(270, 0, 100);
    expect(west.x).toBeCloseTo(-100, 9);
  });

  it('scales elevation linearly toward the centre', () => {
    const p = polarPoint(0, 45, 100);
    expect(p.y).toBeCloseTo(-50, 9);
  });

  it('clamps elevations outside 0..90', () => {
    expect(polarPoint(0, -10, 100).y).toBeCloseTo(-100, 9);
    expect(polarPoint(0, 120, 100).y).toBeCloseTo(0, 9);
  });
});
