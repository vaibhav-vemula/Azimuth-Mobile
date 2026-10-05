import { setGain, setSampleRate, tune } from '../../modules/rtl-sdr';
import { frameCollector } from '../receiver/frameCollector';
import { useReceiver } from '../receiver/useReceiver';
import { useCapture } from '../capture/useCapture';
import { withTimeout } from '../utils/async';
import {
  RADIO_WINDOWS_HZ,
  WindowSummary,
  combineWindows,
  PROBE_GAIN_DB,
  PROBE_SAMPLE_RATE_HZ,
  RadioReading,
  SondeReading,
  nearestGain,
  sondeTuneHz,
  toSondeReading,
} from './radio';

const SETTLE_MS = 300;
/** Per window when sweeping: about 4 s for five windows once a minute. */
const SWEEP_MEASURE_MS = 500;
const MEASURE_MS = 900;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waiting this long for the USB permission prompt before giving up on the dongle for now. */
const CONNECT_TIMEOUT_MS = 20_000;
/** After a failed attempt, do not ask again (and possibly pop the USB prompt) more often than this. */
const RETRY_COOLDOWN_MS = 3 * 60_000;
let lastAttemptMs = 0;

const isConnected = () => {
  const s = useReceiver.getState().status;
  return s === 'connected' || s === 'streaming';
};

/**
 * Makes sure the dongle is connected if one is plugged in. Called when mapping starts, and again before a radio reading
 * if the dongle was not there before. It never throws: with no dongle, mapping carries on with the phone alone.
 * `force` skips the wait between attempts (used when the user presses Start).
 */
export async function ensureDongle(force = false): Promise<boolean> {
  if (isConnected()) return true;
  if (!force && Date.now() - lastAttemptMs < RETRY_COOLDOWN_MS) return false;
  lastAttemptMs = Date.now();
  try {
    await withTimeout(useReceiver.getState().connect(), CONNECT_TIMEOUT_MS, 'The dongle did not answer.');
  } catch {
    // Not plugged in, permission refused, or busy.
  }
  return isConnected();
}

/** Why a radio reading was not taken. */
export type ProbeSkip = 'no-dongle' | 'busy';

interface Averaged {
  bins: number[];
  rms: number;
  clip: number;
  gainDb: number;
}

/**
 * Tunes the dongle, averages a second of spectrum, then releases it. Skips (rather than interferes) when the
 * user is using the dongle for something else.
 */
async function measureAt(tuneHz: number): Promise<Averaged | ProbeSkip> {
  if (!isConnected() && !(await ensureDongle())) return 'no-dongle';
  const receiver = useReceiver.getState();
  const capturing = useCapture.getState().phase;
  if (capturing === 'preparing' || capturing === 'recording' || capturing === 'finishing') return 'busy';
  // Something else (the Radio tab) is streaming or the user is listening: do not retune under them.
  if (receiver.status === 'streaming' || receiver.listening || receiver.streamAction) return 'busy';

  try {
    await setSampleRate(PROBE_SAMPLE_RATE_HZ);
    await tune(tuneHz);
    const gain = nearestGain(useReceiver.getState().gains, PROBE_GAIN_DB);
    if (gain === null) return 'no-dongle';
    await setGain(gain);
    await useReceiver.getState().startReceiving();
    await sleep(SETTLE_MS);
    frameCollector.reset();
    await sleep(MEASURE_MS);
    const summary = frameCollector.snapshot();
    if (summary.frames < 5) return 'busy';
    return { bins: summary.bins, rms: summary.rms, clip: summary.clip, gainDb: gain };
  } catch {
    return 'busy';
  } finally {
    try {
      await useReceiver.getState().stopReceiving();
    } catch {
      // Leave the dongle as it is; the Radio tab shows its own errors.
    }
  }
}

/**
 * Measures several windows in one go: holds the dongle, retunes for each, averages a short stretch of spectrum, then
 * releases it. Windows that gave too few frames are dropped. Skips when the dongle is in use for something else.
 */
async function sweep(windowsHz: readonly number[]): Promise<{ windows: WindowSummary[]; gainDb: number } | ProbeSkip> {
  if (!isConnected() && !(await ensureDongle())) return 'no-dongle';
  const receiver = useReceiver.getState();
  const capturing = useCapture.getState().phase;
  if (capturing === 'preparing' || capturing === 'recording' || capturing === 'finishing') return 'busy';
  if (receiver.status === 'streaming' || receiver.listening || receiver.streamAction) return 'busy';

  const windows: WindowSummary[] = [];
  try {
    await setSampleRate(PROBE_SAMPLE_RATE_HZ);
    const gain = nearestGain(useReceiver.getState().gains, PROBE_GAIN_DB);
    if (gain === null) return 'no-dongle';
    await tune(windowsHz[0]);
    await setGain(gain);
    await useReceiver.getState().startReceiving();
    for (const hz of windowsHz) {
      await tune(hz);
      await sleep(SETTLE_MS);
      frameCollector.reset();
      await sleep(SWEEP_MEASURE_MS);
      const summary = frameCollector.snapshot();
      if (summary.frames >= 3) windows.push({ hz, bins: summary.bins, rms: summary.rms, clip: summary.clip });
    }
    return windows.length > 0 ? { windows, gainDb: gain } : 'busy';
  } catch {
    return 'busy';
  } finally {
    try {
      await useReceiver.getState().stopReceiving();
    } catch {
      // Leave the dongle as it is; the Radio tab shows its own errors.
    }
  }
}

/** One radio reading: how much radio energy there is here, across several bands, plus whether a Meteor satellite is heard. */
export async function probeRadio(): Promise<RadioReading | ProbeSkip> {
  const out = await sweep(RADIO_WINDOWS_HZ);
  if (typeof out === 'string') return out;
  return combineWindows(out.windows, out.gainDb) ?? 'busy';
}

/** Listens for a specific radiosonde frequency. */
export async function probeSonde(frequencyHz: number): Promise<SondeReading | ProbeSkip> {
  const out = await measureAt(sondeTuneHz(frequencyHz));
  return typeof out === 'string' ? out : toSondeReading(out, frequencyHz, out.gainDb);
}
