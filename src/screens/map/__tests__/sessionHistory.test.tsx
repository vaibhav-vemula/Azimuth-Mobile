import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { useMapping } from '../../../mapping/useMapping';
import { useSessionView } from '../../../mapping/sessionHistory';
import { useUnits } from '../../../units/units';
import { SessionHistory } from '../components/SessionHistory';

jest.mock('../../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));

const record = (id: string, startedMs: number, over = {}) => ({ id, startedMs, endedMs: startedMs + 754_000, durationSec: 754, distanceM: 812, clearedCells: 120, areaKm2: 0.003, newCells: 4, readings: 38, towers: 6, wifi: 41, bluetooth: 17, radioDbfs: null, ...over });

function text(tree: renderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  useUnits.getState().setPreference('metric');
  useSessionView.setState({ selectedId: null });
});

describe('SessionHistory', () => {
  it('shows nothing when there are no past sessions', () => {
    useMapping.setState({ sessions: [] });
    let t!: renderer.ReactTestRenderer;
    act(() => {
      t = renderer.create(<SessionHistory />);
    });
    expect(t.toJSON()).toBeNull();
  });

  it('lists each session with its numbers, and the radio level only when there was one', () => {
    useMapping.setState({ sessions: [record('2', Date.now() - 5000, { radioDbfs: -31 }), record('1', Date.now() - 9 * 86_400_000)] });
    let t!: renderer.ReactTestRenderer;
    act(() => {
      t = renderer.create(<SessionHistory />);
    });
    const out = text(t);
    expect(out).toContain('SESSION HISTORY');
    expect(out).toContain('12:34'); // 754 s
    expect(out).toContain('810'); // 812 m, shown to the nearest 10
    expect(out).toContain('-31 dBFS');
    expect((out.match(/\"-31 dBFS\"/g) ?? []).length).toBe(1); // only the session that had a dongle
    expect(t.root.findAllByProps({ accessibilityLabel: 'Delete this session' }).length).toBeGreaterThan(0);
  });

  it('tapping a session selects it for the map, and tapping again puts it away', () => {
    useMapping.setState({ sessions: [record('7', Date.now() - 5000)] });
    let t!: renderer.ReactTestRenderer;
    act(() => {
      t = renderer.create(<SessionHistory />);
    });
    const row = () => t.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show the session') && typeof n.props.onPress === 'function')[0];
    act(() => row().props.onPress());
    expect(useSessionView.getState().selectedId).toBe('7');
    act(() => row().props.onPress());
    expect(useSessionView.getState().selectedId).toBeNull();
  });
});
