import { DISPLAY_RANGE_DB } from '../utils/signal';

/**
 * NOAA Weather Radio uses seven channels, 162.400 to 162.550 MHz, 25 kHz apart. Tuning to 162.700 MHz puts all of
 * them below the centre (150 to 300 kHz down), clear of the dongle's centre spike, and the span above the
 * centre is empty and serves as the noise reference.
 */
export const NOAA_TUNE_HZ = 162_700_000;
export const NOAA_CHANNELS_HZ = [162_400_000, 162_425_000, 162_450_000, 162_475_000, 162_500_000, 162_525_000, 162_550_000];
/** One fixed gain for every reading, so readings from different places are comparable. */
export const PROBE_GAIN_DB = 28;
export const PROBE_SAMPLE_RATE_HZ = 2_400_000;
const BIN_COUNT = 64;
const BIN_HZ = PROBE_SAMPLE_RATE_HZ / BIN_COUNT;
/** A channel must stand this far above the local noise to count as received. */
export const CARRIER_THRESHOLD_DB = 6;

/**
 * Where the dongle listens to measure how much radio energy is around. Each is a 2.4 MHz-wide window; together they sample
 * FM broadcast, VHF (including NOAA Weather Radio), UHF two-way radio, the 700 MHz and the 900 MHz cellular bands. The
 * NOAA window doubles as the weather-radio check that chests of that kind need.
 */
export const RADIO_WINDOWS_HZ = [98_000_000, NOAA_TUNE_HZ, 462_600_000, 751_000_000, 945_000_000] as const;

/** Level of a window as dB below full scale, from its raw-sample level. Floors at -80 so silence stays finite. */
export function levelDbfs(rms: number): number {
  return Math.max(-80, 20 * Math.log10(Math.max(rms, 1e-4)));
}

export interface WindowSummary {
  hz: number;
  bins: number[];
  rms: number;
  clip: number;
}

/**
 * One reading from several windows. `rms` is the combined level (the root of the mean power across windows), so it
 * works as one "how much radio is here" number; `clip` is the worst window. The NOAA check comes from the NOAA window.
 */
export function combineWindows(windows: WindowSummary[], gainDb: number): RadioReading | null {
  if (windows.length === 0) return null;
  const power = windows.reduce((sum, w) => sum + w.rms * w.rms, 0) / windows.length;
  const noaa = windows.find((w) => w.hz === NOAA_TUNE_HZ);
  const { peakDb, carrier } = noaa ? analyzeNoaa(noaa.bins) : { peakDb: 0, carrier: false };
  return {
    band: 'noaa',
    peakDb,
    carrier,
    rms: Math.round(Math.sqrt(power) * 1e5) / 1e5,
    clip: Math.max(...windows.map((w) => w.clip)),
    gainDb,
    windows: windows.length,
  };
}

export interface RadioReading {
  band: 'noaa';
  /** How many windows were measured for this reading (the level in `rms` is across all of them). */
  windows?: number;
  /** Strongest NOAA channel's level above the noise beside it, in dB (0 if nothing stands out). */
  peakDb: number;
  /** A NOAA carrier was received. */
  carrier: boolean;
  /** Raw level of the receiver input as a fraction of full scale, at the fixed gain, across the measured windows. */
  rms: number;
  /** Fraction of samples at the ADC limits; high values mean the reading is overloaded and unreliable. */
  clip: number;
  gainDb: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Display bin that holds `frequencyHz` when the dongle is tuned to NOAA_TUNE_HZ. */
export function noaaBin(frequencyHz: number): number {
  return Math.round(BIN_COUNT / 2 + (frequencyHz - NOAA_TUNE_HZ) / BIN_HZ);
}

/**
 * Reads NOAA reception from one averaged spectrum. The level of the strongest NOAA channel is compared with
 * the median of an empty span above the centre.
 */
export function analyzeNoaa(bins: number[]): { peakDb: number; carrier: boolean } {
  if (bins.length !== BIN_COUNT) return { peakDb: 0, carrier: false };
  // Noise reference: bins well above the centre, where nothing is licensed near here.
  const noise = median(bins.slice(BIN_COUNT / 2 + 6, BIN_COUNT / 2 + 22));
  const from = noaaBin(NOAA_CHANNELS_HZ[0]);
  const to = noaaBin(NOAA_CHANNELS_HZ[NOAA_CHANNELS_HZ.length - 1]);
  let peak = -Infinity;
  for (let i = from - 1; i <= to + 1; i++) peak = Math.max(peak, bins[i]);
  const peakDb = Math.max(0, (peak - noise) * DISPLAY_RANGE_DB);
  return { peakDb: Math.round(peakDb * 10) / 10, carrier: peakDb >= CARRIER_THRESHOLD_DB };
}

export function toReading(summary: { bins: number[]; rms: number; clip: number }, gainDb: number): RadioReading {
  const { peakDb, carrier } = analyzeNoaa(summary.bins);
  return { band: 'noaa', peakDb, carrier, rms: summary.rms, clip: summary.clip, gainDb };
}

/** Closest gain the tuner actually offers. */
export function nearestGain(available: number[], wanted: number): number | null {
  if (available.length === 0) return null;
  return available.reduce((best, g) => (Math.abs(g - wanted) < Math.abs(best - wanted) ? g : best));
}

/** Radiosondes transmit in 400 to 406 MHz. A reading tunes this far below the sonde so its carrier avoids the centre spike. */
export const SONDE_TUNE_OFFSET_HZ = 300_000;
export const SONDE_BAND_HZ = { min: 400_000_000, max: 406_000_000 };
/** A sonde must stand this far above the local noise to count as heard. */
export const SONDE_THRESHOLD_DB = 5;

export interface SondeReading {
  /** The frequency that was listened on (from the sonde's last known transmit frequency). */
  frequencyHz: number;
  detected: boolean;
  peakDb: number;
  rms: number;
  clip: number;
  gainDb: number;
}

export function sondeTuneHz(frequencyHz: number): number {
  return Math.round(frequencyHz - SONDE_TUNE_OFFSET_HZ);
}

/**
 * Whether a narrow carrier stands at `frequencyHz` in a spectrum taken while tuned to sondeTuneHz(frequencyHz).
 * The three bins around the expected one are searched because a bin is 37.5 kHz wide and sondes drift; the
 * noise reference is the median of an empty span above the centre.
 */
export function analyzeSonde(bins: number[], frequencyHz: number): { peakDb: number; detected: boolean } {
  if (bins.length !== BIN_COUNT) return { peakDb: 0, detected: false };
  const centre = Math.round(BIN_COUNT / 2 + (frequencyHz - sondeTuneHz(frequencyHz)) / BIN_HZ);
  const noise = median(bins.slice(BIN_COUNT / 2 + 4, BIN_COUNT / 2 + 20));
  let peak = -Infinity;
  for (let i = centre - 1; i <= centre + 1; i++) peak = Math.max(peak, bins[i]);
  const peakDb = Math.max(0, (peak - noise) * DISPLAY_RANGE_DB);
  return { peakDb: Math.round(peakDb * 10) / 10, detected: peakDb >= SONDE_THRESHOLD_DB };
}

export function toSondeReading(summary: { bins: number[]; rms: number; clip: number }, frequencyHz: number, gainDb: number): SondeReading {
  const { peakDb, detected } = analyzeSonde(summary.bins, frequencyHz);
  return { frequencyHz, detected, peakDb, rms: summary.rms, clip: summary.clip, gainDb };
}
