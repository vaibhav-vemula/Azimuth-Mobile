import { LRPT_FREQUENCIES_HZ } from '../data/satellites';
import { FrameSummary } from '../receiver/frameCollector';
import { SATELLITE_SAMPLE_RATE_HZ } from '../../modules/rtl-sdr';
import { analyzeSignalAt, centerBinFor, pickDownlink, readDownlinks, SignalAnalysis } from '../utils/signal';
import { GainChoice, GainSample, chooseGain, selectSweepGains } from './autoGain';

/** Scanning is done halfway between 137.1 and 137.9 MHz so both downlinks fall inside the 2.3 MHz view. */
export const SCAN_CENTER_HZ = 137_500_000;
export const SETTLE_MS = 350;
export const MEASURE_MS = 700;
export const DETECT_MS = 1500;

export type FrequencySource = 'signal' | 'satnogs' | 'default';

export interface SetupPlan {
  noradId: string;
  frequencyHz: number;
  frequencySource: FrequencySource;
  gainDb: number;
  gainReason: GainChoice['reason'];
  /** Strength of the LRPT signal at the chosen frequency when measured (0 if none yet). */
  signalSnrDb: number;
  /** When the plan was made (epoch ms). */
  at: number;
}

export type SetupStep = 'frequency' | 'gain' | 'signal';

export interface SetupProgress {
  step: SetupStep;
  message: string;
  /** Gain probe position while sweeping. */
  probe?: { index: number; total: number; gainDb: number };
}

/** Everything the controller does to the outside world, so it can be tested without a radio. */
export interface SetupDeps {
  availableGains: () => number[];
  /** Puts the receiver in satellite mode centred on the scan frequency with this gain and antenna power. */
  enterScanMode: (gainDb: number, biasTee: boolean) => Promise<void>;
  setGain: (gainDb: number) => Promise<void>;
  resetFrames: () => void;
  readFrames: () => FrameSummary;
  sleep: (ms: number) => Promise<void>;
  isCancelled: () => boolean;
  report: (progress: SetupProgress) => void;
  now: () => number;
}

export interface SetupInput {
  noradId: string;
  /** Used when no signal is visible yet (from SatNOGS evidence, or the usual default). */
  fallbackHz: number;
  fallbackSource: 'satnogs' | 'default';
  biasTee: boolean;
}

function analysisAt(bins: number[], frequencyHz: number): SignalAnalysis {
  return analyzeSignalAt(bins, centerBinFor(frequencyHz - SCAN_CENTER_HZ, SATELLITE_SAMPLE_RATE_HZ, bins.length));
}

async function measure(deps: SetupDeps, ms: number): Promise<FrameSummary> {
  deps.resetFrames();
  await deps.sleep(ms);
  const snapshot = deps.readFrames();
  if (snapshot.frames === 0 && !deps.isCancelled()) {
    // Measuring silence would make every gain look the same and the "best" choice meaningless.
    throw new Error('The receiver is not delivering data. Unplug it, plug it back in and reconnect.');
  }
  return snapshot;
}

/** Sweeps the safe gains and returns the best one for the signal (or noise floor) at `frequencyHz`. */
async function sweepGain(
  deps: SetupDeps,
  frequencyHz: number
): Promise<{ choice: GainChoice; snrDb: number } | null> {
  const gains = selectSweepGains(deps.availableGains());
  const samples: GainSample[] = [];

  for (let i = 0; i < gains.length; i += 1) {
    if (deps.isCancelled()) return null;
    const gainDb = gains[i];
    deps.report({ step: 'gain', message: `Testing ${gainDb.toFixed(1)} dB`, probe: { index: i, total: gains.length, gainDb } });
    await deps.setGain(gainDb);
    await deps.sleep(SETTLE_MS);
    const snap = await measure(deps, MEASURE_MS);
    const analysis = analysisAt(snap.bins, frequencyHz);
    // Brief overloads average away, so a frame that clipped badly counts for a quarter of its severity.
    const clip = Math.max(snap.clip, snap.clipMax > 0.01 ? snap.clipMax / 4 : 0);
    samples.push({ gainDb, rms: snap.rms, clip, verdict: analysis.verdict, snrDb: analysis.snrDb });
  }

  const choice = chooseGain(samples);
  const chosen = samples.find((s) => s.gainDb === choice.gainDb);
  return { choice, snrDb: chosen && chosen.verdict === 'lrpt' ? chosen.snrDb : 0 };
}

