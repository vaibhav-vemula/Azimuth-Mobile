/** Normalized spectrum bins map 50 dB of dynamic range onto 0..1 (see DISPLAY_FLOOR_DB / CEIL_DB natively). */
export const DISPLAY_RANGE_DB = 50;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rough signal-above-noise estimate in dB for a narrow signal centred in the spectrum (such as an LRPT
 * downlink, about 140 kHz wide against 36 kHz bins): the strongest short run of centre bins versus the
 * median bin, which approximates the noise floor. It is an indicator, not a calibrated measurement.
 */
export function estimateSnrDb(bins: number[], windowBins = 4, searchBins = 16): number {
  if (bins.length < windowBins) return 0;
  const center = Math.floor(bins.length / 2);
  const start = Math.max(0, center - Math.floor(searchBins / 2));
  const end = Math.min(bins.length, center + Math.floor(searchBins / 2));

  let best = 0;
  for (let i = start; i + windowBins <= end; i += 1) {
    let sum = 0;
    for (let k = 0; k < windowBins; k += 1) sum += bins[i + k];
    best = Math.max(best, sum / windowBins);
  }
  return Math.max(0, (best - median(bins)) * DISPLAY_RANGE_DB);
}

export type SignalQuality = 'none' | 'weak' | 'good' | 'strong';

export function classifySnr(snrDb: number): SignalQuality {
  if (snrDb >= 8) return 'strong';
  if (snrDb >= 4) return 'good';
  if (snrDb >= 1.5) return 'weak';
  return 'none';
}
