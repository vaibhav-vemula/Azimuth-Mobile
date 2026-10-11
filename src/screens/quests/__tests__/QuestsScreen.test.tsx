import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

const mockNavigate = jest.fn();
const mockClaim = jest.fn();
let mockHook: Record<string, unknown>;
let mockWallet: { status: string; address: string | null };
type Wallet = typeof mockWallet;

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../../components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../challenges/useChallenges', () => ({ useChallenges: () => mockHook }));
jest.mock('../../../wallet/useWallet', () => ({ useWallet: (sel: (s: unknown) => unknown) => sel(mockWallet) }));

import QuestsScreen from '../QuestsScreen';

const ch = (id: string, period: 'daily' | 'weekly' | 'once', title: string) => ({
  id, title, blurb: 'b', period, metric: 'mapping_minutes' as const, goal: 30, reward: 5, go: 'Map' as const,
});
const item = (id: string, period: 'daily' | 'weekly' | 'once', title: string, state: unknown, value = 10) => ({ challenge: ch(id, period, title), value, state });

function render(over: Record<string, unknown> = {}, wallet: Wallet = { status: 'connected', address: 'abc' }) {
  mockWallet = wallet;
  mockHook = { items: [], loading: false, error: null, claiming: null, message: null, claim: mockClaim, refresh: jest.fn(), ...over };
  let t!: renderer.ReactTestRenderer;
  act(() => {
    t = renderer.create(<QuestsScreen />);
  });
  return t;
}
const text = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());
const press = (t: renderer.ReactTestRenderer, label: string) =>
  t.root.findAll(
    (n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && JSON.stringify(n.findAllByType(Text).map((x) => x.props.children)).includes(label)
  )[0];

beforeEach(() => jest.clearAllMocks());

describe('QuestsScreen', () => {
  it('groups cards under the section labels', () => {
    const out = text(render({ items: [item('a', 'daily', 'Scan daily', { kind: 'progress', value: 10 }), item('b', 'weekly', 'Scan weekly', { kind: 'progress', value: 10 }), item('c', 'once', 'First chest', { kind: 'progress', value: 10 })] }));
    for (const s of ['DAILY', 'WEEKLY', 'ONE TIME', 'Scan daily', 'Scan weekly', 'First chest', '+5 AZMTest']) expect(out).toContain(s);
  });
  it('shows an empty message and a first-load error', () => {
    expect(text(render())).toContain('No challenges right now.');
    expect(text(render({ error: 'Could not reach the verifier.' }))).toContain('Could not reach the verifier.');
  });
  it('Go navigates to the tab', () => {
    const t = render({ items: [item('scan-30', 'daily', 'Scan', { kind: 'progress', value: 10 })] });
    act(() => press(t, 'Go').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Map');
  });
  it('Claim calls claim', () => {
    const t = render({ items: [item('scan-30', 'daily', 'Scan', { kind: 'ready' }, 30)] });
    act(() => press(t, 'Claim').props.onPress());
    expect(mockClaim).toHaveBeenCalledWith('scan-30');
  });
  it('shows waiting and claimed', () => {
    expect(text(render({ items: [item('a', 'daily', 'A', { kind: 'waiting' }, 30)] }))).toContain('Waiting for check');
    expect(text(render({ items: [item('a', 'daily', 'A', { kind: 'claimed' }, 30)] }))).toContain('Claimed');
  });
  it('asks to connect without a wallet', () => {
    expect(text(render({}, { status: 'disconnected', address: null }))).toContain('Connect your wallet');
  });
});
