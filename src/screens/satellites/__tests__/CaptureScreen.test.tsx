import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

jest.mock('../../../../modules/rtl-sdr', () => ({
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
  setAudioEnabled: jest.fn(),
  setBiasTee: jest.fn(),
  setGain: jest.fn(),
  setSampleRate: jest.fn(),
  setVolume: jest.fn(),
  startStream: jest.fn(),
  stopStream: jest.fn(),
  tune: jest.fn(),
  exportRecording: jest.fn(),
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  writeRecordingMetadata: jest.fn(),
  getFreeStorageBytes: jest.fn(async () => 50e9),
}));
jest.mock('../../../capture/autoSetup', () => ({ SCAN_CENTER_HZ: 137_500_000, calibrate: jest.fn(() => new Promise(() => undefined)), monitor: jest.fn() }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: async () => ({ granted: true }), requestPermissionsAsync: async () => ({ granted: true }), SchedulableTriggerInputTypes: { DATE: 'date' } }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }), useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import { MONITORED_SATELLITES } from '../../../data/satellites';
import { useAutoSetup } from '../../../capture/autoSetupStore';
import { useCapture } from '../../../capture/useCapture';
import { useReceiver } from '../../../receiver/useReceiver';
import { defaultSettings } from '../../../state/settingsStorage';
import { useAppStore } from '../../../state/useAppStore';
import CaptureScreen from '../CaptureScreen';

const satellite = MONITORED_SATELLITES[0];
const NOW = Date.now();
const pass = {
  id: 'p1',
  noradId: satellite.noradId,
  riseTime: new Date(NOW + 2 * 60_000),
  setTime: new Date(NOW + 12 * 60_000),
  maxElevationTime: new Date(NOW + 7 * 60_000),
  maxElevationDeg: 62,
  riseAzimuthDeg: 280,
  maxAzimuthDeg: 10,
  setAzimuthDeg: 100,
  durationSec: 600,
};
const plan = { noradId: satellite.noradId, frequencyHz: 137_900_000, frequencySource: 'signal' as const, gainDb: 33.8, gainReason: 'signal' as const, signalSnrDb: 8, at: NOW };

function flat(children: unknown): string {
  return Array.isArray(children) ? children.map(flat).join('') : typeof children === 'string' || typeof children === 'number' ? String(children) : '';
}

function texts(tree: renderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((t) => flat(t.props.children));
}

const mounted: renderer.ReactTestRenderer[] = [];
async function render() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<CaptureScreen />);
  });
  mounted.push(tree);
  return tree;
}

beforeEach(() => {
  useAutoSetup.getState().reset();
  useCapture.getState().reset();
  useAppStore.setState({ settings: { ...defaultSettings(), captureTestMode: false }, location: { latitudeDeg: 38.9, longitudeDeg: -77, heightKm: 0.05 } });
  useCapture.setState({ phase: 'idle', options: { pass, satellite, tle: null }, plan: null, result: null, error: null, progress: null });
  useReceiver.setState({ status: 'disconnected', deviceName: null, gains: [], sampleRate: 2_400_000, busy: false, error: null });
});

afterEach(async () => {
  while (mounted.length) await act(async () => mounted.pop()!.unmount());
});

