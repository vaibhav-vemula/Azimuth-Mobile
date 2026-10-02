import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV({ id: 'azimuth-transmitters' });

export interface Observation {
  frequencyHz: number;
  status: string;
  start: string;
}

export interface AutoFrequency {
  frequencyHz: number;
  /** Recent vetted-good observations at the chosen frequency. */
  goodCount: number;
  latestGoodAt: string | null;
  fetchedAt: string;
  source: 'satnogs' | 'default';
}

const CANDIDATE_TOLERANCE_HZ = 25_000; // groups 137.9125 with 137.900
const LOOKBACK_MS = 72 * 3600_000;
const MAX_AGE_MS = 6 * 3600_000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Picks the downlink with the most recent "good" SatNOGS observations. SatNOGS vets an observation as good
 * when a signal is visible in the waterfall, so the frequency that keeps getting good observations is the one
 * the satellite is actually using. With no evidence the fallback is returned.
 */
export function chooseDownlink(
  observations: Observation[],
  candidatesHz: readonly number[],
  fallbackHz: number,
  nowMs = Date.now()
): Omit<AutoFrequency, 'fetchedAt'> {
  const tally = new Map<number, { count: number; latest: number }>();

  for (const observation of observations) {
    if (observation.status !== 'good') continue;
    const startMs = Date.parse(observation.start);
    if (!Number.isFinite(startMs) || nowMs - startMs > LOOKBACK_MS || startMs > nowMs) continue;
    const match = candidatesHz.find((c) => Math.abs(c - observation.frequencyHz) <= CANDIDATE_TOLERANCE_HZ);
    if (match === undefined) continue;
    const entry = tally.get(match) ?? { count: 0, latest: 0 };
    entry.count += 1;
    entry.latest = Math.max(entry.latest, startMs);
    tally.set(match, entry);
  }

  let best: { frequencyHz: number; count: number; latest: number } | null = null;
  for (const [frequencyHz, entry] of tally) {
    if (!best || entry.count > best.count || (entry.count === best.count && entry.latest > best.latest)) {
      best = { frequencyHz, ...entry };
    }
  }

  if (!best) return { frequencyHz: fallbackHz, goodCount: 0, latestGoodAt: null, source: 'default' };
  return {
    frequencyHz: best.frequencyHz,
    goodCount: best.count,
    latestGoodAt: new Date(best.latest).toISOString(),
    source: 'satnogs',
  };
}

export type ObservationFetcher = (noradId: string, signal: AbortSignal) => Promise<Observation[]>;

export const fetchSatnogsObservations: ObservationFetcher = async (noradId, signal) => {
  const url = `https://network.satnogs.org/api/observations/?norad_cat_id=${encodeURIComponent(noradId)}&status=good&format=json`;
  const response = await fetch(url, { signal, headers: { 'User-Agent': 'AzimuthApp/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const rows = (await response.json()) as {
    transmitter_downlink_low: number | null;
    status: string;
    start: string;
    norad_cat_id?: number;
  }[];
  return rows
    .filter((r) => typeof r.transmitter_downlink_low === 'number' && String(r.norad_cat_id ?? noradId) === noradId)
    .map((r) => ({ frequencyHz: r.transmitter_downlink_low as number, status: r.status, start: r.start }));
};

function readCache(noradId: string): AutoFrequency | null {
  const raw = storage.getString(noradId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AutoFrequency;
  } catch {
    return null;
  }
}

/**
 * The automatically chosen downlink for a satellite: a recent cached answer, else fresh from SatNOGS, else the
 * last cached answer, else the fallback. Never throws.
 */
export async function loadAutoFrequency(
  noradId: string,
  candidatesHz: readonly number[],
  fallbackHz: number,
  options: { force?: boolean; fetcher?: ObservationFetcher; now?: () => number } = {}
): Promise<AutoFrequency> {
  const now = options.now ?? Date.now;
  const cached = readCache(noradId);
  if (cached && !options.force && now() - Date.parse(cached.fetchedAt) < MAX_AGE_MS) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const observations = await (options.fetcher ?? fetchSatnogsObservations)(noradId, controller.signal);
    const chosen = chooseDownlink(observations, candidatesHz, cached?.frequencyHz ?? fallbackHz, now());
    const result: AutoFrequency = { ...chosen, fetchedAt: new Date(now()).toISOString() };
    storage.set(noradId, JSON.stringify(result));
    return result;
  } catch {
    return cached ?? { frequencyHz: fallbackHz, goodCount: 0, latestGoodAt: null, fetchedAt: new Date(now()).toISOString(), source: 'default' };
  } finally {
    clearTimeout(timer);
  }
}

export function clearAutoFrequencyCache(noradId: string): void {
  storage.remove(noradId);
}
