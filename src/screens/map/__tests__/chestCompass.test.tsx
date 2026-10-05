import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { ARRIVED_M, ChestCompass } from '../components/ChestCompass';
import { DirectionArrow } from '../components/DirectionArrow';
import type { Chest } from '../../../network/api';

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
  it('shows only an arrow, how far it is, which way, and the reward', () => {
    const t = text(render());
    expect(t).toContain('420 m');
    expect(t).toContain('E');
    expect(t).toContain('0.5');
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
  it('turns with the phone: target east while facing north points right, facing east points up', () => {
    const rotationOf = (heading: number | null) => {
      let t!: renderer.ReactTestRenderer;
      act(() => {
        t = renderer.create(<DirectionArrow bearingDeg={90} headingDeg={heading} />);
      });
      const rotating = t.root.findAll((n) => Array.isArray(n.props?.style?.transform) || false);
      return rotating.map((n) => n.props.style.transform?.[0]?.rotate).find(Boolean) as string;
    };
    expect(rotationOf(0)).toBe('90deg');
    expect(rotationOf(90)).toBe('0deg');
    expect(rotationOf(null)).toBe('90deg');
  });
});