/**
 * The automatic set-up: find which downlink carries the signal, sweep the gain, and settle on the setting that
 * gives the best recording. Returns null if cancelled part-way.
 */
export async function calibrate(input: SetupInput, deps: SetupDeps): Promise<SetupPlan | null> {
  const gains = selectSweepGains(deps.availableGains());
  const startGain = gains[Math.floor(gains.length / 2)];

  deps.report({ step: 'frequency', message: 'Looking for the downlink' });
  await deps.enterScanMode(startGain, input.biasTee);
  if (deps.isCancelled()) return null;
  await deps.sleep(SETTLE_MS);

  const detect = await measure(deps, DETECT_MS);
  const picked = pickDownlink(readDownlinks(detect.bins, SCAN_CENTER_HZ, SATELLITE_SAMPLE_RATE_HZ, LRPT_FREQUENCIES_HZ), input.fallbackHz);
  const frequencyHz = picked.frequencyHz;
  const frequencySource: FrequencySource = picked.source === 'signal' ? 'signal' : input.fallbackSource;
  if (deps.isCancelled()) return null;

  const swept = await sweepGain(deps, frequencyHz);
  if (!swept) return null;

  await deps.setGain(swept.choice.gainDb);
  deps.report({ step: 'signal', message: 'Checking the signal' });
  await deps.sleep(SETTLE_MS);
  const final = await measure(deps, MEASURE_MS);
  const finalAnalysis = analysisAt(final.bins, frequencyHz);

  return {
    noradId: input.noradId,
    frequencyHz,
    frequencySource,
    gainDb: swept.choice.gainDb,
    gainReason: swept.choice.reason,
    signalSnrDb: finalAnalysis.verdict === 'lrpt' ? finalAnalysis.snrDb : 0,
    at: deps.now(),
  };
}

export interface MonitorUpdate {
  plan: SetupPlan;
  analysis: SignalAnalysis;
}

/**
 * Keeps watching after the set-up. If an LRPT signal shows up on the other downlink the plan follows it, and
 * the first time a real signal appears the gain is re-optimised on it (before it was tuned on noise alone).
 */
export async function monitor(
  initial: SetupPlan,
  input: SetupInput,
  deps: SetupDeps,
  onUpdate: (update: MonitorUpdate) => void,
  intervalMs = 1000
): Promise<void> {
  let plan = initial;
  let refined = initial.gainReason === 'signal';

  while (!deps.isCancelled()) {
    const snap = await measure(deps, intervalMs);
    if (deps.isCancelled()) return;

    const picked = pickDownlink(readDownlinks(snap.bins, SCAN_CENTER_HZ, SATELLITE_SAMPLE_RATE_HZ, LRPT_FREQUENCIES_HZ), plan.frequencyHz);
    if (picked.source === 'signal' && picked.frequencyHz !== plan.frequencyHz) {
      plan = { ...plan, frequencyHz: picked.frequencyHz, frequencySource: 'signal', at: deps.now() };
      refined = false;
    }

    const analysis = analysisAt(snap.bins, plan.frequencyHz);
    if (analysis.verdict === 'lrpt' && !refined) {
      refined = true;
      deps.report({ step: 'gain', message: 'Signal found: fine-tuning the gain' });
      const swept = await sweepGain(deps, plan.frequencyHz);
      if (!swept) return;
      await deps.setGain(swept.choice.gainDb);
      plan = { ...plan, gainDb: swept.choice.gainDb, gainReason: swept.choice.reason, signalSnrDb: swept.snrDb, at: deps.now() };
    } else if (analysis.verdict === 'lrpt') {
      plan = { ...plan, signalSnrDb: analysis.snrDb };
    } else if (plan.signalSnrDb !== 0) {
      plan = { ...plan, signalSnrDb: 0 };
    }

    onUpdate({ plan, analysis });
  }
}
