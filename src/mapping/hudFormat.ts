/** "12:34", or "1:02:09" once it passes an hour. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Distance walked: "0 m", "340 m", "1.2 km". */
export function formatWalked(metres: number): { value: string; unit: string } {
  if (!Number.isFinite(metres) || metres < 1) return { value: '0', unit: 'm' };
  if (metres < 1000) return { value: String(Math.round(metres / 5) * 5 || 5), unit: 'm' };
  return { value: (metres / 1000).toFixed(metres < 10_000 ? 2 : 1), unit: 'km' };
}

/** Area: "420 m²", "0.42 km²". The value and unit are separate so the unit can be drawn smaller. */
export function formatAreaParts(km2: number): { value: string; unit: string } {
  if (!Number.isFinite(km2) || km2 <= 0) return { value: '0', unit: 'm²' };
  if (km2 < 0.01) return { value: String(Math.round((km2 * 1e6) / 10) * 10 || 10), unit: 'm²' };
  if (km2 < 10) return { value: km2.toFixed(2), unit: 'km²' };
  return { value: String(Math.round(km2)), unit: 'km²' };
}

/** Bars for a cellular signal, 0 to 4, from its strength in dBm. */
export function cellularBars(dbm: number | null | undefined): number {
  if (typeof dbm !== 'number' || !Number.isFinite(dbm)) return 0;
  if (dbm >= -85) return 4;
  if (dbm >= -95) return 3;
  if (dbm >= -105) return 2;
  if (dbm >= -115) return 1;
  return 0;
}

export type Quality = 'none' | 'poor' | 'fair' | 'good' | 'great';

export function cellularQuality(dbm: number | null | undefined): Quality {
  return (['none', 'poor', 'fair', 'good', 'great'] as const)[cellularBars(dbm)];
}

/** How many metres a session covered between two position fixes, ignoring jumps that cannot be walking. */
export function stepDistance(metres: number, secondsApart: number): number {
  if (!Number.isFinite(metres) || metres < 2) return 0; // standing still: GPS wobble, not walking
  if (secondsApart > 0 && metres / secondsApart > 70) return 0; // faster than any vehicle we map from: a bad fix
  return metres;
}

const TECH_NAMES: Record<string, string> = { lte: '4G LTE', nr: '5G', wcdma: '3G', gsm: '2G' };

/** "4G LTE", "5G", "3G", "2G"; anything unknown is shown as it came. */
export function techLabel(tech: string): string {
  return TECH_NAMES[tech] ?? tech.toUpperCase();
}

/** The mobile network's code as "310-260" (country and network), which is how it is usually written. */
export function formatPlmn(plmn: string): string {
  return /^\d{5,6}$/.test(plmn) ? `${plmn.slice(0, 3)}-${plmn.slice(3)}` : plmn || 'unknown network';
}
