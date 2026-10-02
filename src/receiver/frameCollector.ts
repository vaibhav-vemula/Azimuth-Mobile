export interface Frame {
  bins: number[];
  rms: number;
  clip: number;
}

export interface FrameSummary {
  frames: number;
  /** Mean spectrum over the collected frames. */
  bins: number[];
  rms: number;
  clip: number;
  /** Worst single-frame clipping, to catch brief overloads that the mean hides. */
  clipMax: number;
}

/**
 * Accumulates the receiver's frames without re-rendering anything, so the auto-tuner can average over a window
 * (every frame counts, not just the ones the UI draws).
 */
export class FrameCollector {
  private count = 0;
  private binSum: number[] = [];
  private rmsSum = 0;
  private clipSum = 0;
  private clipMax = 0;

  push(frame: Frame): void {
    if (this.binSum.length !== frame.bins.length) this.binSum = new Array(frame.bins.length).fill(0);
    for (let i = 0; i < frame.bins.length; i += 1) this.binSum[i] += frame.bins[i];
    this.rmsSum += frame.rms;
    this.clipSum += frame.clip;
    this.clipMax = Math.max(this.clipMax, frame.clip);
    this.count += 1;
  }

  reset(): void {
    this.count = 0;
    this.binSum = [];
    this.rmsSum = 0;
    this.clipSum = 0;
    this.clipMax = 0;
  }

  snapshot(): FrameSummary {
    const n = Math.max(1, this.count);
    return {
      frames: this.count,
      bins: this.binSum.map((v) => v / n),
      rms: this.rmsSum / n,
      clip: this.clipSum / n,
      clipMax: this.clipMax,
    };
  }
}

/** Shared by the receiver's signal listener (producer) and the auto-tuner and gain guard (consumers). */
export const frameCollector = new FrameCollector();
