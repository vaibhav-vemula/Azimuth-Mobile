import { MONITORED_SATELLITES } from '../data/satellites';
import { Pass } from '../types/satellite';
import {
  RECORDING_BYTES_PER_SECOND,
  buildSigmfMetadata,
  coarsen,
  estimateRecordingBytes,
  parseRecordingMetadata,
  recordingName,
  requiredFreeBytes,
} from './sigmf';

const satellite = MONITORED_SATELLITES.find((s) => s.noradId === '59051')!;
const pass: Pass = {
  noradId: '59051',
  riseTime: new Date('2026-10-02T19:20:00Z'),
  maxElevationTime: new Date('2026-10-02T19:24:30Z'),
  setTime: new Date('2026-10-02T19:29:10Z'),
  maxElevationDeg: 84.94,
  riseAzimuthDeg: 281.3,
  maxAzimuthDeg: 20,
  setAzimuthDeg: 96.4,
  durationSec: 550,
};
const input = {
  satellite,
  frequencyHz: 137_900_000,
  gainDb: 28.0,
  biasTee: true,
  deviceName: 'RTL-SDR Blog V4 (R828D)',
  pass,
  tle: { noradId: '59051', name: 'METEOR-M2 4', line1: '1 59051U', line2: '2 59051' },
  observer: { latitudeDeg: 38.90723, longitudeDeg: -77.03687, heightKm: 0.05 },
  startedAt: new Date('2026-10-02T19:19:30Z'),
  appVersion: '1.0.0',
};

describe('recording names', () => {
  it('produces a folder name that is safe on every file system', () => {
    const name = recordingName(satellite, input.startedAt);
    expect(name).toBe('Meteor-M2-4_20261002T191930Z');
    expect(name).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/);
  });
});

describe('size estimates', () => {
  it('matches the 288 kS/s ci8 data rate', () => {
    expect(RECORDING_BYTES_PER_SECOND).toBe(576_000);
    expect(estimateRecordingBytes(600)).toBe(345_600_000);
    expect(estimateRecordingBytes(-5)).toBe(0);
  });

  it('asks for headroom beyond the expected file size', () => {
    expect(requiredFreeBytes(600)).toBeGreaterThan(estimateRecordingBytes(600) * 1.25);
  });
});

describe('SigMF metadata', () => {
  const meta = buildSigmfMetadata({ ...input, status: 'recording' });

  it('declares the sample format and rate that SatDump needs', () => {
    expect(meta.global['core:datatype']).toBe('ci8');
    expect(meta.global['core:sample_rate']).toBe(288_000);
    expect(meta.global['core:version']).toBe('1.0.0');
    expect(meta.global['core:dataset']).toBe('baseband.cs8');
    expect(meta.captures[0]['core:frequency']).toBe(137_900_000);
    expect(meta.captures[0]['core:sample_start']).toBe(0);
    expect(meta.captures[0]['core:datetime']).toBe('2026-10-02T19:19:30.000Z');
  });

  it('keeps the observer location coarse', () => {
    expect(meta.global['core:geolocation'].coordinates).toEqual([-77.04, 38.91]);
    expect(coarsen(38.90723)).toBe(38.91);
  });

  it('records the pass, the orbital elements used and the receiver settings', () => {
    expect(meta.global['azimuth:pass'].max_elevation_deg).toBe(84.9);
    expect(meta.global['azimuth:tle']).toEqual(['1 59051U', '2 59051']);
    expect(meta.global['azimuth:gain_mode']).toBe('manual');
    expect(buildSigmfMetadata({ ...input, gainDb: null, status: 'recording' }).global['azimuth:gain_mode']).toBe('tuner-agc');
    expect(meta.global['azimuth:bias_tee']).toBe(true);
  });

  it('fills in final statistics when the recording completes', () => {
    const done = buildSigmfMetadata({
      ...input,
      status: 'complete',
      endedAt: new Date('2026-10-02T19:30:00Z'),
      stats: { bytes: 5_760_000, samples: 2_880_000, droppedBlocks: 0 },
    });
    expect(done.global['azimuth:duration_sec']).toBe(10);
    expect(done.global['azimuth:bytes']).toBe(5_760_000);
    expect(done.global['azimuth:dropped_blocks']).toBe(0);
    expect(done.global['azimuth:status']).toBe('complete');
  });

  it('round-trips through the parser used by the Recordings list', () => {
    const parsed = parseRecordingMetadata(
      JSON.stringify(
        buildSigmfMetadata({
          ...input,
          status: 'complete',
          endedAt: new Date('2026-10-02T19:30:00Z'),
          stats: { bytes: 5_760_000, samples: 2_880_000, droppedBlocks: 3 },
        })
      )
    );
    expect(parsed.satelliteName).toBe('Meteor-M2 4');
    expect(parsed.noradId).toBe('59051');
    expect(parsed.frequencyHz).toBe(137_900_000);
    expect(parsed.durationSec).toBe(10);
    expect(parsed.droppedBlocks).toBe(3);
    expect(parsed.maxElevationDeg).toBe(84.9);
    expect(parsed.status).toBe('complete');
    expect(parsed.startedAt?.toISOString()).toBe('2026-10-02T19:19:30.000Z');
  });

  it('flags test recordings so they are not mistaken for real passes', () => {
    const real = buildSigmfMetadata({ ...input, status: 'recording' });
    const test = buildSigmfMetadata({ ...input, status: 'complete', testRecording: true });
    expect(real.global['azimuth:test_recording']).toBe(false);
    expect(test.global['azimuth:test_recording']).toBe(true);
    expect(parseRecordingMetadata(JSON.stringify(test)).testRecording).toBe(true);
    expect(parseRecordingMetadata(JSON.stringify(real)).testRecording).toBe(false);
  });

  it('records how the automatic set-up chose the settings, and any gain steps during the pass', () => {
    const meta = buildSigmfMetadata({
      ...input,
      status: 'complete',
      autoSetup: { frequencySource: 'signal', gainReason: 'signal', signalSnrDb: 9.46 },
      gainChanges: [{ atSec: 123.456, gainDb: 32.8, reason: 'clipping' }],
    });
    expect(meta.global['azimuth:auto_setup']).toEqual({ frequency_source: 'signal', gain_reason: 'signal', signal_snr_db: 9.5 });
    expect(meta.global['azimuth:gain_changes']).toEqual([{ at_sec: 123.5, gain_db: 32.8, reason: 'clipping' }]);
    expect(buildSigmfMetadata({ ...input, status: 'recording' }).global['azimuth:gain_changes']).toEqual([]);
  });

  it('tolerates missing or corrupt metadata', () => {
    expect(parseRecordingMetadata(null).satelliteName).toBeNull();
    expect(parseRecordingMetadata('not json').status).toBeNull();
    expect(parseRecordingMetadata('{}').frequencyHz).toBeNull();
  });
});
