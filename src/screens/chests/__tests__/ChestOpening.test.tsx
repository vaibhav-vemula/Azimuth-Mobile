import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { ChestOpening, OPENING_MS } from '../ChestOpening';

const text = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const show = (props: Partial<React.ComponentProps<typeof ChestOpening>>) => {
  let t!: renderer.ReactTestRenderer;
  act(() => {
    t = renderer.create(<ChestOpening visible phase="working" accepted={false} message="" onClose={() => undefined} {...props} />);
  });
  return t;
};

describe('the chest opening', () => {
  it('shows the animation without a result while the wallet and server are busy', () => {
    const t = show({});
    act(() => jest.advanceTimersByTime(OPENING_MS + 100));
    expect(text(t)).toContain('Opening the chest');
    expect(text(t)).not.toContain('Chest opened');
  });

  it('holds back a fast result until the animation has played, then shows the reward', () => {
    const t = show({ phase: 'done', accepted: true, reward: '+5 AZM', message: 'It is on its way.' });
    expect(text(t)).not.toContain('+5 AZM');
    act(() => jest.advanceTimersByTime(OPENING_MS + 100));
    expect(text(t)).toContain('Chest opened');
    expect(text(t)).toContain('+5 AZM');
    expect(text(t)).toContain('It is on its way.');
  });

  it('says so when the chest could not be opened, with no reward', () => {
    const t = show({ phase: 'done', accepted: false, reward: '+5 AZM', message: 'Wallet request was cancelled.' });
    act(() => jest.advanceTimersByTime(OPENING_MS + 100));
    expect(text(t)).toContain('Could not open it');
    expect(text(t)).toContain('Wallet request was cancelled.');
    expect(text(t)).not.toContain('+5 AZM');
  });
});
