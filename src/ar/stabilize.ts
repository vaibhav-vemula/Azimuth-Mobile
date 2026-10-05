import type { LatLon } from '../mapping/hexGrid';

const M_PER_DEG = 111_320;
/** Speed is judged over this much recent time, and not until at least MIN_SPAN_S of it has been seen. */
const WINDOW_MS = 6000;
const MIN_SPAN_S = 3;

/**
 * Steadies the phone's GPS position so a chest drawn from it does not drift while you stand still. Each GPS fix is noisy
 * (a few metres, more near buildings), and drawing the chest straight from it makes it wander across the ground. This
 * keeps one estimate per axis (east and north, in metres from the first fix) and weighs each new fix by how accurate the
 * phone says it is: a poor fix barely moves the estimate, a good one moves it more, and while you walk it follows you
 * with a short lag. Standing still, the estimate settles and stays put.
 */
export class PositionFilter {
  private origin: LatLon | null = null;
  private x = 0; // east, metres
  private y = 0; // north, metres
  private variance = 0;
  private lastMs = 0;
  private speedMps = 0;
  /** Recent estimates, to judge movement from how far the estimate has really travelled, not from step-to-step noise. */
  private history: { t: number; x: number; y: number }[] = [];

  reset(): void {
    this.origin = null;
    this.history = [];
    this.speedMps = 0;
  }

  /** Speed over the last few seconds, in metres per second. Zero until there is enough history to tell. */
  speed(): number {
    return this.speedMps;
  }

  update(fix: LatLon, accuracyM: number | null, atMs: number): LatLon {
    const sigma = Math.max(accuracyM ?? 8, 3);
    const r = sigma * sigma;
    if (!this.origin) {
      this.origin = fix;
      this.x = 0;
      this.y = 0;
      this.variance = r;
      this.lastMs = atMs;
      this.history = [{ t: atMs, x: 0, y: 0 }];
      return fix;
    }
    const k = Math.cos((this.origin.latitudeDeg * Math.PI) / 180);
    const zx = (fix.longitudeDeg - this.origin.longitudeDeg) * M_PER_DEG * k;
    const zy = (fix.latitudeDeg - this.origin.latitudeDeg) * M_PER_DEG;
    const dt = Math.max(0, (atMs - this.lastMs) / 1000);
    this.lastMs = atMs;

    // Standing still, the position barely changes, so little is allowed to creep in; once you are walking it may change fast.
    const processNoise = this.speedMps > 0.6 ? 2.5 : 0.15;
    this.variance += processNoise * dt;
    const gain = this.variance / (this.variance + r);
    this.x += gain * (zx - this.x);
    this.y += gain * (zy - this.y);
    this.variance *= 1 - gain;

    this.history.push({ t: atMs, x: this.x, y: this.y });
    while (this.history.length > 2 && atMs - this.history[1].t >= WINDOW_MS) this.history.shift();
    const oldest = this.history[0];
    const span = (atMs - oldest.t) / 1000;
    this.speedMps = span >= MIN_SPAN_S ? Math.hypot(this.x - oldest.x, this.y - oldest.y) / span : 0;
    return this.position();
  }

  position(): LatLon {
    const o = this.origin!;
    const k = Math.cos((o.latitudeDeg * Math.PI) / 180);
    return { latitudeDeg: o.latitudeDeg + this.y / M_PER_DEG, longitudeDeg: o.longitudeDeg + this.x / (M_PER_DEG * k) };
  }
}
