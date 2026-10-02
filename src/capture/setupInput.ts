import { getMonitoredSatellite } from '../data/satellites';
import { effectiveFrequencyHz } from '../state/frequency';
import { useAppStore } from '../state/useAppStore';
import { SetupInput } from './autoSetup';

/**
 * What the automatic set-up starts from: the frequency SatNOGS data suggests (used until a signal is actually
 * seen) and the antenna-power choice from Settings.
 */
export function setupInputFor(noradId: string): SetupInput {
  const app = useAppStore.getState();
  const evidence = app.settings.autoFrequency && app.autoFrequencies[noradId]?.source === 'satnogs';
  return {
    noradId,
    fallbackHz: effectiveFrequencyHz(app, noradId),
    fallbackSource: evidence ? 'satnogs' : 'default',
    biasTee: app.settings.biasTee,
  };
}

export function satelliteName(noradId: string): string {
  return getMonitoredSatellite(noradId)?.name ?? noradId;
}
