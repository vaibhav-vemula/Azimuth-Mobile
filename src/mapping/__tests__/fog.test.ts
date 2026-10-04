import { boundaryLoops, clearedBoundary, fogFeature } from '../fog';
import { FOG_CELL_M, cellsWithin } from '../explore';
import { cellId, hexAt, hexCorners, neighbors } from '../hexGrid';

const here = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
const centre = hexAt(here, FOG_CELL_M);
const id = (h: { q: number; r: number }) => cellId(h, FOG_CELL_M);

const area = (ring: number[][]) => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

describe('tracing the cleared ground', () => {
  it('one cell is one six-sided loop, counter-clockwise', () => {
    const loops = boundaryLoops([id(centre)]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
    expect(area(loops[0])).toBeGreaterThan(0);
  });

  it('a cell and its six neighbours are one loop of eighteen sides with the area of seven cells', () => {
    const flower = [id(centre), ...neighbors(centre).map(id)];
    const loops = boundaryLoops(flower);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(18);
    const one = Math.abs(area(hexCorners(centre, FOG_CELL_M).map((c) => [c.longitudeDeg, c.latitudeDeg])));
    expect(area(loops[0]) / one).toBeCloseTo(7, 1);
  });

  it('separate patches are separate loops', () => {
    const far = { q: centre.q + 10, r: centre.r };
    expect(boundaryLoops([id(centre), id(far)])).toHaveLength(2);
  });

  it('an uncleared cell surrounded by cleared ones is a clockwise island', () => {
    const ring = neighbors(centre).map(id);
    const loops = boundaryLoops(ring);
    expect(loops).toHaveLength(2);
    const signs = loops.map((l) => Math.sign(area(l))).sort();
    expect(signs).toEqual([-1, 1]);
  });

  it('ignores cells from other grids and bad ids', () => {
    expect(boundaryLoops(['h120:1:1', 'nonsense'])).toHaveLength(0);
  });

  it('traces a whole walked bubble as a single loop with no interior seams', () => {
    const loops = boundaryLoops(cellsWithin(here));
    expect(loops).toHaveLength(1);
    expect(loops[0].length).toBeGreaterThan(12);
  });
});

describe('fog polygon', () => {
  it('is the world with no holes when nothing is cleared', () => {
    const f = fogFeature([]);
    expect(f.geometry.coordinates).toHaveLength(1);
    expect(f.geometry.coordinates[0]).toHaveLength(1);
    expect(f.geometry.coordinates[0][0][0]).toEqual(f.geometry.coordinates[0][0][4]);
  });

  it('cuts one clockwise hole for a cleared patch, with the world counter-clockwise', () => {
    const f = fogFeature(cellsWithin(here));
    expect(f.geometry.coordinates).toHaveLength(1);
    const [world, hole] = f.geometry.coordinates[0];
    expect(area(world)).toBeGreaterThan(0);
    expect(area(hole)).toBeLessThan(0);
    expect(hole[0]).toEqual(hole[hole.length - 1]);
  });

  it('the hole surrounds the place you stand', () => {
    const [, hole] = fogFeature(cellsWithin(here)).geometry.coordinates[0];
    const lons = hole.map((p) => p[0]);
    const lats = hole.map((p) => p[1]);
    expect(Math.min(...lons)).toBeLessThan(here.longitudeDeg);
    expect(Math.max(...lons)).toBeGreaterThan(here.longitudeDeg);
    expect(Math.min(...lats)).toBeLessThan(here.latitudeDeg);
    expect(Math.max(...lats)).toBeGreaterThan(here.latitudeDeg);
  });

  it('smoothing rounds the outline: many more points than the hex staircase, and only a little less area', () => {
    const cells = cellsWithin(here);
    const raw = boundaryLoops(cells)[0];
    const [, hole] = fogFeature(cells).geometry.coordinates[0];
    expect(hole.length).toBeGreaterThan(raw.length * 3);
    const smoothArea = Math.abs(area(hole));
    expect(smoothArea).toBeLessThan(Math.abs(area(raw)));
    expect(smoothArea).toBeGreaterThan(Math.abs(area(raw)) * 0.9);
  });

  it('the smoothed outline of a round bubble is nearly a circle (no teeth)', () => {
    const [, hole] = fogFeature(cellsWithin(here)).geometry.coordinates[0];
    const pts = hole.slice(0, -1);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const k = Math.cos((here.latitudeDeg * Math.PI) / 180);
    const radii = pts.map((p) => Math.hypot((p[0] - cx) * k, p[1] - cy));
    const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
    const worst = Math.max(...radii.map((r) => Math.abs(r - mean)));
    // Within 4.5% of a perfect circle. A bubble of hex cells is naturally a hexagon, which is about 7% off.
    expect(worst / mean).toBeLessThan(0.045);
  });

  it('keeps an uncleared island as its own fog polygon', () => {
    const f = fogFeature(neighbors(centre).map(id));
    expect(f.geometry.coordinates).toHaveLength(2);
    const [island] = f.geometry.coordinates[1];
    expect(area(island)).toBeGreaterThan(0); // an exterior ring
  });

  it('places nested patches correctly: a cleared patch inside a fog island is a hole in that island', () => {
    // A thick ring of cells with a gap, and a single cleared cell in the middle of the gap.
    const ringCells = new Set<string>();
    for (let dq = -4; dq <= 4; dq++) {
      for (let dr = Math.max(-4, -dq - 4); dr <= Math.min(4, -dq + 4); dr++) {
        const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        if (d >= 3) ringCells.add(id({ q: centre.q + dq, r: centre.r + dr }));
      }
    }
    ringCells.add(id(centre));
    const f = fogFeature(ringCells);
    // [world with one hole (the big ring's outer edge)], [island fog with one hole (the centre cell)]
    expect(f.geometry.coordinates).toHaveLength(2);
    expect(f.geometry.coordinates[0]).toHaveLength(2);
    expect(f.geometry.coordinates[1]).toHaveLength(2);
  });
});

describe('boundary line', () => {
  it('is closed smoothed loops', () => {
    const b = clearedBoundary(cellsWithin(here));
    expect(b.geometry.coordinates).toHaveLength(1);
    const line = b.geometry.coordinates[0];
    expect(line[0]).toEqual(line[line.length - 1]);
  });

  it('is empty when nothing is cleared', () => {
    expect(clearedBoundary([]).geometry.coordinates).toHaveLength(0);
  });
});
