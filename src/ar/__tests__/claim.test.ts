import { readinessOf } from '../readiness';
import type { Chest } from '../../network/api';

const chest = (over: Partial<Chest> = {}): Chest => ({ id: 'c', title: 't', kind: 'gap', cellId: 'h120:1:1', rewardUsdc: 1, remaining: 1, expiresMs: Date.now() + 1e6, requester: 'r', requires: 'phone', spec: {}, ...over });
const input = (over: Partial<Parameters<typeof readinessOf>[0]> = {}) => ({ chest: chest(), mappingRunning: true, hasWallet: true, have: 5, radioHave: 0, ...over });

describe('readinessOf', () => {
  it('is ready once there is a wallet, mapping and enough readings', () => {
    expect(readinessOf(input())).toMatchObject({ ready: true, hint: 'Ready to open.', needed: 3, have: 5 });
  });

  it('says what is missing, in the order a player would fix it', () => {
    expect(readinessOf(input({ hasWallet: false }))).toMatchObject({ ready: false });
    expect(readinessOf(input({ hasWallet: false })).hint).toMatch(/wallet/i);
    expect(readinessOf(input({ mappingRunning: false })).hint).toMatch(/Start mapping/);
    expect(readinessOf(input({ have: 1 })).hint).toBe('Readings near the chest: 1 of 3. Keep walking toward it.');
  });

  it('honours a chest that wants more readings', () => {
    expect(readinessOf(input({ chest: chest({ spec: { minSamples: 6 } }), have: 5 })).ready).toBe(false);
    expect(readinessOf(input({ chest: chest({ spec: { minSamples: 6 } }), have: 6 })).ready).toBe(true);
  });

  it('needs a dongle reading for radio chests, and explains a sonde hunt', () => {
    const radio = chest({ kind: 'weather-radio', requires: 'dongle' });
    expect(readinessOf(input({ chest: radio })).hint).toMatch(/dongle reading/);
    expect(readinessOf(input({ chest: radio, radioHave: 1 })).ready).toBe(true);
    const sonde = chest({ kind: 'sonde', requires: 'dongle', spec: { frequencyHz: 403_000_200 } });
    expect(readinessOf(input({ chest: sonde })).hint).toMatch(/403\.000 MHz/);
  });

  it('never opens a satellite chest from the map', () => {
    const r = readinessOf(input({ chest: chest({ kind: 'satellite-pass', requires: 'dongle' }) }));
    expect(r.ready).toBe(false);
    expect(r.hint).toMatch(/Satellites tab/);
  });
});
