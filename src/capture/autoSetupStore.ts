import { create } from 'zustand';
import { setGain as nativeSetGain } from '../../modules/rtl-sdr';
import { frameCollector } from '../receiver/frameCollector';
import { errorMessage, useReceiver } from '../receiver/useReceiver';
import { SignalAnalysis } from '../utils/signal';
import { SCAN_CENTER_HZ, SetupDeps, SetupInput, SetupPlan, SetupProgress, calibrate, monitor } from './autoSetup';

/** A plan older than this is re-made before recording, because the sky and the noise environment change. */
export const PLAN_MAX_AGE_MS = 10 * 60_000;

export type AutoSetupStatus = 'idle' | 'working' | 'ready' | 'error';

interface Run {
  cancelled: boolean;
  /** Resolves when the run has fully stopped (the loop has exited). */
  finished: Promise<void>;
  /** Resolves with the first plan, or null if the run ended without one. */
  firstPlan: Promise<SetupPlan | null>;
}

interface AutoSetupState {
  status: AutoSetupStatus;
  progress: SetupProgress | null;
  plan: SetupPlan | null;
  analysis: SignalAnalysis | null;
  error: string | null;

  /** Starts (or restarts) calibration followed by continuous monitoring. */
  start: (input: SetupInput) => void;
  /** Stops any run and waits until it has finished touching the receiver. */
  stop: () => Promise<void>;
  /** Runs one full calibration and returns its plan, then stops. Throws if it could not complete. */
  calibrateOnce: (input: SetupInput) => Promise<SetupPlan>;
  /** Waits for the first plan of the current run, if one is under way. */
  waitForPlan: () => Promise<SetupPlan | null>;
  /** The plan if it is fresh enough for this satellite. */
  freshPlan: (noradId: string, now?: number) => SetupPlan | null;
  reset: () => void;
}

let currentRun: Run | null = null;

function realDeps(run: Run, set: (partial: Partial<AutoSetupState>) => void): SetupDeps {
  return {
    availableGains: () => useReceiver.getState().gains,
    enterScanMode: (gainDb, biasTee) =>
      useReceiver.getState().enterSatelliteMode({ frequencyHz: SCAN_CENTER_HZ, gainDb, biasTee }),
    setGain: async (gainDb) => {
      await nativeSetGain(gainDb);
    },
    resetFrames: () => frameCollector.reset(),
    readFrames: () => frameCollector.snapshot(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isCancelled: () => run.cancelled,
    report: (progress) => set({ progress }),
    now: () => Date.now(),
  };
}

export const useAutoSetup = create<AutoSetupState>((set, get) => ({
  status: 'idle',
  progress: null,
  plan: null,
  analysis: null,
  error: null,

  start: (input) => {
    void get().stop();

    let resolveFirst!: (plan: SetupPlan | null) => void;
    const firstPlan = new Promise<SetupPlan | null>((resolve) => (resolveFirst = resolve));
    const run: Run = { cancelled: false, finished: Promise.resolve(), firstPlan };
    currentRun = run;
    set({ status: 'working', progress: null, plan: null, analysis: null, error: null });

    const deps = realDeps(run, set);
    run.finished = (async () => {
      try {
        const plan = await calibrate(input, deps);
        if (!plan || run.cancelled) {
          resolveFirst(null);
          return;
        }
        set({ status: 'ready', plan, progress: null });
        resolveFirst(plan);
        await monitor(plan, input, deps, (update) => {
          if (!run.cancelled) set({ plan: update.plan, analysis: update.analysis });
        });
      } catch (e) {
        if (!run.cancelled) set({ status: 'error', error: errorMessage(e), progress: null });
        resolveFirst(null);
      }
    })();
  },

  stop: async () => {
    const run = currentRun;
    if (!run) return;
    run.cancelled = true;
    await run.finished;
    if (currentRun === run) currentRun = null;
    if (get().status !== 'error') set({ status: 'idle', progress: null });
  },

  calibrateOnce: async (input) => {
    get().start(input);
    const plan = await get().waitForPlan();
    const failure = get().error;
    await get().stop();
    if (!plan) throw new Error(failure ?? 'The automatic set-up was cancelled.');
    return plan;
  },

  waitForPlan: async () => (currentRun ? currentRun.firstPlan : get().plan),

  freshPlan: (noradId, now = Date.now()) => {
    const { plan } = get();
    return plan && plan.noradId === noradId && now - plan.at < PLAN_MAX_AGE_MS ? plan : null;
  },

  reset: () => {
    currentRun = null;
    set({ status: 'idle', progress: null, plan: null, analysis: null, error: null });
  },
}));
