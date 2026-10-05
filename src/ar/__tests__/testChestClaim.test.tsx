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

const submitReport = jest.fn();
jest.mock('../../network/api', () => ({ ...jest.requireActual('../../network/api'), submitReport: (...a: unknown[]) => submitReport(...a) }));

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
    expect(submitReport).not.toHaveBeenCalled();
    expect(latest.state).toMatchObject({ phase: 'done', accepted: true, pending: false });
    expect((latest.state as { message: string }).message).toMatch(/Nothing was submitted/);
  });
});
