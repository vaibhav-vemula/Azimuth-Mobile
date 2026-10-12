import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { DialogHost, appAlert, toneFor, useDialogs } from '../dialog';

const render = () => {
  let t!: renderer.ReactTestRenderer;
  act(() => {
    t = renderer.create(<DialogHost />);
  });
  return t;
};
const json = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());
const button = (t: renderer.ReactTestRenderer, label: string) =>
  t.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && JSON.stringify(n.findAllByType(Text).map((x) => x.props.children)).includes(label))[0];

beforeEach(() => act(() => useDialogs.setState({ queue: [] })));

describe('toneFor', () => {
  it('reads the title and buttons', () => {
    expect(toneFor('Delete?', [{ text: 'Delete', style: 'destructive' }])).toBe('warning');
    expect(toneFor('Export failed', [{ text: 'OK' }])).toBe('danger');
    expect(toneFor('Could not delete', [{ text: 'OK' }])).toBe('danger');
    expect(toneFor('Notifications blocked', [{ text: 'OK' }])).toBe('warning');
    expect(toneFor('Exported', [{ text: 'OK' }])).toBe('success');
    expect(toneFor('Disconnect wallet?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect' }])).toBe('info');
  });
});

describe('appAlert', () => {
  it('shows nothing until asked, then the title, message and an OK button by default', () => {
    const t = render();
    expect(t.toJSON()).toBeNull();
    act(() => appAlert('Exported', 'Saved to Downloads'));
    const out = json(t);
    expect(out).toContain('Exported');
    expect(out).toContain('Saved to Downloads');
    expect(button(t, 'OK')).toBeDefined();
  });

  it('closes on a button and runs that button\'s action once', () => {
    const t = render();
    const onDelete = jest.fn();
    const onCancel = jest.fn();
    act(() => appAlert('Erase?', 'Cannot be undone.', [{ text: 'Cancel', style: 'cancel', onPress: onCancel }, { text: 'Erase', style: 'destructive', onPress: onDelete }]));
    act(() => button(t, 'Erase').props.onPress());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(t.toJSON()).toBeNull();
  });

  it('puts Cancel first however the buttons were given', () => {
    const t = render();
    act(() => appAlert('Stop?', undefined, [{ text: 'Stop', style: 'destructive' }, { text: 'Cancel', style: 'cancel' }]));
    const labels = t.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button').map((n) => n.findAllByType(Text)[0].props.children);
    expect(labels.indexOf('Cancel')).toBeLessThan(labels.indexOf('Stop'));
  });

  it('shows pop-ups one after another', () => {
    const t = render();
    act(() => {
      appAlert('First');
      appAlert('Second');
    });
    expect(json(t)).toContain('First');
    expect(json(t)).not.toContain('Second');
    act(() => button(t, 'OK').props.onPress());
    expect(json(t)).toContain('Second');
  });
});
