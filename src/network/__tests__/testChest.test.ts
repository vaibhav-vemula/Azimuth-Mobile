import { distanceM } from '../../mapping/hexGrid';
import { useChests } from '../useChests';

const HERE = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };

beforeEach(() => {
  useChests.getState().clearTestChests();
  useChests.setState({ chests: [] });
});

describe('the test chest', () => {
  it('is placed exactly where you are, with its cell, and remembers which way you faced', () => {
    const chest = useChests.getState().addTestChest(HERE, 120);
    expect(chest.spec.test).toBe(true);
    expect(chest.spec.minSamples).toBe(1);
    expect(chest.spec.facingDeg).toBe(120);
    expect(chest.cellId).toMatch(/^h\d+:-?\d+:-?\d+$/);
    expect(distanceM(HERE, { latitudeDeg: chest.spec.lat!, longitudeDeg: chest.spec.lon! })).toBeLessThan(0.01);
  });

  it('has no facing when the compass had no heading yet', () => {
    expect(useChests.getState().addTestChest(HERE, null).spec.facingDeg).toBeUndefined();
  });

  it('shows up in the chest list, and can be removed again', () => {
    useChests.getState().addTestChest(HERE);
    expect(useChests.getState().chests.filter((c) => c.spec.test)).toHaveLength(1);
    useChests.getState().clearTestChests();
    expect(useChests.getState().chests).toHaveLength(0);
  });

  it('is open for two hours, to pay one USDC, and from a clearly named test requester', () => {
    const chest = useChests.getState().addTestChest(HERE);
    expect(chest.remaining).toBe(1);
    expect(chest.requester).toBe('Azimuth test');
    expect(chest.expiresMs - Date.now()).toBeGreaterThan(3_599_000 * 2 - 5000);
  });
});

describe('an opened chest', () => {
  const real = (id: string) => ({ id, title: 'Cafe', kind: 'visit' as const, cellId: 'h120:1:1', rewardUsdc: 2, remaining: 3, expiresMs: Date.now() + 1e6, requester: 'r', requires: 'phone' as const, spec: {} });

  it('leaves the map and the list, and the others stay', () => {
    useChests.setState({ chests: [real('a'), real('b')] });
    useChests.getState().markOpened('a');
    expect(useChests.getState().chests.map((c) => c.id)).toEqual(['b']);
  });

  it('removes a test chest for good', () => {
    const chest = useChests.getState().addTestChest(HERE);
    useChests.getState().markOpened(chest.id);
    expect(useChests.getState().chests.some((c) => c.id === chest.id)).toBe(false);
    useChests.getState().clearTestChests();
    expect(useChests.getState().chests).toHaveLength(0);
  });

  it('is remembered on the phone, so a refresh from the network does not bring it back', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadOpenedChests } = require('../../mapping/mappingStorage');
    useChests.getState().markOpened('zzz');
    expect(loadOpenedChests()).toContain('zzz');
  });
});
