import { FrameCollector } from './frameCollector';

const frame = (level: number, rms = 0.1, clip = 0) => ({ bins: new Array(64).fill(level), rms, clip });

describe('FrameCollector', () => {
  it('averages the spectrum, level and clipping over the frames pushed', () => {
    const collector = new FrameCollector();
    collector.push(frame(0.2, 0.1, 0));
    collector.push(frame(0.4, 0.3, 0.02));
    const s = collector.snapshot();
    expect(s.frames).toBe(2);
    expect(s.bins[0]).toBeCloseTo(0.3, 9);
    expect(s.bins).toHaveLength(64);
    expect(s.rms).toBeCloseTo(0.2, 9);
    expect(s.clip).toBeCloseTo(0.01, 9);
    expect(s.clipMax).toBeCloseTo(0.02, 9);
  });

  it('starts fresh after a reset', () => {
    const collector = new FrameCollector();
    collector.push(frame(0.9, 0.9, 0.5));
    collector.reset();
    expect(collector.snapshot().frames).toBe(0);
    collector.push(frame(0.1, 0.05, 0));
    const s = collector.snapshot();
    expect(s.bins[10]).toBeCloseTo(0.1, 9);
    expect(s.clipMax).toBe(0);
  });

  it('is safe to read when empty', () => {
    const s = new FrameCollector().snapshot();
    expect(s.frames).toBe(0);
    expect(s.rms).toBe(0);
    expect(s.bins).toEqual([]);
  });
});
