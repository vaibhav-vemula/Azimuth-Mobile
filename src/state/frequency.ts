import { LRPT_FREQUENCIES_HZ, getMonitoredSatellite } from '../data/satellites';
import { AutoFrequency } from '../data/transmitters';
import { Settings } from './settingsStorage';

export const DEFAULT_LRPT_HZ = LRPT_FREQUENCIES_HZ[1];

/** The frequency to record on: the SatNOGS-derived one in Auto mode, otherwise the user's manual choice. */
export function effectiveFrequencyHz(
  state: { settings: Pick<Settings, 'autoFrequency' | 'frequencyHzBySatellite'>; autoFrequencies: Record<string, AutoFrequency> },
  noradId: string
): number {
  const manual = state.settings.frequencyHzBySatellite[noradId] ?? getMonitoredSatellite(noradId)?.defaultFrequencyHz ?? DEFAULT_LRPT_HZ;
  if (!state.settings.autoFrequency) return manual;
  return state.autoFrequencies[noradId]?.frequencyHz ?? manual;
}
