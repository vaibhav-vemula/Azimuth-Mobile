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
