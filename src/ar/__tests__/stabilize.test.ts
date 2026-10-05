import { PositionFilter } from '../stabilize';

const HERE = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
const M = 1 / 111_320;
/** Repeatable random noise in [-1, 1] (a small seeded generator), so the test is the same every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}
const rand = seeded(7);
const noise = () => rand();
const fix = (i: number, sigma: number) => ({ latitudeDeg: HERE.latitudeDeg + noise() * sigma * M, longitudeDeg: HERE.longitudeDeg + (noise() * sigma * M) / Math.cos((HERE.latitudeDeg * Math.PI) / 180) });
const metres = (a: { latitudeDeg: number; longitudeDeg: number }, b: { latitudeDeg: number; longitudeDeg: number }) =>
  Math.hypot((a.latitudeDeg - b.latitudeDeg) / M, ((a.longitudeDeg - b.longitudeDeg) / M) * Math.cos((HERE.latitudeDeg * Math.PI) / 180));

describe('PositionFilter', () => {
  it('starts at the first fix', () => {
    expect(new PositionFilter().update(HERE, 5, 0)).toEqual(HERE);
  });

  it('settles when you stand still: the noisy fixes move the estimate far less than they move themselves', () => {
    const f = new PositionFilter();
    const raw: number[] = [];
    const out: ReturnType<PositionFilter['update']>[] = [];
    for (let i = 0; i < 60; i++) {
      const z = fix(i, 6);
      raw.push(metres(z, HERE));
      out.push(f.update(z, 6, i * 1000));
    }
    const late = out.slice(30).map((p) => metres(p, HERE));
    const lateRaw = raw.slice(30);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(late)).toBeLessThan(spread(lateRaw) / 2);
    expect(f.speed()).toBeLessThan(0.35);
  });

  it('follows you when you walk, and notices you are moving', () => {
    const f = new PositionFilter();
    let p = HERE;
    for (let i = 0; i < 40; i++) {
      p = f.update({ latitudeDeg: HERE.latitudeDeg + (i * 1.4) * M, longitudeDeg: HERE.longitudeDeg }, 4, i * 1000);
    }
    const truth = { latitudeDeg: HERE.latitudeDeg + 39 * 1.4 * M, longitudeDeg: HERE.longitudeDeg };
    expect(metres(p, truth)).toBeLessThan(8);
    expect(f.speed()).toBeGreaterThan(0.8);
  });

  it('trusts an accurate fix more than a poor one', () => {
    const jump = { latitudeDeg: HERE.latitudeDeg + 20 * M, longitudeDeg: HERE.longitudeDeg };
    const trusting = new PositionFilter();
    trusting.update(HERE, 4, 0);
    const a = metres(trusting.update(jump, 3, 1000), HERE);
    const doubting = new PositionFilter();
    doubting.update(HERE, 4, 0);
    const b = metres(doubting.update(jump, 40, 1000), HERE);
    expect(a).toBeGreaterThan(b);
  });
});
