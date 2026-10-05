import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { FrequencyBar, fractionToMhz, mhzToFraction } from '../components/FrequencyBar';

describe('the frequency bar maths', () => {
  it('puts the ends of the band at the ends of the bar', () => {
    expect(mhzToFraction(87.5)).toBe(0);
    expect(mhzToFraction(108)).toBe(1);
    expect(mhzToFraction(97.75)).toBeCloseTo(0.5, 5);
    expect(mhzToFraction(50)).toBe(0);
    expect(mhzToFraction(200)).toBe(1);
  });

  it('turns a position back into a frequency on the 0.1 grid', () => {
    expect(fractionToMhz(0)).toBe(87.5);
    expect(fractionToMhz(1)).toBe(108);
    expect(fractionToMhz(0.5)).toBe(97.8); // 97.75 rounds to the nearest tenth
    expect(fractionToMhz(-1)).toBe(87.5);
    expect(fractionToMhz(2)).toBe(108);
  });

  it('round-trips every frequency on the grid', () => {
    for (let t = 875; t <= 1080; t += 1) {
      const mhz = t / 10;
      expect(fractionToMhz(mhzToFraction(mhz))).toBe(mhz);
    }
  });
});

describe('FrequencyBar', () => {
  function render(onScrub = jest.fn(), onCommit = jest.fn()) {
    let t!: renderer.ReactTestRenderer;
    act(() => {
      t = renderer.create(<FrequencyBar mhz={98.7} onScrub={onScrub} onCommit={onCommit} />);
    });
    act(() => {
      t.root.findByProps({ accessibilityLabel: 'Frequency bar' }).props.onLayout({ nativeEvent: { layout: { width: 328, height: 64 } } });
    });
    return { t, onScrub, onCommit };
  }

  it('is labelled with its frequency for screen readers', () => {
    const { t } = render();
    expect(t.root.findByProps({ accessibilityLabel: 'Frequency bar' }).props.accessibilityValue).toEqual({ text: '98.7 megahertz' });
  });

  it('shows the scale labels', () => {
    const { t } = render();
    const out = JSON.stringify(t.toJSON());
    for (const f of ['88', '96', '104', '108']) expect(out).toContain(`"${f}"`);
  });

  it('follows a touch along the bar, and finds the station when the finger lifts', () => {
    const { t, onScrub, onCommit } = render();
    const layer = t.root.findAll((n) => typeof n.props.onResponderGrant === 'function')[0];
    // Halfway along the usable part of the bar (14 px of room at each end of a 328 px bar).
    act(() => layer.props.onResponderGrant({ nativeEvent: { locationX: 14 + (328 - 28) / 2 }, touchHistory: { touchBank: [], indexOfSingleActiveTouch: -1 } }));
    expect(onScrub).toHaveBeenLastCalledWith(97.8);
    act(() => layer.props.onResponderRelease({ nativeEvent: {}, touchHistory: { touchBank: [], indexOfSingleActiveTouch: -1 } }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
