import { chooseDownlink, clearAutoFrequencyCache, loadAutoFrequency, Observation } from './transmitters';

const NOW = Date.parse('2026-10-02T18:00:00Z');
const CANDIDATES = [137_100_000, 137_900_000];
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const obs = (frequencyHz: number, h: number, status = 'good'): Observation => ({ frequencyHz, status, start: hoursAgo(h) });

describe('chooseDownlink', () => {
  it('picks the frequency with the most recent good observations', () => {
    const result = chooseDownlink([obs(137_900_000, 1), obs(137_900_000, 5), obs(137_100_000, 2)], CANDIDATES, 137_100_000, NOW);
    expect(result.frequencyHz).toBe(137_900_000);
    expect(result.goodCount).toBe(2);
    expect(result.source).toBe('satnogs');
    expect(result.latestGoodAt).toBe(hoursAgo(1));
  });

  it('groups 137.9125 with 137.900', () => {
    const result = chooseDownlink([obs(137_912_500, 1), obs(137_900_000, 2)], CANDIDATES, 137_100_000, NOW);
    expect(result.frequencyHz).toBe(137_900_000);
    expect(result.goodCount).toBe(2);
  });

  it('ignores bad, future and stale observations', () => {
    const result = chooseDownlink(
      [obs(137_100_000, 1, 'bad'), obs(137_100_000, 1, 'future'), obs(137_100_000, 100), obs(137_900_000, -3)],
      CANDIDATES,
      137_900_000,
      NOW
    );
    expect(result.source).toBe('default');
    expect(result.goodCount).toBe(0);
    expect(result.frequencyHz).toBe(137_900_000);
  });

  it('breaks ties toward the more recent evidence', () => {
    const result = chooseDownlink([obs(137_100_000, 1), obs(137_900_000, 6)], CANDIDATES, 137_900_000, NOW);
    expect(result.frequencyHz).toBe(137_100_000);
  });

  it('ignores frequencies that are not LRPT candidates', () => {
    const result = chooseDownlink([obs(435_600_000, 1), obs(1_700_000_000, 1)], CANDIDATES, 137_900_000, NOW);
    expect(result.source).toBe('default');
  });

  it('returns the fallback when there are no observations', () => {
    expect(chooseDownlink([], CANDIDATES, 137_900_000, NOW).frequencyHz).toBe(137_900_000);
  });
});

describe('loadAutoFrequency', () => {
  beforeEach(() => clearAutoFrequencyCache('59051'));

  it('fetches, chooses and caches', async () => {
    const fetcher = jest.fn(async () => [obs(137_900_000, 1), obs(137_900_000, 2)]);
    const result = await loadAutoFrequency('59051', CANDIDATES, 137_100_000, { fetcher, now: () => NOW });
    expect(result.frequencyHz).toBe(137_900_000);
    const again = await loadAutoFrequency('59051', CANDIDATES, 137_100_000, { fetcher, now: () => NOW + 3600_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.frequencyHz).toBe(137_900_000);
  });

  it('refetches once the cache is old or when forced', async () => {
    const fetcher = jest.fn(async () => [obs(137_900_000, 1)]);
    await loadAutoFrequency('59051', CANDIDATES, 137_900_000, { fetcher, now: () => NOW });
    await loadAutoFrequency('59051', CANDIDATES, 137_900_000, { fetcher, now: () => NOW + 7 * 3600_000 });
    await loadAutoFrequency('59051', CANDIDATES, 137_900_000, { fetcher, now: () => NOW + 7 * 3600_000, force: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps the last known answer when the network fails', async () => {
    await loadAutoFrequency('59051', CANDIDATES, 137_100_000, { fetcher: async () => [obs(137_900_000, 1)], now: () => NOW });
    const failing = async () => {
      throw new Error('offline');
    };
    const result = await loadAutoFrequency('59051', CANDIDATES, 137_100_000, { fetcher: failing, now: () => NOW + 24 * 3600_000 });
    expect(result.frequencyHz).toBe(137_900_000);
  });

  it('falls back to the default when there is no cache and no network', async () => {
    const failing = async () => {
      throw new Error('offline');
    };
    const result = await loadAutoFrequency('59051', CANDIDATES, 137_900_000, { fetcher: failing, now: () => NOW });
    expect(result.frequencyHz).toBe(137_900_000);
    expect(result.source).toBe('default');
  });
});
