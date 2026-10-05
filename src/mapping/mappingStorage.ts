import { createMMKV } from 'react-native-mmkv';
import type { HomeExclusion } from './session';
import type { CellSignal } from './signalLayer';

const storage = createMMKV({ id: 'azimuth-mapping' });
const VISITED = 'visited';
const HOME = 'home';
const BLUETOOTH = 'bluetooth';
const PENDING = 'pending';

/** Cells the user has visited while mapping, with the time of the first visit. Stays on the phone. */
export function loadVisited(): Record<string, number> {
  try {
    const raw = storage.getString(VISITED);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveVisited(visited: Record<string, number>): void {
  storage.set(VISITED, JSON.stringify(visited));
}

export function loadHome(): HomeExclusion | null {
  try {
    const raw = storage.getString(HOME);
    return raw ? (JSON.parse(raw) as HomeExclusion) : null;
  } catch {
    return null;
  }
}

export function saveHome(home: HomeExclusion | null): void {
  if (home) storage.set(HOME, JSON.stringify(home));
  else storage.remove(HOME);
}

export function loadBluetoothEnabled(): boolean {
  return storage.getBoolean(BLUETOOTH) ?? true;
}

export function saveBluetoothEnabled(enabled: boolean): void {
  storage.set(BLUETOOTH, enabled);
}

/** Finished sessions not yet submitted. Kept as plain JSON so they survive restarts. */
export function loadPending(): string | null {
  return storage.getString(PENDING) ?? null;
}

export function savePending(json: string | null): void {
  if (json === null) storage.remove(PENDING);
  else storage.set(PENDING, json);
}

const RADIO = 'radio';

export function loadRadioEnabled(): boolean {
  return storage.getBoolean(RADIO) ?? true;
}

export function saveRadioEnabled(enabled: boolean): void {
  storage.set(RADIO, enabled);
}

const EXPLORED = 'explored';

/** Ground cleared from the fog (fog-grid cells with the time first seen). Stays on the phone. */
export function loadExplored(): Record<string, number> {
  try {
    const raw = storage.getString(EXPLORED);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveExplored(explored: Record<string, number>): void {
  storage.set(EXPLORED, JSON.stringify(explored));
}

const SIGNALS = 'signals';

/** What the phone measured in each reporting cell, behind the signal map. Stays on the phone. */
export function loadSignals(): Record<string, CellSignal> {
  try {
    const raw = storage.getString(SIGNALS);
    return raw ? (JSON.parse(raw) as Record<string, CellSignal>) : {};
  } catch {
    return {};
  }
}

export function saveSignals(signals: Record<string, CellSignal>): void {
  storage.set(SIGNALS, JSON.stringify(signals));
}

export type FogStyle = 'sky' | 'terrain';
const FOG_STYLE = 'fogStyle';

/** Which look unmapped ground has. */
export function loadFogStyle(): FogStyle {
  // Terrain lines unless the user has chosen the night sky.
  return storage.getString(FOG_STYLE) === 'sky' ? 'sky' : 'terrain';
}

export function saveFogStyle(style: FogStyle): void {
  storage.set(FOG_STYLE, style);
}
