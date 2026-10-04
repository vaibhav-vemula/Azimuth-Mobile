jest.mock('../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 500_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
  addRecordingListener: jest.fn(),
  connect: jest.fn(async () => ({})),
  disconnect: jest.fn(),
  getGains: jest.fn(async () => []),
  setAudioEnabled: jest.fn(async () => undefined),
  setBiasTee: jest.fn(async () => undefined),
  setGain: jest.fn(async () => 0),
  setSampleRate: jest.fn(async () => undefined),
  setVolume: jest.fn(),
  startStream: jest.fn(async () => undefined),
  stopStream: jest.fn(async () => undefined),
  tune: jest.fn(async () => undefined),
  startRecording: jest.fn(async () => ({ directory: '/data/captures/x', dataPath: '/data/captures/x/baseband.cs8', metadataPath: '' })),
  stopRecording: jest.fn(async () => ({ active: false, bytes: 5_760_000, samples: 2_880_000, droppedBlocks: 0, error: null })),
  writeRecordingMetadata: jest.fn(async () => undefined),
  getFreeStorageBytes: jest.fn(async () => 50e9),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('expo-location', () => ({}));
jest.mock('./autoSetup', () => ({
  SCAN_CENTER_HZ: 137_500_000,
  calibrate: jest.fn(),
  monitor: jest.fn(async () => undefined),
}));

import { MONITORED_SATELLITES } from '../data/satellites';
import { frameCollector } from '../receiver/frameCollector';
import { useReceiver } from '../receiver/useReceiver';
import { defaultSettings } from '../state/settingsStorage';
import { SatellitePass, useAppStore } from '../state/useAppStore';
import { SetupPlan, calibrate } from './autoSetup';
import { useAutoSetup } from './autoSetupStore';
import { useCapture } from './useCapture';

const rtl = jest.requireMock('../../modules/rtl-sdr') as Record<string, jest.Mock>;
const calibrateMock = calibrate as jest.Mock;

const R828D = [0.0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28.0, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48.0, 49.6];
const NOW = Date.parse('2026-10-02T19:00:00Z');
const satellite = MONITORED_SATELLITES.find((s) => s.noradId === '59051')!;

const plan: SetupPlan = {
  noradId: '59051',
  frequencyHz: 137_900_000,
  frequencySource: 'signal',
  gainDb: 33.8,
  gainReason: 'signal',
  signalSnrDb: 9.2,
  at: NOW,
};

function passAt(riseOffsetMin: number, durationMin = 10): SatellitePass {
  const riseTime = new Date(NOW + riseOffsetMin * 60_000);
  const setTime = new Date(riseTime.getTime() + durationMin * 60_000);
  return {
    id: `59051-${riseOffsetMin}`,
    noradId: '59051',
    riseTime,
    setTime,
    maxElevationTime: new Date((riseTime.getTime() + setTime.getTime()) / 2),
    maxElevationDeg: 62,
    riseAzimuthDeg: 280,
    maxAzimuthDeg: 10,
    setAzimuthDeg: 100,
    durationSec: durationMin * 60,
  };
}

const options = (pass = passAt(2)) => ({ pass, satellite, tle: null });

function metadataWrites(): any[] {
  return rtl.writeRecordingMetadata.mock.calls.map((c) => JSON.parse(c[1]));
}

async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  Object.values(rtl).forEach((fn) => {
    if (typeof fn === 'function') fn.mockClear();
  });
  rtl.getFreeStorageBytes.mockResolvedValue(50e9);
  calibrateMock.mockReset();
  calibrateMock.mockResolvedValue(plan);

  useAutoSetup.getState().reset();
  useCapture.getState().reset();
  useAppStore.setState({
    settings: { ...defaultSettings(), biasTee: true, captureTestMode: false },
    location: { latitudeDeg: 38.9, longitudeDeg: -77, heightKm: 0.05 },
  });
  useReceiver.setState({ status: 'connected', deviceName: 'RTL-SDR Blog V4 (R828D)', gains: R828D, sampleRate: 2_400_000, streamAction: null });
  frameCollector.reset();
});

