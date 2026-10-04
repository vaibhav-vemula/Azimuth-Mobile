import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { CellBucket } from '../mapping/aggregate';
import { canonicalize } from './canonical';

export const REPORT_VERSION = 1;
/** Domain separation: a signature over a report can never be mistaken for another kind of signed message. */
export const SIGNING_PREFIX = 'azimuth-report-v1\n';

export type ReportType = 'mapping-session' | 'chest-claim' | 'satellite-pass';

/** A recorded satellite pass. Times are exact because the pass itself is a public, predictable event. */
export interface PassSection {
  noradId: string;
  startMs: number;
  endMs: number;
  maxElevationDeg: number;
  frequencyHz: number;
  gainDb: number;
  signalSnrDb: number;
  recording: { bytes: number; samples: number; droppedBlocks: number; sampleRateHz: number; format: string };
}

export interface ReportChecks {
  samples: number;
  /** Position fixes the phone itself flagged as mock locations. */
  mockedFixes: number;
  /** Fixes rejected for poor accuracy. */
  poorAccuracyFixes: number;
  maxSpeedMps: number;
  durationSec: number;
}

export interface Report {
  version: number;
  type: ReportType;
  /** Wallet address (base58) that signs the report. */
  node: string;
  device: { model: string; app: string };
  /** Start of the first time bucket in the report (rounded; exact times stay on the phone). */
  firstBucketMs: number;
  buckets: CellBucket[];
  checks: ReportChecks;
  chest?: { id: string; cellId: string };
  pass?: PassSection;
}

export interface SignedReport {
  report: Report;
  /** Base64 ed25519 signature over {@link signingMessage}. */
  signature: string;
  /** SHA-256 of the canonical report, hex. This is what gets anchored on-chain. */
  hash: string;
}

export function reportHash(report: Report): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalize(report))));
}

/** The exact bytes the wallet signs. */
export function signingMessage(report: Report): Uint8Array {
  return utf8ToBytes(SIGNING_PREFIX + canonicalize(report));
}

export function buildReport(input: {
  type: ReportType;
  node: string;
  device: { model: string; app: string };
  buckets: CellBucket[];
  checks: ReportChecks;
  chest?: { id: string; cellId: string };
  pass?: PassSection;
}): Report {
  const sorted = [...input.buckets].sort((a, b) => a.bucketStartMs - b.bucketStartMs || a.cellId.localeCompare(b.cellId));
  return {
    version: REPORT_VERSION,
    type: input.type,
    node: input.node,
    device: input.device,
    firstBucketMs: sorted.length > 0 ? sorted[0].bucketStartMs : 0,
    buckets: sorted,
    checks: input.checks,
    chest: input.chest,
    pass: input.pass,
  };
}
