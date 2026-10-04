import { NOAA_CHANNELS_HZ, analyzeNoaa, nearestGain, noaaBin, toReading } from '../radio';
import { addScan, emptyBucket, summarize } from '../aggregate';
import type { ScanResult } from '../../../modules/signal-scan';

const flat = (level = 0.3) => new Array(64).fill(level);

describe('NOAA analysis', () => {
  it('puts all seven channels below the centre and clear of the centre spike', () => {
    const bins = NOAA_CHANNELS_HZ.map(noaaBin);
    expect(Math.max(...bins)).toBeLessThan(32 - 3);
    expect(Math.min(...bins)).toBeGreaterThan(8);
  });

  it('finds nothing in a flat spectrum', () => {
    expect(analyzeNoaa(flat())).toEqual({ peakDb: 0, carrier: false });
  });

  it('detects a strong channel', () => {
    const bins = flat();
    bins[noaaBin(162_550_000)] = 0.6; // 15 dB over the noise (0.3 * 50 dB range)
    const out = analyzeNoaa(bins);
    expect(out.carrier).toBe(true);
    expect(out.peakDb).toBeCloseTo(15, 0);
  });

  it('does not call a weak bump a carrier', () => {
    const bins = flat();
    bins[noaaBin(162_400_000)] = 0.34; // 2 dB
    expect(analyzeNoaa(bins).carrier).toBe(false);
  });

  it('is not fooled by a spike at the dongle centre', () => {
    const bins = flat();
    bins[32] = 0.95;
    expect(analyzeNoaa(bins).carrier).toBe(false);
  });

  it('rejects spectra of the wrong size', () => {
    expect(analyzeNoaa([0.1, 0.2])).toEqual({ peakDb: 0, carrier: false });
  });
});

describe('radio helpers and aggregation', () => {
  it('picks the nearest available gain', () => {
    expect(nearestGain([0, 9, 28.0, 37.2, 49.6], 28)).toBe(28);
    expect(nearestGain([0, 9, 30.1, 49.6], 28)).toBe(30.1);
    expect(nearestGain([], 28)).toBeNull();
  });

  it('aggregates dongle readings into the bucket and summary', () => {
    const phone: ScanResult = { atMs: 0, cellular: { available: false, cells: [] }, wifi: { available: false }, bluetooth: null, gnss: {} };
    const bins = flat();
    bins[noaaBin(162_475_000)] = 0.6;
    const bucket = emptyBucket('c', 0);
    addScan(bucket, { ...phone, radio: toReading({ bins, rms: 0.1, clip: 0 }, 28) });
    addScan(bucket, { ...phone, radio: toReading({ bins: flat(), rms: 0.12, clip: 0 }, 28) });
    expect(bucket.radio?.samples).toBe(2);
    expect(bucket.radio?.carriers).toBe(1);
    expect(summarize([bucket]).noaaReception).toBe(0.5);
  });

  it('leaves radio absent when no dongle was used', () => {
    const phone: ScanResult = { atMs: 0, cellular: { available: false, cells: [] }, wifi: { available: false }, bluetooth: null, gnss: {} };
    const bucket = emptyBucket('c', 0);
    addScan(bucket, phone);
    expect(bucket.radio).toBeUndefined();
    expect(summarize([bucket]).noaaReception).toBeNull();
  });
});

import { SONDE_TUNE_OFFSET_HZ, analyzeSonde, sondeTuneHz, toSondeReading } from '../radio';

describe('sonde listening', () => {
  const f = 403_000_000;

  it('tunes below the sonde so it avoids the centre spike', () => {
    expect(f - sondeTuneHz(f)).toBe(SONDE_TUNE_OFFSET_HZ);
  });

  it('hears a carrier on the expected frequency', () => {
    const bins = flat();
    bins[Math.round(32 + SONDE_TUNE_OFFSET_HZ / (2_400_000 / 64))] = 0.6;
    const out = analyzeSonde(bins, f);
    expect(out.detected).toBe(true);
    expect(out.peakDb).toBeCloseTo(15, 0);
  });

  it('tolerates one bin of drift but not a carrier somewhere else', () => {
    const bin = Math.round(32 + SONDE_TUNE_OFFSET_HZ / (2_400_000 / 64));
    const drift = flat();
    drift[bin + 1] = 0.6;
    expect(analyzeSonde(drift, f).detected).toBe(true);
    const elsewhere = flat();
    elsewhere[bin - 6] = 0.6;
    expect(analyzeSonde(elsewhere, f).detected).toBe(false);
  });

  it('is not fooled by the centre spike or a flat spectrum', () => {
    const spike = flat();
    spike[32] = 0.95;
    expect(analyzeSonde(spike, f).detected).toBe(false);
    expect(analyzeSonde(flat(), f).detected).toBe(false);
  });

  it('builds a reading with the settings used', () => {
    const r = toSondeReading({ bins: flat(), rms: 0.1, clip: 0 }, f, 28);
    expect(r).toMatchObject({ frequencyHz: f, detected: false, gainDb: 28 });
  });
});
