import { buildPassReceipt } from '../passReport';
import { cellIdAt } from '../../mapping/hexGrid';

const observer = { latitudeDeg: 38.9072, longitudeDeg: -77.0369, heightKm: 0.05 };
const base = {
  node: 'Node1111111111111111111111111111111111111111',
  device: { model: 'Seeker', app: '1.0.0' },
  observer,
  noradId: '59051',
  riseMs: Date.UTC(2026, 9, 2, 15, 0, 0),
  setMs: Date.UTC(2026, 9, 2, 15, 12, 0),
  maxElevationDeg: 47.26,
  frequencyHz: 137_900_000,
  gainDb: 28,
  signalSnrDb: 9,
  format: 'fullband' as const,
  bytes: 1_000_000,
  samples: 500_000,
  droppedBlocks: 0,
};

describe('buildPassReceipt', () => {
  it('records the pass, the settings and the observer cell, and nothing about the recording content', () => {
    const r = buildPassReceipt(base);
    expect(r.type).toBe('satellite-pass');
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0].cellId).toBe(cellIdAt(observer));
    expect(r.pass).toMatchObject({ noradId: '59051', startMs: base.riseMs, endMs: base.setMs, maxElevationDeg: 47.3 });
    expect(r.pass?.recording).toEqual({ bytes: 1_000_000, samples: 500_000, droppedBlocks: 0, sampleRateHz: 2_304_000, format: 'fullband' });
    expect(r.checks.samples).toBe(r.buckets[0].samples);
  });

  it('uses the compact sample rate for compact recordings', () => {
    expect(buildPassReceipt({ ...base, format: 'compact' }).pass?.recording.sampleRateHz).toBe(288_000);
  });

  it('can carry a chest to claim', () => {
    const r = buildPassReceipt({ ...base, chest: { id: 'abc', cellId: 'h120:1:1' } });
    expect(r.chest).toEqual({ id: 'abc', cellId: 'h120:1:1' });
  });
});
