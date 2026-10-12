import { distanceM } from '../../mapping/hexGrid';
import { useChests } from '../useChests';

const HERE = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };

beforeEach(() => {
  useChests.getState().clearTreasureChests();
  useChests.setState({ chests: [] });
});

describe('the treasure chests', () => {
  it('are three, placed together: one where you are and two about 200 m away', () => {
    const chests = useChests.getState().addTreasureChests(HERE, 120);
    expect(chests).toHaveLength(3);
    expect(useChests.getState().chests).toHaveLength(3);
    const at = (c: (typeof chests)[number]) => ({ latitudeDeg: c.spec.lat!, longitudeDeg: c.spec.lon! });
    expect(distanceM(HERE, at(chests[0]))).toBeLessThan(0.01);
    expect(distanceM(HERE, at(chests[1]))).toBeGreaterThan(190);
    expect(distanceM(HERE, at(chests[1]))).toBeLessThan(210);
    expect(distanceM(HERE, at(chests[2]))).toBeGreaterThan(190);
    expect(distanceM(HERE, at(chests[2]))).toBeLessThan(210);
    expect(distanceM(at(chests[1]), at(chests[2]))).toBeGreaterThan(200);
  });

  it('each have their own slot, are not called test chests, and need one reading', () => {
    const chests = useChests.getState().addTreasureChests(HERE, 120);
    expect(chests.map((c) => c.spec.treasure)).toEqual([1, 2, 3]);
    expect(new Set(chests.map((c) => c.id)).size).toBe(3);
    for (const c of chests) {
      expect(c.title).toBe('Treasure chest');
      expect(c.requester).toBe('Azimuth');
      expect(c.spec.minSamples).toBe(1);
      expect(c.cellId).toMatch(/^h\d+:-?\d+:-?\d+$/);
    }
    expect(chests[0].spec.facingDeg).toBe(120);
  });

  it('have no facing when the compass had no heading yet', () => {
    expect(useChests.getState().addTreasureChests(HERE, null)[0].spec.facingDeg).toBeUndefined();
  });

  it('can be removed again, and opening one leaves the other two', () => {
    const chests = useChests.getState().addTreasureChests(HERE);
    useChests.getState().markOpened(chests[0].id);
    expect(useChests.getState().chests.map((c) => c.id)).toEqual([chests[1].id, chests[2].id]);
    useChests.getState().clearTreasureChests();
    expect(useChests.getState().chests).toHaveLength(0);
  });
});

describe('an opened chest', () => {
  const real = (id: string) => ({ id, title: 'Cafe', kind: 'visit' as const, cellId: 'h120:1:1', rewardUsdc: 2, remaining: 3, expiresMs: Date.now() + 1e6, requester: 'r', requires: 'phone' as const, spec: {} });

  it('leaves the map and the list, and the others stay', () => {
    useChests.setState({ chests: [real('a'), real('b')] });
    useChests.getState().markOpened('a');
    expect(useChests.getState().chests.map((c) => c.id)).toEqual(['b']);
  });

  it('removes a treasure chest for good', () => {
    const chest = useChests.getState().addTreasureChests(HERE)[0];
    useChests.getState().markOpened(chest.id);
    expect(useChests.getState().chests.some((c) => c.id === chest.id)).toBe(false);
    useChests.getState().clearTreasureChests();
    expect(useChests.getState().chests).toHaveLength(0);
  });

  it('is remembered on the phone, so a refresh from the network does not bring it back', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadOpenedChests } = require('../../mapping/mappingStorage');
    useChests.getState().markOpened('zzz');
    expect(loadOpenedChests()).toContain('zzz');
  });
});
