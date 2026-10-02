import { analyzeSignal, analyzeSignalAt, centerBinFor, classifyStrength, pickDownlink, readDownlinks } from './signal';

const N = 64;
const C = 32;

/** Pure noise whose floor is `tiltDb` higher at the centre than at the edges, like an RTL passband. */
function noise(level = 0.25, tiltDb = 0): number[] {
  const tilt = tiltDb / 50;
  return Array.from({ length: N }, (_, i) => level + tilt * (1 - Math.abs(i - (C - 0.5)) / (N / 2)));
}

function withBlock(bins: number[], dbAbove: number, from = C - 2, to = C + 1): number[] {
  const out = [...bins];
  const noiseHere = (bins[C - 8] + bins[C + 8]) / 2;
  for (let i = from; i <= to; i += 1) out[i] = noiseHere + dbAbove / 50;
  return out;
}

describe('analyzeSignal', () => {
  it('finds nothing in flat noise', () => {
    expect(analyzeSignal(noise())).toEqual({ verdict: 'none', snrDb: 0 });
  });

  it('is not fooled by a passband tilt (the false positive seen on a real dongle)', () => {
    for (const tilt of [3, 6, 9, 12]) {
      const result = analyzeSignal(noise(0.25, tilt));
      expect(result.verdict).toBe('none');
    }
  });

  it('recognises an LRPT-shaped block, even on a tilted floor', () => {
    const result = analyzeSignal(withBlock(noise(0.25, 9), 9));
    expect(result.verdict).toBe('lrpt');
    expect(result.snrDb).toBeGreaterThan(7);
    expect(result.snrDb).toBeLessThan(11);
  });

  it('ignores a single raised centre bin (receiver spur) and reports it as narrow', () => {
    const bins = noise();
    bins[C] += 0.4; // +20 dB in one bin
    const result = analyzeSignal(bins);
    expect(result.verdict).toBe('narrow');
    expect(result.snrDb).toBe(0);
  });

  it('classes a narrow carrier near the centre as narrow', () => {
    const bins = noise();
    bins[C - 1] += 0.3;
    bins[C] += 0.3;
    expect(analyzeSignal(bins).verdict).toBe('narrow');
  });

  it('rejects a hump about twice the width of LRPT as wide interference', () => {
    const bins = noise();
    for (let i = C - 4; i <= C + 3; i += 1) bins[i] += 0.2; // about 290 kHz wide
    expect(analyzeSignal(bins).verdict).toBe('wide');
  });

  it('cannot tell a hump wider than the noise reference zone from raised noise (documented limit)', () => {
    const bins = noise();
    for (let i = C - 12; i <= C + 11; i += 1) bins[i] += 0.2;
    expect(analyzeSignal(bins).verdict).toBe('none');
  });

  it('ignores energy far from the centre', () => {
    const bins = noise();
    for (let i = 2; i < 8; i += 1) bins[i] += 0.5;
    expect(analyzeSignal(bins).verdict).toBe('none');
  });

  it('treats a very weak block as none rather than guessing', () => {
    expect(analyzeSignal(withBlock(noise(), 1)).verdict).toBe('none');
  });

  it('handles too-short input', () => {
    expect(analyzeSignal([])).toEqual({ verdict: 'none', snrDb: 0 });
    expect(analyzeSignal([0.5, 0.5])).toEqual({ verdict: 'none', snrDb: 0 });
  });
});

describe('classifyStrength', () => {
  it('buckets by dB above the noise', () => {
    expect(classifyStrength(2.5)).toBe('weak');
    expect(classifyStrength(5)).toBe('good');
    expect(classifyStrength(12)).toBe('strong');
  });
});

describe('detecting which downlink carries the signal', () => {
  const SR = 2_304_000;
  const CENTER = 137_500_000;
  const CANDIDATES = [137_100_000, 137_900_000];

  function spectrumWithSignalAt(freqHz: number, dbAbove = 9, tilt = 6): number[] {
    const bins = noise(0.25, tilt);
    const c = centerBinFor(freqHz - CENTER, SR);
    const local = (bins[c - 8] + bins[c + 7]) / 2;
    for (let i = c - 2; i <= c + 1; i += 1) bins[i] = local + dbAbove / 50;
    return bins;
  }

  it('maps frequency offsets to the right display bins', () => {
    expect(centerBinFor(0, SR)).toBe(32);
    expect(centerBinFor(400_000, SR)).toBe(43);
    expect(centerBinFor(-400_000, SR)).toBe(21);
  });

  it('analyses a block away from the middle of the spectrum', () => {
    const bins = withBlock(noise(), 9, 41, 44);
    expect(analyzeSignalAt(bins, 43).verdict).toBe('lrpt');
    expect(analyzeSignal(bins).verdict).toBe('none');
  });

  it('refuses a block that would run off the edge of the spectrum', () => {
    expect(analyzeSignalAt(noise(), 3).verdict).toBe('none');
    expect(analyzeSignalAt(noise(), 62).verdict).toBe('none');
  });

  it('finds the signal on 137.9 and on 137.1', () => {
    for (const hz of CANDIDATES) {
      const readings = readDownlinks(spectrumWithSignalAt(hz), CENTER, SR, CANDIDATES);
      const choice = pickDownlink(readings, 137_900_000 === hz ? 137_100_000 : 137_900_000);
      expect(choice.source).toBe('signal');
      expect(choice.frequencyHz).toBe(hz);
      expect(choice.snrDb).toBeGreaterThan(6);
    }
  });

  it('keeps the fallback when nothing is there yet', () => {
    const readings = readDownlinks(noise(0.25, 6), CENTER, SR, CANDIDATES);
    expect(pickDownlink(readings, 137_900_000)).toEqual({ frequencyHz: 137_900_000, source: 'fallback', snrDb: 0 });
  });

  it('does not choose between two similar signals; it keeps the fallback', () => {
    const a = spectrumWithSignalAt(137_100_000);
    const b = spectrumWithSignalAt(137_900_000);
    const both = a.map((v, i) => Math.max(v, b[i]));
    const choice = pickDownlink(readDownlinks(both, CENTER, SR, CANDIDATES), 137_900_000);
    expect(choice.source).toBe('fallback');
  });

  it('chooses the clearly stronger of two signals', () => {
    const weak = spectrumWithSignalAt(137_100_000, 4);
    const strong = spectrumWithSignalAt(137_900_000, 11);
    const both = weak.map((v, i) => Math.max(v, strong[i]));
    expect(pickDownlink(readDownlinks(both, CENTER, SR, CANDIDATES), 137_100_000).frequencyHz).toBe(137_900_000);
  });
});
