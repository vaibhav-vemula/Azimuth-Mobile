import { cellIdAt } from '../mapping/hexGrid';
import type { LatLon } from '../mapping/hexGrid';
import type { Chest } from './api';

/** AZM paid for each treasure chest, once per chest slot per day. The server pays it; see server/supabase/schema_treasure.sql. */
export const TREASURE_AZM = 5;
/** How far the two outer chests sit from the one at your feet, in metres. */
export const TREASURE_SPREAD_M = 200;
export const TREASURE_SLOTS = [1, 2, 3] as const;

const M_PER_DEG_LAT = 111_320;
/** The point `metres` away from `from`, on a compass bearing (degrees clockwise from north). */
export function offsetByMetres(from: LatLon, metres: number, bearingDeg: number): LatLon {
  const b = (bearingDeg * Math.PI) / 180;
  return {
    latitudeDeg: from.latitudeDeg + (metres * Math.cos(b)) / M_PER_DEG_LAT,
    longitudeDeg: from.longitudeDeg + (metres * Math.sin(b)) / (M_PER_DEG_LAT * Math.cos((from.latitudeDeg * Math.PI) / 180)),
  };
}

/** The server's challenge id for a chest slot. */
export const treasureChallengeId = (slot: number) => `treasure-${slot}`;

/**
 * Three chests dropped at once: one where you stand, and two about 200 m away in different directions (roughly opposite
 * each other, so neither is behind the other).
 */
export function buildTreasureChests(position: LatLon, facingDeg: number | null, now = Date.now(), startBearingDeg = Math.random() * 360): Chest[] {
  const spots: LatLon[] = [
    { latitudeDeg: position.latitudeDeg, longitudeDeg: position.longitudeDeg },
    offsetByMetres(position, TREASURE_SPREAD_M, startBearingDeg),
    offsetByMetres(position, TREASURE_SPREAD_M, startBearingDeg + 140),
  ];
  return spots.map((at, i) => {
    const slot = TREASURE_SLOTS[i];
    return {
      id: `treasure-${slot}-${now}`,
      title: 'Treasure chest',
      kind: 'visit',
      cellId: cellIdAt(at),
      rewardUsdc: 0,
      remaining: 1,
      expiresMs: now + 2 * 3_600_000,
      requester: 'Azimuth',
      requires: 'phone',
      // `test` marks a chest that lives only on this phone. `treasure` is its slot, which decides what the server pays.
      // The one at your feet also remembers which way you faced, since GPS cannot tell which way a point under you lies.
      spec: { minSamples: 1, lat: at.latitudeDeg, lon: at.longitudeDeg, test: true, treasure: slot, ...(i === 0 && facingDeg !== null ? { facingDeg } : {}) },
    };
  });
}
