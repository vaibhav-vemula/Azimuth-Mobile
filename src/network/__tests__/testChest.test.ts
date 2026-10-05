import { distanceM } from '../../mapping/hexGrid';
import { useChests } from '../useChests';

const HERE = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };

beforeEach(() => {
  useChests.getState().clearTestChests();
  useChests.setState({ chests: [] });
});

describe('the test chest', () => {
  it('is placed a few metres north of where you are, with an exact position and a cell', () => {
    const chest = useChests.getState().addTestChest(HERE);
    expect(chest.spec.test).toBe(true);
    expect(chest.spec.minSamples).toBe(1);
    expect(chest.cellId).toMatch(/^h\d+:-?\d+:-?\d+$/);
    const at = { latitudeDeg: chest.spec.lat!, longitudeDeg: chest.spec.lon! };
    expect(distanceM(HERE, at)).toBeGreaterThan(11);
    expect(distanceM(HERE, at)).toBeLessThan(13);
    expect(at.longitudeDeg).toBe(HERE.longitudeDeg);
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
