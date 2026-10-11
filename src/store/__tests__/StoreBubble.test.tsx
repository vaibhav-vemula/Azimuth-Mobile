import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import { StoreBubble } from '../StoreBubble';
import { STORE_PRODUCTS } from '../products';

const text = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());

describe('Store', () => {
  it('sells a 50 USDC satellite and radio kit and a 25 USDC radio kit', () => {
    expect(STORE_PRODUCTS.map((p) => [p.id, p.priceUsdc])).toEqual([
      ['kit-satellite-radio', 50],
      ['kit-radio', 25],
    ]);
  });

  it('opens the store from the bubble, and each kit has a disabled order button', () => {
    let t!: renderer.ReactTestRenderer;
    act(() => {
      t = renderer.create(<StoreBubble />);
    });
    const bubble = t.root.findByProps({ accessibilityLabel: 'Open the store' });
    act(() => bubble.props.onPress());
    const out = text(t);
    expect(out).toContain('Satellite + Radio kit');
    expect(out).toContain('Radio kit');
    const orders = t.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button' && n.props.accessibilityState?.disabled === true);
    expect(orders).toHaveLength(2);
    expect(out.match(/Orders open soon/g)).toHaveLength(2);
  });
});
