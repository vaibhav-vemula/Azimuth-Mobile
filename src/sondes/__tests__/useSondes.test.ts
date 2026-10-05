import { useSondes } from '../useSondes';
import type { Sonde } from '../sondehub';

const HERE = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
const now = Date.now();
const frame = (serial: string, minutes = 2) => ({ serial, type: 'RS41', datetime: new Date(now - minutes * 60_000).toISOString(), lat: 38.9, lon: -77.0, alt: 500, vel_v: -5, vel_h: 8, heading: 45, frequency: 402.7 });
const answer = (all: Record<string, unknown>) => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => all })) as unknown as typeof fetch;
};

beforeEach(() => {
  useSondes.setState({ sondes: [], status: 'idle', error: null, updatedMs: null, tracked: [] });
});

describe('the sonde list', () => {
  it('loads what SondeHub has near you', async () => {
    answer({ A: frame('A'), B: frame('B', 40) });
    await useSondes.getState().refresh(HERE);
    const s = useSondes.getState();
    expect(s.status).toBe('ready');
    expect(s.sondes.map((x: Sonde) => x.serial)).toEqual(['B', 'A']); // landed first
    expect(s.updatedMs).not.toBeNull();
  });

  it('reports a problem plainly and keeps what it had', async () => {
    answer({ A: frame('A') });
    await useSondes.getState().refresh(HERE);
    global.fetch = jest.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await useSondes.getState().refresh(HERE);
    expect(useSondes.getState().status).toBe('error');
    expect(useSondes.getState().error).toMatch(/Could not reach SondeHub/);
    expect(useSondes.getState().sondes).toHaveLength(1);
  });

  it('does not start a second request while one is running', async () => {
    answer({ A: frame('A') });
    const first = useSondes.getState().refresh(HERE);
    await useSondes.getState().refresh(HERE);
    await first;
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('remembers the sondes you follow, and keeps one that drops out of the search', async () => {
    answer({ A: frame('A'), B: frame('B') });
    await useSondes.getState().refresh(HERE);
    useSondes.getState().toggleTracked('A');
    expect(useSondes.getState().tracked).toEqual(['A']);
    answer({ B: frame('B') }); // A has drifted out of range
    await useSondes.getState().refresh(HERE);
    expect(useSondes.getState().sondes.map((x: Sonde) => x.serial).sort()).toEqual(['A', 'B']);
    useSondes.getState().toggleTracked('A');
    expect(useSondes.getState().tracked).toEqual([]);
    answer({ B: frame('B') });
    await useSondes.getState().refresh(HERE);
    expect(useSondes.getState().sondes.map((x: Sonde) => x.serial)).toEqual(['B']);
  });
});
