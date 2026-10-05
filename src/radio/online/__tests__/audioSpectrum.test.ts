import { audioBins, fft, monoFrames, smoothBins } from '../audioSpectrum';

/** `n` frames of a sine at `cycles` periods per 512 frames, at amplitude `amp`. */
const sine = (cycles: number, amp = 1, n = 512) => Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * cycles * i) / 512));
const peakBar = (bins: number[]) => bins.indexOf(Math.max(...bins));

describe('fft', () => {
  it('puts a pure tone in the right bin', () => {
    const re = sine(16);
    const im = new Array(512).fill(0);
    fft(re, im);
    const mags = re.map((r, i) => Math.hypot(r, im[i]));
    expect(mags.indexOf(Math.max(...mags.slice(0, 256)))).toBe(16);
    expect(mags[16]).toBeCloseTo(256, 3);
  });
});

describe('audioBins', () => {
  it('gives 64 bars between 0 and 1', () => {
    const bins = audioBins(sine(20));
    expect(bins).toHaveLength(64);
    expect(Math.min(...bins)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...bins)).toBeLessThanOrEqual(1);
  });

  it('is empty for silence', () => {
    expect(Math.max(...audioBins(new Array(512).fill(0)))).toBe(0);
  });

  it('puts a low tone on the left and a high tone on the right', () => {
    expect(peakBar(audioBins(sine(5)))).toBeLessThan(peakBar(audioBins(sine(100))));
    expect(peakBar(audioBins(sine(5)))).toBeLessThan(25);
    expect(peakBar(audioBins(sine(100)))).toBeGreaterThan(40);
  });

  it('shows a louder sound as taller bars', () => {
    const loud = Math.max(...audioBins(sine(40, 0.8)));
    const quiet = Math.max(...audioBins(sine(40, 0.05)));
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeGreaterThan(0.8);
  });

  it('copes with short or odd input', () => {
    expect(audioBins([])).toHaveLength(64);
    expect(audioBins([0.5])).toHaveLength(64);
    expect(audioBins([NaN, 1, Infinity, -1])).toHaveLength(64);
    expect(audioBins(sine(10, 1, 2048))).toHaveLength(64); // uses the newest 512 frames
  });
});

describe('smoothing', () => {
  it('rises quickly and falls slowly', () => {
    expect(smoothBins([0], [1])[0]).toBeCloseTo(0.7, 5);
    expect(smoothBins([1], [0])[0]).toBeCloseTo(0.8, 5);
  });
});

describe('mono frames', () => {
  it('averages the channels', () => {
    expect(monoFrames([{ frames: [1, 0, -1] }, { frames: [0, 0, 1] }])).toEqual([0.5, 0, 0]);
    expect(monoFrames([])).toEqual([]);
  });
});

describe('simulatedBins', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { simulatedBins } = require('../audioSpectrum');

  it('gives 64 bars in range, with more energy low down than high up', () => {
    const bins = simulatedBins(3, 4);
    expect(bins).toHaveLength(64);
    expect(Math.min(...bins)).toBeGreaterThan(0);
    expect(Math.max(...bins)).toBeLessThanOrEqual(1);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    let low = 0;
    let high = 0;
    for (let t = 0; t < 20; t += 0.5) {
      const b = simulatedBins(t, 4);
      low += avg(b.slice(0, 16));
      high += avg(b.slice(48));
    }
    expect(low).toBeGreaterThan(high);
  });

  it('changes smoothly over time and differs between stations', () => {
    const a = simulatedBins(1, 3);
    const b = simulatedBins(1.05, 3);
    const maxStep = Math.max(...a.map((v: number, i: number) => Math.abs(v - b[i])));
    expect(maxStep).toBeLessThan(0.15);
    expect(simulatedBins(1, 3)).not.toEqual(simulatedBins(1, 9));
  });
});
