import { Hex, cellId as toCellId, hexCorners, parseCellId } from './hexGrid';
import { FOG_CELL_M } from './explore';

type Pt = [number, number];

/** Everything the map can show, as one outer ring. Counter-clockwise, as GeoJSON expects for an outer ring. */
const WORLD: Pt[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

/** Neighbour across the edge between corner i and corner i+1 of a pointy-top hex (corner i is at 60i - 30 degrees). */
const EDGE_NEIGHBOUR: Hex[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

const key = (p: Pt) => `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;

/** Twice the signed area (shoelace). Positive for counter-clockwise rings. */
function signedArea(ring: Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

function contains(ring: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Corner cutting: each pass rounds every corner. Two passes turn a hex staircase into a smooth curve. */
function smooth(ring: Pt[], passes = 2): Pt[] {
  let pts = ring;
  for (let n = 0; n < passes; n++) {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    pts = out;
  }
  return pts;
}

/**
 * Averages every point with its neighbours, repeatedly. Corner cutting rounds the corners of the hex staircase but
 * leaves its teeth; this spreads each tooth out until the edge reads as a smooth curve. A closed loop shrinks very
 * little because the smoothing distance is small next to the size of the cleared area.
 */
function relax(ring: Pt[], passes: number): Pt[] {
  let pts = ring;
  for (let n = 0; n < passes; n++) {
    const out: Pt[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      out[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
    pts = out;
  }
  return pts;
}

/** Corner cutting, then relaxing: a hex staircase becomes a smooth, organic outline. */
function softEdge(ring: Pt[]): Pt[] {
  return relax(smooth(ring, 2), RELAX_PASSES);
}

/** More passes make a rounder edge. Enough to remove a few cells' worth of staircase. */
const RELAX_PASSES = 60;

/**
 * The outline of the cleared ground as closed loops. Only the sides of cleared cells that touch fog are used, then
 * chained end to end, so there are no seams between neighbouring cells. Cleared regions come out counter-clockwise;
 * fog "islands" (an uncleared cell surrounded by cleared ones) come out clockwise. Neighbouring hexes always share an
 * edge, so each boundary vertex has exactly one way out and chaining is unambiguous.
 */
export function boundaryLoops(cells: Iterable<string>): Pt[][] {
  const ids = new Set<string>();
  for (const id of cells) {
    const parsed = parseCellId(id);
    // Only the fog grid is drawn. Mixing grids would make overlapping shapes, which draw wrongly.
    if (parsed && parsed.sizeM === FOG_CELL_M) ids.add(id);
  }

  const next = new Map<string, { from: Pt; to: Pt; used: boolean }>();
  for (const id of ids) {
    const parsed = parseCellId(id)!;
    const corners = hexCorners(parsed.hex, parsed.sizeM).map((c): Pt => [c.longitudeDeg, c.latitudeDeg]);
    for (let i = 0; i < 6; i++) {
      const n = EDGE_NEIGHBOUR[i];
      if (ids.has(toCellId({ q: parsed.hex.q + n.q, r: parsed.hex.r + n.r }, parsed.sizeM))) continue;
      const from = corners[i];
      next.set(key(from), { from, to: corners[(i + 1) % 6], used: false });
    }
  }

  const loops: Pt[][] = [];
  for (const start of next.values()) {
    if (start.used) continue;
    const loop: Pt[] = [];
    let edge: { from: Pt; to: Pt; used: boolean } | undefined = start;
    while (edge && !edge.used) {
      edge.used = true;
      loop.push(edge.from);
      edge = next.get(key(edge.to));
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

const close = (ring: Pt[]): Pt[] => [...ring, ring[0]];
const reversed = (ring: Pt[]): Pt[] => [...ring].reverse();

/**
 * The fog: the whole world as a polygon with the cleared ground cut out, drawn as a dark veil over the map. Loops
 * nested inside one another alternate between "cleared" and "fog island", so each is placed in the right polygon.
 */
export function fogFeature(cells: Iterable<string>): GeoJSON.Feature<GeoJSON.MultiPolygon> {
  const loops = boundaryLoops(cells).map(softEdge);
  const areas = loops.map((l) => Math.abs(signedArea(l)));

  // For each loop, the smallest other loop that contains it.
  const parent = loops.map((loop, i) => {
    let best = -1;
    for (let j = 0; j < loops.length; j++) {
      if (j === i || areas[j] <= areas[i]) continue;
      if (contains(loops[j], loop[0]) && (best === -1 || areas[j] < areas[best])) best = j;
    }
    return best;
  });
  const depth = (i: number): number => (parent[i] === -1 ? 0 : 1 + depth(parent[i]));

  const world: Pt[][] = [WORLD];
  const polygons: Pt[][][] = [world];
  const islandPolygon = new Map<number, Pt[][]>();

  const order = loops.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  for (const i of order) {
    if (depth(i) % 2 === 0) {
      // Cleared ground: a hole in whatever fog contains it (the world, or an island).
      const hole = close(reversed(loops[i]));
      const container = parent[i] === -1 ? world : islandPolygon.get(parent[i]);
      container?.push(hole);
    } else {
      // Fog inside cleared ground: its own polygon.
      const poly: Pt[][] = [close(reversed(loops[i]))];
      islandPolygon.set(i, poly);
      polygons.push(poly);
    }
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
}

/** The edge between fog and cleared ground, smoothed, for the soft glow drawn along it. */
export function clearedBoundary(cells: Iterable<string>): GeoJSON.Feature<GeoJSON.MultiLineString> {
  const lines = boundaryLoops(cells).map((l) => close(softEdge(l)));
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}
