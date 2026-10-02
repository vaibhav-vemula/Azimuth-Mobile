jest.mock('../../modules/rtl-sdr', () => ({ SATELLITE_SAMPLE_RATE_HZ: 2_304_000 }));

import { FrameSummary } from '../receiver/frameCollector';
import { SCAN_CENTER_HZ, SetupDeps, SetupInput, SetupPlan, SetupProgress, calibrate, monitor } from './autoSetup';
import { centerBinFor } from '../utils/signal';

const R828D = [0.0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28.0, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48.0, 49.6];
const SR = 2_304_000;

interface Scenario {
  /** Raw-sample RMS (fraction of full scale) at 20 dB gain; it rises 1:1 with the gain in dB. */
  rmsAt20: number;
  /** Gain at and above which the converter clips. */
  clipFromDb?: number;
  /** Where an LRPT signal is, and how many dB above the noise it is at each gain. */
  signal?: { frequencyHz: number; snrDb: (gainDb: number) => number };
  /** When the signal only appears after this many simulated seconds (for the monitor). */
  appearsAfterSec?: number;
}

class FakeRadio {
  gain = 0;
  clockMs = 0;
  enterCalls: { gainDb: number; biasTee: boolean }[] = [];
  gainsSet: number[] = [];
  progress: SetupProgress[] = [];
  cancelAfterCalls: number | null = null;
  private calls = 0;

  constructor(public scenario: Scenario) {}

  private frames(): FrameSummary {
    const s = this.scenario;
    const rms = Math.min(0.95, s.rmsAt20 * Math.pow(10, (this.gain - 20) / 20));
    const clip = s.clipFromDb !== undefined && this.gain >= s.clipFromDb ? 0.02 : 0;
    const bins = new Array(64).fill(0).map((_, i) => 0.25 + (6 / 50) * (1 - Math.abs(i - 31.5) / 32));
    const active = s.signal && this.clockMs / 1000 >= (s.appearsAfterSec ?? 0);
    if (active && s.signal) {
      const c = centerBinFor(s.signal.frequencyHz - SCAN_CENTER_HZ, SR);
      const local = (bins[c - 8] + bins[c + 7]) / 2;
      for (let i = c - 2; i <= c + 1; i += 1) bins[i] = local + s.signal.snrDb(this.gain) / 50;
    }
    return { frames: 20, bins, rms, clip, clipMax: clip };
  }

  deps(): SetupDeps {
    return {
      availableGains: () => R828D,
      enterScanMode: async (gainDb, biasTee) => {
        this.calls += 1;
        this.gain = gainDb;
        this.enterCalls.push({ gainDb, biasTee });
      },
      setGain: async (g) => {
        this.calls += 1;
        this.gain = g;
        this.gainsSet.push(g);
      },
      resetFrames: () => undefined,
      readFrames: () => this.frames(),
      sleep: async (ms) => {
        this.clockMs += ms;
      },
      isCancelled: () => this.cancelAfterCalls !== null && this.calls >= this.cancelAfterCalls,
      report: (p) => this.progress.push(p),
      now: () => this.clockMs,
    };
  }
}

const INPUT: SetupInput = { noradId: '59051', fallbackHz: 137_900_000, fallbackSource: 'satnogs', biasTee: false };

