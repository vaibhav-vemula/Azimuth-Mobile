import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AzimuthMark } from '../Logo';

describe('AzimuthMark', () => {
  it('draws, and is labelled for screen readers', () => {
    let t!: renderer.ReactTestRenderer;
    act(() => {
      t = renderer.create(<AzimuthMark size={64} />);
    });
    expect(t.root.findAllByProps({ accessibilityLabel: 'Azimuth' }).length).toBeGreaterThan(0);
  });

  it('gives every copy its own gradient ids, so two on one screen do not clash', () => {
    let t!: renderer.ReactTestRenderer;
    act(() => {
      t = renderer.create(
        <>
          <AzimuthMark tile />
          <AzimuthMark />
        </>
      );
    });
    const ids = JSON.stringify(t.toJSON()).match(/"name":"[^"]+"/g) ?? [];
    expect(ids.length).toBeGreaterThanOrEqual(6); // three gradients in each copy
    expect(new Set(ids).size).toBe(ids.length);
  });
});
