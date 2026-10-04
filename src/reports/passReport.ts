import { emptyBucket } from '../mapping/aggregate';
import { bucketStartMs } from '../mapping/aggregate';
import { cellIdAt } from '../mapping/hexGrid';
import type { Observer } from '../types/satellite';
import { RECORDING_FORMATS, RecordingFormat } from '../capture/sigmf';
import { Report, buildReport } from './report';

export interface PassReceiptInput {
  node: string;
  device: { model: string; app: string };
  observer: Observer;
  noradId: string;
  riseMs: number;
  setMs: number;
  maxElevationDeg: number;
  frequencyHz: number;
  gainDb: number;
  signalSnrDb: number;
  format: RecordingFormat;
  bytes: number;
  samples: number;
  droppedBlocks: number;
  /** Open chest to claim with this receipt, if any. */
  chest?: { id: string; cellId: string };
}

/**
 * A signed statement that this receiver recorded this pass: the satellite, the window, the settings and the
 * size of the recording. The recording itself stays on the phone. The verifier checks the claim against the
 * satellite's orbit, so a pass that was not overhead cannot be claimed.
 */
export function buildPassReceipt(input: PassReceiptInput): Report {
  const cellId = cellIdAt(input.observer);
  const bucket = emptyBucket(cellId, bucketStartMs(input.setMs));
  bucket.samples = 1;
  return buildReport({
    type: 'satellite-pass',
    node: input.node,
    device: input.device,
    buckets: [bucket],
    checks: {
      samples: 1,
      mockedFixes: 0,
      poorAccuracyFixes: 0,
      maxSpeedMps: 0,
      durationSec: Math.max(30, Math.round((input.setMs - input.riseMs) / 1000)),
    },
    chest: input.chest,
    pass: {
      noradId: input.noradId,
      startMs: input.riseMs,
      endMs: input.setMs,
      maxElevationDeg: Math.round(input.maxElevationDeg * 10) / 10,
      frequencyHz: input.frequencyHz,
      gainDb: input.gainDb,
      signalSnrDb: input.signalSnrDb,
      recording: {
        bytes: input.bytes,
        samples: input.samples,
        droppedBlocks: input.droppedBlocks,
        sampleRateHz: RECORDING_FORMATS[input.format].sampleRateHz,
        format: input.format,
      },
    },
  });
}
