import { clampFm, formatMHz, nameHasFrequency, rankStations, searchByFrequency, searchByName, stationFromRow, Station } from '../radioBrowser';

const station = (over: Partial<Station> = {}): Station => ({ id: 'a', name: 'WTOP 103.5 FM', url: 'https://x/stream', country: 'USA', countryCode: 'US', bitrate: 128, codec: 'MP3', votes: 10, tags: '', state: '', lat: null, lon: null, ...over });
const row = (over: Record<string, unknown> = {}) => ({ stationuuid: 'u1', name: 'WTOP 103.5 FM', url_resolved: 'https://stream.example/wtop', country: 'The United States Of America', countrycode: 'us', bitrate: 128, codec: 'MP3', votes: 50, tags: 'news', lastcheckok: 1, ...over });
const reply = (rows: unknown, ok = true) => jest.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => rows })) as unknown as typeof fetch;

describe('frequencies', () => {
  it('are kept on the FM band and on the 0.1 grid', () => {
    expect(clampFm(50)).toBe(87.5);
    expect(clampFm(120)).toBe(108);
    expect(clampFm(98.74)).toBe(98.7);
    expect(clampFm(Number.NaN)).toBe(87.5);
    expect(formatMHz(98)).toBe('98.0');
  });

  it('are found in station names written the usual ways', () => {
    expect(nameHasFrequency('WTOP 103.5 FM', 103.5)).toBe(true);
    expect(nameHasFrequency('Radio 103,5', 103.5)).toBe(true);
    expect(nameHasFrequency('KISS 98.7', 98.7)).toBe(true);
    expect(nameHasFrequency('103.5', 103.5)).toBe(true);
  });

  it('are not found inside other numbers', () => {
    expect(nameHasFrequency('WXYZ 103.55', 103.5)).toBe(false);
    expect(nameHasFrequency('Station 1103.5', 103.5)).toBe(false);
    expect(nameHasFrequency('Hits 98.7', 98.1)).toBe(false);
    expect(nameHasFrequency('Top 40 Radio', 40)).toBe(false); // off the FM band: never matched by accident
  });

  it('match a whole-number frequency written with or without the .0', () => {
    expect(nameHasFrequency('Mix 98 FM', 98)).toBe(true);
    expect(nameHasFrequency('Mix 98.0', 98)).toBe(true);
    expect(nameHasFrequency('Mix 98.5', 98)).toBe(false);
    expect(nameHasFrequency('Hits 198', 98)).toBe(false);
  });
});

describe('station rows', () => {
  it('become stations', () => {
    expect(stationFromRow(row())).toMatchObject({ id: 'u1', name: 'WTOP 103.5 FM', url: 'https://stream.example/wtop', countryCode: 'US', bitrate: 128 });
  });

  it('are dropped when they cannot be played', () => {
    expect(stationFromRow(row({ lastcheckok: 0 }))).toBeNull();
    expect(stationFromRow(row({ url_resolved: '', url: '' }))).toBeNull();
    expect(stationFromRow(row({ url_resolved: 'rtsp://x/y', url: 'rtsp://x/y' }))).toBeNull();
    expect(stationFromRow(row({ stationuuid: undefined }))).toBeNull();
  });

  it('may be plain http, which Android is told to allow', () => {
    expect(stationFromRow(row({ url_resolved: 'http://old.example/stream' }))?.url).toBe('http://old.example/stream');
  });
});

describe('ranking', () => {
  it('puts stations from your country first, then the most voted for', () => {
    const list = [station({ id: 'fr', countryCode: 'FR', votes: 900 }), station({ id: 'us-low', votes: 5 }), station({ id: 'us-high', votes: 80 })];
    expect(rankStations(list, 'us').map((s) => s.id)).toEqual(['us-high', 'us-low', 'fr']);
    expect(rankStations(list, null).map((s) => s.id)).toEqual(['fr', 'us-high', 'us-low']);
  });
});

