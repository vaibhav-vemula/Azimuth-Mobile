import { setGain, setSampleRate, tune } from '../../modules/rtl-sdr';
import { frameCollector } from '../receiver/frameCollector';
import { useReceiver } from '../receiver/useReceiver';
import { useCapture } from '../capture/useCapture';
import {
  NOAA_TUNE_HZ,
  PROBE_GAIN_DB,
  PROBE_SAMPLE_RATE_HZ,
  RadioReading,
  SondeReading,
  nearestGain,
  sondeTuneHz,
  toReading,
  toSondeReading,
} from './radio';

const SETTLE_MS = 400;
const MEASURE_MS = 900;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const receiver = useReceiver.getState();
  if (receiver.status === 'disconnected' || receiver.status === 'error') return 'no-dongle';
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

/** One NOAA Weather Radio reading. */
export async function probeRadio(): Promise<RadioReading | ProbeSkip> {
  const out = await measureAt(NOAA_TUNE_HZ);
  return typeof out === 'string' ? out : toReading(out, out.gainDb);
}

/** Listens for a specific radiosonde frequency. */
export async function probeSonde(frequencyHz: number): Promise<SondeReading | ProbeSkip> {
  const out = await measureAt(sondeTuneHz(frequencyHz));
  return typeof out === 'string' ? out : toSondeReading(out, frequencyHz, out.gainDb);
}
