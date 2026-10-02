import React from 'react';
import { Platform, Text, TextInput } from 'react-native';
import renderer, { act, ReactTestInstance } from 'react-test-renderer';

const mockSignalListeners: ((e: { bins: number[] }) => void)[] = [];
jest.mock('../../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 500_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn((l: (e: { bins: number[] }) => void) => {
    mockSignalListeners.push(l);
    return { remove: jest.fn() };
  }),
  addStatusListener: jest.fn(() => ({ remove: jest.fn() })),
  addRecordingListener: jest.fn(() => ({ remove: jest.fn() })),
  connect: jest.fn(),
  disconnect: jest.fn(),
  getGains: jest.fn(async () => []),
  setAudioEnabled: jest.fn(async () => undefined),
  setBiasTee: jest.fn(),
  setGain: jest.fn(),
  setSampleRate: jest.fn(),
  setVolume: jest.fn(),
  startStream: jest.fn(async () => undefined),
  stopStream: jest.fn(),
  tune: jest.fn(async () => undefined),
  startRecording: jest.fn(),
  stopRecording: jest.fn(),
  writeRecordingMetadata: jest.fn(),
  getFreeStorageBytes: jest.fn(async () => 1e12),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true, useNavigation: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const rtl = jest.requireMock('../../../../modules/rtl-sdr') as Record<string, jest.Mock>;

let tunerRenders = 0;
let spectrumRenders = 0;
jest.mock('../components/FrequencyTuner', () => ({
  FrequencyTuner: () => {
    tunerRenders += 1;
    return null;
  },
}));
jest.mock('../../../components/LiveSpectrum', () => ({
  LiveSpectrum: () => {
    spectrumRenders += 1;
    return null;
  },
}));

import RadioScreen from '../RadioScreen';
import { useReceiver } from '../../../receiver/useReceiver';

const frame = (seed: number) => Array.from({ length: 64 }, (_, i) => 0.2 + 0.3 * Math.abs(Math.sin((i + seed) / 5)));

function flat(children: unknown): string {
  return Array.isArray(children) ? children.map(flat).join('') : typeof children === 'string' || typeof children === 'number' ? String(children) : '';
}

describe('Radio screen under a stream of spectrum frames', () => {
  it('does not re-render the screen or its controls for each frame', () => {
    Platform.OS = 'android';
    useReceiver.getState().init();
    useReceiver.setState({ status: 'streaming', deviceName: 'RTL-SDR Blog V4', sampleRate: 2_400_000 });

    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<RadioScreen />);
    });
    const tunerBefore = tunerRenders;
    expect(tunerBefore).toBeGreaterThan(0);

    for (let i = 0; i < 60; i += 1) {
      act(() => {
        useReceiver.setState({ bins: frame(i) });
      });
    }
    expect(tunerRenders).toBe(tunerBefore);
    act(() => tree.unmount());
  });
});

import { FrequencyTuner } from '../components/FrequencyTuner';
const RealTuner = jest.requireActual('../components/FrequencyTuner').FrequencyTuner as typeof FrequencyTuner;

function pressByLabel(tree: renderer.ReactTestRenderer, label: string) {
  const text = tree.root.findAllByType(Text).find((t) => flat(t.props.children) === label);
  if (!text) throw new Error(`No button labelled ${label}`);
  let node: ReactTestInstance | null = text;
  while (node && !node.props.onPress) node = node.parent;
  if (!node) throw new Error(`${label} is not pressable`);
  return act(async () => {
    node!.props.onPress();
  });
}

