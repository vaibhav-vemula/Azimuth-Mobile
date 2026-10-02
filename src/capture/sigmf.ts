import { MonitoredSatellite } from '../data/satellites';
import { Observer, Pass, TleRecord } from '../types/satellite';
import { compactUtc } from '../utils/format';

export const RECORDING_SAMPLE_RATE_HZ = 288_000;
export const RECORDING_BYTES_PER_SECOND = RECORDING_SAMPLE_RATE_HZ * 2;
export const DATA_FILE_NAME = 'baseband.cs8';

/** Seconds of recording kept before AOS-triggered start and after LOS. */
export const PRE_PASS_MARGIN_SEC = 30;
export const POST_PASS_MARGIN_SEC = 45;

export type RecordingStatus = 'recording' | 'complete' | 'interrupted' | 'failed';

export interface GainChange {
  /** Seconds into the recording when the gain was changed. */
  atSec: number;
  gainDb: number;
  reason: 'clipping';
}

export interface AutoSetupInfo {
  frequencySource: 'signal' | 'satnogs' | 'default';
  gainReason: 'signal' | 'noise-floor' | 'quiet' | 'overload';
  signalSnrDb: number;
}

export interface CaptureMetadataInput {
  satellite: MonitoredSatellite;
  frequencyHz: number;
  gainDb: number | null;
  biasTee: boolean;
  deviceName: string | null;
  pass: Pass;
  tle: TleRecord | null;
  observer: Observer;
  startedAt: Date;
  endedAt?: Date;
  stats?: { bytes: number; samples: number; droppedBlocks: number };
  status: RecordingStatus;
  error?: string | null;
  appVersion: string;
  /** True for recordings made with testing mode outside a real pass. */
  testRecording?: boolean;
  /** How the frequency and gain were chosen by the automatic set-up. */
  autoSetup?: AutoSetupInfo;
  gainChanges?: GainChange[];
}

/** Folder name for a recording, for example Meteor-M2-4_20261002T154200Z. */
export function recordingName(satellite: MonitoredSatellite, startedAt: Date): string {
  return `${satellite.name.replace(/[^A-Za-z0-9]+/g, '-')}_${compactUtc(startedAt)}`;
}

export function estimateRecordingBytes(durationSec: number): number {
  return Math.ceil(Math.max(0, durationSec) * RECORDING_BYTES_PER_SECOND);
}

/** Free space needed to start: the expected file plus headroom for slack and the OS. */
export function requiredFreeBytes(durationSec: number): number {
  return Math.ceil(estimateRecordingBytes(durationSec) * 1.25) + 200 * 1024 * 1024;
}

/** Rounds to 0.01 degrees (about 1 km): enough for context, not a precise home address. */
export function coarsen(valueDeg: number): number {
  return Math.round(valueDeg * 100) / 100;
}

/**
 * SigMF 1.0.0 metadata describing baseband.cs8 (signed 8-bit I/Q, i.e. SigMF datatype "ci8").
 * Fields with the "azimuth:" prefix are app extensions that SigMF-aware tools ignore.
 */
