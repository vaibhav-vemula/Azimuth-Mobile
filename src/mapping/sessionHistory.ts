import { create } from 'zustand';
import type { SessionTotals } from './sessionStats';
import { exploredAreaKm2 } from './explore';
import { hexCenter, parseCellId } from './hexGrid';

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
  /** Rebuilt from the fog map's timestamps for a session mapped before history existed: only date, length, area and cleared cells are known. */
  estimated?: boolean;
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

/** A pause longer than this between newly cleared cells means a different session. */
const SESSION_GAP_MS = 30 * 60_000;
/** Groups smaller than this are noise (a few cells cleared in passing), not a session. */
const MIN_RECONSTRUCTED_CELLS = 20;

/**
 * Sessions mapped before history was kept still left a trace: every cleared fog cell remembers when it was first
 * cleared. Cells cleared within half an hour of each other came from one session, so the old sessions can be rebuilt.
 * Only the date, length, area and cleared cells are known. `before` is the time the first real record starts, so a
 * session is never listed twice.
 */
export function reconstructSessions(explored: Record<string, number>, before = Infinity): { record: SessionRecord; cells: string[] }[] {
  const entries = Object.entries(explored)
    .filter(([, t]) => Number.isFinite(t) && t > 0 && t < before)
    .sort((a, b) => a[1] - b[1]);
  const groups: [string, number][][] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && entry[1] - last[last.length - 1][1] <= SESSION_GAP_MS) last.push(entry);
    else groups.push([entry]);
  }
  return groups
    .filter((g) => g.length >= MIN_RECONSTRUCTED_CELLS)
    .map((g) => {
      const startedMs = g[0][1];
      const endedMs = g[g.length - 1][1];
      const first = parseCellId(g[0][0]);
      const lat = first ? hexCenter(first.hex, first.sizeM).latitudeDeg : 38.9;
      const record: SessionRecord = {
        id: String(startedMs),
        startedMs,
        endedMs,
        durationSec: Math.round((endedMs - startedMs) / 1000),
        distanceM: 0,
        clearedCells: g.length,
        areaKm2: exploredAreaKm2(g.length, lat),
        newCells: 0,
        readings: 0,
        towers: 0,
        wifi: 0,
        bluetooth: 0,
        radioDbfs: null,
        estimated: true,
      };
      return { record, cells: g.map(([id]) => id) };
    });
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
