import { SessionAccumulator, emptyTotals, withoutIds } from '../sessionStats';
import type { MappedScan } from '../aggregate';

const tower = (cellId: string, dbm: number, over: Partial<{ tech: 'lte' | 'nr' | 'wcdma' | 'gsm'; registered: boolean; plmn: string; channel: number }> = {}) => ({
  tech: 'lte' as const,
  registered: false,
  dbm,
  level: 2,
  cellId,
  channel: 5230,
  plmn: '310260',
  ...over,
});
const scan = (over: Partial<MappedScan> = {}): MappedScan => ({
  atMs: 0,
  cellular: { available: true, cells: [] },
  wifi: { available: false },
  bluetooth: null,
  gnss: {},
  ...over,
});

describe('session totals', () => {
  it('starts empty', () => {
    expect(new SessionAccumulator().totals()).toEqual(emptyTotals());
  });

  it('counts different towers once, by kind, however often they are heard', () => {
    const acc = new SessionAccumulator();
    acc.add(scan({ cellular: { available: true, cells: [tower('1', -90, { registered: true }), tower('2', -100), tower('9', -95, { tech: 'nr' })] } }));
    const t = acc.add(scan({ cellular: { available: true, cells: [tower('1', -92, { registered: true }), tower('3', -104, { tech: 'wcdma' })] } }));
    expect(t.towers).toBe(4);
    expect(t.towersByTech).toEqual({ lte: 2, nr: 1, wcdma: 1, gsm: 0 });
  });

  it('tells apart the same tower number on different networks or technologies', () => {
    const acc = new SessionAccumulator();
    const t = acc.add(scan({ cellular: { available: true, cells: [tower('7', -90), tower('7', -91, { plmn: '310410' }), tower('7', -92, { tech: 'gsm' })] } }));
    expect(t.towers).toBe(3);
  });

  it('tracks the connected tower and the strongest-signal range', () => {
    const acc = new SessionAccumulator();
    acc.add(scan({ cellular: { available: true, cells: [tower('1', -80, { registered: true, channel: 66486, tech: 'nr' }), tower('2', -110)] } }));
    const t = acc.add(scan({ cellular: { available: true, cells: [tower('1', -100, { registered: true })] } }));
    expect(t.cellularMax).toBe(-80);
    expect(t.cellularMin).toBe(-100);
    expect(t.cellularAvg).toBe(-90);
    expect(t.serving).toEqual({ tech: 'lte', channel: 5230, plmn: '310260' });
  });

  it('counts dead-zone readings and forgets the serving tower when there is none', () => {
    const acc = new SessionAccumulator();
    acc.add(scan({ cellular: { available: true, cells: [tower('1', -90, { registered: true })] } }));
    const t = acc.add(scan({ cellular: { available: true, cells: [] } }));
    expect(t.deadReadings).toBe(1);
    expect(t.serving).toBeNull();
    expect(t.towers).toBe(1);
  });

  it('counts different Wi-Fi networks and Bluetooth devices from anonymous ids', () => {
    const acc = new SessionAccumulator();
    acc.add(scan({ wifi: { available: true, count: 3, ids: [11, 12, 13], band24: 2, band5: 1, strongestDbm: -60 }, bluetooth: { available: true, count: 2, ids: [1, 2] } }));
    const t = acc.add(scan({ wifi: { available: true, count: 3, ids: [12, 13, 14], band24: 1, band5: 2, strongestDbm: -48 }, bluetooth: { available: true, count: 4, ids: [2, 3, 4, 5] } }));
    expect(t.wifiNow).toBe(3);
    expect(t.wifiUnique).toBe(4); // 11, 12, 13, 14
    expect(t.wifiBands).toEqual({ ghz24: 1, ghz5: 2, ghz6: 0 });
    expect(t.wifiStrongestDbm).toBe(-48);
    expect(t.bluetoothNow).toBe(4);
    expect(t.bluetoothUnique).toBe(5);
    expect(t.bluetoothPeak).toBe(4);
  });

  it('falls back to the biggest count at once when a scanner gives no ids', () => {
    const acc = new SessionAccumulator();
    acc.add(scan({ wifi: { available: true, count: 5 } }));
    const t = acc.add(scan({ wifi: { available: true, count: 3 } }));
    expect(t.wifiUnique).toBe(5);
  });

  it('keeps GPS figures and ignores unavailable sensors', () => {
    const acc = new SessionAccumulator();
    acc.add(scan({ gnss: { used: 7, avgCn0Used: 31 } }));
    const t = acc.add(scan({ gnss: { used: 9, avgCn0Used: 28 }, cellular: { available: false, cells: [] }, wifi: { available: false }, bluetooth: { available: false } }));
    expect(t.gpsUsed).toBe(9);
    expect(t.gpsBestCn0).toBe(31);
    expect(t.towers).toBe(0);
    expect(t.wifiNow).toBe(0);
  });

  it('returns snapshots that later readings do not change', () => {
    const acc = new SessionAccumulator();
    const first = acc.add(scan({ wifi: { available: true, count: 2, ids: [1, 2], band24: 2 } }));
    acc.add(scan({ wifi: { available: true, count: 4, ids: [3, 4, 5, 6], band24: 4 } }));
    expect(first.wifiUnique).toBe(2);
    expect(first.wifiBands.ghz24).toBe(2);
  });

  it('never holds an address: ids are plain numbers and nothing else is kept', () => {
    const acc = new SessionAccumulator();
    const t = acc.add(scan({ wifi: { available: true, count: 1, ids: [123456] } }));
    expect(JSON.stringify(t)).not.toMatch(/ssid|bssid|mac|address/i);
    expect(JSON.stringify(t)).not.toContain('123456');
  });
});

describe('privacy of the ids', () => {
  it('removes them from a scan that is kept', () => {
    const kept = withoutIds(scan({ wifi: { available: true, count: 2, ids: [1, 2] }, bluetooth: { available: true, count: 1, ids: [9] } }));
    expect(kept.wifi.ids).toBeUndefined();
    expect(kept.bluetooth?.ids).toBeUndefined();
    expect(kept.wifi.count).toBe(2);
    expect(JSON.stringify(kept)).not.toContain('ids');
  });

  it('does not change the original scan', () => {
    const original = scan({ wifi: { available: true, count: 2, ids: [1, 2] } });
    withoutIds(original);
    expect(original.wifi.ids).toEqual([1, 2]);
  });

  it('forgets the ids at the end of a session but keeps the totals, and everything on reset', () => {
    const acc = new SessionAccumulator();
    acc.add(scan({ wifi: { available: true, count: 2, ids: [1, 2] } }));
    acc.dropIds();
    expect(acc.totals().wifiUnique).toBe(2);
    // The ids really are gone: a reading after that counts from an empty set (this only happens after a session ends).
    expect(acc.add(scan({ wifi: { available: true, count: 1, ids: [2] } })).wifiUnique).toBe(1);
    acc.reset();
    expect(acc.totals()).toEqual(emptyTotals());
  });
});
