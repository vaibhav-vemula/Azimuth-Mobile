import { classifySnr, estimateSnrDb } from './signal';

function flat(level: number, n = 64): number[] {
  return new Array(n).fill(level);
}

describe('estimateSnrDb', () => {
  it('reads zero for a flat noise floor', () => {
    expect(estimateSnrDb(flat(0.2))).toBe(0);
  });

  it('measures a signal bump in the centre', () => {
    const bins = flat(0.2);
    for (let i = 30; i < 34; i += 1) bins[i] = 0.4; // +0.2 -> +10 dB
    expect(estimateSnrDb(bins)).toBeCloseTo(10, 5);
  });

  it('ignores bumps far from the centre', () => {
    const bins = flat(0.2);
    for (let i = 2; i < 6; i += 1) bins[i] = 0.9;
    expect(estimateSnrDb(bins)).toBe(0);
  });

  it('is not fooled by a single noisy bin', () => {
    const bins = flat(0.2);
    bins[32] = 1;
    // One bin averaged over a 4-bin window contributes a quarter of its excess.
    expect(estimateSnrDb(bins)).toBeCloseTo(((1 - 0.2) / 4) * 50, 5);
  });

  it('handles empty and tiny inputs', () => {
    expect(estimateSnrDb([])).toBe(0);
    expect(estimateSnrDb([0.5, 0.5])).toBe(0);
  });
});

describe('classifySnr', () => {
  it('buckets the estimate', () => {
    expect(classifySnr(0)).toBe('none');
    expect(classifySnr(2)).toBe('weak');
    expect(classifySnr(5)).toBe('good');
    expect(classifySnr(12)).toBe('strong');
  });
});