describe('Capture screen', () => {
  it('asks to connect when the receiver is not connected, and says so', async () => {
    const t = texts(await render());
    expect(t).toContain('Connect receiver');
    expect(t).toContain('Receiver not connected');
    expect(t).toContain('Offline');
  });

  it('offers to start recording once connected', async () => {
    useReceiver.setState({ status: 'connected', deviceName: 'RTL-SDR Blog V4 (R828D)' });
    const t = texts(await render());
    expect(t).toContain('Start recording');
    expect(t).not.toContain('Connect receiver');
    expect(t).toContain('RTL-SDR Blog V4 (R828D)');
    expect(t).toContain('Connected');
  });

  it('shows the automatic set-up steps instead of any manual controls', async () => {
    useReceiver.setState({ status: 'connected', deviceName: 'RTL-SDR Blog V4 (R828D)' });
    const all = texts(await render()).join(' | ');
    expect(all).toContain('AUTOMATIC SET-UP');
    for (const step of ['Receiver', 'Frequency', 'Gain', 'Signal']) expect(all).toContain(step);
    // The manual controls are gone.
    for (const manual of ['Bias-tee (powers an LNA)', 'Less', 'More', 'Monitor signal first', 'Auto · ']) expect(all).not.toContain(manual);
  });

  it('puts the primary button above the receiver and set-up cards', async () => {
    useReceiver.setState({ status: 'connected', deviceName: 'RTL-SDR Blog V4 (R828D)' });
    const t = texts(await render());
    expect(t.indexOf('Start recording')).toBeGreaterThan(-1);
    expect(t.indexOf('AUTOMATIC SET-UP')).toBeGreaterThan(-1);
    expect(t.indexOf('Start recording')).toBeLessThan(t.indexOf('AUTOMATIC SET-UP'));
    expect(t.indexOf('Connected over USB')).toBeGreaterThan(-1);
    expect(t.indexOf('Start recording')).toBeLessThan(t.indexOf('Connected over USB'));
  });

  it('shows the chosen frequency and gain once the set-up has a plan', async () => {
    useReceiver.setState({ status: 'streaming', deviceName: 'RTL-SDR Blog V4 (R828D)', sampleRate: 2_304_000 });
    useAutoSetup.setState({ status: 'ready', plan, analysis: { verdict: 'lrpt', snrDb: 8 } });
    const all = texts(await render()).join(' | ');
    expect(all).toContain('137.900 MHz · signal detected here');
    expect(all).toContain('33.8 dB');
    expect(all).toContain('LRPT signal found, 8.0 dB above the noise');
    expect(all).toContain('Ready');
  });

  it('shows Stop recording and live statistics while recording', async () => {
    useReceiver.setState({ status: 'streaming', sampleRate: 2_304_000 });
    useCapture.setState({
      phase: 'recording',
      plan,
      currentGainDb: 32.8,
      progress: { active: true, name: 'x', bytes: 5_760_000, samples: 2_880_000, droppedBlocks: 0, elapsedMs: 10_000, error: null },
    });
    const all = texts(await render()).join(' | ');
    expect(all).toContain('Stop recording');
    expect(all).toContain('Recording');
    expect(all).toContain('5.49 MB');
    expect(all).toContain('The gain was lowered from 33.8 dB to 32.8 dB');
  });

  it('shows the result with Done, Share and Export after a recording', async () => {
    useCapture.setState({
      phase: 'complete',
      plan,
      result: { name: 'Meteor-M2-4_20261002T190000Z', directory: '/x', bytes: 5_760_000, samples: 2_880_000, droppedBlocks: 0, durationSec: 10, interrupted: false, error: null },
    });
    const all = texts(await render()).join(' | ');
    expect(all).toContain('Done');
    expect(all).toContain('Recording saved');
    expect(all).toContain('Share');
    expect(all).toContain('Export');
    expect(all).toContain('Recorded at 137.900 MHz with 33.8 dB gain, chosen automatically.');
  });

  it('shows a failure clearly and still offers Done', async () => {
    useCapture.setState({ phase: 'error', error: 'Not enough free storage: this pass needs about 600 MB but only 10 MB is free.' });
    const all = texts(await render()).join(' | ');
    expect(all).toContain('Not enough free storage');
    expect(all).toContain('Done');
    expect(all).toContain('Failed');
  });

  it('explains a set-up failure with the failing step and a retry', async () => {
    useReceiver.setState({ status: 'connected', deviceName: 'RTL-SDR' });
    useAutoSetup.setState({ status: 'error', error: 'The receiver is not delivering data. Unplug it, plug it back in and reconnect.' });
    const all = texts(await render()).join(' | ');
    expect(all).toContain('not delivering data');
    expect(all).toContain('Retry set-up');
  });
});
