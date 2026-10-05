import { create } from 'zustand';
import type { SessionTotals } from './sessionStats';

/** The summary of one finished mapping session. Kept on the phone (and in the encrypted backup, if on). No route is kept. */
export interface SessionRecord {
  /** The start time in ms, as text, so it is unique and sorts by date. */
  id: string;
  startedMs: number;
  endedMs: number;
  durationSec: number;
  distanceM: number;
  /** Fog cells this session cleared that were not cleared before. */
  clearedCells: number;
  /** The ground those cells cover, in square kilometres. */
  areaKm2: number;
  /** Reporting cells that were new to this phone. */
  newCells: number;
  readings: number;
  towers: number;
  wifi: number;
  bluetooth: number;
  /** Average overall radio level in dB below full scale, or null if no dongle readings were taken. */
  radioDbfs: number | null;
}

/** Cells beyond this are dropped from a session's saved area, so one very long session cannot fill the phone. */
export const MAX_SESSION_CELLS = 30_000;

export function buildSessionRecord(input: {
  startedMs: number;
  endedMs: number;
  distanceM: number;
  clearedCells: number;
  areaKm2: number;
  newCells: number;
  readings: number;
  totals: SessionTotals;
  radioLevelSum: number;
  radioLevelN: number;
}): SessionRecord | null {
  // A session in which nothing was read and nothing cleared leaves no trace worth listing.
  if (input.readings <= 0 && input.clearedCells <= 0) return null;
  return {
    id: String(input.startedMs),
    startedMs: input.startedMs,
    endedMs: input.endedMs,
    durationSec: Math.max(0, Math.round((input.endedMs - input.startedMs) / 1000)),
    distanceM: Math.max(0, Math.round(input.distanceM)),
    clearedCells: input.clearedCells,
    areaKm2: input.areaKm2,
    newCells: input.newCells,
    readings: input.readings,
    towers: input.totals.towers,
    wifi: input.totals.wifiUnique,
    bluetooth: input.totals.bluetoothUnique,
    radioDbfs: input.radioLevelN > 0 ? Math.round(input.radioLevelSum / input.radioLevelN) : null,
  };
}

/** Newest first, one entry per id. */
export function sortSessions(records: SessionRecord[]): SessionRecord[] {
  const byId = new Map<string, SessionRecord>();
  for (const r of records) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => b.startedMs - a.startedMs);
}

/** "Today, 3:20 PM", "Yesterday, 9:05 AM" or "Oct 4, 3:20 PM". */
export function sessionDate(startedMs: number, now = Date.now()): string {
  const d = new Date(startedMs);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  const diffDays = Math.round((day(now) - day(startedMs)) / 86_400_000);
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })}, ${time}`;
}

/** Which past session is being shown on the map, if any. */
interface SessionView {
  selectedId: string | null;
  show: (id: string | null) => void;
}

export const useSessionView = create<SessionView>((set) => ({
  selectedId: null,
  show: (selectedId) => set({ selectedId }),
}));
