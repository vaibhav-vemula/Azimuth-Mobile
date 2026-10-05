import { deriveKeys, open, seal, unlockMessage } from '../crypto';
import { EMPTY, Snapshot, hasNewerThan, mergeSnapshots, packSnapshot, unpackSnapshot } from '../snapshot';

const sig = (fill: number) => new Uint8Array(64).fill(fill);
const cell = (n: number, t: number) => ({ n, cs: 0, cn: 0, dz: 0, ws: 0, wn: 0, bs: 0, bn: 0, t });
const snap = (p: Partial<Snapshot>): Snapshot => ({ ...EMPTY, savedMs: 0, ...p });

describe('keys from a wallet signature', () => {
  it('are the same every time for the same signature, and differ for another wallet', () => {
    expect(deriveKeys(sig(1))).toEqual(deriveKeys(sig(1)));
    expect(deriveKeys(sig(1)).key).not.toBe(deriveKeys(sig(2)).key);
    expect(deriveKeys(sig(1)).tag).not.toBe(deriveKeys(sig(2)).tag);
  });

  it('give a 32-byte key and a 16-byte label, and the label does not reveal the key', () => {
    const k = deriveKeys(sig(7));
    expect(k.key).toMatch(/^[0-9a-f]{64}$/);
    expect(k.tag).toMatch(/^[0-9a-f]{32}$/);
    expect(k.key.startsWith(k.tag)).toBe(false);
  });

  it('name the wallet in the message that is signed', () => {
    expect(unlockMessage('Abc123')).toContain('Abc123');
  });
});

describe('encryption', () => {
  const key = deriveKeys(sig(3)).key;

  it('round-trips, with a different result each time', () => {
    const plain = new TextEncoder().encode('fog of war');
    const a = seal(plain, key);
    expect(open(a, key)).toEqual(plain);
    expect(seal(plain, key)).not.toBe(a);
  });

  it('refuses the wrong key', () => {
    expect(() => open(seal(new Uint8Array([1, 2, 3]), key), deriveKeys(sig(4)).key)).toThrow(/cannot be opened/);
  });

  it('refuses data that was changed', () => {
    const sealed = Buffer.from(seal(new Uint8Array([1, 2, 3, 4, 5]), key), 'base64');
    sealed[sealed.length - 1] ^= 1;
    expect(() => open(sealed.toString('base64'), key)).toThrow();
  });

  it('refuses something far too short', () => {
    expect(() => open('AAAA', key)).toThrow();
  });
});

describe('snapshots', () => {
  it('pack small and unpack to the same thing', () => {
    const explored: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) explored[`f5:${i}:${i * 3}`] = 1_700_000_000_000 + i;
    const s = snap({ explored, signals: { 'h20:1:2': cell(3, 5) }, savedMs: 9 });
    const bytes = packSnapshot(s);
    expect(bytes.length).toBeLessThan(JSON.stringify(s).length / 3);
    expect(unpackSnapshot(bytes)).toEqual(s);
  });

  it('refuse something that is not a snapshot', () => {
    expect(() => unpackSnapshot(packSnapshot({ v: 2 } as never))).toThrow(/format/);
  });

  it('merge by adding cells, keeping the earliest time, and never losing any', () => {
    const a = snap({ explored: { x: 5, y: 9 }, visited: { v: 3 }, savedMs: 10 });
    const b = snap({ explored: { x: 2, z: 7 }, visited: { w: 4 }, savedMs: 20 });
    const m = mergeSnapshots(a, b);
    expect(m.explored).toEqual({ x: 2, y: 9, z: 7 });
    expect(m.visited).toEqual({ v: 3, w: 4 });
    expect(m.savedMs).toBe(20);
  });

  it('keeps the signal cell with more readings, then the newer one', () => {
    const m = mergeSnapshots(
      snap({ signals: { a: cell(2, 100), b: cell(5, 100), c: cell(3, 100) } }),
      snap({ signals: { a: cell(4, 50), b: cell(1, 999), c: cell(3, 200), d: cell(1, 1) } })
    );
    expect(m.signals.a.n).toBe(4);
    expect(m.signals.b.n).toBe(5);
    expect(m.signals.c.t).toBe(200);
    expect(m.signals.d.n).toBe(1);
  });

  it('merging twice changes nothing more', () => {
    const a = snap({ explored: { x: 1 }, signals: { s: cell(2, 3) } });
    const b = snap({ explored: { y: 2 }, signals: { s: cell(5, 4) } });
    const once = mergeSnapshots(a, b);
    expect(mergeSnapshots(once, b)).toEqual(once);
  });

  it('knows when there is something new to upload', () => {
    const base = snap({ explored: { x: 1 }, signals: { s: cell(2, 3) } });
    expect(hasNewerThan(base, base)).toBe(false);
    expect(hasNewerThan(snap({ explored: { x: 1, y: 2 }, signals: base.signals }), base)).toBe(true);
    expect(hasNewerThan(snap({ explored: base.explored, signals: { s: cell(3, 3) } }), base)).toBe(true);
    expect(hasNewerThan(snap({}), base)).toBe(false);
  });
});
