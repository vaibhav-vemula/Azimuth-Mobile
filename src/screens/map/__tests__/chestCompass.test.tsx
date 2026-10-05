import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { ARRIVED_M, ChestCompass } from '../components/ChestCompass';
import { ARROW_PATH, DirectionArrow, shortestTurn } from '../components/DirectionArrow';
import type { Chest } from '../../../network/api';
import { useUnits } from '../../../units/units';
beforeEach(() => useUnits.getState().setPreference('metric'));


const chest: Chest = { id: 'c1', title: 'Wi-Fi at Main St Cafe', kind: 'wifi-quality', cellId: 'h120:1:1', rewardUsdc: 0.5, remaining: 3, expiresMs: Date.now() + 3 * 3600_000, requester: 'Cafe', requires: 'phone', spec: {} };

function text(node: renderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: renderer.ReactTestInstance) => {
    n.children.forEach((c) => (typeof c === 'string' ? out.push(c) : walk(c)));
  };
  walk(node.root);
  return out.join('|');
}

function render(props: Partial<React.ComponentProps<typeof ChestCompass>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ChestCompass chest={chest} distanceM={420} bearingDeg={90} headingDeg={0} onPress={() => undefined} onAr={() => undefined} {...props} />);
  });
  return tree;
}

describe('ChestCompass', () => {
  it('shows only an arrow, how far it is and which way, with no reward amount', () => {
    const t = text(render());
    expect(t).toContain('420 m');
    expect(t).toContain('E');
    expect(t).not.toContain('0.5'); // the reward is not shown
    expect(t).not.toMatch(/USDC/);
    expect(t).not.toContain('Wi-Fi at Main St Cafe'); // compact: no title
  });

  it('says you are there once you arrive', () => {
    expect(text(render({ distanceM: ARRIVED_M - 10 }))).toContain('You are here');
  });

  it('is pressable', () => {
    const onPress = jest.fn();
    const t = render({ onPress });
    act(() => t.root.findByProps({ accessibilityLabel: 'Nearest chest: Wi-Fi at Main St Cafe' }).props.onPress());
    expect(onPress).toHaveBeenCalled();
  });

  it('offers the camera only when the chest is within AR range', () => {
    expect(render({ distanceM: 420 }).root.findAllByProps({ accessibilityLabel: 'Find the chest in AR' })).toHaveLength(0);
    const onAr = jest.fn();
    const near = render({ distanceM: 45, onAr });
    act(() => near.root.findByProps({ accessibilityLabel: 'Find the chest in AR' }).props.onPress());
    expect(onAr).toHaveBeenCalledTimes(1);
  });
});

describe('DirectionArrow', () => {
  it('takes the short way round when it turns', () => {
    expect(shortestTurn(350, 10)).toBe(370);
    expect(shortestTurn(10, 350)).toBe(-10);
    expect(shortestTurn(0, 180)).toBe(180);
    expect(shortestTurn(90, 90)).toBe(90);
  });

  it('turns with the phone: target east while facing north points right, facing east points up', () => {
    const rotationOf = (heading: number | null) => {
      let t!: renderer.ReactTestRenderer;
      act(() => {
        t = renderer.create(<DirectionArrow bearingDeg={90} headingDeg={heading} />);
      });
      // The arrow glides to its angle, so the rotation is an animated value; read what it currently holds.
      const flat = (style: unknown): any => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style ?? {});
      const spinning = t.root.findAll((n) => Array.isArray(flat(n.props?.style).transform))[0];
      const rotate = flat(spinning.props.style).transform[0].rotate;
      return Math.round(parseFloat(typeof rotate === 'string' ? rotate : rotate.__getValue())) + 'deg';
    };
    expect(rotationOf(0)).toBe('90deg');
    expect(rotationOf(90)).toBe('0deg');
    expect(rotationOf(null)).toBe('90deg');
  });
});

describe('the arrow shape', () => {
  const points = [...ARROW_PATH.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);

  it('has its tip at the top centre, so turning it by zero degrees points straight up', () => {
    const top = points.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(top[0]).toBe(50);
    expect(points.filter((p) => p[1] === top[1])).toHaveLength(1); // one tip, not an edge
  });

  it('is symmetric about the vertical centre line, so it does not lean to either side', () => {
    const left = points.filter((p) => p[0] < 50).map((p) => 100 - p[0]).sort();
    const right = points.filter((p) => p[0] > 50).map((p) => p[0]).sort();
    expect(left).toEqual(right);
  });
});
