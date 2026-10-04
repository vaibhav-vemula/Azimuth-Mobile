import { SessionRecorder, MAX_FIX_AGE_MS } from '../session';
import type { Fix } from '../session';
import { cellIdAt } from '../hexGrid';
import type { ScanResult } from '../../../modules/signal-scan';

const T0 = Date.UTC(2026, 9, 2, 14, 0, 0);
const here = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };

const scan = (atMs: number): ScanResult => ({
  atMs,
  cellular: { available: true, cells: [{ tech: 'lte', registered: true, dbm: -90, level: 3, cellId: '1', channel: 1, plmn: '1' }] },
  wifi: { available: true, count: 5, strongestDbm: -55 },
  bluetooth: null,
  gnss: {},
});

const fix = (over: Partial<Fix> = {}): Fix => ({ ...here, atMs: T0, accuracyM: 10, mocked: false, ...over });

describe('SessionRecorder', () => {
  it('records a scan against the cell of the latest fix and marks it new', () => {
    const r = new SessionRecorder(new Set(), { now: T0 });
    expect(r.addFix(fix())).toBe(true);
    const out = r.addScan(scan(T0 + 1000));
    expect(out).toMatchObject({ recorded: true, newCell: true, cellId: cellIdAt(here) });
    expect(r.buckets.size).toBe(1);
    expect(r.checks().samples).toBe(1);
  });

  it('does not call a previously visited cell new', () => {
    const r = new SessionRecorder(new Set([cellIdAt(here)]), { now: T0 });
    r.addFix(fix());
    expect(r.addScan(scan(T0 + 1000)).newCell).toBe(false);
  });

  it('counts a new cell once per session', () => {
    const r = new SessionRecorder(new Set(), { now: T0 });
    r.addFix(fix());
    expect(r.addScan(scan(T0 + 1000)).newCell).toBe(true);
    expect(r.addScan(scan(T0 + 2000)).newCell).toBe(false);
    expect(r.newCells.size).toBe(1);
  });

  it('refuses scans with no fix or a stale one', () => {
    const r = new SessionRecorder(new Set(), { now: T0 });
    expect(r.addScan(scan(T0)).reason).toBe('no-fix');
    r.addFix(fix());
    expect(r.addScan(scan(T0 + MAX_FIX_AGE_MS + 1)).reason).toBe('stale-fix');
  });

  it('rejects mock locations and poor accuracy, and counts them', () => {
    const r = new SessionRecorder(new Set(), { now: T0 });
    expect(r.addFix(fix({ mocked: true }))).toBe(false);
    expect(r.addFix(fix({ accuracyM: 500 }))).toBe(false);
    expect(r.addFix(fix({ accuracyM: null }))).toBe(false);
    const c = r.checks();
    expect(c.mockedFixes).toBe(1);
    expect(c.poorAccuracyFixes).toBe(2);
    expect(r.addScan(scan(T0)).reason).toBe('no-fix');
  });

  it('rejects teleporting', () => {
    const r = new SessionRecorder(new Set(), { now: T0 });
    r.addFix(fix());
    const far = fix({ atMs: T0 + 5000, latitudeDeg: here.latitudeDeg + 1 });
    expect(r.addFix(far)).toBe(false);
    expect(r.checks().maxSpeedMps).toBeGreaterThan(1000);
  });

  it('never records inside the home exclusion zone', () => {
    const r = new SessionRecorder(new Set(), { now: T0, home: { ...here, radiusM: 200 } });
    r.addFix(fix());
    const out = r.addScan(scan(T0 + 1000));
    expect(out).toMatchObject({ recorded: false, reason: 'excluded' });
    expect(r.buckets.size).toBe(0);
    expect(r.newCells.size).toBe(0);
  });

  it('puts scans in different time buckets 15 minutes apart', () => {
    const r = new SessionRecorder(new Set(), { now: T0 });
    r.addFix(fix());
    r.addScan(scan(T0 + 1000));
    r.addFix(fix({ atMs: T0 + 16 * 60_000 }));
    r.addScan(scan(T0 + 16 * 60_000 + 1000));
    expect(r.buckets.size).toBe(2);
  });
});
