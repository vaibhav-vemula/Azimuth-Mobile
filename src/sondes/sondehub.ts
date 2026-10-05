import { bearingDeg } from '../mapping/geo';
import { distanceM } from '../mapping/hexGrid';
import type { LatLon } from '../mapping/hexGrid';

/**
 * Weather balloons (radiosondes) from the community SondeHub tracker (https://sondehub.org), which collects the signals that
 * hobbyists decode. A balloon climbs for about two hours, bursts, and the small radio under a parachute comes down to
 * the ground, where anyone who gets there first can pick it up. This finds the ones near you.
 */
const API = 'https://api.v2.sondehub.org';
const TIMEOUT_MS = 15_000;

export type SondeStatus = 'ascending' | 'descending' | 'landed' | 'lost';

export interface Sonde {
  serial: string;
  /** The model, for example RS41 or DFM-17. */
  type: string;
  lat: number;
  lon: number;
  altM: number;
  /** Vertical speed: positive going up, negative coming down, metres per second. */
  climbMps: number;
  speedMps: number;
  /** The direction it is travelling, degrees clockwise from north, when known. */
  headingDeg: number | null;
  frequencyMHz: number | null;
  lastSeenMs: number;
  status: SondeStatus;
}

/** A frame (one decoded packet) as SondeHub sends it. Only the fields used here. */
interface Frame {
  serial?: string;
  type?: string;
  datetime?: string;
  lat?: number;
  lon?: number;
  alt?: number;
  vel_v?: number;
  vel_h?: number;
  heading?: number;
  frequency?: number;
  tx_frequency?: number;
}

/** A packet this recent means it is still transmitting. */
export const LIVE_WITHIN_MS = 10 * 60_000;
/** Below this height with no signal, the sonde is on the ground, or very nearly. */
export const LANDED_BELOW_M = 3000;
/** Sondes older than this are not worth a trip: the battery is flat and someone has probably found it. */
export const FORGET_AFTER_MS = 72 * 3600_000;

export function classify(frame: { altM: number; climbMps: number; lastSeenMs: number }, now: number): SondeStatus {
  const age = now - frame.lastSeenMs;
  if (age <= LIVE_WITHIN_MS) return frame.climbMps >= 0.5 ? 'ascending' : 'descending';
  // Silent for a while: if it was low and coming down, it landed where it was last heard.
  return frame.altM <= LANDED_BELOW_M && frame.climbMps < 0 ? 'landed' : 'lost';
}

export function parseSondes(all: unknown, now = Date.now()): Sonde[] {
  if (typeof all !== 'object' || all === null || Array.isArray(all)) return [];
  const out: Sonde[] = [];
  for (const [key, raw] of Object.entries(all as Record<string, Frame>)) {
    if (!raw || typeof raw !== 'object') continue;
    const when = Date.parse(raw.datetime ?? '');
    if (!Number.isFinite(when) || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) continue;
    if (now - when > FORGET_AFTER_MS) continue;
    const frequency = raw.frequency ?? raw.tx_frequency;
    const frame = { altM: Number(raw.alt), climbMps: Number(raw.vel_v), lastSeenMs: when };
    if (!Number.isFinite(frame.altM)) continue;
    if (!Number.isFinite(frame.climbMps)) frame.climbMps = 0;
    out.push({
      serial: raw.serial ?? key,
      type: raw.type ?? 'sonde',
      lat: raw.lat as number,
      lon: raw.lon as number,
      altM: frame.altM,
      climbMps: frame.climbMps,
      speedMps: Number.isFinite(raw.vel_h) ? (raw.vel_h as number) : 0,
      headingDeg: Number.isFinite(raw.heading) ? (((raw.heading as number) % 360) + 360) % 360 : null,
      frequencyMHz: typeof frequency === 'number' && Number.isFinite(frequency) ? frequency : null,
      lastSeenMs: when,
      status: classify(frame, now),
    });
  }
  return out;
}

const RANK: Record<SondeStatus, number> = { landed: 0, descending: 1, ascending: 2, lost: 3 };

/** The ones worth going for first: landed, then coming down, then climbing; the nearest first within each. */
export function sortForHunting(sondes: Sonde[], here: LatLon | null): Sonde[] {
  const away = (s: Sonde) => (here ? distanceM(here, { latitudeDeg: s.lat, longitudeDeg: s.lon }) : 0);
  return [...sondes].sort((a, b) => RANK[a.status] - RANK[b.status] || away(a) - away(b) || b.lastSeenMs - a.lastSeenMs);
}

/** Seconds until a descending sonde reaches the ground at its present rate, or null if it is not coming down. */
export function secondsToGround(s: Pick<Sonde, 'altM' | 'climbMps' | 'status'>, groundM = 0): number | null {
  if (s.status !== 'descending' || s.climbMps >= -0.5) return null;
  return Math.max(0, (s.altM - groundM) / -s.climbMps);
}

/**
 * Where a descending sonde will probably come down: its last position carried along its heading for the time it has
 * left. The wind changes with height, so this is a rough guess; the real answer is the last position once it lands.
 */
export function estimatedLanding(s: Sonde): LatLon | null {
  const t = secondsToGround(s);
  if (t === null || s.headingDeg === null || s.speedMps <= 0) return null;
  const metres = Math.min(s.speedMps * t, 150_000);
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = (metres * Math.cos(rad(s.headingDeg))) / 111_320;
  const dLon = (metres * Math.sin(rad(s.headingDeg))) / (111_320 * Math.cos(rad(s.lat)));
  return { latitudeDeg: s.lat + dLat, longitudeDeg: s.lon + dLon };
}

/** Where to head for: the estimated landing for a sonde still coming down, otherwise where it was last heard. */
export function target(s: Sonde): LatLon {
  return (s.status === 'descending' ? estimatedLanding(s) : null) ?? { latitudeDeg: s.lat, longitudeDeg: s.lon };
}

export function bearingTo(from: LatLon, s: Sonde): number {
  return bearingDeg(from, target(s));
}

export function distanceTo(from: LatLon, s: Sonde): number {
  return distanceM(from, target(s));
}

/** How long ago, in plain words: "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export const DEFAULT_RADIUS_KM = 300;

export async function fetchSondes(here: LatLon, { radiusKm = DEFAULT_RADIUS_KM, fetchImpl = fetch, now = Date.now() }: { radiusKm?: number; fetchImpl?: typeof fetch; now?: number } = {}): Promise<Sonde[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${API}/sondes?lat=${here.latitudeDeg.toFixed(4)}&lon=${here.longitudeDeg.toFixed(4)}&distance=${Math.round(radiusKm * 1000)}`;
    const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'Azimuth/1.0' }, signal: controller.signal });
    if (!res.ok) throw new Error(`SondeHub answered HTTP ${res.status}`);
    return sortForHunting(parseSondes(await res.json(), now), here);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('SondeHub took too long to answer.');
    if (e instanceof Error && /^SondeHub/.test(e.message)) throw e;
    throw new Error('Could not reach SondeHub. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
}
