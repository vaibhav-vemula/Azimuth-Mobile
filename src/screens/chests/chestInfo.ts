import type { Ionicons } from '@expo/vector-icons';
import type { Chest } from '../../network/api';
import { colors } from '../../theme';
import { distanceParts, formatQuantity } from '../../units/units';

export const CHEST_KIND: Record<Chest['kind'], { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; blurb: string }> = {
  gap: { label: 'Gap', icon: 'map-outline', color: colors.accent, blurb: 'Measure cellular signal where the map is empty.' },
  'dead-zone': { label: 'Dead zone', icon: 'cellular-outline', color: colors.warning, blurb: 'Check whether cellular coverage really drops out here.' },
  'wifi-quality': { label: 'Wi-Fi', icon: 'wifi-outline', color: colors.success, blurb: 'Measure Wi-Fi availability and strength at this spot.' },
  visit: { label: 'Visit', icon: 'storefront-outline', color: '#BA68C8', blurb: 'Stop by and take readings.' },
  'weather-radio': { label: 'Weather radio', icon: 'thunderstorm-outline', color: '#4FC3F7', blurb: 'Needs an RTL-SDR dongle to measure radio signal at this spot.' },
  'satellite-pass': { label: 'Satellite pass', icon: 'planet-outline', color: '#7986CB', blurb: 'Record a Meteor-M pass with an RTL-SDR and submit the receipt.' },
  sonde: { label: 'Sonde hunt', icon: 'balloon-outline', color: '#FF8A65', blurb: 'A weather balloon landed nearby. Find it by listening for its radio signal.' },
  noise: { label: 'Noise', icon: 'pulse-outline', color: colors.record, blurb: 'Needs an RTL-SDR dongle to measure radio noise.' },
};

export function timeLeft(expiresMs: number, now = Date.now()): string {
  const ms = expiresMs - now;
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600_000);
  if (h >= 48) return `${Math.floor(h / 24)} d left`;
  if (h >= 1) return `${h} h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min left`;
}

export function formatDistance(m: number | null): string {
  if (m === null) return '—';
  return formatQuantity(distanceParts(m));
}
