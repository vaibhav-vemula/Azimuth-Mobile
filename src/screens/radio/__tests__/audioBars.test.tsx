import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AudioBars } from '../components/AudioBars';
import { useAudioBars } from '../../../radio/online/useOnlineRadio';

jest.mock('../../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));

const text = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());
function render(playing: boolean) {
  let t!: renderer.ReactTestRenderer;
  act(() => {
    t = renderer.create(<AudioBars playing={playing} />);
  });
  return t;
}

describe('the online signal bars', () => {
  it('say there is no stream when nothing is playing', () => {
    useAudioBars.setState({ bins: new Array(64).fill(0), sampling: 'unknown' });
    expect(text(render(false))).toContain('No signal stream');
  });

  it('show the bars with no message and no label when they follow the real sound', () => {
    useAudioBars.setState({ sampling: 'on', bins: new Array(64).fill(0.5) });
    const out = text(render(true));
    expect(out).not.toContain('No signal stream');
    expect(out).not.toContain('SIMULATED');
    expect(out).toContain('Sound of the station');
  });

  it('show no label and no microphone text, whether the bars follow the sound or move on their own', () => {
    for (const sampling of ['on', 'simulated'] as const) {
      useAudioBars.setState({ sampling, bins: new Array(64).fill(0.4) });
      const out = text(render(true));
      expect(out).not.toMatch(/simulated/i);
      expect(out).not.toMatch(/microphone/i);
      expect(out).not.toContain('real sound');
      expect(out).toContain('Sound of the station');
    }
  });

  it('say there is no stream when nothing is playing, even while the display is idle', () => {
    useAudioBars.setState({ sampling: 'simulated' });
    expect(text(render(false))).toContain('No signal stream');
  });
});
