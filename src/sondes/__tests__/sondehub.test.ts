import { ago, classify, distanceTo, estimatedLanding, fetchSondes, parseSondes, secondsToGround, sortForHunting, target, bearingTo } from '../sondehub';
import type { Sonde } from '../sondehub';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const frame = (over: Record<string, unknown> = {}) => ({ serial: 'S1', type: 'RS41', datetime: minutesAgo(2), lat: 38.9, lon: -77.0, alt: 12000, vel_v: -5, vel_h: 12, heading: 90, frequency: 402.7, ...over });
const sonde = (over: Partial<Sonde> = {}): Sonde => ({ serial: 'S1', type: 'RS41', lat: 38.9, lon: -77.0, altM: 12000, climbMps: -5, speedMps: 12, headingDeg: 90, frequencyMHz: 402.7, lastSeenMs: NOW - 120_000, status: 'descending', ...over });
const HERE = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };

describe('what state a sonde is in', () => {
  it('is climbing, coming down, landed or lost', () => {
    expect(classify({ altM: 8000, climbMps: 5, lastSeenMs: NOW - 60_000 }, NOW)).toBe('ascending');
    expect(classify({ altM: 20000, climbMps: -30, lastSeenMs: NOW - 60_000 }, NOW)).toBe('descending');
    expect(classify({ altM: 150, climbMps: -5, lastSeenMs: NOW - 30 * 60_000 }, NOW)).toBe('landed');
    expect(classify({ altM: 25000, climbMps: 5, lastSeenMs: NOW - 30 * 60_000 }, NOW)).toBe('lost'); // went quiet high up
    expect(classify({ altM: 25000, climbMps: -5, lastSeenMs: NOW - 30 * 60_000 }, NOW)).toBe('lost');
  });
});

describe('reading SondeHub', () => {
  it('turns the answer into sondes', () => {
    const [s] = parseSondes({ S1: frame() }, NOW);
    expect(s).toMatchObject({ serial: 'S1', type: 'RS41', lat: 38.9, lon: -77, altM: 12000, climbMps: -5, speedMps: 12, headingDeg: 90, frequencyMHz: 402.7, status: 'descending' });
  });

  it('skips broken or very old entries, and anything that is not an object of frames', () => {
    const out = parseSondes({ A: frame({ datetime: 'nonsense' }), B: frame({ lat: null }), C: frame({ datetime: minutesAgo(80 * 60) }), D: null, E: frame({ serial: undefined }) }, NOW);
    expect(out.map((s) => s.serial)).toEqual(['E']); // the key is used when a frame has no serial
    expect(parseSondes(null)).toEqual([]);
    expect(parseSondes([frame()])).toEqual([]);
  });

  it('copes with a missing climb rate or heading', () => {
    const [s] = parseSondes({ S1: frame({ vel_v: undefined, heading: undefined }) }, NOW);
    expect(s.climbMps).toBe(0);
    expect(s.headingDeg).toBeNull();
  });

  it('uses the transmit frequency when there is no frequency', () => {
    expect(parseSondes({ S1: frame({ frequency: undefined, tx_frequency: 403.1 }) }, NOW)[0].frequencyMHz).toBe(403.1);
  });
});

describe('ordering for a hunt', () => {
  it('puts landed first, then coming down, then climbing, nearest first within each', () => {
    const far = { lat: 40, lon: -75 };
    const list = [
      sonde({ serial: 'up', status: 'ascending' }),
      sonde({ serial: 'down-far', status: 'descending', ...far }),
      sonde({ serial: 'landed-far', status: 'landed', ...far }),
      sonde({ serial: 'down-near', status: 'descending' }),
      sonde({ serial: 'landed-near', status: 'landed' }),
      sonde({ serial: 'lost', status: 'lost' }),
    ];
    expect(sortForHunting(list, HERE).map((s) => s.serial)).toEqual(['landed-near', 'landed-far', 'down-near', 'down-far', 'up', 'lost']);
  });
});

describe('where it will come down', () => {
  it('counts the seconds to the ground at the present rate, only while it is coming down', () => {
    expect(secondsToGround(sonde({ altM: 6000, climbMps: -6 }))).toBe(1000);
    expect(secondsToGround(sonde({ status: 'ascending', climbMps: 5 }))).toBeNull();
    expect(secondsToGround(sonde({ status: 'landed' }))).toBeNull();
    expect(secondsToGround(sonde({ climbMps: -0.1 }))).toBeNull();
  });

  it('carries the position along the heading for the time left', () => {
    // 3000 m up at 5 m/s is 600 s; at 10 m/s east that is 6 km east.
    const landing = estimatedLanding(sonde({ altM: 3000, climbMps: -5, speedMps: 10, headingDeg: 90 }))!;
    expect(landing.latitudeDeg).toBeCloseTo(38.9, 3);
    expect((landing.longitudeDeg - -77.0) * 111_320 * Math.cos((38.9 * Math.PI) / 180)).toBeCloseTo(6000, -1);
  });

  it('has no estimate without a heading or a speed', () => {
    expect(estimatedLanding(sonde({ headingDeg: null }))).toBeNull();
    expect(estimatedLanding(sonde({ speedMps: 0 }))).toBeNull();
  });

  it('is headed for the estimate while coming down and for the last position once landed', () => {
    const down = sonde({ altM: 3000, climbMps: -5, speedMps: 10, headingDeg: 90 });
    expect(target(down).longitudeDeg).toBeGreaterThan(-77.0);
    const landed = sonde({ status: 'landed', altM: 100 });
    expect(target(landed)).toEqual({ latitudeDeg: 38.9, longitudeDeg: -77.0 });
  });

  it('gives the distance and bearing from you to the place to head for', () => {
    const landed = sonde({ status: 'landed', lat: 39.9072, lon: -77.0369 });
    expect(bearingTo(HERE, landed)).toBeCloseTo(0, 0);
    expect(distanceTo(HERE, landed)).toBeGreaterThan(110_000);
    expect(distanceTo(HERE, landed)).toBeLessThan(112_000);
  });
});

describe('time ago', () => {
  it('is in plain words', () => {
    expect(ago(NOW - 30_000, NOW)).toBe('just now');
    expect(ago(NOW - 12 * 60_000, NOW)).toBe('12 min ago');
    expect(ago(NOW - 3 * 3600_000, NOW)).toBe('3 h ago');
    expect(ago(NOW - 72 * 3600_000, NOW)).toBe('3 days ago');
  });
});

describe('asking SondeHub', () => {
  const reply = (body: unknown, ok = true) => jest.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as unknown as typeof fetch;

  it('asks for the area around you, and sorts what comes back', async () => {
    const f = reply({ A: frame({ serial: 'A', datetime: minutesAgo(1) }), B: frame({ serial: 'B', datetime: minutesAgo(40), alt: 90, vel_v: -4 }) });
    const found = await fetchSondes(HERE, { fetchImpl: f, now: NOW, radiusKm: 250 });
    expect(found.map((s) => s.serial)).toEqual(['B', 'A']); // landed before flying
    const url = (f as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('lat=38.9072');
    expect(url).toContain('lon=-77.0369');
    expect(url).toContain('distance=250000');
  });

  it('says plainly when SondeHub is down or unreachable', async () => {
    await expect(fetchSondes(HERE, { fetchImpl: reply({}, false), now: NOW })).rejects.toThrow('SondeHub answered HTTP 503');
    const offline = jest.fn(async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    await expect(fetchSondes(HERE, { fetchImpl: offline, now: NOW })).rejects.toThrow('Could not reach SondeHub');
  });
});