describe('searching', () => {
  it('asks for the frequency, keeps the stations that really name it, and ranks them', async () => {
    const f = reply([row({ stationuuid: '1', name: 'WTOP 103.5 FM', votes: 50 }), row({ stationuuid: '2', name: 'Other 103.55', votes: 999 }), row({ stationuuid: '3', name: 'Classic 103.5', url_resolved: 'https://stream.example/classic', votes: 90 })]);
    const found = await searchByFrequency(103.5, { countryCode: 'US', fetchImpl: f });
    expect(found.map((s) => s.id)).toEqual(['3', '1']);
    expect((f as jest.Mock).mock.calls[0][0]).toContain('name=103.5');
  });

  it('shows the same stream once', async () => {
    const f = reply([row({ stationuuid: '1' }), row({ stationuuid: '2', name: 'WTOP 103.5', url_resolved: 'https://stream.example/wtop/' })]);
    expect(await searchByFrequency(103.5, { fetchImpl: f })).toHaveLength(1);
  });

  it('tries the next directory server when one is down', async () => {
    let calls = 0;
    const f = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return { ok: true, status: 200, json: async () => [row()] };
    }) as unknown as typeof fetch;
    expect(await searchByFrequency(103.5, { fetchImpl: f })).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('says so plainly when no server can be reached', async () => {
    await expect(searchByFrequency(103.5, { fetchImpl: reply([], false) })).rejects.toThrow(/Could not reach the station directory/);
  });

  it('searches by name, and ignores a one-letter search', async () => {
    const f = reply([row()]);
    expect(await searchByName('w', { fetchImpl: f })).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(await searchByName('  wtop ', { fetchImpl: f })).toHaveLength(1);
    expect((f as jest.Mock).mock.calls[0][0]).toContain('name=wtop');
  });
});

describe('stations near you', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { distanceKm, searchNearby, NEARBY_KM } = require('../radioBrowser');
  const DC = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
  const geo = (id: string, lat: number | null, lon: number | null, over: Record<string, unknown> = {}) => row({ stationuuid: id, name: `S${id}`, url_resolved: `https://stream.example/${id}`, geo_lat: lat, geo_long: lon, ...over });

  it('measures the distance to a station, and has none when the station has no position', () => {
    expect(distanceKm(station({ lat: 38.9072, lon: -77.0369 }), DC)).toBeCloseTo(0, 3);
    expect(distanceKm(station({ lat: 39.2904, lon: -76.6122 }), DC)).toBeGreaterThan(50); // Baltimore
    expect(distanceKm(station({ lat: 39.2904, lon: -76.6122 }), DC)).toBeLessThan(60);
    expect(distanceKm(station(), DC)).toBeNull();
  });

  it('reads the position out of a row, ignoring nonsense', () => {
    expect(stationFromRow(geo('1', 38.9, -77.0))).toMatchObject({ lat: 38.9, lon: -77 });
    expect(stationFromRow(geo('2', null, null))).toMatchObject({ lat: null, lon: null });
    expect(stationFromRow(geo('3', 999, 0))).toMatchObject({ lat: null });
  });

  it('puts the nearest station first, even when a faraway one has more votes', () => {
    const near = station({ id: 'near', lat: 39.0, lon: -77.1, votes: 1 });
    const far = station({ id: 'far', lat: 34.05, lon: -118.24, votes: 900 }); // Los Angeles
    const unknown = station({ id: 'unknown', votes: 5000 });
    expect(rankStations([unknown, far, near], 'US', DC).map((s) => s.id)).toEqual(['near', 'far', 'unknown']);
    expect(rankStations([unknown, far, near], 'US').map((s) => s.id)).toEqual(['unknown', 'far', 'near']); // no position: by votes
  });

  it('ranks a frequency search by distance when it knows where you are', async () => {
    const f = reply([geo('la', 34.05, -118.24, { name: 'KIIS 103.5', votes: 500 }), geo('dc', 38.95, -77.03, { name: 'WTOP 103.5', votes: 10 })]);
    const found = await searchByFrequency(103.5, { here: DC, countryCode: 'US', fetchImpl: f });
    expect(found.map((s) => s.id)).toEqual(['dc', 'la']);
  });

  it('lists only stations within reach, nearest first', async () => {
    const f = reply([geo('far', 34.05, -118.24), geo('mid', 39.29, -76.61), geo('near', 38.95, -77.03), geo('nopos', null, null)]);
    const found = await searchNearby(DC, { countryCode: 'US', fetchImpl: f });
    expect(found.map((s: Station) => s.id)).toEqual(['near', 'mid']);
    expect((f as jest.Mock).mock.calls[0][0]).toContain('has_geo_info=true');
    expect((f as jest.Mock).mock.calls[0][0]).toContain('countrycode=US');
    expect(NEARBY_KM).toBeGreaterThan(50);
  });
});

