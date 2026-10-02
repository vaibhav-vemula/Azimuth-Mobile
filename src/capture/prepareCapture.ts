import { getMonitoredSatellite } from '../data/satellites';
import { SatellitePass, useAppStore } from '../state/useAppStore';
import { useCapture } from './useCapture';

export type RecorderState = 'idle' | 'this-pass' | 'other-pass';

/** Whether the recorder is free, already working on `pass`, or busy with a different pass. */
export function recorderStateFor(passId: string): RecorderState {
  const { phase, options } = useCapture.getState();
  const busy = phase === 'preparing' || phase === 'recording' || phase === 'finishing';
  if (!busy) return 'idle';
  return options?.pass.id === passId ? 'this-pass' : 'other-pass';
}

/**
 * Points the recorder screen at `pass` using the saved frequency, gain and bias-tee for its satellite.
 * Does nothing if a recording is already running (the screen then shows that recording).
 * Returns false when the satellite is unknown.
 */
export function prepareCaptureFor(pass: SatellitePass): boolean {
  const satellite = getMonitoredSatellite(pass.noradId);
  if (!satellite) return false;

  const app = useAppStore.getState();
  useCapture.getState().prepare({ pass, satellite, tle: app.tles[pass.noradId]?.record ?? null });
  return true;
}
