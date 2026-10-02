import { SignalVerdict } from '../utils/signal';

/**
 * Gain selection for LRPT. Practitioners agree the tuner's own AGC distorts the narrow LRPT signal, so gain is set
 * manually. Too little gain leaves the 8-bit converter's rounding noise visible; too much overloads it and lifts
 * the noise floor. The sweet spot is the LOWEST gain at which the converter's rounding noise is negligible,
 * with no clipping.
 */
export interface GainSample {
  gainDb: number;
  /** RMS of the raw samples as a fraction of the converter's full scale. */
  rms: number;
  /** Fraction of samples on the converter's rails. */
  clip: number;
  verdict: SignalVerdict;
  snrDb: number;
}

export interface GainChoice {
  gainDb: number;
  reason: 'signal' | 'noise-floor' | 'quiet' | 'overload';
}

export const GAIN_LIMITS = {
  /** Sweep range: below this the front end is deaf, above it the noise floor rises and overload becomes likely. */
  minDb: 20,
  maxDb: 44,
  /** The converter's rounding noise is negligible once the noise fills this much of full scale (about 11 counts). */
  minRms: 0.09,
  /** Keep headroom for bursts of interference above the noise. */
  maxRms: 0.25,
  maxClip: 0.001,
  /** Prefer the lower gain unless a higher one is clearly better. */
  snrTieDb: 0.7,
  sweepSteps: 8,
} as const;

const FALLBACK_SWEEP = [20.7, 25.4, 29.7, 33.8, 37.2, 40.2, 42.1, 43.9];

/** A handful of evenly spread gains from what the tuner supports, inside the safe range. */
export function selectSweepGains(available: number[], limits = GAIN_LIMITS): number[] {
  const inRange = [...new Set(available)].filter((g) => g >= limits.minDb && g <= limits.maxDb).sort((a, b) => a - b);
  if (inRange.length === 0) return FALLBACK_SWEEP;
  if (inRange.length <= limits.sweepSteps) return inRange;

  const picked: number[] = [];
  for (let i = 0; i < limits.sweepSteps; i += 1) {
    picked.push(inRange[Math.round((i * (inRange.length - 1)) / (limits.sweepSteps - 1))]);
  }
  return [...new Set(picked)];
}

export function chooseGain(samples: GainSample[], limits = GAIN_LIMITS): GainChoice {
  const ordered = [...samples].sort((a, b) => a.gainDb - b.gainDb);
  if (ordered.length === 0) return { gainDb: FALLBACK_SWEEP[3], reason: 'quiet' };

  const usable = ordered.filter((s) => s.clip <= limits.maxClip && s.rms <= limits.maxRms);
  if (usable.length === 0) {
    // Everything overloads: the environment is strong (nearby transmitters). Take the quietest setting.
    return { gainDb: ordered[0].gainDb, reason: 'overload' };
  }

  const withSignal = usable.filter((s) => s.verdict === 'lrpt' && s.snrDb > 0);
  if (withSignal.length > 0) {
    const bestSnr = Math.max(...withSignal.map((s) => s.snrDb));
    const near = withSignal.find((s) => s.snrDb >= bestSnr - limits.snrTieDb);
    return { gainDb: (near ?? withSignal[0]).gainDb, reason: 'signal' };
  }

  const enough = usable.find((s) => s.rms >= limits.minRms);
  if (enough) return { gainDb: enough.gainDb, reason: 'noise-floor' };
  // Very quiet surroundings: even the top of the range does not fill the converter; use the highest safe gain.
  return { gainDb: usable[usable.length - 1].gainDb, reason: 'quiet' };
}

/** The next lower supported gain, or null when already at the bottom of the safe range. */
export function nextLowerGain(available: number[], currentDb: number, limits = GAIN_LIMITS): number | null {
  const lower = [...new Set(available)].filter((g) => g < currentDb - 0.05 && g >= limits.minDb - 5).sort((a, b) => b - a);
  return lower.length ? lower[0] : null;
}

/** Brief clipping is normal; sustained clipping means the gain is too high for this pass and should drop a step. */
export const CLIP_GUARD = { threshold: 0.005, windowSec: 1.5 } as const;

export function shouldReduceGain(clipMean: number, windowSec: number): boolean {
  return windowSec >= CLIP_GUARD.windowSec && clipMean > CLIP_GUARD.threshold;
}
