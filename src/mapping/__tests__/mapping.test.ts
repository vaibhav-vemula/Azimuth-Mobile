import {
  cellIdAt,
  distanceM,
  hexAt,
  hexCenter,
  hexCorners,
  hexDisk,
  neighbors,
  parseCellId,
  hexDistance,
} from '../hexGrid';
import { addScan, bucketStartMs, emptyBucket, summarize } from '../aggregate';
import type { ScanResult } from '../../../modules/signal-scan';

const DC = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };

describe('hex grid', () => {
  it('maps a point to a cell whose centre is close to the point', () => {
    const hex = hexAt(DC);
    const centre = hexCenter(hex);
    // 120 m projected cells are about 94 m on the ground at this latitude.
    expect(distanceM(DC, centre)).toBeLessThan(150);
  });

  it('is stable: the centre of a cell maps back to the same cell', () => {
    const hex = hexAt(DC);
    expect(hexAt(hexCenter(hex))).toEqual(hex);
  });

  it('has six distinct neighbours that are all adjacent', () => {
    const hex = hexAt(DC);
    const ns = neighbors(hex);
    expect(new Set(ns.map((n) => `${n.q},${n.r}`)).size).toBe(6);
    const d = ns.map((n) => distanceM(hexCenter(hex), hexCenter(n)));
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(5);
  });

  it('returns the right number of cells in a disk', () => {
    expect(hexDisk({ q: 0, r: 0 }, 0)).toHaveLength(1);
    expect(hexDisk({ q: 0, r: 0 }, 1)).toHaveLength(7);
    expect(hexDisk({ q: 0, r: 0 }, 3)).toHaveLength(37);
  });

  it('round-trips cell ids', () => {
    const id = cellIdAt(DC);
    const parsed = parseCellId(id);
    expect(parsed).not.toBeNull();
    expect(parsed!.hex).toEqual(hexAt(DC));
    expect(parseCellId('nonsense')).toBeNull();
  });

  it('draws six corners around the centre', () => {
    const hex = hexAt(DC);
    expect(hexCorners(hex)).toHaveLength(6);
  });

  it('puts nearby points in the same cell and far points in different ones', () => {
    const near = { latitudeDeg: DC.latitudeDeg + 0.00002, longitudeDeg: DC.longitudeDeg };
    const far = { latitudeDeg: DC.latitudeDeg + 0.01, longitudeDeg: DC.longitudeDeg };
    expect(cellIdAt(near)).toBe(cellIdAt(DC));
    expect(cellIdAt(far)).not.toBe(cellIdAt(DC));
  });
});

function scan(partial: Partial<ScanResult>): ScanResult {
  return {
    atMs: 0,
    cellular: { available: true, cells: [] },
    wifi: { available: false },
    bluetooth: null,
    gnss: {},
    ...partial,
  };
}

describe('aggregation', () => {
  it('rounds times down to the bucket', () => {
    const t = Date.UTC(2026, 9, 2, 14, 37, 12);
    expect(bucketStartMs(t)).toBe(Date.UTC(2026, 9, 2, 14, 30, 0));
  });

  it('records dead-zone samples separately from covered ones', () => {
    const b = emptyBucket('c', 0);
    addScan(b, scan({}));
    addScan(
      b,
      scan({
        cellular: {
          available: true,
          cells: [
            { tech: 'lte', registered: true, dbm: -95, level: 2, cellId: '1', channel: 1, plmn: '31026' },
            { tech: 'lte', registered: false, dbm: -105, level: 1, cellId: '2', channel: 1, plmn: '31026' },
          ],
        },
      })
    );
    const s = summarize([b]);
    expect(s.cellularCoverage).toBe(0.5);
    expect(s.cellularMeanDbm).toBe(-95);
    expect(b.cellular.maxCells).toBe(2);
  });

  it('averages Wi-Fi, Bluetooth and GNSS', () => {
    const b = emptyBucket('c', 0);
    addScan(b, scan({ wifi: { available: true, count: 4, strongestDbm: -60 }, bluetooth: { available: true, count: 10 }, gnss: { avgCn0Used: 30, used: 8 } }));
    addScan(b, scan({ wifi: { available: true, count: 8, strongestDbm: -50 }, bluetooth: { available: true, count: 20 }, gnss: { avgCn0Used: 40, used: 10 } }));
    const s = summarize([b]);
    expect(s.wifiMeanCount).toBe(6);
    expect(s.bluetoothMeanCount).toBe(15);
    expect(s.gnssMeanCn0).toBe(35);
    expect(b.wifi.strongestDbmMax).toBe(-50);
  });

  it('ignores unavailable sensors instead of counting zeros', () => {
    const b = emptyBucket('c', 0);
    addScan(b, scan({ cellular: { available: false, cells: [] }, wifi: { available: false }, bluetooth: { available: false } }));
    const s = summarize([b]);
    expect(s.cellularCoverage).toBeNull();
    expect(s.wifiMeanCount).toBeNull();
    expect(s.bluetoothMeanCount).toBeNull();
  });
});

describe('beacons and hex distance', () => {
  it('measures hex distance', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
    expect(hexDistance({ q: -2, r: 1 }, { q: 2, r: -1 })).toBe(4);
  });

  it('counts how often a venue tag was heard, without keeping addresses', () => {
    const b = emptyBucket('c', 0);
    const base: ScanResult = { atMs: 0, cellular: { available: false, cells: [] }, wifi: { available: false }, bluetooth: { available: true, count: 9, beaconSeen: true, beaconRssi: -70 }, gnss: {} };
    addScan(b, { ...base, beaconName: 'azm-cafe' });
    addScan(b, { ...base, bluetooth: { available: true, count: 8, beaconSeen: false, beaconRssi: null }, beaconName: 'azm-cafe' });
    addScan(b, { ...base, bluetooth: { available: true, count: 8, beaconSeen: true, beaconRssi: -55 }, beaconName: 'azm-cafe' });
    expect(b.beacon).toEqual({ name: 'azm-cafe', samples: 3, seen: 2, rssiMax: -55 });
    expect(JSON.stringify(b)).not.toMatch(/address|mac/i);
  });

  it('does not record a beacon when none was requested', () => {
    const b = emptyBucket('c', 0);
    addScan(b, { atMs: 0, cellular: { available: false, cells: [] }, wifi: { available: false }, bluetooth: { available: true, count: 3 }, gnss: {} });
    expect(b.beacon).toBeUndefined();
  });
});
