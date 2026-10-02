import { TleRecord } from '../../types/satellite';
import { parseTleText } from './parseTle';
import { TleCache } from './tleCache';

const FRESH_MS = 1000 * 60 * 60 * 12; // refetch twice a day
const STALE_WARNING_MS = 1000 * 60 * 60 * 24 * 5; // orbit error grows noticeably past ~5 days
const REQUEST_TIMEOUT_MS = 15_000;

export interface TleResult {
  record: TleRecord;
  fetchedAt: Date;
  source: string;
  /** True when a network refresh failed and an old cached element set is being used. */
  stale: boolean;
  /** True when the element set is old enough that pass times may be off by more than a few seconds. */
  outdated: boolean;
}

export type TleSource = {
  name: string;
  fetch: (noradId: string, signal: AbortSignal) => Promise<TleRecord>;
};

async function fetchText(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal, headers: { 'User-Agent': 'AzimuthApp/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

export const celestrakSource: TleSource = {
  name: 'CelesTrak',
  async fetch(noradId, signal) {
    const response = await fetchText(
      `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(noradId)}&FORMAT=tle`,
      signal
    );
    const records = parseTleText(await response.text());
    const match = records.find((r) => r.noradId === noradId);
    if (!match) throw new Error('CelesTrak returned no element set');
    return match;
  },
};

export const satnogsSource: TleSource = {
  name: 'SatNOGS',
  async fetch(noradId, signal) {
    const response = await fetchText(
      `https://db.satnogs.org/api/tle/?norad_cat_id=${encodeURIComponent(noradId)}&format=json`,
      signal
    );
    const rows = (await response.json()) as { tle0: string; tle1: string; tle2: string }[];
    const row = rows[0];
    if (!row) throw new Error('SatNOGS returned no element set');
    const record = parseTleText(`${row.tle0.replace(/^0 /, '')}\n${row.tle1}\n${row.tle2}`)[0];
    if (!record || record.noradId !== noradId) throw new Error('SatNOGS element set did not parse');
    return record;
  },
};

const DEFAULT_SOURCES: TleSource[] = [celestrakSource, satnogsSource];

async function fetchWithTimeout(source: TleSource, noradId: string): Promise<TleRecord> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await source.fetch(noradId, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the freshest element set available: a recent cache hit, else the first source that
 * answers, else whatever is cached (flagged stale). Throws only when nothing at all is available.
 */
export async function loadTle(
  noradId: string,
  options: { sources?: TleSource[]; force?: boolean; now?: () => number } = {}
): Promise<TleResult> {
  const sources = options.sources ?? DEFAULT_SOURCES;
  const now = options.now ?? Date.now;
  const cached = TleCache.get(noradId);
  const age = cached ? now() - cached.fetchedAt.getTime() : Infinity;

  if (cached && age < FRESH_MS && !options.force) {
    return { ...cached, stale: false, outdated: age > STALE_WARNING_MS };
  }

  const failures: string[] = [];
  for (const source of sources) {
    try {
      const record = await fetchWithTimeout(source, noradId);
      TleCache.set(noradId, record, source.name);
      return { record, fetchedAt: new Date(now()), source: source.name, stale: false, outdated: false };
    } catch (error) {
      failures.push(`${source.name}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  if (cached) {
    return { ...cached, stale: true, outdated: age > STALE_WARNING_MS };
  }
  throw new Error(`Could not load orbital data (${failures.join('; ')})`);
}
