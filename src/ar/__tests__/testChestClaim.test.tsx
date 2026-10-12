import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { useChestClaim } from '../claim';
import type { Chest } from '../../network/api';

jest.mock('../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));

const mockSubmitReport = jest.fn();
jest.mock('../../network/api', () => ({ ...jest.requireActual('../../network/api'), submitReport: (...a: unknown[]) => mockSubmitReport(...a) }));

const mockSignAndSubmit = jest.fn();
jest.mock('../../challenges/claim', () => ({ ...jest.requireActual('../../challenges/claim'), signAndSubmitClaim: (...a: unknown[]) => mockSignAndSubmit(...a) }));

const testChest: Chest = { id: 'test-1', title: 'Test chest', kind: 'visit', cellId: 'h120:1:1', rewardUsdc: 1, remaining: 1, expiresMs: Date.now() + 1e6, requester: 'Azimuth test', requires: 'phone', spec: { minSamples: 1, test: true } };

function Probe({ onClaim }: { onClaim: (c: ReturnType<typeof useChestClaim>) => void }) {
  onClaim(useChestClaim(testChest, true, 0));
  return null;
}

describe('opening a test chest', () => {
  it('finishes on the phone: no wallet, no report, nothing sent', async () => {
    let latest!: ReturnType<typeof useChestClaim>;
    act(() => {
      renderer.create(<Probe onClaim={(c) => (latest = c)} />);
    });
    await act(async () => {
      await latest.claim();
    });
    expect(mockSubmitReport).not.toHaveBeenCalled();
    expect(latest.state).toMatchObject({ phase: 'done', accepted: true, pending: false });
    expect((latest.state as { message: string }).message).toMatch(/Nothing was submitted/);
  });
});

describe('after a chest is opened', () => {
  it('it leaves the map', async () => {
    const { useChests } = require('../../network/useChests');
    useChests.setState({ chests: [testChest] });
    let latest!: ReturnType<typeof useChestClaim>;
    act(() => {
      renderer.create(<Probe onClaim={(c) => (latest = c)} />);
    });
    expect(useChests.getState().chests.map((c: Chest) => c.id)).toEqual(['test-1']);
    await act(async () => {
      await latest.claim();
    });
    expect(useChests.getState().chests).toEqual([]);
  });
});

describe('opening a treasure chest', () => {
  const treasure: Chest = { ...testChest, id: 'treasure-2-1', title: 'Treasure chest', spec: { minSamples: 1, test: true, treasure: 2 } };
  const WALLET = '11111111111111111111111111111112';
  const probe = () => {
    let latest!: ReturnType<typeof useChestClaim>;
    function P() {
      latest = useChestClaim(treasure, true, 0);
      return null;
    }
    act(() => {
      renderer.create(<P />);
    });
    return () => latest;
  };

  beforeEach(() => mockSignAndSubmit.mockReset());

  it('signs a claim for its slot and says the AZM is on its way', async () => {
    const { useWallet } = require('../../wallet/useWallet');
    act(() => useWallet.setState({ address: WALLET }));
    mockSignAndSubmit.mockResolvedValue({ accepted: true, pending: true, reasons: [] });
    const get = probe();
    await act(async () => {
      await get().claim();
    });
    const claim = mockSignAndSubmit.mock.calls[0][0];
    expect(claim).toMatchObject({ type: 'challenge-claim', node: WALLET, challengeId: 'treasure-2' });
    expect(claim.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(get().state).toMatchObject({ phase: 'done', accepted: true });
    expect((get().state as { message: string }).message).toMatch(/5 AZM is on its way/);
  });

  it('shows the reason when the claim could not be sent, and the chest stays', async () => {
    const { useWallet } = require('../../wallet/useWallet');
    const { useChests } = require('../../network/useChests');
    act(() => useWallet.setState({ address: WALLET }));
    act(() => useChests.setState({ chests: [treasure] }));
    mockSignAndSubmit.mockRejectedValue(new Error('Wallet request was cancelled.'));
    const get = probe();
    await act(async () => {
      await get().claim();
    });
    expect(get().state).toMatchObject({ phase: 'error', message: 'Wallet request was cancelled.' });
    expect(useChests.getState().chests.map((c: Chest) => c.id)).toEqual(['treasure-2-1']);
  });

  it('needs a wallet, unlike a plain test chest', () => {
    const { useWallet } = require('../../wallet/useWallet');
    act(() => useWallet.setState({ address: null }));
    expect(probe()().hint).toMatch(/Connect a wallet/);
  });
});