describe('FM from your own country', () => {
  const r = (id: string, name: string, cc: string, votes = 10) => row({ stationuuid: id, name, countrycode: cc, url_resolved: `https://stream.example/${id}`, votes });

  it('asks the directory for that country only, and keeps only its stations', async () => {
    const f = reply([r('us', 'WTOP 103.5', 'US'), r('mx', 'Radio 103.5', 'MX', 900), r('gb', 'Beat 103.5', 'GB', 900)]);
    const found = await searchByFrequency(103.5, { countryCode: 'us', fetchImpl: f });
    expect(found.map((s) => s.id)).toEqual(['us']);
    expect((f as jest.Mock).mock.calls[0][0]).toContain('countrycode=US');
  });

  it('looks worldwide when no country is given', async () => {
    const f = reply([r('us', 'WTOP 103.5', 'US'), r('mx', 'Radio 103.5', 'MX')]);
    expect(await searchByFrequency(103.5, { fetchImpl: f })).toHaveLength(2);
    expect((f as jest.Mock).mock.calls[0][0]).not.toContain('countrycode');
  });

  it('puts the nearest of your own country first', async () => {
    const DC = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
    const f = reply([
      { ...r('la', 'KIIS 103.5', 'US', 900), geo_lat: 34.05, geo_long: -118.24 },
      { ...r('dc', 'WTOP 103.5', 'US', 5), geo_lat: 38.95, geo_long: -77.03 },
    ]);
    expect((await searchByFrequency(103.5, { countryCode: 'US', here: DC, fetchImpl: f })).map((s) => s.id)).toEqual(['dc', 'la']);
  });
});

describe('the frequency in a station name', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { frequencyFromName } = require('../radioBrowser');

  it('is read from the usual ways of writing it', () => {
    expect(frequencyFromName('WTOP 103.5 FM')).toBe(103.5);
    expect(frequencyFromName('Mix 98,7')).toBe(98.7);
    expect(frequencyFromName('Kiss 100.3')).toBe(100.3);
    expect(frequencyFromName('88.1 WYEP')).toBe(88.1);
    expect(frequencyFromName('Hits 107.9 - The Best')).toBe(107.9);
  });

  it('reads a whole number only when it says FM or MHz', () => {
    expect(frequencyFromName('Mix 98 FM')).toBe(98);
    expect(frequencyFromName('Radio 95 MHz')).toBe(95);
    expect(frequencyFromName('Top 100 Hits')).toBeNull();
    expect(frequencyFromName('Radio 95')).toBeNull();
  });

  it('is nothing for a name without a frequency, or with one off the FM band', () => {
    expect(frequencyFromName('Jazz FM')).toBeNull();
    expect(frequencyFromName('AM 1010 WINS')).toBeNull();
    expect(frequencyFromName('Station 12.5')).toBeNull();
    expect(frequencyFromName('Number 150.7')).toBeNull();
    expect(frequencyFromName('Hits 87.4')).toBeNull();
  });

  it('takes the first frequency on the band when a name has several numbers', () => {
    expect(frequencyFromName('Channel 5 - 101.1 FM since 1998')).toBe(101.1);
  });
});
