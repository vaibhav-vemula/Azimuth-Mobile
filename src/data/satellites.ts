/**
 * The satellites Azimuth knows how to capture. Both Meteor-M N2-3 and N2-4 broadcast LRPT in the
 * 137 MHz band, but SatNOGS lists 137.100 and 137.900 MHz for each, so the frequency is user
 * selectable per satellite with these defaults.
 */
export interface MonitoredSatellite {
  noradId: string;
  name: string;
  shortName: string;
  defaultFrequencyHz: number;
}

export const LRPT_FREQUENCIES_HZ = [137_100_000, 137_900_000] as const;

export const MONITORED_SATELLITES: MonitoredSatellite[] = [
  { noradId: '59051', name: 'Meteor-M2 4', shortName: 'M2-4', defaultFrequencyHz: 137_900_000 },
  { noradId: '57166', name: 'Meteor-M2 3', shortName: 'M2-3', defaultFrequencyHz: 137_900_000 },
];

export function getMonitoredSatellite(noradId: string): MonitoredSatellite | undefined {
  return MONITORED_SATELLITES.find((s) => s.noradId === noradId);
}
