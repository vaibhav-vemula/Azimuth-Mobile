jest.mock('../../modules/rtl-sdr', () => ({ MIN_FREQUENCY_HZ: 500_000, MAX_FREQUENCY_HZ: 1_766_000_000 }));

import { withTimeout } from './async';
import { createFrameGate } from './frameGate';
import { parseFrequencyMHz } from './frequencyInput';
import { SPECTRUM_BIN_COUNT, SPECTRUM_VIEW_WIDTH, buildBarsPath } from './spectrumPath';

describe('createFrameGate', () => {
  it('passes at most one frame per interval and recovers afterwards', () => {
    let now = 1000;
    const gate = createFrameGate(40, () => now);
    expect(gate()).toBe(true);
    now += 10;
    expect(gate()).toBe(false);
    now += 29;
    expect(gate()).toBe(false);
    now += 1;
    expect(gate()).toBe(true);
  });

  it('caps a 30 Hz stream to the requested rate', () => {
    let now = 0;
    const gate = createFrameGate(50, () => now);
    let passed = 0;
    for (let i = 0; i < 300; i += 1) {
      now += 33;
      if (gate()) passed += 1;
    }
    // 300 frames over ~9.9 s at 30 Hz, limited to 20 Hz -> about 100 pass (every other frame).
    expect(passed).toBeGreaterThanOrEqual(95);
    expect(passed).toBeLessThanOrEqual(150);
  });
});

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves normally when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'late')).resolves.toBe(42);
  });

  it('rejects with the message when the work never finishes', async () => {
    const pending = withTimeout(new Promise<never>(() => undefined), 1000, 'Stopping timed out');
    const assertion = expect(pending).rejects.toThrow('Stopping timed out');
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('passes through the work\'s own error', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'late')).rejects.toThrow('boom');
  });
});

describe('parseFrequencyMHz', () => {
  it('accepts normal input in several forms', () => {
    expect(parseFrequencyMHz('98.7')).toEqual({ ok: true, hz: 98_700_000 });
    expect(parseFrequencyMHz(' 103,5 ')).toEqual({ ok: true, hz: 103_500_000 });
    expect(parseFrequencyMHz('137.9125')).toEqual({ ok: true, hz: 137_912_500 });
    expect(parseFrequencyMHz('1')).toEqual({ ok: true, hz: 1_000_000 });
    expect(parseFrequencyMHz('.5')).toEqual({ ok: true, hz: 500_000 });
  });

  it('rejects empty, malformed and out-of-range input with a useful message', () => {
    for (const bad of ['', '   ', '.', 'abc', '98.7.1', '9e2', '-5']) {
      const result = parseFrequencyMHz(bad);
      expect(result.ok).toBe(false);
    }
    const high = parseFrequencyMHz('2000');
    expect(high.ok).toBe(false);
    expect(!high.ok && high.message).toContain('1766');
    expect(parseFrequencyMHz('0.1').ok).toBe(false);
  });
});

describe('buildBarsPath', () => {
  it('draws one bar per bin inside the drawing area', () => {
    const path = buildBarsPath(Array.from({ length: SPECTRUM_BIN_COUNT }, (_, i) => i / 63), 100);
    expect((path.match(/M/g) ?? []).length).toBe(SPECTRUM_BIN_COUNT);
    const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    for (const n of numbers) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(SPECTRUM_VIEW_WIDTH);
    }
  });

  it('survives bad values and missing bins', () => {
    const bad = buildBarsPath([NaN, Infinity, -3, 5, undefined as unknown as number], 100);
    expect(bad).not.toContain('NaN');
    expect((bad.match(/M/g) ?? []).length).toBe(SPECTRUM_BIN_COUNT);
    expect(buildBarsPath([], 100)).not.toContain('NaN');
  });

  it('makes taller bars for stronger bins and keeps a visible stub for silence', () => {
    expect(buildBarsPath([0], 100).startsWith('M1.0 100V98.5')).toBe(true); // 1.5 high
    expect(buildBarsPath([0.8], 100).startsWith('M1.0 100V20.0')).toBe(true); // 80 high
  });
});
