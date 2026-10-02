import { loadTle, TleSource } from './fetchTle';
import { TleCache } from './tleCache';
import { TleRecord } from '../../types/satellite';

const record = (suffix: string): TleRecord => ({
  noradId: '59051',
  name: 'METEOR-M2 4',
  line1: `1 59051U 24039A   26275.31389677  .00000003  00000+0  20956-4 0  999${suffix}`,
  line2: '2 59051  98.7159 233.3284 0006296 213.1613 146.9171 14.22438822134492',
});

function source(name: string, behaviour: () => Promise<TleRecord>): TleSource & { calls: number } {
  const s = {
    name,
    calls: 0,
    fetch: async () => {
      s.calls += 1;
      return behaviour();
    },
  };
  return s;
}

const HOUR = 3600_000;

describe('loadTle', () => {
  beforeEach(() => TleCache.clear('59051'));

  it('fetches from the first source and caches the result', async () => {
    const primary = source('Primary', async () => record('2'));
    const result = await loadTle('59051', { sources: [primary] });
    expect(result.source).toBe('Primary');
    expect(result.stale).toBe(false);
    expect(TleCache.get('59051')?.record.line1).toContain('9992');
  });

  it('uses a fresh cache without touching the network', async () => {
    const primary = source('Primary', async () => record('2'));
    await loadTle('59051', { sources: [primary] });
    const again = await loadTle('59051', { sources: [primary] });
    expect(primary.calls).toBe(1);
    expect(again.stale).toBe(false);
  });

  it('refreshes when forced even if the cache is fresh', async () => {
    const primary = source('Primary', async () => record('2'));
    await loadTle('59051', { sources: [primary] });
    await loadTle('59051', { sources: [primary], force: true });
    expect(primary.calls).toBe(2);
  });

  it('falls back to the next source when the first fails', async () => {
    const broken = source('Broken', async () => {
      throw new Error('HTTP 500');
    });
    const backup = source('Backup', async () => record('3'));
    const result = await loadTle('59051', { sources: [broken, backup] });
    expect(result.source).toBe('Backup');
    expect(broken.calls).toBe(1);
    expect(backup.calls).toBe(1);
  });

  it('serves an old cached copy, flagged stale, when every source fails', async () => {
    const good = source('Good', async () => record('2'));
    const start = Date.now();
    await loadTle('59051', { sources: [good], now: () => start });
    const failing = source('Down', async () => {
      throw new Error('offline');
    });
    const result = await loadTle('59051', { sources: [failing], now: () => start + 20 * HOUR });
    expect(result.stale).toBe(true);
    expect(result.outdated).toBe(false);
    expect(failing.calls).toBe(1);
  });

  it('marks very old cached data as outdated', async () => {
    const good = source('Good', async () => record('2'));
    const start = Date.now();
    await loadTle('59051', { sources: [good], now: () => start });
    const failing = source('Down', async () => {
      throw new Error('offline');
    });
    const result = await loadTle('59051', { sources: [failing], now: () => start + 7 * 24 * HOUR });
    expect(result.stale).toBe(true);
    expect(result.outdated).toBe(true);
  });

  it('throws a helpful error when nothing is available at all', async () => {
    const failing = source('Down', async () => {
      throw new Error('offline');
    });
    await expect(loadTle('59051', { sources: [failing] })).rejects.toThrow(/Down: offline/);
  });
});
