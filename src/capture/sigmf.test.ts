import { MONITORED_SATELLITES } from '../data/satellites';
import { Pass } from '../types/satellite';
import {
  RECORDING_FORMATS,
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

describe('recording formats', () => {
  it('describes the two formats by their data rates', () => {
    expect(RECORDING_FORMATS.fullband).toMatchObject({ sampleRateHz: 2_304_000, bytesPerSecond: 4_608_000 });
    expect(RECORDING_FORMATS.compact).toMatchObject({ sampleRateHz: 288_000, bytesPerSecond: 576_000 });
    // 2 bytes per complex sample in both.
    for (const f of Object.values(RECORDING_FORMATS)) expect(f.bytesPerSecond).toBe(f.sampleRateHz * 2);
  });
});

describe('size estimates', () => {
  it('defaults to the full-band rate, like SatDump', () => {
    expect(estimateRecordingBytes(600)).toBe(2_764_800_000);
    expect(estimateRecordingBytes(600, 'fullband')).toBe(2_764_800_000);
    expect(estimateRecordingBytes(-5)).toBe(0);
  });

  it('is eight times smaller for the compact format', () => {
    expect(estimateRecordingBytes(600, 'compact')).toBe(345_600_000);
    expect(estimateRecordingBytes(600, 'fullband')).toBe(8 * estimateRecordingBytes(600, 'compact'));
  });

  it('asks for headroom beyond the expected file size', () => {
    for (const format of ['fullband', 'compact'] as const) {
      expect(requiredFreeBytes(600, format)).toBeGreaterThan(estimateRecordingBytes(600, format) * 1.25);
    }
    expect(requiredFreeBytes(600, 'fullband')).toBeGreaterThan(3_600_000_000);
  });
});

describe('SigMF metadata', () => {
  const meta = buildSigmfMetadata({ ...input, status: 'recording' });

  it('declares the sample format and rate that SatDump needs (full band by default)', () => {
    expect(meta.global['core:datatype']).toBe('ci8');
    expect(meta.global['core:sample_rate']).toBe(2_304_000);
    expect(meta.global['azimuth:recording_format']).toBe('fullband');
    expect(meta.global['azimuth:decimation']).toBeNull();
    // Centred on the downlink, covering 2.3 MHz so both Meteor downlinks are inside it.
    expect(meta.global['azimuth:coverage_hz']).toEqual([137_900_000 - 1_152_000, 137_900_000 + 1_152_000]);
    expect(meta.global['core:version']).toBe('1.0.0');
    expect(meta.global['core:dataset']).toBe('baseband.cs8');
    expect(meta.captures[0]['core:frequency']).toBe(137_900_000);
    expect(meta.captures[0]['core:sample_start']).toBe(0);
    expect(meta.captures[0]['core:datetime']).toBe('2026-10-02T19:19:30.000Z');
  });

  it('describes the compact format with its lower rate and the processing applied', () => {
    const compact = buildSigmfMetadata({ ...input, status: 'recording', format: 'compact' });
    expect(compact.global['core:sample_rate']).toBe(288_000);
    expect(compact.global['azimuth:recording_format']).toBe('compact');
    expect(compact.global['azimuth:decimation']).toEqual({ input_rate: 2_304_000, factor: 8, dc_block: true, level_adjust: true });
    expect(compact.global['azimuth:coverage_hz']).toEqual([137_900_000 - 144_000, 137_900_000 + 144_000]);
    expect(compact.global['core:dataset']).toBe('baseband.cs8');
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
      format: 'compact',
      endedAt: new Date('2026-10-02T19:30:00Z'),
      stats: { bytes: 5_760_000, samples: 2_880_000, droppedBlocks: 0 },
    });
    expect(done.global['azimuth:duration_sec']).toBe(10);
    const full = buildSigmfMetadata({ ...input, status: 'complete', stats: { bytes: 46_080_000, samples: 23_040_000, droppedBlocks: 0 } });
    expect(full.global['azimuth:duration_sec']).toBe(10); // same 10 s at the full-band rate
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
          format: 'compact',
          endedAt: new Date('2026-10-02T19:30:00Z'),
          stats: { bytes: 5_760_000, samples: 2_880_000, droppedBlocks: 3 },
        })
      )
    );
    expect(parsed.format).toBe('compact');
    expect(parsed.sampleRateHz).toBe(288_000);
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
