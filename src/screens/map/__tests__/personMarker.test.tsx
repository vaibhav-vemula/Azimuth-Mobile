import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { PersonMarker } from '../components/PersonMarker';
import { DRIVING_MPS, WALKING_MPS, activityFor, useHeadingStore } from '../../../mapping/headingStore';

function render(props: React.ComponentProps<typeof PersonMarker>) {
  let t!: renderer.ReactTestRenderer;
  act(() => {
    t = renderer.create(<PersonMarker {...props} />);
  });
  return t;
}
const json = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());

describe('what you are doing', () => {
  it('is standing still, walking or driving by speed', () => {
    expect(activityFor(0)).toBe('still');
    expect(activityFor(WALKING_MPS - 0.1)).toBe('still');
    expect(activityFor(1.4)).toBe('walking');
    expect(activityFor(DRIVING_MPS - 0.1)).toBe('walking');
    expect(activityFor(25)).toBe('driving');
  });

  it('is standing still when the phone does not know its speed', () => {
    for (const unknown of [null, undefined, Number.NaN, -1]) expect(activityFor(unknown)).toBe('still');
  });

  it('is kept in the store, and a repeat does not redraw anything', () => {
    useHeadingStore.getState().setActivity('driving');
    expect(useHeadingStore.getState().activity).toBe('driving');
    const seen: string[] = [];
    const off = useHeadingStore.subscribe((s) => seen.push(s.activity));
    useHeadingStore.getState().setActivity('driving');
    off();
    expect(seen).toEqual([]);
    useHeadingStore.getState().setActivity('still');
  });
});

describe('the person marker', () => {
  it('is labelled for screen readers', () => {
    expect(render({ headingDeg: 0, activity: 'still' }).root.findAllByProps({ accessibilityLabel: 'Your position' }).length).toBeGreaterThan(0);
  });

  it('draws a different figure for standing, walking and driving', () => {
    const still = json(render({ headingDeg: null, activity: 'still' }));
    const walking = json(render({ headingDeg: null, activity: 'walking' }));
    const driving = json(render({ headingDeg: null, activity: 'driving' }));
    expect(new Set([still, walking, driving]).size).toBe(3);
  });

  it('shows the beam only when the phone knows which way it faces, turned to that heading', () => {
    expect(json(render({ headingDeg: null, activity: 'still' }))).not.toContain('meBeam');
    const t = render({ headingDeg: 135, activity: 'still' });
    expect(json(t)).toContain('meBeam');
    expect(json(t)).toContain('135deg');
  });

  it('strides while walking by swapping between the two halves of a step, and stands when it stops', () => {
    jest.useFakeTimers();
    try {
      let t!: renderer.ReactTestRenderer;
      act(() => {
        t = renderer.create(<PersonMarker headingDeg={null} activity="walking" />);
      });
      const frames = new Set<string>([json(t)]);
      for (let i = 0; i < 4; i += 1) {
        act(() => {
          jest.advanceTimersByTime(300);
        });
        frames.add(json(t));
      }
      expect(frames.size).toBe(2);
      act(() => t.update(<PersonMarker headingDeg={null} activity="still" />));
      const standing = json(t);
      act(() => {
        jest.advanceTimersByTime(900);
      });
      expect(json(t)).toBe(standing);
    } finally {
      jest.useRealTimers();
    }
  });

  it('puts the feet on the exact position: the figure reaches above the centre of the marker, not below it', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FEET_Y, ART_H } = require('../components/PersonArt');
    expect(FEET_Y).toBeLessThan(ART_H);
    expect(FEET_Y).toBeGreaterThan(ART_H * 0.85);
  });
});
