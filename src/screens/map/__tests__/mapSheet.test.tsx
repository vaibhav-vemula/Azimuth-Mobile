import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import { MapSheet } from '../components/MapSheet';

describe('MapSheet', () => {
  it('always renders the header and the body, and reports how tall the collapsed bar is', () => {
    const onCollapsedHeight = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MapSheet open={false} onOpenChange={() => undefined} onCollapsedHeight={onCollapsedHeight} header={<Text>HEADER</Text>}>
          <Text>BODY</Text>
        </MapSheet>
      );
    });
    const all = JSON.stringify(tree.toJSON());
    expect(all).toContain('HEADER');
    expect(all).toContain('BODY');
    expect(onCollapsedHeight).toHaveBeenCalled();
    expect(onCollapsedHeight.mock.calls[0][0]).toBeGreaterThan(100); // handle plus the default header height
  });

  it('has a handle that can be dragged or tapped, labelled for screen readers', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MapSheet open={false} onOpenChange={() => undefined} header={<Text>H</Text>}>
          <Text>B</Text>
        </MapSheet>
      );
    });
    const handle = tree.root.findByProps({ accessibilityLabel: 'Expand the mapping panel' });
    // The drag and tap behaviour needs real touches, so it is checked on a device; here we check it is wired up.
    expect(typeof handle.props.onResponderGrant).toBe('function');
    expect(typeof handle.props.onResponderMove).toBe('function');
    expect(typeof handle.props.onResponderRelease).toBe('function');

    act(() => {
      tree.update(
        <MapSheet open onOpenChange={() => undefined} header={<Text>H</Text>}>
          <Text>B</Text>
        </MapSheet>
      );
    });
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Collapse the mapping panel' }).length).toBeGreaterThan(0);
  });
});
