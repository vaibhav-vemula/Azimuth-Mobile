/**
 * A pointy-top axial hex grid laid over Web Mercator. Cells have a fixed size in projected metres, so their
 * true ground size shrinks with cos(latitude) (about 0.78x at Washington, DC). That is fine for a coverage
 * map: the grid is only a bucketing scheme, and the resolution is stored with every cell id.
 */
const EARTH_RADIUS_M = 6378137;
const MAX_LAT = 85.0511;

export const DEFAULT_CELL_SIZE_M = 120;

export interface LatLon {
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface Hex {
  q: number;
  r: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function project({ latitudeDeg, longitudeDeg }: LatLon): { x: number; y: number } {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, latitudeDeg));
  return {
    x: EARTH_RADIUS_M * toRad(longitudeDeg),
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2)),
  };
}

export function unproject(x: number, y: number): LatLon {
  return {
    longitudeDeg: toDeg(x / EARTH_RADIUS_M),
    latitudeDeg: toDeg(2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2),
  };
}

function roundHex(qf: number, rf: number): Hex {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r: r === 0 ? 0 : r };
}

export function hexAt(point: LatLon, sizeM = DEFAULT_CELL_SIZE_M): Hex {
  const { x, y } = project(point);
  const qf = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / sizeM;
  const rf = ((2 / 3) * y) / sizeM;
  const hex = roundHex(qf, rf);
  return { q: hex.q === 0 ? 0 : hex.q, r: hex.r };
}

export function hexCenter(hex: Hex, sizeM = DEFAULT_CELL_SIZE_M): LatLon {
  const x = sizeM * Math.sqrt(3) * (hex.q + hex.r / 2);
  const y = sizeM * 1.5 * hex.r;
  return unproject(x, y);
}

/** Six corners, for drawing. */
export function hexCorners(hex: Hex, sizeM = DEFAULT_CELL_SIZE_M): LatLon[] {
  const cx = sizeM * Math.sqrt(3) * (hex.q + hex.r / 2);
  const cy = sizeM * 1.5 * hex.r;
  const corners: LatLon[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = toRad(60 * i - 30);
    corners.push(unproject(cx + sizeM * Math.cos(angle), cy + sizeM * Math.sin(angle)));
  }
  return corners;
}

const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighbors(hex: Hex): Hex[] {
  return DIRECTIONS.map((d) => ({ q: hex.q + d.q, r: hex.r + d.r }));
}

/** All cells within `radius` steps of `hex`, including it. */
export function hexDisk(hex: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push({ q: hex.q + dq, r: hex.r + dr });
    }
  }
  return out;
}

export function cellId(hex: Hex, sizeM = DEFAULT_CELL_SIZE_M): string {
  return `h${sizeM}:${hex.q}:${hex.r}`;
}

export function parseCellId(id: string): { hex: Hex; sizeM: number } | null {
  const m = /^h(\d+):(-?\d+):(-?\d+)$/.exec(id);
  if (!m) return null;
  return { sizeM: Number(m[1]), hex: { q: Number(m[2]), r: Number(m[3]) } };
}

export function cellIdAt(point: LatLon, sizeM = DEFAULT_CELL_SIZE_M): string {
  return cellId(hexAt(point, sizeM), sizeM);
}

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.latitudeDeg - a.latitudeDeg);
  const dLon = toRad(b.longitudeDeg - a.longitudeDeg);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitudeDeg)) * Math.cos(toRad(b.latitudeDeg)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Number of hex steps between two cells. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
