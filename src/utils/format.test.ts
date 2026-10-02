import { compactUtc, compassPoint, formatBytes, formatCountdown, formatDay, formatDuration, formatFrequencyMHz } from './format';

describe('format', () => {
  it('formats countdowns at every scale', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5000)).toBe('00:00');
    expect(formatCountdown(65_000)).toBe('01:05');
    expect(formatCountdown(3_725_000)).toBe('1h 02m 05s');
    expect(formatCountdown(2 * 86400_000 + 3 * 3600_000 + 4 * 60_000)).toBe('2d 3h 04m');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(605)).toBe('10:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(350 * 1024 * 1024)).toBe('350 MB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.50 GB');
    expect(formatBytes(-1)).toBe('0 B');
  });

  it('formats frequencies in MHz', () => {
    expect(formatFrequencyMHz(137_900_000)).toBe('137.900');
    expect(formatFrequencyMHz(137_100_000, 1)).toBe('137.1');
  });

  it('maps azimuths to compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(225)).toBe('SW');
    expect(compassPoint(-90)).toBe('W');
  });

  it('labels days relative to now', () => {
    const now = new Date(2026, 9, 2, 12);
    expect(formatDay(new Date(2026, 9, 2, 23), now)).toBe('Today');
    expect(formatDay(new Date(2026, 9, 3, 1), now)).toBe('Tomorrow');
    expect(formatDay(new Date(2026, 9, 1, 1), now)).toBe('Yesterday');
  });

  it('builds file-name safe UTC stamps', () => {
    expect(compactUtc(new Date('2026-10-02T15:42:00.123Z'))).toBe('20261002T154200Z');
  });
});
