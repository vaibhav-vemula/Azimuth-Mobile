import { SPECTRUM_BIN_COUNT } from '../../utils/spectrumPath';

/** In-place radix-2 FFT. `re` and `im` must have the same power-of-two length. */
export function fft(re: number[], im: number[]): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

const SIZE = 512;
/** Level (dB below full scale) shown as an empty bar, and as a full one. */
const FLOOR_DB = -75;
const CEIL_DB = -15;

/** Bar edges in FFT bins, spaced like hearing is: narrow at the bass, wide at the treble. */
const EDGES: number[] = (() => {
  const lowest = 2; // skip the very bottom, which is mostly DC offset
  const highest = SIZE / 2;
  const edges: number[] = [];
  for (let i = 0; i <= SPECTRUM_BIN_COUNT; i += 1) edges.push(Math.round(lowest * Math.pow(highest / lowest, i / SPECTRUM_BIN_COUNT)));
  for (let i = 1; i < edges.length; i += 1) if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] + 1;
  return edges;
})();

/**
 * The spectrum of a short stretch of audio as 64 bars, 0 to 1, low pitch on the left. Takes mono frames between -1 and 1
 * and uses the newest 512 of them (or fewer, padded with silence, if there are not that many).
 */
export function audioBins(frames: ArrayLike<number>): number[] {
  const re: number[] = new Array(SIZE).fill(0);
  const im: number[] = new Array(SIZE).fill(0);
  const take = Math.min(SIZE, frames.length);
  const start = frames.length - take;
  for (let i = 0; i < take; i += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (take - 1 || 1)); // Hann
    const v = frames[start + i];
    re[i] = Number.isFinite(v) ? v * window : 0;
  }
  fft(re, im);
  const bins: number[] = [];
  for (let b = 0; b < SPECTRUM_BIN_COUNT; b += 1) {
    let peak = 0;
    for (let k = EDGES[b]; k < Math.min(EDGES[b + 1], SIZE / 2); k += 1) peak = Math.max(peak, Math.hypot(re[k], im[k]));
    // A full-scale sine gives a magnitude of about SIZE / 4 after the window, so this is relative to full scale.
    const db = 20 * Math.log10(Math.max(1e-9, peak / (SIZE / 4)));
    bins.push(Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB))));
  }
  return bins;
}

/** Bars rise quickly and fall slowly, so the display is readable and does not flicker. */
export function smoothBins(previous: number[], next: number[], attack = 0.7, decay = 0.2): number[] {
  return next.map((v, i) => {
    const p = previous[i] ?? 0;
    return p + (v - p) * (v > p ? attack : decay);
  });
}

/** Mono frames from the channels of one audio sample (the average of left and right). */
export function monoFrames(channels: { frames: ArrayLike<number> }[]): number[] {
  if (channels.length === 0) return [];
  const length = Math.min(...channels.map((c) => c.frames.length));
  const out: number[] = new Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (const c of channels) sum += c.frames[i];
    out[i] = sum / channels.length;
  }
  return out;
}

export const EMPTY_BINS: number[] = new Array(SPECTRUM_BIN_COUNT).fill(0);
