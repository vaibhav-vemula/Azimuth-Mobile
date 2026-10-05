/**
 * Finding internet radio stations by the frequency they broadcast on. Uses the community Radio Browser directory
 * (https://www.radio-browser.info), which is free and needs no account. It lists stations by name, and most FM stations put
 * their frequency in the name ("WTOP 103.5 FM"), so tuning to 103.5 searches for names with 103.5 in them and keeps only
 * the ones that really contain that number.
 */
export interface Station {
  id: string;
  name: string;
  /** The address of the audio stream. */
  url: string;
  country: string;
  countryCode: string;
  bitrate: number;
  codec: string;
  votes: number;
  tags: string;
  /** The state or region the station says it is in. */
  state: string;
  /** Where the transmitter or studio is, when the directory knows. */
  lat: number | null;
  lon: number | null;
}

export interface Here {
  latitudeDeg: number;
  longitudeDeg: number;
}

export const FM_MIN_MHZ = 87.5;
export const FM_MAX_MHZ = 108.0;

const SERVERS = ['https://de1.api.radio-browser.info', 'https://fr1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];
const TIMEOUT_MS = 10_000;

/** "103.5" for a frequency in MHz, to one decimal place. */
export function formatMHz(mhz: number): string {
  return (Math.round(mhz * 10) / 10).toFixed(1);
}

/** Keeps a frequency on the FM band and on the 0.1 MHz grid. */
export function clampFm(mhz: number): number {
  if (!Number.isFinite(mhz)) return FM_MIN_MHZ;
  return Math.round(Math.min(FM_MAX_MHZ, Math.max(FM_MIN_MHZ, mhz)) * 10) / 10;
}

/** Whether a station name mentions this frequency, as "103.5" or "103,5" (and "98" or "98.0" for a whole number). */
export function nameHasFrequency(name: string, mhz: number): boolean {
  if (!(mhz >= FM_MIN_MHZ && mhz <= FM_MAX_MHZ)) return false;
  const [whole, tenth] = formatMHz(mhz).split('.');
  const decimal = `${whole}[.,]${tenth}(?![0-9])`;
  // A whole-number frequency is often written without the ".0" ("Mix 98 FM"), but "98.5" is another station.
  const pattern = tenth === '0' ? `(?:${decimal}|${whole}(?![.,]?[0-9]))` : decimal;
  return new RegExp(`(?<![0-9.,])${pattern}`).test(name);
}

interface Row {
  stationuuid?: string;
  name?: string;
  url_resolved?: string;
  url?: string;
  country?: string;
  countrycode?: string;
  bitrate?: number;
  codec?: string;
  votes?: number;
  tags?: string;
  state?: string;
  geo_lat?: number | null;
  geo_long?: number | null;
  lastcheckok?: number;
}

export function stationFromRow(row: Row): Station | null {
  const url = row.url_resolved || row.url;
  if (!row.stationuuid || !row.name || !url || !/^https?:\/\//i.test(url) || row.lastcheckok === 0) return null;
  return {
    id: row.stationuuid,
    name: row.name.trim(),
    url,
    country: row.country ?? '',
    countryCode: (row.countrycode ?? '').toUpperCase(),
    bitrate: Number(row.bitrate) || 0,
    codec: row.codec ?? '',
    votes: Number(row.votes) || 0,
    tags: row.tags ?? '',
    state: row.state ?? '',
    lat: typeof row.geo_lat === 'number' && Math.abs(row.geo_lat) <= 90 ? row.geo_lat : null,
    lon: typeof row.geo_long === 'number' && Math.abs(row.geo_long) <= 180 ? row.geo_long : null,
  };
}

/** Great-circle distance from a place to a station, in kilometres, or null if the station has no position. */
export function distanceKm(station: Station, here: Here): number | null {
  if (station.lat === null || station.lon === null) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(station.lat - here.latitudeDeg);
  const dLon = rad(station.lon - here.longitudeDeg);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(here.latitudeDeg)) * Math.cos(rad(station.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Best first. With a position: stations whose position is known come first, nearest first (a 103.5 in your own city beats
 * a 103.5 two states away). Then stations from your own country, then the most voted for, then the clearest stream.
 */
export function rankStations(stations: Station[], countryCode: string | null, here: Here | null = null): Station[] {
  const home = countryCode?.toUpperCase() ?? null;
  const dist = new Map<string, number | null>();
  if (here) for (const s of stations) dist.set(s.id, distanceKm(s, here));
  return [...stations].sort((a, b) => {
    if (here) {
      const da = dist.get(a.id) ?? null;
      const db = dist.get(b.id) ?? null;
      if (da !== null && db !== null && Math.abs(da - db) > 1) return da - db;
      if ((da === null) !== (db === null)) return da === null ? 1 : -1;
    }
    const ha = home && a.countryCode === home ? 1 : 0;
    const hb = home && b.countryCode === home ? 1 : 0;
    if (ha !== hb) return hb - ha;
    if (a.votes !== b.votes) return b.votes - a.votes;
    return b.bitrate - a.bitrate;
  });
}

type FetchFn = typeof fetch;

async function query(path: string, fetchImpl: FetchFn): Promise<Row[]> {
  let lastError: unknown = null;
  for (const server of SERVERS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${server}${path}`, { headers: { 'user-agent': 'Azimuth/1.0', accept: 'application/json' }, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      if (Array.isArray(json)) return json as Row[];
      throw new Error('Unexpected answer');
    } catch (e) {
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Could not reach the station directory${lastError instanceof Error ? ` (${lastError.message})` : ''}. Check your connection.`);
}

const SEARCH = '/json/stations/search?hidebroken=true&order=votes&reverse=true&limit=80';

export interface SearchOptions {
  /** The listener's country (two letters), so local stations come first. */
  countryCode?: string | null;
  /** The listener's position, so the nearest stations come first. */
  here?: Here | null;
  fetchImpl?: FetchFn;
}

/**
 * Stations whose name mentions this FM frequency, best first. With a country, only that country's stations are returned
 * (FM frequencies are reused from country to country, so a 98.7 in another country is not the one you can tune here).
 */
export async function searchByFrequency(mhz: number, { countryCode = null, here = null, fetchImpl = fetch }: SearchOptions = {}): Promise<Station[]> {
  const country = countryCode ? `&countrycode=${encodeURIComponent(countryCode.toUpperCase())}` : '';
  const rows = await query(`${SEARCH}&name=${encodeURIComponent(formatMHz(mhz))}${country}`, fetchImpl);
  const home = countryCode?.toUpperCase() ?? null;
  const stations = rows
    .map(stationFromRow)
    .filter((s): s is Station => s !== null && nameHasFrequency(s.name, mhz) && (!home || s.countryCode === home));
  return rankStations(dedupe(stations), countryCode, here);
}

/** Stations matching a name or word, best first. With a country, only that country's stations. */
export async function searchByName(text: string, { countryCode = null, here = null, fetchImpl = fetch }: SearchOptions = {}): Promise<Station[]> {
  const term = text.trim();
  if (term.length < 2) return [];
  const country = countryCode ? `&countrycode=${encodeURIComponent(countryCode.toUpperCase())}` : '';
  const rows = await query(`${SEARCH}&name=${encodeURIComponent(term)}${country}`, fetchImpl);
  const home = countryCode?.toUpperCase() ?? null;
  const stations = rows.map(stationFromRow).filter((s): s is Station => s !== null && (!home || s.countryCode === home));
  return rankStations(dedupe(stations), countryCode, here);
}

/** The same stream listed twice (different names for one address) is shown once. */
function dedupe(stations: Station[]): Station[] {
  const seen = new Set<string>();
  return stations.filter((s) => {
    const key = s.url.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** How far "near me" reaches. FM carries roughly this far from a transmitter. */
export const NEARBY_KM = 120;

/**
 * Stations around a place, nearest first, whatever their frequency. The directory cannot be asked "within X km", so the
 * stations that have a position are fetched for the country and the near ones kept.
 */
export async function searchNearby(here: Here, { countryCode = null, fetchImpl = fetch, radiusKm = NEARBY_KM }: SearchOptions & { radiusKm?: number } = {}): Promise<Station[]> {
  const country = countryCode ? `&countrycode=${encodeURIComponent(countryCode.toUpperCase())}` : '';
  const rows = await query(`/json/stations/search?hidebroken=true&has_geo_info=true&order=votes&reverse=true&limit=1500${country}`, fetchImpl);
  const stations = dedupe(rows.map(stationFromRow).filter((s): s is Station => s !== null));
  return stations
    .map((s) => ({ s, d: distanceKm(s, here) }))
    .filter((x): x is { s: Station; d: number } => x.d !== null && x.d <= radiusKm)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.s);
}
