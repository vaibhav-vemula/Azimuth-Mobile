import { useOnlineRadio } from '../useOnlineRadio';

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
const answer = (rows: unknown[]) => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => rows })) as unknown as typeof fetch;
};

beforeEach(() => {
  audio.__players.length = 0;
  audio.createAudioPlayer.mockClear();
  useOnlineRadio.getState().stop();
  useOnlineRadio.setState({ stations: [], status: 'idle', error: null });
});

describe('online radio', () => {
  it('tunes a frequency by playing the best station that names it', async () => {
    answer([row('a', 'Low 103.5', 5), row('b', 'Top 103.5', 90), row('c', 'Elsewhere 99.1', 500)]);
    await useOnlineRadio.getState().tune(103.5, 'US');
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
    await useOnlineRadio.getState().search('jazz', 'US');
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
    expect(old.removed).toBe(true);
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

  it('say so when this phone cannot give out the audio', async () => {
    answer([row('a', 'One 103.5')]);
    audio.createAudioPlayer.mockImplementationOnce((source: unknown) => {
      const p = { source, volume: 1, isAudioSamplingSupported: false, setAudioSamplingEnabled: jest.fn(), play: jest.fn(), remove: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) };
      return p;
    });
    await useOnlineRadio.getState().tune(103.5);
    expect(useAudioBars.getState().sampling).toBe('off');
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
    expect(useAudioBars.getState().sampling).toBe('needs-permission');
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
    expect(useAudioBars.getState().sampling).toBe('needs-permission');
  });
});
