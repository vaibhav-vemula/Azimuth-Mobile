import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { MappingButton } from '../components/MappingButton';

const text = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());
function render(props: { running: boolean; busy?: boolean; onPress?: () => void }) {
  let t!: renderer.ReactTestRenderer;
  act(() => {
    t = renderer.create(<MappingButton running={props.running} busy={props.busy ?? false} onPress={props.onPress ?? (() => undefined)} />);
  });
  return t;
}
const button = (t: renderer.ReactTestRenderer) => t.root.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function')[0];

describe('the mapping button', () => {
  it('invites you to start, and starts', () => {
    const onPress = jest.fn();
    const t = render({ running: false, onPress });
    const out = text(t);
    expect(out).toContain('Start mapping');
    expect(out).toContain('Clear the fog and collect signals');
    expect(out).not.toContain('LIVE');
    act(() => button(t).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows Stop with a live marker while mapping', () => {
    const t = render({ running: true });
    const out = text(t);
    expect(out).toContain('Stop mapping');
    expect(out).toContain('Finish and save this session');
    expect(out).toContain('LIVE');
  });

  it('says what it is doing and cannot be pressed twice while working', () => {
    const starting = render({ running: false, busy: true });
    expect(text(starting)).toContain('Starting…');
    expect(button(starting).props.disabled).toBe(true);
    expect(button(starting).props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    const stopping = render({ running: true, busy: true });
    expect(text(stopping)).toContain('Stopping…');
    expect(text(stopping)).not.toContain('LIVE');
  });

  it('is labelled for screen readers by what it will do', () => {
    expect(button(render({ running: false })).props.accessibilityLabel).toBe('Start mapping');
    expect(button(render({ running: true })).props.accessibilityLabel).toBe('Stop mapping');
  });
});
