import { DISPLAY_RANGE_DB } from '../utils/signal';

/**
 * Meteor-M weather satellites send their picture (LRPT, about 144 kHz wide) near 137.1 and 137.9 MHz. One window
 * centred on 137.5 MHz holds both, 400 kHz either side of the dongle's centre spike, and the rest of the window is
 * the noise reference.
 */
export const METEOR_TUNE_HZ = 137_500_000;
export const METEOR_CHANNELS_HZ = [137_100_000, 137_900_000];
/** One fixed gain for every reading, so readings from different places are comparable. */
export const PROBE_GAIN_DB = 28;
export const PROBE_SAMPLE_RATE_HZ = 2_400_000;
const BIN_COUNT = 64;
const BIN_HZ = PROBE_SAMPLE_RATE_HZ / BIN_COUNT;
/** A channel must stand this far above the local noise to count as received. */
export const CARRIER_THRESHOLD_DB = 6;

/**
 * Where the dongle listens to measure how much radio energy is around. Each is a 2.4 MHz-wide window; together they sample
 * FM broadcast, the Meteor-M satellite band, UHF two-way radio, the 700 MHz and the 900 MHz cellular bands. The
 * Meteor window also checks whether a Meteor satellite is being heard.
 */
export const RADIO_WINDOWS_HZ = [98_000_000, METEOR_TUNE_HZ, 462_600_000, 751_000_000, 945_000_000] as const;

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
 * works as one "how much radio is here" number; `clip` is the worst window. The Meteor check comes from the Meteor window.
 */
export function combineWindows(windows: WindowSummary[], gainDb: number): RadioReading | null {
  if (windows.length === 0) return null;
  const power = windows.reduce((sum, w) => sum + w.rms * w.rms, 0) / windows.length;
  const meteor = windows.find((w) => w.hz === METEOR_TUNE_HZ);
  const { peakDb, carrier } = meteor ? analyzeMeteor(meteor.bins) : { peakDb: 0, carrier: false };
  return {
    band: 'meteor',
    peakDb,
    carrier,
    rms: Math.round(Math.sqrt(power) * 1e5) / 1e5,
    clip: Math.max(...windows.map((w) => w.clip)),
    gainDb,
    windows: windows.length,
  };
}

export interface RadioReading {
  band: 'meteor';
  /** How many windows were measured for this reading (the level in `rms` is across all of them). */
  windows?: number;
  /** Strongest Meteor channel's level above the noise in the rest of the window, in dB (0 if nothing stands out). */
  peakDb: number;
  /** A Meteor satellite signal was heard (only possible while one is overhead). */
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

/** Display bin that holds `frequencyHz` when the dongle is tuned to METEOR_TUNE_HZ. */
export function meteorBin(frequencyHz: number): number {
  return Math.round(BIN_COUNT / 2 + (frequencyHz - METEOR_TUNE_HZ) / BIN_HZ);
}

/** A Meteor signal must stand this far above the rest of the window to count as heard. */
export const METEOR_THRESHOLD_DB = 4;

/**
 * Reads Meteor reception from one averaged spectrum. A Meteor signal is wide (about four display bins), so each
 * channel is judged by the mean of the five bins around it, against the median of the bins far from both channels
 * and from the centre spike.
 */
export function analyzeMeteor(bins: number[]): { peakDb: number; carrier: boolean } {
  if (bins.length !== BIN_COUNT) return { peakDb: 0, carrier: false };
  const centres = METEOR_CHANNELS_HZ.map(meteorBin);
  const near = (i: number) => Math.abs(i - BIN_COUNT / 2) <= 3 || centres.some((c) => Math.abs(i - c) <= 4);
  const noise = median(bins.filter((_, i) => i > 1 && i < BIN_COUNT - 2 && !near(i)));
  let peak = -Infinity;
  for (const c of centres) {
    const level = (bins[c - 2] + bins[c - 1] + bins[c] + bins[c + 1] + bins[c + 2]) / 5;
    peak = Math.max(peak, level);
  }
  const peakDb = Math.max(0, (peak - noise) * DISPLAY_RANGE_DB);
  return { peakDb: Math.round(peakDb * 10) / 10, carrier: peakDb >= METEOR_THRESHOLD_DB };
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
