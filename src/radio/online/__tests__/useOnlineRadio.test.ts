import { setLocator, useOnlineRadio } from '../useOnlineRadio';

jest.mock('../../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const audio = require('expo-audio') as { __players: any[]; createAudioPlayer: jest.Mock };

const row = (id: string, name: string, votes = 10) => ({ stationuuid: id, name, url_resolved: `https://stream.example/${id}`, country: 'USA', countrycode: 'US', bitrate: 128, codec: 'MP3', votes, lastcheckok: 1 });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const answer = (rows: unknown[]) => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => rows })) as unknown as typeof fetch;
};

beforeEach(() => {
  // Unless a test says otherwise, the listener is in the United States, where the test stations are.
  setLocator(async () => ({ here: { latitudeDeg: 38.9072, longitudeDeg: -77.0369 }, countryCode: 'US' }));
  audio.__players.length = 0;
  audio.createAudioPlayer.mockClear();
  useOnlineRadio.getState().stop();
  useOnlineRadio.setState({ stations: [], status: 'idle', error: null });
});

describe('online radio', () => {
  it('tunes a frequency by playing the best station that names it', async () => {
    answer([row('a', 'Low 103.5', 5), row('b', 'Top 103.5', 90), row('c', 'Elsewhere 99.1', 500)]);
    await useOnlineRadio.getState().tune(103.5);
    const s = useOnlineRadio.getState();
    expect(s.mhz).toBe(103.5);
    expect(s.current?.id).toBe('b');
    expect(s.stations.map((x) => x.id)).toEqual(['b', 'a']);
    expect(audio.createAudioPlayer).toHaveBeenCalledWith({ uri: 'https://stream.example/b' });
    expect(audio.__players[0].play).toHaveBeenCalled();
    expect(s.status).toBe('connecting');
  });

  it('is playing once the stream is flowing, and reports a stream that fails', async () => {
    answer([row('a', 'Top 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    audio.__players[0].emit({ playing: true, isBuffering: false, isLoaded: true, error: null });
    expect(useOnlineRadio.getState().status).toBe('playing');
    audio.__players[0].emit({ playing: false, isBuffering: false, isLoaded: false, error: 'boom' });
    expect(useOnlineRadio.getState().status).toBe('error');
    expect(useOnlineRadio.getState().error).toMatch(/not playing/);
  });

  it('says when no station has that frequency, and plays nothing', async () => {
    answer([row('x', 'Elsewhere 99.1')]);
    await useOnlineRadio.getState().tune(103.5);
    expect(useOnlineRadio.getState().status).toBe('nomatch');
    expect(audio.createAudioPlayer).not.toHaveBeenCalled();
  });

  it('switches stations by releasing the old player first', async () => {
    answer([row('a', 'One 103.5'), row('b', 'Two 103.5', 1)]);
    await useOnlineRadio.getState().tune(103.5);
    await useOnlineRadio.getState().play(useOnlineRadio.getState().stations[1]);
    expect(audio.__players).toHaveLength(2);
    expect(audio.__players[0].removed).toBe(true);
    expect(useOnlineRadio.getState().current?.id).toBe('b');
  });

  it('stops and lets go of the player', async () => {
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    useOnlineRadio.getState().stop();
    expect(audio.__players[0].removed).toBe(true);
    expect(useOnlineRadio.getState()).toMatchObject({ status: 'idle', current: null });
  });

  it('ignores a slow answer for a frequency you have already left', async () => {
    let release!: (v: unknown) => void;
    global.fetch = jest.fn(() => new Promise((resolve) => (release = resolve))) as unknown as typeof fetch;
    const slow = useOnlineRadio.getState().tune(99.1);
    await flush(); // the position lookup finishes and the directory is asked
    answer([row('n', 'New 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    release({ ok: true, status: 200, json: async () => [row('old', 'Old 99.1')] });
    await slow;
    expect(useOnlineRadio.getState().current?.id).toBe('n');
    expect(useOnlineRadio.getState().mhz).toBe(103.5);
  });

  it('shows a plain error when the directory cannot be reached', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await useOnlineRadio.getState().tune(103.5);
    expect(useOnlineRadio.getState().status).toBe('error');
    expect(useOnlineRadio.getState().error).toMatch(/Could not reach/);
  });

  it('keeps the volume in range and passes it to the player', async () => {
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    useOnlineRadio.getState().setVolume(1.7);
    expect(useOnlineRadio.getState().volume).toBe(1);
    useOnlineRadio.getState().setVolume(0.5);
    expect(audio.__players[0].volume).toBe(0.5);
    useOnlineRadio.getState().setVolume(-1);
    expect(useOnlineRadio.getState().volume).toBe(0);
  });

  it('searches by name without playing anything', async () => {
    answer([row('a', 'Jazz FM'), row('b', 'Smooth Jazz')]);
    await useOnlineRadio.getState().search('jazz');
    expect(useOnlineRadio.getState().stations).toHaveLength(2);
    expect(audio.createAudioPlayer).not.toHaveBeenCalled();
  });
});

describe('changing the frequency', () => {
  it('stops the old station at once, before the new one is found', async () => {
    answer([row('a', 'Old 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    const old = audio.__players[0];
    expect(old.removed).toBe(false);

    let release!: (v: unknown) => void;
    global.fetch = jest.fn(() => new Promise((resolve) => (release = resolve))) as unknown as typeof fetch;
    const next = useOnlineRadio.getState().tune(99.1); // the lookup is still pending
    expect(old.removed).toBe(true); // already silent, before anything has been found
    await flush();
    expect(useOnlineRadio.getState()).toMatchObject({ status: 'searching', current: null });

    release({ ok: true, status: 200, json: async () => [row('n', 'New 99.1')] });
    await next;
    expect(audio.__players.filter((p: { removed: boolean }) => !p.removed)).toHaveLength(1);
    expect(useOnlineRadio.getState().current?.id).toBe('n');
  });

  it('never leaves two players running when stations are switched quickly', async () => {
    answer([row('a', 'One 103.5'), row('b', 'Two 103.5', 1), row('c', 'Three 103.5', 0)]);
    await useOnlineRadio.getState().tune(103.5);
    const [, b, c] = useOnlineRadio.getState().stations;
    await Promise.all([useOnlineRadio.getState().play(b), useOnlineRadio.getState().play(c)]);
    expect(audio.__players.filter((p: { removed: boolean }) => !p.removed)).toHaveLength(1);
    expect(useOnlineRadio.getState().current?.id).toBe('c');
  });
});

describe('the signal bars', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAudioBars } = require('../useOnlineRadio');
  const tone = Array.from({ length: 512 }, (_, i) => Math.sin((2 * Math.PI * 40 * i) / 512));

  it('follow the sound that is playing', async () => {
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    const player = audio.__players[0];
    expect(player.setAudioSamplingEnabled).toHaveBeenCalledWith(true);
    player.emit({ channels: [{ frames: tone }, { frames: tone }], timestamp: 0 }, 'audioSampleUpdate');
    const { bins, sampling } = useAudioBars.getState();
    expect(sampling).toBe('on');
    expect(Math.max(...bins)).toBeGreaterThan(0.3);
  });

  it('go flat when the station stops', async () => {
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    audio.__players[0].emit({ channels: [{ frames: tone }], timestamp: 0 }, 'audioSampleUpdate');
    useOnlineRadio.getState().stop();
    expect(Math.max(...useAudioBars.getState().bins)).toBe(0);
    expect(useAudioBars.getState().sampling).toBe('unknown');
  });

  it('are simulated, and labelled so, when this phone cannot give out the audio', async () => {
    answer([row('a', 'One 103.5')]);
    audio.createAudioPlayer.mockImplementationOnce((source: unknown) => {
      const p = { source, volume: 1, isAudioSamplingSupported: false, setAudioSamplingEnabled: jest.fn(), play: jest.fn(), remove: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) };
      return p;
    });
    await useOnlineRadio.getState().tune(103.5);
    expect(useAudioBars.getState().sampling).toBe('simulated');
  });
});

describe('the permission for the signal bars', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAudioBars } = require('../useOnlineRadio');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoAudio = require('expo-audio');

  it('is asked for only when the bars are wanted, and until then the radio plays without them', async () => {
    expoAudio.getRecordingPermissionsAsync.mockResolvedValueOnce({ granted: false });
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    expect(useAudioBars.getState().sampling).toBe('simulated');
    expect(expoAudio.requestRecordingPermissionsAsync).not.toHaveBeenCalled();
    expect(audio.__players[0].setAudioSamplingEnabled).not.toHaveBeenCalled();
    expect(audio.__players[0].play).toHaveBeenCalled(); // the station still plays
  });

  it('starts the bars once it is given', async () => {
    expoAudio.getRecordingPermissionsAsync.mockResolvedValueOnce({ granted: false });
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    expect(await useOnlineRadio.getState().enableBars()).toBe(true);
    expect(audio.__players[0].setAudioSamplingEnabled).toHaveBeenCalledWith(true);
  });

  it('stays off when it is refused', async () => {
    expoAudio.getRecordingPermissionsAsync.mockResolvedValueOnce({ granted: false });
    expoAudio.requestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: false });
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    expect(await useOnlineRadio.getState().enableBars()).toBe(false);
    expect(useAudioBars.getState().sampling).toBe('simulated');
  });
});

describe('really stopping the sound', () => {
  it('pauses and mutes the player before letting go of it, because removing it alone leaves the sound running', async () => {
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    const p = audio.__players[0];
    useOnlineRadio.getState().stop();
    expect(p.pause).toHaveBeenCalled();
    expect(p.volume).toBe(0);
    expect(p.removed).toBe(true);
    expect(p.pause.mock.invocationCallOrder[0]).toBeLessThan(p.remove.mock.invocationCallOrder[0]);
    expect(p.playing).toBe(false);
  });

  it('silences the old station when the dial moves, and when another is chosen', async () => {
    answer([row('a', 'One 103.5'), row('b', 'Two 103.5', 1)]);
    await useOnlineRadio.getState().tune(103.5);
    const first = audio.__players[0];
    await useOnlineRadio.getState().play(useOnlineRadio.getState().stations[1]);
    expect(first.playing).toBe(false);
    expect(first.volume).toBe(0);
    const second = audio.__players[1];
    useOnlineRadio.getState().stop();
    expect(second.playing).toBe(false);
    expect(audio.__players.filter((p: { playing: boolean }) => p.playing)).toHaveLength(0);
  });

  it('leaves nothing playing after a quick burst of tunes', async () => {
    answer([row('a', 'One 103.5')]);
    await Promise.all([useOnlineRadio.getState().tune(103.5), useOnlineRadio.getState().tune(103.5), useOnlineRadio.getState().tune(103.5)]);
    expect(audio.__players.filter((p: { playing: boolean }) => p.playing).length).toBeLessThanOrEqual(1);
    useOnlineRadio.getState().stop();
    expect(audio.__players.filter((p: { playing: boolean }) => p.playing)).toHaveLength(0);
  });
});

describe('the simulated bars', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAudioBars } = require('../useOnlineRadio');

  it('move while a station plays and stop with it', async () => {
    jest.useFakeTimers();
    try {
      answer([row('a', 'One 103.5')]);
      const done = useOnlineRadio.getState().tune(103.5);
      await jest.advanceTimersByTimeAsync(0);
      await done;
      audio.__players[0].emit({ playing: true, isBuffering: false, isLoaded: true, error: null });
      expect(useAudioBars.getState().sampling).toBe('simulated');
      await jest.advanceTimersByTimeAsync(600);
      const first = [...useAudioBars.getState().bins];
      await jest.advanceTimersByTimeAsync(700);
      expect(Math.max(...first)).toBeGreaterThan(0.05);
      expect(useAudioBars.getState().bins).not.toEqual(first);
      useOnlineRadio.getState().stop();
      await jest.advanceTimersByTimeAsync(500);
      expect(Math.max(...useAudioBars.getState().bins)).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('local stations', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setLocator } = require('../useOnlineRadio');
  const DC = { here: { latitudeDeg: 38.9072, longitudeDeg: -77.0369 }, countryCode: 'US' };
  const geo = (id: string, name: string, lat: number | null, lon: number | null, votes = 10) => ({ ...row(id, name, votes), geo_lat: lat, geo_long: lon });

  afterEach(() => setLocator(null));

  it('tuning plays the station nearest you on that frequency', async () => {
    setLocator(async () => DC);
    answer([geo('la', 'KIIS 103.5', 34.05, -118.24, 900), geo('dc', 'WTOP 103.5', 38.95, -77.03, 5)]);
    await useOnlineRadio.getState().tune(103.5);
    expect(useOnlineRadio.getState().current?.id).toBe('dc');
    expect(useOnlineRadio.getState().here).toEqual(DC.here);
  });

  it('finds the stations near you', async () => {
    setLocator(async () => DC);
    answer([geo('far', 'Far FM', 34.05, -118.24), geo('near', 'Near FM', 38.95, -77.03)]);
    await useOnlineRadio.getState().findNearby();
    const s = useOnlineRadio.getState();
    expect(s.nearbyStatus).toBe('ready');
    expect(s.nearby.map((x) => x.id)).toEqual(['near']);
  });

  it('says so when there is no location, and when nothing is near', async () => {
    setLocator(async () => null);
    await useOnlineRadio.getState().findNearby();
    expect(useOnlineRadio.getState().nearbyStatus).toBe('no-location');
    setLocator(async () => DC);
    answer([geo('far', 'Far FM', 34.05, -118.24)]);
    await useOnlineRadio.getState().findNearby();
    expect(useOnlineRadio.getState().nearbyStatus).toBe('empty');
  });

  it('shows a plain error when the directory cannot be reached', async () => {
    setLocator(async () => DC);
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await useOnlineRadio.getState().findNearby();
    expect(useOnlineRadio.getState().nearbyStatus).toBe('error');
  });
});

describe('your own country first', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setLocator, guessCountry } = require('../useOnlineRadio');
  const US = { here: { latitudeDeg: 38.9072, longitudeDeg: -77.0369 }, countryCode: 'US' };
  const r = (id: string, name: string, cc: string, lat: number | null = null, lon: number | null = null, votes = 10) => ({ ...row(id, name, votes), countrycode: cc, geo_lat: lat, geo_long: lon });
  afterEach(() => setLocator(null));

  it('plays the nearest station of your country and lists only your country on that frequency', async () => {
    setLocator(async () => US);
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => [r('mx', 'Radio 103.5', 'MX', 19.4, -99.1, 999), r('la', 'KIIS 103.5', 'US', 34.05, -118.24, 500), r('dc', 'WTOP 103.5', 'US', 38.95, -77.03, 5)].filter((x) => !String(url).includes('countrycode=US') || x.countrycode === 'US'),
    })) as unknown as typeof fetch;
    await useOnlineRadio.getState().tune(103.5);
    const s = useOnlineRadio.getState();
    expect(s.stations.map((x) => x.id)).toEqual(['dc', 'la']);
    expect(s.current?.id).toBe('dc');
    expect(s.scope).toBe('US');
  });

  it('never shows stations from other countries, even when your country has none', async () => {
    setLocator(async () => US);
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => [r('mx', 'Radio 99.1', 'MX', 19.4, -99.1)].filter((x) => !String(url).includes('countrycode=US') || x.countrycode === 'US'),
    })) as unknown as typeof fetch;
    await useOnlineRadio.getState().tune(99.1);
    const s = useOnlineRadio.getState();
    expect(s.stations).toEqual([]);
    expect(s.status).toBe('nomatch');
    expect(audio.createAudioPlayer).not.toHaveBeenCalled();
  });

  it('drops other countries even if the directory sends them anyway', async () => {
    setLocator(async () => US);
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => [r('mx', 'Radio 99.1', 'MX'), r('us', 'WXYZ 99.1', 'US')] })) as unknown as typeof fetch;
    await useOnlineRadio.getState().tune(99.1);
    expect(useOnlineRadio.getState().stations.map((x) => x.id)).toEqual(['us']);
  });

  it('does not tune at all when the country is not known, and says what to do', async () => {
    setLocator(async () => null);
    global.fetch = jest.fn() as unknown as typeof fetch;
    await useOnlineRadio.getState().tune(99.1);
    const s = useOnlineRadio.getState();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/which country/);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(audio.createAudioPlayer).not.toHaveBeenCalled();
  });

  it('searches by name inside your country only', async () => {
    setLocator(async () => US);
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => [r('mx', 'Jazz MX', 'MX'), r('us', 'Jazz US', 'US')] })) as unknown as typeof fetch;
    await useOnlineRadio.getState().search('jazz');
    expect(useOnlineRadio.getState().stations.map((x) => x.id)).toEqual(['us']);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('countrycode=US');
  });

  it('works out the country from where the phone is when the phone cannot say', () => {
    // In the United States: the answer is the United States or Canada whatever the phone's region says.
    expect(guessCountry({ latitudeDeg: 38.9, longitudeDeg: -77.0 })).toMatch(/^(US|CA)$/);
    // Standing in Mexico City: never the United States, even if the phone's region setting says so.
    expect(guessCountry({ latitudeDeg: 19.43, longitudeDeg: -99.13 })).not.toBe('US');
    expect(guessCountry({ latitudeDeg: 19.43, longitudeDeg: -99.13 })).not.toBe('CA');
  });
});

