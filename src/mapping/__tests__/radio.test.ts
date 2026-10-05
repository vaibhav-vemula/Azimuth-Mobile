import { METEOR_CHANNELS_HZ, METEOR_TUNE_HZ, analyzeMeteor, meteorBin, nearestGain, RADIO_WINDOWS_HZ, combineWindows, levelDbfs } from '../radio';
import { addScan, emptyBucket, summarize } from '../aggregate';
import type { ScanResult } from '../../../modules/signal-scan';

const flat = (level = 0.3) => new Array(64).fill(level);

describe('Meteor analysis', () => {
  const [low, high] = METEOR_CHANNELS_HZ.map(meteorBin);

  it('puts both channels clear of the centre spike and inside the window', () => {
    expect(high).toBeLessThan(62);
    expect(low).toBeGreaterThan(2);
    expect(Math.abs(low - 32)).toBeGreaterThan(6);
    expect(Math.abs(high - 32)).toBeGreaterThan(6);
  });

  it('finds nothing in a flat spectrum', () => {
    expect(analyzeMeteor(flat())).toEqual({ peakDb: 0, carrier: false });
  });

  it('detects a wide signal on either channel', () => {
    for (const c of [low, high]) {
      const bins = flat();
      for (let i = c - 2; i <= c + 2; i++) bins[i] = 0.6; // 15 dB over the noise (0.3 * 50 dB range)
      const out = analyzeMeteor(bins);
      expect(out.carrier).toBe(true);
      expect(out.peakDb).toBeCloseTo(15, 0);
    }
  });

  it('does not call a weak bump, or one narrow spike, a satellite', () => {
    const weak = flat();
    for (let i = low - 2; i <= low + 2; i++) weak[i] = 0.34; // 2 dB
    expect(analyzeMeteor(weak).carrier).toBe(false);
    const spike = flat();
    spike[high] = 0.6; // one bin: averaged over five it is only 3 dB
    expect(analyzeMeteor(spike).carrier).toBe(false);
  });

  it('is not fooled by a spike at the dongle centre', () => {
    const bins = flat();
    bins[32] = 0.95;
    expect(analyzeMeteor(bins).carrier).toBe(false);
  });

  it('rejects spectra of the wrong size', () => {
    expect(analyzeMeteor([0.1, 0.2])).toEqual({ peakDb: 0, carrier: false });
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
    for (let i = meteorBin(137_900_000) - 2; i <= meteorBin(137_900_000) + 2; i++) bins[i] = 0.6;
    const bucket = emptyBucket('c', 0);
    addScan(bucket, { ...phone, radio: combineWindows([{ hz: METEOR_TUNE_HZ, bins, rms: 0.1, clip: 0 }], 28)! });
    addScan(bucket, { ...phone, radio: combineWindows([{ hz: METEOR_TUNE_HZ, bins: flat(), rms: 0.12, clip: 0 }], 28)! });
    expect(bucket.radio?.samples).toBe(2);
    expect(bucket.radio?.carriers).toBe(1);
    expect(summarize([bucket]).meteorReception).toBe(0.5);
  });

  it('leaves radio absent when no dongle was used', () => {
    const phone: ScanResult = { atMs: 0, cellular: { available: false, cells: [] }, wifi: { available: false }, bluetooth: null, gnss: {} };
    const bucket = emptyBucket('c', 0);
    addScan(bucket, phone);
    expect(bucket.radio).toBeUndefined();
    expect(summarize([bucket]).meteorReception).toBeNull();
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

describe('radio level across bands', () => {
  const flatBins = new Array(64).fill(0.3);

  it('listens in five windows that include the Meteor one', () => {
    expect(RADIO_WINDOWS_HZ).toHaveLength(5);
    expect(RADIO_WINDOWS_HZ).toContain(METEOR_TUNE_HZ);
  });

  it('turns a raw level into dB below full scale', () => {
    expect(levelDbfs(1)).toBeCloseTo(0, 5);
    expect(levelDbfs(0.1)).toBeCloseTo(-20, 5);
    expect(levelDbfs(0)).toBe(-80);
  });

  it('combines windows by power, takes the worst clipping, and does not need a satellite to be heard', () => {
    const r = combineWindows(
      [
        { hz: 98_000_000, bins: flatBins, rms: 0.3, clip: 0 },
        { hz: 751_000_000, bins: flatBins, rms: 0.1, clip: 0.02 },
      ],
      28
    )!;
    expect(r.rms).toBeCloseTo(Math.sqrt((0.09 + 0.01) / 2), 4);
    expect(r.clip).toBe(0.02);
    expect(r.windows).toBe(2);
    expect(r.carrier).toBe(false);
  });

  it('gives nothing when no window was measured', () => {
    expect(combineWindows([], 28)).toBeNull();
  });
});
