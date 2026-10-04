'use strict';
const { cellIdAt } = require('../public/hex.js');

const API = 'https://api.v2.sondehub.org';
const HOUR = 3600_000;

const DEFAULTS = {
  /** Subsidy per sonde chest, paid from the network budget. Small and clearly labelled. */
  rewardUsdc: 0.25,
  maxChestsPerDay: 6,
  /** A sonde whose last frame is this old and low counts as landed. */
  landedAfterMs: 15 * 60_000,
  maxAltitudeM: 3000,
  expiresAfterMs: 48 * HOUR,
};

/** Great-circle distance in metres. */
function distanceM(aLat, aLon, bLat, bLon) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Picks radiosondes that have probably landed: still low and descending when their signal was last decoded, and
 * quiet since. The last decoded position is the best public estimate of where one came down.
 */
function landedSondes(all, now, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const out = [];
  for (const [serial, frame] of Object.entries(all)) {
    const when = Date.parse(frame.datetime);
    if (!Number.isFinite(when) || !Number.isFinite(frame.lat) || !Number.isFinite(frame.lon)) continue;
    const frequencyMHz = frame.frequency ?? frame.tx_frequency;
    if (!(frequencyMHz >= 400 && frequencyMHz <= 406)) continue;
    const age = now - when;
    if (age < cfg.landedAfterMs || age > cfg.expiresAfterMs) continue;
    if (!(frame.alt <= cfg.maxAltitudeM) || !(frame.vel_v < 0)) continue;
    out.push({ serial, lat: frame.lat, lon: frame.lon, alt: frame.alt, frequencyHz: Math.round(frequencyMHz * 1e6), lastSeenMs: when, type: frame.type || 'sonde' });
  }
  return out;
}

/**
 * Turns newly landed sondes near a region into recovery chests. Each balloon is offered once, and the number of
 * new chests per day is capped so the subsidy stays small.
 * @param {{ lat: number, lon: number, radiusKm: number }} region
 */
async function syncSondes({ service, store, region, now = Date.now(), fetchImpl = fetch, options = {} }) {
  const cfg = { ...DEFAULTS, ...options };
  const url = `${API}/sondes?lat=${region.lat}&lon=${region.lon}&distance=${Math.round(region.radiusKm * 1000)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`SondeHub answered HTTP ${res.status}`);
  const all = await res.json();

  const created = [];
  let todays = store.q.sondeChestsSince.get(now - 24 * HOUR).n;
  for (const s of landedSondes(all, now, cfg)) {
    if (todays >= cfg.maxChestsPerDay) break;
    if (distanceM(region.lat, region.lon, s.lat, s.lon) > region.radiusKm * 1000) continue;
    if (store.q.getSondeChest.get(s.serial)) continue;
    const made = service.createBounty({
      title: `Landed ${s.type} balloon`,
      kind: 'sonde',
      cellId: cellIdAt(s.lat, s.lon),
      rewardUsdc: cfg.rewardUsdc,
      maxFills: 1,
      expiresMs: now + cfg.expiresAfterMs,
      requester: 'SondeHub community',
      spec: { serial: s.serial, frequencyHz: s.frequencyHz, lastSeenMs: s.lastSeenMs, radiusCells: 8, altitudeM: Math.round(s.alt) },
    });
    if (!made.ok) continue;
    store.q.insertSondeChest.run(s.serial, made.id, now);
    todays += 1;
    created.push({ serial: s.serial, bountyId: made.id });
  }
  return created;
}

module.exports = { landedSondes, syncSondes, DEFAULTS };
