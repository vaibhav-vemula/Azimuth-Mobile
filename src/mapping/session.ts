import type { ScanResult } from '../../modules/signal-scan';
import { CellBucket, MappedScan, addScan, bucketKey, bucketStartMs, emptyBucket } from './aggregate';
import { DEFAULT_CELL_SIZE_M, LatLon, cellIdAt, distanceM } from './hexGrid';
import type { ReportChecks } from '../reports/report';

export const MAX_ACCURACY_M = 50;
export const MAX_FIX_AGE_MS = 30_000;
/** Faster than this is a plane or a spoofed position, not a person mapping on foot or in a vehicle. */
export const MAX_PLAUSIBLE_SPEED_MPS = 70;

export interface Fix extends LatLon {
  atMs: number;
  accuracyM: number | null;
  mocked: boolean;
}

export interface HomeExclusion extends LatLon {
  radiusM: number;
}

export interface ScanOutcome {
  /** The reading was added to a cell bucket. */
  recorded: boolean;
  /** The fix is in a cell this phone had never visited. */
  newCell: boolean;
  cellId: string | null;
  reason?: 'no-fix' | 'stale-fix' | 'poor-accuracy' | 'mocked' | 'implausible-speed' | 'excluded';
}

/**
 * Turns position fixes and scans into per-cell time buckets and a "visited" set (the fog of war).
 * Pure logic, no I/O, so it can be tested without a phone.
 */
export class SessionRecorder {
  readonly buckets = new Map<string, CellBucket>();
  readonly newCells = new Set<string>();
  private lastFix: Fix | null = null;
  private samples = 0;
  private mockedFixes = 0;
  private poorAccuracyFixes = 0;
  private maxSpeedMps = 0;
  private startedAtMs: number;
  private lastAtMs: number;

  constructor(
    private readonly visited: ReadonlySet<string>,
    private readonly options: { sizeM?: number; home?: HomeExclusion | null; now?: number } = {}
  ) {
    this.startedAtMs = options.now ?? Date.now();
    this.lastAtMs = this.startedAtMs;
  }

  private get sizeM() {
    return this.options.sizeM ?? DEFAULT_CELL_SIZE_M;
  }

  /** Accepts a position fix. Returns false if it is not usable for mapping. */
  addFix(fix: Fix): boolean {
    this.lastAtMs = Math.max(this.lastAtMs, fix.atMs);
    if (fix.mocked) {
      this.mockedFixes += 1;
      return false;
    }
    if (fix.accuracyM === null || fix.accuracyM > MAX_ACCURACY_M) {
      this.poorAccuracyFixes += 1;
      return false;
    }
    if (this.lastFix) {
      const dt = (fix.atMs - this.lastFix.atMs) / 1000;
      if (dt > 0) {
        const speed = distanceM(this.lastFix, fix) / dt;
        this.maxSpeedMps = Math.max(this.maxSpeedMps, speed);
        if (speed > MAX_PLAUSIBLE_SPEED_MPS) return false;
      }
    }
    this.lastFix = fix;
    return true;
  }

  /** Adds a scan to the cell of the latest usable fix. */
  addScan(scan: MappedScan, now: number = scan.atMs): ScanOutcome {
    this.lastAtMs = Math.max(this.lastAtMs, now);
    const fix = this.lastFix;
    if (!fix) return { recorded: false, newCell: false, cellId: null, reason: 'no-fix' };
    if (now - fix.atMs > MAX_FIX_AGE_MS) return { recorded: false, newCell: false, cellId: null, reason: 'stale-fix' };

    const home = this.options.home;
    if (home && distanceM(home, fix) <= home.radiusM) {
      return { recorded: false, newCell: false, cellId: null, reason: 'excluded' };
    }

    const cellId = cellIdAt(fix, this.sizeM);
    const bucket = bucketStartMs(now);
    const key = bucketKey(cellId, bucket);
    let entry = this.buckets.get(key);
    if (!entry) {
      entry = emptyBucket(cellId, bucket);
      this.buckets.set(key, entry);
    }
    addScan(entry, scan);
    this.samples += 1;

    const newCell = !this.visited.has(cellId) && !this.newCells.has(cellId);
    if (newCell) this.newCells.add(cellId);
    return { recorded: true, newCell, cellId };
  }

  checks(): ReportChecks {
    return {
      samples: this.samples,
      mockedFixes: this.mockedFixes,
      poorAccuracyFixes: this.poorAccuracyFixes,
      maxSpeedMps: Math.round(this.maxSpeedMps * 10) / 10,
      durationSec: Math.max(0, Math.round((this.lastAtMs - this.startedAtMs) / 1000)),
    };
  }

  /** Cells to clear from the fog: visited before, or reached this session. */
  allVisited(): string[] {
    return [...this.visited, ...this.newCells];
  }
}