describe('FrequencyTuner', () => {
  beforeEach(() => {
    rtl.tune.mockClear();
    useReceiver.setState({ frequencyHz: 100_000_000, status: 'streaming', error: null });
  });

  const mounted: renderer.ReactTestRenderer[] = [];
  afterEach(() => {
    // Unmount so the component's timers cannot fire after the test environment is gone.
    while (mounted.length) act(() => mounted.pop()!.unmount());
  });

  async function mount() {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RealTuner disabled={false} />);
    });
    mounted.push(tree);
    return tree;
  }

  it('keeps what you type while spectrum frames and status updates arrive', async () => {
    const tree = await mount();
    const input = () => tree.root.findByType(TextInput);

    await act(async () => {
      input().props.onFocus();
      input().props.onChangeText('98.7');
    });
    for (let i = 0; i < 40; i += 1) {
      await act(async () => {
        useReceiver.setState({ bins: frame(i) });
      });
    }
    // The receiver reports a different frequency (for example a status event) while you are typing.
    await act(async () => {
      useReceiver.setState({ frequencyHz: 101_000_000 });
    });
    expect(input().props.value).toBe('98.7');
  });

  it('tunes to exactly what was typed when Tune is pressed', async () => {
    const tree = await mount();
    await act(async () => {
      tree.root.findByType(TextInput).props.onFocus();
      tree.root.findByType(TextInput).props.onChangeText('98.7');
    });
    await pressByLabel(tree, 'Tune');

    expect(rtl.tune).toHaveBeenCalledTimes(1);
    expect(rtl.tune).toHaveBeenCalledWith(98_700_000);
    expect(useReceiver.getState().frequencyHz).toBe(98_700_000);
    const texts = tree.root.findAllByType(Text).map((t) => flat(t.props.children));
    expect(texts).toContain('Tuned to 98.700 MHz');
  });

  it('also tunes when the keyboard Done key is pressed', async () => {
    const tree = await mount();
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('103,5');
    });
    await act(async () => {
      tree.root.findByType(TextInput).props.onSubmitEditing();
    });
    expect(rtl.tune).toHaveBeenCalledWith(103_500_000);
  });

  it('rejects bad input without touching the radio and says why', async () => {
    const tree = await mount();
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('5000');
    });
    await pressByLabel(tree, 'Tune');
    expect(rtl.tune).not.toHaveBeenCalled();
    const texts = tree.root.findAllByType(Text).map((t) => flat(t.props.children));
    expect(texts.some((t) => t.includes('1766'))).toBe(true);
  });

  it('shows the error when the receiver refuses the frequency', async () => {
    rtl.tune.mockRejectedValueOnce(new Error('Tuner rejected the frequency (driver code -1)'));
    const tree = await mount();
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText('98.7');
    });
    await pressByLabel(tree, 'Tune');
    const texts = tree.root.findAllByType(Text).map((t) => flat(t.props.children));
    expect(texts.some((t) => t.includes('Tuner rejected'))).toBe(true);
    expect(useReceiver.getState().frequencyHz).toBe(100_000_000);
  });

  it('steps the frequency from the current tuned value', async () => {
    const tree = await mount();
    await pressByLabel(tree, '+0.1');
    expect(rtl.tune).toHaveBeenLastCalledWith(100_100_000);
    await pressByLabel(tree, '−1');
    expect(rtl.tune).toHaveBeenLastCalledWith(99_100_000);
  });

  it('follows the receiver when you are not typing', async () => {
    const tree = await mount();
    await act(async () => {
      useReceiver.setState({ frequencyHz: 93_900_000 });
    });
    expect(tree.root.findByType(TextInput).props.value).toBe('93.900');
  });
});

describe('stopping the stream', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    rtl.stopStream.mockReset();
    useReceiver.setState({ status: 'streaming', streamAction: null, bins: frame(1) });
  });
  afterEach(() => jest.useRealTimers());

  it('ignores spectrum frames while stopping and clears the display afterwards', async () => {
    let finish!: () => void;
    rtl.stopStream.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));

    const stopping = useReceiver.getState().stopReceiving();
    expect(useReceiver.getState().streamAction).toBe('stopping');

    jest.setSystemTime(Date.now() + 1000);
    const before = useReceiver.getState().bins;
    mockSignalListeners.forEach((l) => l({ bins: frame(9) }));
    expect(useReceiver.getState().bins).toBe(before);

    finish();
    await stopping;
    expect(useReceiver.getState().streamAction).toBeNull();
    expect(useReceiver.getState().bins.every((b) => b === 0)).toBe(true);
  });

  it('gives up with a clear error if the native side never answers', async () => {
    rtl.stopStream.mockReturnValueOnce(new Promise(() => undefined));
    const stopping = useReceiver.getState().stopReceiving();
    const assertion = expect(stopping).rejects.toThrow(/timed out/);
    jest.advanceTimersByTime(9000);
    await assertion;
    expect(useReceiver.getState().streamAction).toBeNull();
  });

  it('ignores a second stop while one is already running', async () => {
    let finish!: () => void;
    rtl.stopStream.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    const first = useReceiver.getState().stopReceiving();
    await useReceiver.getState().stopReceiving();
    expect(rtl.stopStream).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });
});
