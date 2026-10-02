/** Normalized spectrum bins map 50 dB of dynamic range onto 0..1 (see DISPLAY_FLOOR_DB / CEIL_DB natively). */
export const DISPLAY_RANGE_DB = 50;

export type SignalVerdict =
  /** Nothing above the local noise. */
  | 'none'
  /** A spike narrower than an LRPT signal: a carrier, the receiver's own centre spur, or interference. */
  | 'narrow'
  /** Raised across a much wider area than LRPT occupies: broadband interference or a different signal. */
  | 'wide'
  /** A flat-topped block about the width of an LRPT signal with a clear drop either side. */
  | 'lrpt';

export interface SignalAnalysis {
  verdict: SignalVerdict;
  /** Strength of the centre block above the noise beside it, in dB (0 when there is none). */
  snrDb: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function slice(bins: number[], from: number, to: number): number[] {
  return bins.slice(Math.max(0, from), Math.min(bins.length, to + 1));
}

const MIN_SIGNAL_DB = 2;
const NARROW_PEAK_DB = 4;
const WIDE_EDGE_FRACTION = 0.6;

/**
 * Decides whether the centre of the spectrum looks like an LRPT downlink. An LRPT signal is about 140 kHz
 * wide, which is 4 display bins (36 kHz each), centred on the tuned frequency, so:
 *
 *  - the level of the block is its SECOND-LOWEST bin, so a spike or carrier one or two bins wide (the receiver's
 *    centre spur, interference) cannot fake a signal; a real LRPT signal lifts at least three of the four;
 *  - the noise reference is taken from bins just BESIDE the signal on both sides and averaged, not from the
 *    whole 2.3 MHz span. An RTL dongle's filters make the middle of its band several dB stronger than the
 *    edges even with nothing there, which a global reference would mistake for a signal;
 *  - the bins immediately next to the block must fall back toward the noise; if they stay high the hump is
 *    too wide to be LRPT.
 *
 * Limits: a hump wider than about 300 kHz covers the noise reference too and reads as plain noise. This is an
 * indicator for lining up the antenna and frequency, not a calibrated measurement.
 */
export function analyzeSignal(bins: number[]): SignalAnalysis {
  return analyzeSignalAt(bins, Math.floor(bins.length / 2));
}

/** Display bin whose edge is the centre of a signal `offsetHz` away from the tuned frequency. */
export function centerBinFor(offsetHz: number, sampleRateHz: number, binCount = 64): number {
  return Math.round(binCount / 2 + offsetHz / (sampleRateHz / binCount));
}

/** Same check as [analyzeSignal], for a signal centred on bin `center` instead of the middle of the spectrum. */
export function analyzeSignalAt(bins: number[], center: number): SignalAnalysis {
  if (bins.length < 32 || center - 9 < 0 || center + 8 >= bins.length) return { verdict: 'none', snrDb: 0 };

  const block = slice(bins, center - 2, center + 1);
  const guard = [...slice(bins, center - 4, center - 3), ...slice(bins, center + 2, center + 3)];
  const left = median(slice(bins, center - 9, center - 5));
  const right = median(slice(bins, center + 4, center + 8));
  const noise = (left + right) / 2;

  const secondLowest = [...block].sort((a, b) => a - b)[1];
  const snrDb = (secondLowest - noise) * DISPLAY_RANGE_DB;
  const peakDb = (Math.max(...block) - noise) * DISPLAY_RANGE_DB;
  const guardDb = (guard.reduce((a, b) => a + b, 0) / guard.length - noise) * DISPLAY_RANGE_DB;

  if (snrDb < MIN_SIGNAL_DB) {
    return { verdict: peakDb >= NARROW_PEAK_DB ? 'narrow' : 'none', snrDb: 0 };
  }
  if (guardDb > snrDb * WIDE_EDGE_FRACTION) return { verdict: 'wide', snrDb };
  return { verdict: 'lrpt', snrDb };
}

export type SignalStrength = 'weak' | 'good' | 'strong';

/** Only meaningful for an 'lrpt' verdict. */
export function classifyStrength(snrDb: number): SignalStrength {
  if (snrDb >= 8) return 'strong';
  if (snrDb >= 4) return 'good';
  return 'weak';
}

export interface DownlinkReading {
  frequencyHz: number;
  analysis: SignalAnalysis;
}

/**
 * Looks for an LRPT-shaped block at each candidate frequency in a spectrum centred on `centerHz`. Tuning
 * between the candidates (137.1 and 137.9 MHz, 0.8 MHz apart) shows both at once in the 2.3 MHz span.
 */
export function readDownlinks(bins: number[], centerHz: number, sampleRateHz: number, candidatesHz: readonly number[]): DownlinkReading[] {
  return candidatesHz.map((frequencyHz) => ({
    frequencyHz,
    analysis: analyzeSignalAt(bins, centerBinFor(frequencyHz - centerHz, sampleRateHz, bins.length)),
  }));
}

export interface DownlinkChoice {
  frequencyHz: number;
  /** 'signal' = an LRPT signal was seen there; 'fallback' = nothing seen, so the given default was used. */
  source: 'signal' | 'fallback';
  snrDb: number;
}

const MIN_DETECT_SNR_DB = 2.5;
const MIN_MARGIN_DB = 1.5;

/**
 * Picks the frequency that actually shows an LRPT signal. A frequency only wins if its signal is clearly
 * present and clearly stronger than any other candidate's; otherwise the fallback is kept.
 */
export function pickDownlink(readings: DownlinkReading[], fallbackHz: number): DownlinkChoice {
  const lrpt = readings
    .filter((r) => r.analysis.verdict === 'lrpt' && r.analysis.snrDb >= MIN_DETECT_SNR_DB)
    .sort((a, b) => b.analysis.snrDb - a.analysis.snrDb);
  if (lrpt.length === 0) return { frequencyHz: fallbackHz, source: 'fallback', snrDb: 0 };

  const best = lrpt[0];
  const runnerUp = lrpt[1];
  if (runnerUp && best.analysis.snrDb - runnerUp.analysis.snrDb < MIN_MARGIN_DB) {
    return { frequencyHz: fallbackHz, source: 'fallback', snrDb: 0 };
  }
  return { frequencyHz: best.frequencyHz, source: 'signal', snrDb: best.analysis.snrDb };
}