export function buildSigmfMetadata(input: CaptureMetadataInput) {
  const { satellite, pass, tle, observer } = input;
  const samples = input.stats?.samples;

  return {
    global: {
      'core:datatype': 'ci8',
      'core:sample_rate': RECORDING_SAMPLE_RATE_HZ,
      'core:version': '1.0.0',
      'core:dataset': DATA_FILE_NAME,
      'core:recorder': `Azimuth ${input.appVersion}`,
      'core:hw': input.deviceName ?? 'RTL-SDR',
      'core:description': `${satellite.name} LRPT pass recorded ${input.startedAt.toISOString()}`,
      'core:geolocation': {
        type: 'Point',
        coordinates: [coarsen(observer.longitudeDeg), coarsen(observer.latitudeDeg)],
      },
      'azimuth:test_recording': input.testRecording ?? false,
      'azimuth:status': input.status,
      'azimuth:error': input.error ?? null,
      'azimuth:satellite': { name: satellite.name, noradId: satellite.noradId },
      'azimuth:gain_db': input.gainDb,
      'azimuth:gain_mode': input.gainDb === null ? 'tuner-agc' : 'manual',
      'azimuth:auto_setup': input.autoSetup
        ? {
            frequency_source: input.autoSetup.frequencySource,
            gain_reason: input.autoSetup.gainReason,
            signal_snr_db: Math.round(input.autoSetup.signalSnrDb * 10) / 10,
          }
        : null,
      'azimuth:gain_changes': (input.gainChanges ?? []).map((c) => ({ at_sec: Math.round(c.atSec * 10) / 10, gain_db: c.gainDb, reason: c.reason })),
      'azimuth:bias_tee': input.biasTee,
      'azimuth:decimation': { input_rate: 2_304_000, factor: 8, agc: true },
      'azimuth:pass': {
        aos: pass.riseTime.toISOString(),
        tca: pass.maxElevationTime.toISOString(),
        los: pass.setTime.toISOString(),
        max_elevation_deg: Math.round(pass.maxElevationDeg * 10) / 10,
        aos_azimuth_deg: Math.round(pass.riseAzimuthDeg),
        los_azimuth_deg: Math.round(pass.setAzimuthDeg),
      },
      'azimuth:tle': tle ? [tle.line1, tle.line2] : null,
      'azimuth:ended_at': input.endedAt ? input.endedAt.toISOString() : null,
      'azimuth:bytes': input.stats?.bytes ?? null,
      'azimuth:samples': samples ?? null,
      'azimuth:dropped_blocks': input.stats?.droppedBlocks ?? null,
      'azimuth:duration_sec': samples !== undefined ? Math.round((samples / RECORDING_SAMPLE_RATE_HZ) * 10) / 10 : null,
    },
    captures: [
      {
        'core:sample_start': 0,
        'core:frequency': input.frequencyHz,
        'core:datetime': input.startedAt.toISOString(),
      },
    ],
    annotations: [] as unknown[],
  };
}

export interface ParsedRecording {
  satelliteName: string | null;
  noradId: string | null;
  frequencyHz: number | null;
  startedAt: Date | null;
  durationSec: number | null;
  maxElevationDeg: number | null;
  droppedBlocks: number | null;
  status: RecordingStatus | null;
  error: string | null;
  testRecording: boolean;
}

/** Reads back what the Recordings list needs; tolerant of missing or foreign metadata. */
export function parseRecordingMetadata(json: string | null): ParsedRecording {
  const empty: ParsedRecording = {
    satelliteName: null,
    noradId: null,
    frequencyHz: null,
    startedAt: null,
    durationSec: null,
    maxElevationDeg: null,
    droppedBlocks: null,
    status: null,
    error: null,
    testRecording: false,
  };
  if (!json) return empty;
  try {
    const parsed = JSON.parse(json);
    const global = parsed?.global ?? {};
    const capture = parsed?.captures?.[0] ?? {};
    const datetime = capture['core:datetime'];
    return {
      satelliteName: global['azimuth:satellite']?.name ?? null,
      noradId: global['azimuth:satellite']?.noradId ?? null,
      frequencyHz: typeof capture['core:frequency'] === 'number' ? capture['core:frequency'] : null,
      startedAt: datetime ? new Date(datetime) : null,
      durationSec: typeof global['azimuth:duration_sec'] === 'number' ? global['azimuth:duration_sec'] : null,
      maxElevationDeg: typeof global['azimuth:pass']?.max_elevation_deg === 'number' ? global['azimuth:pass'].max_elevation_deg : null,
      droppedBlocks: typeof global['azimuth:dropped_blocks'] === 'number' ? global['azimuth:dropped_blocks'] : null,
      status: global['azimuth:status'] ?? null,
      error: global['azimuth:error'] ?? null,
      testRecording: global['azimuth:test_recording'] === true,
    };
  } catch {
    return empty;
  }
}
