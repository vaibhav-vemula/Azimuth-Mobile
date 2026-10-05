import { NativeModules } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

export type UnitSystem = 'metric' | 'imperial';
export type UnitPreference = 'auto' | UnitSystem;

/** Countries that measure everyday distances in miles and feet. The user asked for Canada to be included. */
const MILES_REGIONS = new Set(['US', 'CA', 'GB', 'LR', 'MM', 'PR', 'GU', 'VI', 'AS', 'MP']);

/** The region from a locale such as "en_US" or "fr-CA", or null when there is none. */
export function regionOfLocale(locale: string | null | undefined): string | null {
  const match = /[-_]([A-Za-z]{2})(?:$|[-_@.])/.exec(locale ?? '');
  return match ? match[1].toUpperCase() : null;
}

export function systemForRegion(region: string | null): UnitSystem {
  return region && MILES_REGIONS.has(region) ? 'imperial' : 'metric';
}

/** The phone's own region setting, which is the best sign of which units its owner is used to. */
function deviceRegion(): string | null {
  const native = NativeModules as { I18nManager?: { localeIdentifier?: string }; SettingsManager?: { settings?: { AppleLocale?: string } } };
  const fromNative = native.I18nManager?.localeIdentifier ?? native.SettingsManager?.settings?.AppleLocale;
  const region = regionOfLocale(fromNative);
  if (region) return region;
  try {
    return regionOfLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

const storage = createMMKV({ id: 'azimuth-prefs' });
const KEY = 'units';

function loadPreference(): UnitPreference {
  const saved = storage.getString(KEY);
  return saved === 'metric' || saved === 'imperial' ? saved : 'auto';
}

interface UnitsState {
  preference: UnitPreference;
  setPreference: (preference: UnitPreference) => void;
}

export const useUnits = create<UnitsState>((set) => ({
  preference: loadPreference(),
  setPreference: (preference) => {
    if (preference === 'auto') storage.remove(KEY);
    else storage.set(KEY, preference);
    set({ preference });
  },
}));

export function resolveSystem(preference: UnitPreference, region: string | null): UnitSystem {
  return preference === 'auto' ? systemForRegion(region) : preference;
}

let cachedRegion: string | null | undefined;
/** The system in use now. Components that show distances should also call useUnitSystem so they redraw when it changes. */
export function currentSystem(): UnitSystem {
  if (cachedRegion === undefined) cachedRegion = deviceRegion();
  return resolveSystem(useUnits.getState().preference, cachedRegion);
}

export function useUnitSystem(): UnitSystem {
  const preference = useUnits((s) => s.preference);
  return resolveSystem(preference, cachedRegion === undefined ? (cachedRegion = deviceRegion()) : cachedRegion);
}

const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;
const KM2_PER_MI2 = 2.589988110336;

export interface Quantity {
  value: string;
  unit: string;
}

/** A distance you might be walking: "85 m", "1.4 km", or "280 ft", "0.8 mi". Rounded to steady, readable steps. */
export function distanceParts(metres: number, system: UnitSystem = currentSystem(), opts: { minimum?: number } = {}): Quantity {
  const min = opts.minimum ?? 0;
  if (system === 'imperial') {
    const ft = metres / M_PER_FT;
    if (ft < 1000) return { value: String(Math.max(min, Math.round(ft / 5) * 5)), unit: 'ft' };
    const mi = metres / M_PER_MI;
    return { value: shortDecimal(mi), unit: 'mi' };
  }
  if (metres < 1000) return { value: String(Math.max(min, Math.round(metres / 5) * 5)), unit: 'm' };
  return { value: shortDecimal(metres / 1000), unit: 'km' };
}

/** One decimal below ten, none from ten up, judged after rounding so 9.96 reads "10", not "10.0". */
function shortDecimal(value: number): string {
  return Math.round(value * 10) / 10 < 10 ? value.toFixed(1) : String(Math.round(value));
}

export function formatQuantity(q: Quantity): string {
  return `${q.value} ${q.unit}`;
}

/** An exact distance such as a range limit, rounded to a tidy number: 60 m is "200 ft". */
export function rangeLabel(metres: number, system: UnitSystem = currentSystem()): string {
  if (system === 'imperial') return `${Math.round(metres / M_PER_FT / 10) * 10} ft`;
  return `${Math.round(metres)} m`;
}

/** Long distances such as a satellite's range and altitude, in kilometres or miles. */
export function longDistanceParts(km: number, system: UnitSystem = currentSystem()): Quantity {
  if (!Number.isFinite(km)) return { value: '–', unit: system === 'imperial' ? 'mi' : 'km' };
  return system === 'imperial' ? { value: String(Math.round((km * 1000) / M_PER_MI)), unit: 'mi' } : { value: String(Math.round(km)), unit: 'km' };
}

/** Distance walked: "340 m", "1.20 km", "900 ft", "1.20 mi". */
export function walkedParts(metres: number, system: UnitSystem = currentSystem()): Quantity {
  const feet = system === 'imperial';
  if (!Number.isFinite(metres) || metres < 1) return { value: '0', unit: feet ? 'ft' : 'm' };
  if (feet) {
    const ft = metres / M_PER_FT;
    if (ft < 1000) return { value: String(Math.round(ft / 10) * 10 || 10), unit: 'ft' };
    const mi = metres / M_PER_MI;
    return { value: mi.toFixed(mi < 10 ? 2 : 1), unit: 'mi' };
  }
  if (metres < 1000) return { value: String(Math.round(metres / 5) * 5 || 5), unit: 'm' };
  return { value: (metres / 1000).toFixed(metres < 10_000 ? 2 : 1), unit: 'km' };
}

const FT2_PER_KM2 = 1e6 / (M_PER_FT * M_PER_FT);

/** "1,200 sq ft" with thousands separated, rounded to a steady step. */
function squareFeet(ft2: number): string {
  const step = ft2 < 10_000 ? 10 : 100;
  return (Math.round(ft2 / step) * step || step).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Area explored: "420 m²", "0.42 km²", or "4,600 sq ft", "1.4 mi²". */
export function areaParts(km2: number, system: UnitSystem = currentSystem()): Quantity {
  if (system === 'imperial') {
    if (!Number.isFinite(km2) || km2 <= 0) return { value: '0', unit: 'sq ft' };
    const mi2 = km2 / KM2_PER_MI2;
    if (mi2 < 0.02) return { value: squareFeet(km2 * FT2_PER_KM2), unit: 'sq ft' };
    return { value: mi2 < 10 ? mi2.toFixed(2) : String(Math.round(mi2)), unit: 'mi²' };
  }
  if (!Number.isFinite(km2) || km2 <= 0) return { value: '0', unit: 'm²' };
  if (km2 < 0.01) return { value: String(Math.round((km2 * 1e6) / 10) * 10 || 10), unit: 'm²' };
  if (km2 < 10) return { value: km2.toFixed(2), unit: 'km²' };
  return { value: String(Math.round(km2)), unit: 'km²' };
}
