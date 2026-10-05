import { clampFm, formatMHz, nameHasFrequency, rankStations, searchByFrequency, searchByName, stationFromRow, Station } from '../radioBrowser';

const station = (over: Partial<Station> = {}): Station => ({ id: 'a', name: 'WTOP 103.5 FM', url: 'https://x/stream', country: 'USA', countryCode: 'US', bitrate: 128, codec: 'MP3', votes: 10, tags: '', ...over });
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
