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

const station = { id: 'a', name: 'WTOP 103.5 FM', url: 'https://x/s', country: 'USA', countryCode: 'US', bitrate: 128, codec: 'MP3', votes: 5, tags: '', state: '', lat: null, lon: null };

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

  it('silences the playing station as soon as the dial moves', () => {
    useOnlineRadio.setState({ current: station, stations: [station], status: 'playing' });
    const t = render();
    act(() => t.root.findAllByProps({ accessibilityLabel: 'Tune +0.1 megahertz' }).find((n) => typeof n.props.onPress === 'function')!.props.onPress());
    expect(useOnlineRadio.getState()).toMatchObject({ status: 'idle', current: null, mhz: 98.8 });
  });

  it('offers stations near you, with how far each is', () => {
    useOnlineRadio.setState({
      here: { latitudeDeg: 38.9072, longitudeDeg: -77.0369 },
      nearbyStatus: 'ready',
      nearby: [{ ...station, id: 'n1', name: 'Near FM', lat: 38.95, lon: -77.03, state: 'DC' }],
    });
    const out = text(render());
    expect(out).toContain('NEAR ME');
    expect(out).toContain('Near FM');
    expect(out).toContain('away');
    expect(out).toContain('Refresh');
  });

  it('explains when location is missing', () => {
    useOnlineRadio.setState({ nearbyStatus: 'no-location', nearby: [] });
    expect(text(render())).toContain('Allow location');
  });

  it('lists every station on the frequency below the one that plays, even when there is just one', () => {
    const second = { ...station, id: 'b', name: 'Other 98.7', url: 'https://x/b' };
    useOnlineRadio.setState({ current: station, status: 'playing', stations: [station, second] });
    const out = text(render());
    expect(out).toMatch(/all stations on 98.7 mhz/i);
    expect(out).toContain('Other 98.7');
    useOnlineRadio.setState({ stations: [station] });
    expect(text(render())).toMatch(/all stations on 98.7 mhz/i);
  });

  it('does not cut a long list short', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...station, id: `s${i}`, name: `Station number ${i}`, url: `https://x/${i}` }));
    useOnlineRadio.setState({ current: many[0], status: 'playing', stations: many });
    const out = text(render());
    expect(out).toContain('Station number 0');
    expect(out).toContain('Station number 29');
  });
});
