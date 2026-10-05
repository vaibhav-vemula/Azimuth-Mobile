import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { OnlineRadio } from '../components/OnlineRadio';
import { useOnlineRadio } from '../../../radio/online/useOnlineRadio';

jest.mock('../../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));

const station = { id: 'a', name: 'WTOP 103.5 FM', url: 'https://x/s', country: 'USA', countryCode: 'US', bitrate: 128, codec: 'MP3', votes: 5, tags: '' };

function render() {
  let t!: renderer.ReactTestRenderer;
  act(() => {
    t = renderer.create(<OnlineRadio />);
  });
  return t;
}
const text = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());

beforeEach(() => {
  jest.useFakeTimers();
  useOnlineRadio.getState().stop();
  useOnlineRadio.setState({ mhz: 98.7, stations: [], status: 'idle', error: null });
});
afterEach(() => jest.useRealTimers());

describe('the online radio screen', () => {
  it('shows the frequency and the dial buttons', () => {
    const t = render();
    expect(text(t)).toContain('98.7');
    for (const label of ['Tune −1 megahertz', 'Tune −0.1 megahertz', 'Tune +0.1 megahertz', 'Tune +1 megahertz']) {
      expect(t.root.findAllByProps({ accessibilityLabel: label }).length).toBeGreaterThan(0);
    }
  });

  it('turns the dial at once, and only looks for the station when you stop', () => {
    const tune = jest.fn(async (_mhz?: number, _country?: string | null) => undefined);
    useOnlineRadio.setState({ tune });
    const t = render();
    const press = (label: string) => act(() => t.root.findAllByProps({ accessibilityLabel: label }).find((n) => typeof n.props.onPress === 'function')!.props.onPress());
    press('Tune +0.1 megahertz');
    press('Tune +0.1 megahertz');
    expect(useOnlineRadio.getState().mhz).toBe(98.9);
    expect(tune).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(900);
    });
    expect(tune).toHaveBeenCalledTimes(1);
    expect(tune.mock.calls[0][0]).toBe(98.9);
  });

  it('shows what is playing and a way to stop it', () => {
    useOnlineRadio.setState({ current: station, stations: [station], status: 'playing' });
    const t = render();
    expect(text(t)).toContain('WTOP 103.5 FM');
    expect(text(t)).toContain('Playing');
    expect(text(t)).toContain('Stop');
  });

  it('explains when no station has that frequency', () => {
    useOnlineRadio.setState({ status: 'nomatch' });
    expect(text(render())).toContain('No station found for ');
  });
});