describe('the dial follows what is playing', () => {
  it('shows the frequency of a station chosen from the list', async () => {
    answer([row('a', 'One 103.5'), row('b', 'Two 103.5', 1), row('c', 'Mix 98.7 FM', 0)]);
    await useOnlineRadio.getState().tune(103.5);
    await useOnlineRadio.getState().play({ ...useOnlineRadio.getState().stations[0], id: 'x', name: 'Other 91.3', url: 'https://x/91' });
    expect(useOnlineRadio.getState().mhz).toBe(91.3);
    expect(useOnlineRadio.getState().current?.id).toBe('x');
  });

  it('keeps the dial where it was when the station has no frequency in its name', async () => {
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    await useOnlineRadio.getState().play({ ...useOnlineRadio.getState().stations[0], id: 'j', name: 'Smooth Jazz', url: 'https://x/jazz' });
    expect(useOnlineRadio.getState().mhz).toBe(103.5);
  });

  it('follows a station started from the near-me list or a name search too', async () => {
    useOnlineRadio.setState({ mhz: 88.1 });
    await useOnlineRadio.getState().play({ id: 'n', name: 'Local 96.3', url: 'https://x/n', country: 'USA', countryCode: 'US', bitrate: 128, codec: 'MP3', votes: 1, tags: '', state: '', lat: null, lon: null });
    expect(useOnlineRadio.getState().mhz).toBe(96.3);
  });

  it('does not search again for the frequency it just showed', async () => {
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    (global.fetch as jest.Mock).mockClear();
    await useOnlineRadio.getState().play({ ...useOnlineRadio.getState().stations[0], id: 'x', name: 'Other 91.3', url: 'https://x/91' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('the station list keeps its own name', () => {
  it('names the list for the frequency that was tuned, even after the dial moves to another station', async () => {
    answer([row('a', 'One 103.5')]);
    await useOnlineRadio.getState().tune(103.5);
    expect(useOnlineRadio.getState().listTitle).toBe('All US stations on 103.5 MHz');
    await useOnlineRadio.getState().play({ ...useOnlineRadio.getState().stations[0], id: 'x', name: 'Other 91.3', url: 'https://x/91' });
    expect(useOnlineRadio.getState().mhz).toBe(91.3);
    expect(useOnlineRadio.getState().listTitle).toBe('All US stations on 103.5 MHz');
  });

  it('names a name search by its words', async () => {
    answer([row('a', 'Jazz FM')]);
    await useOnlineRadio.getState().search(' jazz ');
    expect(useOnlineRadio.getState().listTitle).toBe('Results for “jazz”');
  });
});
