import { GAIN_LIMITS, GainSample, chooseGain, nextLowerGain, selectSweepGains, shouldReduceGain } from './autoGain';

const R828D = [0.0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28.0, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48.0, 49.6];

const sample = (gainDb: number, rms: number, clip = 0, verdict: GainSample['verdict'] = 'none', snrDb = 0): GainSample => ({ gainDb, rms, clip, verdict, snrDb });

describe('selectSweepGains', () => {
  it('stays inside the safe range and never offers the maximum gain', () => {
    const gains = selectSweepGains(R828D);
    expect(gains.length).toBeLessThanOrEqual(GAIN_LIMITS.sweepSteps);
    expect(gains.length).toBeGreaterThanOrEqual(5);
    for (const g of gains) {
      expect(g).toBeGreaterThanOrEqual(GAIN_LIMITS.minDb);
      expect(g).toBeLessThanOrEqual(GAIN_LIMITS.maxDb);
    }
    expect(gains).not.toContain(49.6);
    expect([...gains].sort((a, b) => a - b)).toEqual(gains);
  });

  it('spans the range, not just one end', () => {
    const gains = selectSweepGains(R828D);
    expect(gains[0]).toBeLessThan(24);
    expect(gains[gains.length - 1]).toBeGreaterThan(40);
  });

  it('keeps a short list as is and falls back when nothing is known', () => {
    expect(selectSweepGains([25.4, 33.8, 40.2])).toEqual([25.4, 33.8, 40.2]);
    expect(selectSweepGains([]).length).toBeGreaterThan(4);
    expect(selectSweepGains([0, 1, 2])).toEqual(selectSweepGains([]));
  });
});

describe('chooseGain', () => {
  it('picks the lowest gain that fills the converter when there is no signal yet', () => {
    const samples = [sample(20.7, 0.02), sample(25.4, 0.04), sample(29.7, 0.07), sample(33.8, 0.1), sample(37.2, 0.16), sample(40.2, 0.22)];
    expect(chooseGain(samples)).toEqual({ gainDb: 33.8, reason: 'noise-floor' });
  });

  it('never picks a setting that clips, even if it would otherwise look best', () => {
    const samples = [sample(25.4, 0.05), sample(33.8, 0.12), sample(40.2, 0.2, 0.02)];
    const choice = chooseGain(samples);
    expect(choice.gainDb).toBe(33.8);
  });

  it('avoids settings that leave too little headroom', () => {
    const samples = [sample(29.7, 0.08), sample(37.2, 0.3), sample(43.9, 0.45)];
    expect(chooseGain(samples).gainDb).toBe(29.7);
  });

  it('takes the highest safe gain in a very quiet environment', () => {
    const samples = [sample(20.7, 0.01), sample(29.7, 0.02), sample(37.2, 0.04), sample(43.9, 0.07)];
    expect(chooseGain(samples)).toEqual({ gainDb: 43.9, reason: 'quiet' });
  });

  it('falls back to the quietest setting when everything overloads', () => {
    const samples = [sample(20.7, 0.4, 0.05), sample(29.7, 0.6, 0.2), sample(37.2, 0.8, 0.4)];
    expect(chooseGain(samples)).toEqual({ gainDb: 20.7, reason: 'overload' });
  });

  it('prefers the gain with the best LRPT signal when one is visible', () => {
    const samples = [
      sample(25.4, 0.05, 0, 'lrpt', 5.0),
      sample(33.8, 0.11, 0, 'lrpt', 9.5),
      sample(40.2, 0.2, 0, 'lrpt', 6.0),
    ];
    expect(chooseGain(samples)).toEqual({ gainDb: 33.8, reason: 'signal' });
  });

  it('prefers the lower gain when signal strength is practically equal', () => {
    const samples = [sample(29.7, 0.08, 0, 'lrpt', 9.0), sample(33.8, 0.11, 0, 'lrpt', 9.4), sample(37.2, 0.15, 0, 'lrpt', 9.6)];
    expect(chooseGain(samples).gainDb).toBe(29.7);
  });

  it('ignores a signal reading taken at an overloaded gain', () => {
    const samples = [sample(29.7, 0.1, 0, 'lrpt', 6.0), sample(40.2, 0.3, 0.03, 'lrpt', 11.0)];
    expect(chooseGain(samples).gainDb).toBe(29.7);
  });

  it('copes with no samples', () => {
    expect(chooseGain([]).gainDb).toBeGreaterThan(20);
  });
});

describe('gain guard', () => {
  it('steps down to the next lower supported gain', () => {
    expect(nextLowerGain(R828D, 37.2)).toBe(36.4);
    expect(nextLowerGain(R828D, 20.7)).toBe(19.7);
    expect(nextLowerGain(R828D, 0)).toBeNull();
  });

  it('only reacts to sustained clipping', () => {
    expect(shouldReduceGain(0.02, 0.5)).toBe(false);
    expect(shouldReduceGain(0.001, 3)).toBe(false);
    expect(shouldReduceGain(0.02, 2)).toBe(true);
  });
});