describe('calibrate', () => {
  it('on noise alone, picks the lowest gain that fills the converter and keeps the SatNOGS frequency', async () => {
    const radio = new FakeRadio({ rmsAt20: 0.02 });
    const plan = (await calibrate(INPUT, radio.deps())) as SetupPlan;
    expect(plan.frequencyHz).toBe(137_900_000);
    expect(plan.frequencySource).toBe('satnogs');
    expect(plan.gainReason).toBe('noise-floor');
    const rmsAtChosen = 0.02 * Math.pow(10, (plan.gainDb - 20) / 20);
    expect(rmsAtChosen).toBeGreaterThanOrEqual(0.09);
    expect(plan.gainDb).toBeLessThan(40);
    expect(radio.gain).toBe(plan.gainDb);
    expect(plan.signalSnrDb).toBe(0);
  });

  it('backs off a strong environment so the converter never clips', async () => {
    const radio = new FakeRadio({ rmsAt20: 0.03, clipFromDb: 33 });
    const plan = (await calibrate(INPUT, radio.deps())) as SetupPlan;
    expect(plan.gainDb).toBeLessThan(33);
    expect(radio.gain).toBeLessThan(33);
  });

  it('follows the signal to 137.1 MHz even though SatNOGS suggested 137.9', async () => {
    const radio = new FakeRadio({ rmsAt20: 0.02, signal: { frequencyHz: 137_100_000, snrDb: (g) => Math.min(10, 2 + g / 5) } });
    const plan = (await calibrate(INPUT, radio.deps())) as SetupPlan;
    expect(plan.frequencyHz).toBe(137_100_000);
    expect(plan.frequencySource).toBe('signal');
    expect(plan.gainReason).toBe('signal');
    expect(plan.signalSnrDb).toBeGreaterThan(5);
  });

  it('picks the gain that gives the best signal on 137.9', async () => {
    // Signal is best around 33 dB and degrades above it (compression).
    const radio = new FakeRadio({
      rmsAt20: 0.02,
      signal: { frequencyHz: 137_900_000, snrDb: (g) => 10 - Math.abs(g - 33) * 0.6 },
    });
    const plan = (await calibrate(INPUT, radio.deps())) as SetupPlan;
    expect(plan.frequencyHz).toBe(137_900_000);
    expect(plan.gainReason).toBe('signal');
    expect(Math.abs(plan.gainDb - 33)).toBeLessThan(5);
  });

  it('applies the antenna power setting and only ever uses manual gain values', async () => {
    const radio = new FakeRadio({ rmsAt20: 0.02 });
    await calibrate({ ...INPUT, biasTee: true }, radio.deps());
    expect(radio.enterCalls).toHaveLength(1);
    expect(radio.enterCalls[0].biasTee).toBe(true);
    for (const g of [...radio.gainsSet, radio.enterCalls[0].gainDb]) {
      expect(typeof g).toBe('number');
      expect(g).toBeGreaterThanOrEqual(20);
      expect(g).toBeLessThanOrEqual(44);
    }
  });

  it('reports its steps in order', async () => {
    const radio = new FakeRadio({ rmsAt20: 0.02 });
    await calibrate(INPUT, radio.deps());
    const steps = radio.progress.map((p) => p.step);
    expect(steps[0]).toBe('frequency');
    expect(steps[steps.length - 1]).toBe('signal');
    expect(steps.indexOf('gain')).toBeGreaterThan(0);
    const probes = radio.progress.filter((p) => p.probe);
    expect(probes[0].probe!.index).toBe(0);
    expect(probes[probes.length - 1].probe!.index).toBe(probes[0].probe!.total - 1);
  });

  it('fails loudly if the receiver delivers no data instead of guessing a gain', async () => {
    const radio = new FakeRadio({ rmsAt20: 0.02 });
    const deps = radio.deps();
    deps.readFrames = () => ({ frames: 0, bins: [], rms: 0, clip: 0, clipMax: 0 });
    await expect(calibrate(INPUT, deps)).rejects.toThrow(/not delivering data/);
    expect(radio.gainsSet).toHaveLength(0);
  });

  it('stops promptly when cancelled and returns nothing', async () => {
    const radio = new FakeRadio({ rmsAt20: 0.02 });
    radio.cancelAfterCalls = 3;
    expect(await calibrate(INPUT, radio.deps())).toBeNull();
    expect(radio.gainsSet.length).toBeLessThanOrEqual(3);
  });
});

describe('monitor', () => {
  async function runFor(radio: FakeRadio, plan: SetupPlan, seconds: number) {
    const updates: { plan: SetupPlan; verdict: string }[] = [];
    const deps = radio.deps();
    const stopAt = radio.clockMs + seconds * 1000;
    const baseCancelled = deps.isCancelled;
    deps.isCancelled = () => baseCancelled() || radio.clockMs >= stopAt;
    await monitor(plan, INPUT, deps, (u) => updates.push({ plan: u.plan, verdict: u.analysis.verdict }), 1000);
    return updates;
  }

  it('re-optimises the gain once a real signal appears, and follows it to the other downlink', async () => {
    const radio = new FakeRadio({
      rmsAt20: 0.02,
      signal: { frequencyHz: 137_100_000, snrDb: (g) => 10 - Math.abs(g - 30) * 0.5 },
      appearsAfterSec: 20,
    });
    const initial = (await calibrate(INPUT, radio.deps())) as SetupPlan;
    expect(initial.gainReason).toBe('noise-floor');
    expect(initial.frequencyHz).toBe(137_900_000);

    const updates = await runFor(radio, initial, 30);
    const last = updates[updates.length - 1].plan;
    expect(last.frequencyHz).toBe(137_100_000);
    expect(last.frequencySource).toBe('signal');
    expect(last.gainReason).toBe('signal');
    expect(Math.abs(last.gainDb - 30)).toBeLessThan(6);
  });

  it('keeps reporting no signal while the satellite is below the horizon', async () => {
    const radio = new FakeRadio({ rmsAt20: 0.02 });
    const initial = (await calibrate(INPUT, radio.deps())) as SetupPlan;
    const before = radio.gainsSet.length;
    const updates = await runFor(radio, initial, 5);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((u) => u.verdict === 'none')).toBe(true);
    expect(radio.gainsSet.length).toBe(before); // no needless gain changes
  });
});
