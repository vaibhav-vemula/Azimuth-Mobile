import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { NearestChestCard, ARRIVED_M } from '../components/NearestChestCard';
import { DirectionArrow } from '../components/DirectionArrow';
import type { Chest } from '../../../network/api';

const chest: Chest = { id: 'c1', title: 'Wi-Fi at Main St Cafe', kind: 'wifi-quality', cellId: 'h120:1:1', rewardUsdc: 0.5, remaining: 3, expiresMs: Date.now() + 3 * 3600_000, requester: 'Cafe', requires: 'phone', spec: {} };

function text(node: renderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: renderer.ReactTestInstance) => {
    n.children.forEach((c) => (typeof c === 'string' ? out.push(c) : walk(c)));
  };
  walk(node.root);
  return out.join('');
}

function render(props: Partial<React.ComponentProps<typeof NearestChestCard>> = {}) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<NearestChestCard chest={chest} distanceM={420} bearingDeg={90} headingDeg={0} mappingRunning={false} onPress={() => undefined} {...props} />);
  });
  return tree;
}

describe('NearestChestCard', () => {
  it('shows the chest, how far it is, the reward and which way to go', () => {
    const t = text(render());
    expect(t).toContain('Wi-Fi at Main St Cafe');
    expect(t).toContain('420 m');
    expect(t).toContain('0.5 USDC');
    expect(t).toContain('E');
    expect(t).toContain('follow the arrow');
  });

  it('says so when there is no compass', () => {
    expect(text(render({ headingDeg: null }))).toContain('north-up');
  });

  it('tells you to start mapping when you arrive without it, and to keep going when mapping', () => {
    expect(text(render({ distanceM: ARRIVED_M - 10 }))).toContain('Start mapping to take the readings');
    expect(text(render({ distanceM: ARRIVED_M - 10, mappingRunning: true }))).toContain('Keep mapping');
  });

  it('is pressable', () => {
    const onPress = jest.fn();
    const t = render({ onPress });
    act(() => t.root.findByProps({ accessibilityRole: 'button' }).props.onPress());
    expect(onPress).toHaveBeenCalled();
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
      const rot = rotating.map((n) => n.props.style.transform?.[0]?.rotate).find(Boolean) as string;
      return rot;
    };
    expect(rotationOf(0)).toBe('90deg');
    expect(rotationOf(90)).toBe('0deg');
    expect(rotationOf(null)).toBe('90deg');
  });
});