afterEach(async () => {
  if (useCapture.getState().phase === 'recording') await useCapture.getState().stop('user');
  jest.useRealTimers();
});

describe('starting a capture', () => {
  it('runs the automatic set-up, applies its settings and records', async () => {
    await useCapture.getState().start(options());

    expect(calibrateMock).toHaveBeenCalledTimes(1);
    expect(rtl.setSampleRate).toHaveBeenCalledWith(2_304_000);
    expect(rtl.tune).toHaveBeenLastCalledWith(137_900_000);
    expect(rtl.setGain).toHaveBeenLastCalledWith(33.8); // a number: manual gain, never the tuner's AGC
    expect(rtl.setBiasTee).toHaveBeenLastCalledWith(true); // from Settings, not chosen per capture
    expect(rtl.startRecording).toHaveBeenCalledTimes(1);
    const [name, label, maxMs, fullBand] = rtl.startRecording.mock.calls[0];
    expect(fullBand).toBe(true); // full band by default, the way SatDump records
    expect(name).toMatch(/^Meteor-M2-4_\d{8}T\d{6}Z$/);
    expect(label).toBe('Meteor-M2 4 pass');
    expect(maxMs).toBeGreaterThan(10 * 60_000); // runs to the end of the pass plus the margin
    expect(useCapture.getState().phase).toBe('recording');
  });

  it('writes metadata that records how the settings were chosen', async () => {
    await useCapture.getState().start(options());
    const first = metadataWrites()[0].global;
    expect(first['azimuth:status']).toBe('recording');
    expect(first['azimuth:gain_mode']).toBe('manual');
    expect(first['azimuth:gain_db']).toBe(33.8);
    expect(first['azimuth:bias_tee']).toBe(true);
    expect(first['azimuth:auto_setup']).toEqual({ frequency_source: 'signal', gain_reason: 'signal', signal_snr_db: 9.2 });
    expect(first['azimuth:test_recording']).toBe(false);
    expect(first['core:sample_rate']).toBe(2_304_000);
    expect(first['azimuth:recording_format']).toBe('fullband');
    expect(metadataWrites()[0].captures[0]['core:frequency']).toBe(137_900_000);
  });

  it('reuses a fresh plan from the set-up already running instead of sweeping again', async () => {
    useAutoSetup.setState({ plan, status: 'ready' });
    await useCapture.getState().start(options());
    expect(calibrateMock).not.toHaveBeenCalled();
    expect(rtl.tune).toHaveBeenLastCalledWith(137_900_000);
  });

  it('makes a new plan when the old one is stale', async () => {
    useAutoSetup.setState({ plan: { ...plan, at: NOW - 30 * 60_000 }, status: 'ready' });
    await useCapture.getState().start(options());
    expect(calibrateMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to start without enough free storage', async () => {
    rtl.getFreeStorageBytes.mockResolvedValue(10_000);
    await useCapture.getState().start(options());
    expect(useCapture.getState().phase).toBe('error');
    expect(useCapture.getState().error).toMatch(/Not enough free storage/);
    expect(rtl.startRecording).not.toHaveBeenCalled();
  });

  it('records the compact format when chosen, and needs far less free space for it', async () => {
    useAppStore.setState({ settings: { ...defaultSettings(), captureTestMode: false, recordingFormat: 'compact' } });
    rtl.getFreeStorageBytes.mockResolvedValue(1_500_000_000); // plenty for compact, not for full band
    await useCapture.getState().start(options());
    expect(useCapture.getState().phase).toBe('recording');
    expect(rtl.startRecording.mock.calls[0][3]).toBe(false);
    expect(metadataWrites()[0].global['core:sample_rate']).toBe(288_000);
    expect(metadataWrites()[0].global['azimuth:recording_format']).toBe('compact');
  });

  it('refuses a full-band recording when only compact would fit', async () => {
    rtl.getFreeStorageBytes.mockResolvedValue(1_500_000_000);
    await useCapture.getState().start(options());
    expect(useCapture.getState().phase).toBe('error');
    expect(useCapture.getState().error).toMatch(/Not enough free storage/);
    expect(rtl.startRecording).not.toHaveBeenCalled();
  });

  it('reports a failed set-up and leaves the receiver in normal mode', async () => {
    calibrateMock.mockRejectedValue(new Error('The receiver is not delivering data.'));
    await useCapture.getState().start(options());
    expect(useCapture.getState().phase).toBe('error');
    expect(useCapture.getState().error).toMatch(/not delivering data/);
    expect(rtl.startRecording).not.toHaveBeenCalled();
    expect(rtl.setSampleRate).toHaveBeenLastCalledWith(2_400_000);
  });

  it('makes a short flagged test recording outside the pass window when testing mode is on', async () => {
    useAppStore.setState({ settings: { ...defaultSettings(), captureTestMode: true } });
    await useCapture.getState().start(options(passAt(180)));
    expect(rtl.startRecording.mock.calls[0][2]).toBe(135_000); // 2 minutes + 15 s safety
    expect(rtl.startRecording.mock.calls[0][3]).toBe(true);
    expect(metadataWrites()[0].global['azimuth:test_recording']).toBe(true);
    expect(useCapture.getState().testRun).toBe(true);
  });
});

describe('during and after the recording', () => {
  it('steps the gain down one notch if the receiver keeps clipping, and notes it', async () => {
    await useCapture.getState().start(options());
    for (let i = 0; i < 40; i += 1) frameCollector.push({ bins: new Array(64).fill(0.3), rms: 0.3, clip: 0.03 });

    jest.advanceTimersByTime(1500);
    await flush();

    expect(rtl.setGain).toHaveBeenLastCalledWith(32.8);
    expect(useCapture.getState().currentGainDb).toBe(32.8);

    await useCapture.getState().stop('user');
    const final = metadataWrites().pop();
    expect(final.global['azimuth:gain_changes']).toEqual([{ at_sec: 1.5, gain_db: 32.8, reason: 'clipping' }]);
  });

  it('leaves the gain alone when there is no clipping', async () => {
    await useCapture.getState().start(options());
    const calls = rtl.setGain.mock.calls.length;
    for (let i = 0; i < 40; i += 1) frameCollector.push({ bins: new Array(64).fill(0.3), rms: 0.12, clip: 0 });
    jest.advanceTimersByTime(4500);
    await flush();
    expect(rtl.setGain.mock.calls.length).toBe(calls);
    expect(useCapture.getState().currentGainDb).toBe(33.8);
  });

  it('finishes cleanly: final metadata, result and the receiver back to normal', async () => {
    await useCapture.getState().start(options());
    useReceiver.setState({ status: 'streaming' }); // the native side reports this once the stream is running
    await useCapture.getState().stop('user');

    const state = useCapture.getState();
    expect(state.phase).toBe('complete');
    expect(state.result).toMatchObject({ bytes: 5_760_000, droppedBlocks: 0, interrupted: true });
    expect(state.result!.format).toBe('fullband');
    expect(state.result!.dataPath).toBe('/data/captures/x/baseband.cs8');
    expect(state.result!.durationSec).toBeCloseTo(1.25, 5); // 2.88 M samples at the 2.304 MS/s full-band rate

    const final = metadataWrites().pop().global;
    expect(final['azimuth:status']).toBe('interrupted'); // stopped before the pass ended
    expect(final['azimuth:bytes']).toBe(5_760_000);
    expect(rtl.stopStream).toHaveBeenCalled();
    expect(rtl.setBiasTee).toHaveBeenLastCalledWith(false); // antenna power off again
    expect(rtl.setSampleRate).toHaveBeenLastCalledWith(2_400_000);
  });

  it('stops by itself shortly after the pass ends', async () => {
    await useCapture.getState().start(options(passAt(0, 10)));
    jest.advanceTimersByTime(10 * 60_000 + 46_000);
    await flush();
    await flush();
    expect(rtl.stopRecording).toHaveBeenCalledTimes(1);
    expect(useCapture.getState().phase).toBe('complete');
    expect(useCapture.getState().result!.interrupted).toBe(false);
    expect(metadataWrites().pop().global['azimuth:status']).toBe('complete');
  });
});
