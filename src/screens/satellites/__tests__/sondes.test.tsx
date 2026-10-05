import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { SondesPanel } from '../components/SondesPanel';
import SondeHuntScreen, { mapsUrl, speedLabel } from '../SondeHuntScreen';
import { useSondes } from '../../../sondes/useSondes';
import { useUnits } from '../../../units/units';
import type { Sonde } from '../../../sondes/sondehub';

jest.mock('../../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useRoute: () => ({ params: { serial: 'S1' } }) }));
jest.mock('../../../mapping/useDevicePose', () => ({ useDevicePose: () => ({ position: { latitudeDeg: 38.9072, longitudeDeg: -77.0369 }, accuracyM: 5, mocked: false, permission: 'granted', request: jest.fn() }) }));

const HERE = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
const sonde = (over: Partial<Sonde> = {}): Sonde => ({ serial: 'S1', type: 'RS41', lat: 39.9072, lon: -77.0369, altM: 300, climbMps: -5, speedMps: 8, headingDeg: 90, frequencyMHz: 402.7, lastSeenMs: Date.now() - 20 * 60_000, status: 'landed', ...over });
const text = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());
function render(el: React.ReactElement) {
  let t!: renderer.ReactTestRenderer;
  act(() => {
    t = renderer.create(el);
  });
  return t;
}

beforeEach(() => {
  useUnits.getState().setPreference('metric');
  useSondes.setState({ sondes: [], status: 'ready', error: null, updatedMs: Date.now(), tracked: [] });
});

describe('the sondes list', () => {
  it('asks for a position first', () => {
    expect(text(render(<SondesPanel here={null} onOpen={jest.fn()} />))).toContain('Where are you?');
  });

  it('lists each sonde with its state, distance and direction, and opens one', () => {
    const onOpen = jest.fn();
    useSondes.setState({ sondes: [sonde(), sonde({ serial: 'S2', status: 'descending', lastSeenMs: Date.now() - 60_000 })] });
    const t = render(<SondesPanel here={HERE} onOpen={onOpen} />);
    const out = text(t);
    expect(out).toContain('S1');
    expect(out).toContain('Landed');
    expect(out).toContain('Coming down');
    expect(out).toContain('110 km N'.replace('110 km N', ' N')); // direction word
    act(() => t.root.findAllByProps({ accessibilityLabel: 'S1, Landed' }).find((n) => typeof n.props.onPress === 'function')!.props.onPress());
    expect(onOpen).toHaveBeenCalledWith('S1');
  });

  it('puts the ones you follow first, with a star, and hides sondes that went quiet high up', () => {
    useSondes.setState({ sondes: [sonde({ serial: 'A' }), sonde({ serial: 'B' }), sonde({ serial: 'C', status: 'lost' })], tracked: ['B'] });
    const t = render(<SondesPanel here={HERE} onOpen={jest.fn()} />);
    const out = text(t);
    expect(out.indexOf('"B"')).toBeLessThan(out.indexOf('"A"'));
    expect(t.root.findAll((n) => n.props.name === 'star').length).toBeGreaterThan(0);
    act(() => useSondes.setState({ tracked: [] }));
    expect(t.root.findAll((n) => n.props.name === 'star')).toHaveLength(0);
    expect(out).not.toContain('"C"');
  });

  it('says so when none are near', () => {
    expect(text(render(<SondesPanel here={HERE} onOpen={jest.fn()} />))).toContain('No sondes near you');
  });

  it('shows a problem', () => {
    useSondes.setState({ status: 'error', error: 'Could not reach SondeHub. Check your connection.' });
    expect(text(render(<SondesPanel here={HERE} onOpen={jest.fn()} />))).toContain('Could not reach SondeHub');
  });
});

describe('going to collect one', () => {
  it('shows which way and how far, and what happened to it', () => {
    useSondes.setState({ sondes: [sonde()] });
    const out = text(render(<SondeHuntScreen />));
    expect(out).toContain('S1');
    expect(out).toContain('Landed where it was last heard');
    expect(out).toMatch(/11\d(\.\d)? km|11\d km/);
    expect(out).toContain('where it landed');
    expect(out).toContain('Direction to the chest'); // the shared arrow, labelled for screen readers
  });

  it('says how long a falling sonde has left, and heads for the estimated landing', () => {
    useSondes.setState({ sondes: [sonde({ status: 'descending', altM: 3000, climbMps: -5, lastSeenMs: Date.now() - 30_000 })] });
    const out = text(render(<SondeHuntScreen />));
    expect(out).toContain('About 10 min to the ground');
    expect(out).toContain('estimated landing');
    expect(out).toContain('Estimated landing');
  });

  it('opens directions in a maps app, tracks the sonde, and offers to tune the dongle', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    useSondes.setState({ sondes: [sonde()] });
    const t = render(<SondeHuntScreen />);
    const textOf = (n: renderer.ReactTestInstance | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''));
    const press = (label: string) => act(() => t.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && textOf(n).includes(label))[0].props.onPress());
    press('Get directions');
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toMatch(/^(geo:|http:\/\/maps\.apple\.com)/);
    press('Track');
    expect(useSondes.getState().tracked).toEqual(['S1']);
    expect(text(t)).toContain('Needs the dongle: 402.700 MHz');
    open.mockRestore();
  });

  it('says when the sonde is no longer listed', () => {
    useSondes.setState({ sondes: [] });
    expect(text(render(<SondeHuntScreen />))).toContain('Sonde not found');
  });
});

describe('helpers', () => {
  it('give speeds in your units, and a link that opens the maps app', () => {
    expect(speedLabel(10)).toBe('36 km/h');
    useUnits.getState().setPreference('imperial');
    expect(speedLabel(10)).toBe('22 mph');
    expect(mapsUrl({ latitudeDeg: 38.9, longitudeDeg: -77.1 }, 'RS41 S1')).toMatch(/38\.9,-77\.1/);
  });
});
