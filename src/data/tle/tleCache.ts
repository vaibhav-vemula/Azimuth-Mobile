import { createMMKV } from 'react-native-mmkv';
import { TleRecord } from '../../types/satellite';

const storage = createMMKV({ id: 'azimuth-tle-cache' });

interface CachedEntry {
  record: TleRecord;
  fetchedAt: string;
  source: string;
}

export interface CachedTle {
  record: TleRecord;
  fetchedAt: Date;
  source: string;
}

export const TleCache = {
  get(noradId: string): CachedTle | null {
    const raw = storage.getString(noradId);
    if (!raw) return null;
    try {
      const parsed: CachedEntry = JSON.parse(raw);
      return { record: parsed.record, fetchedAt: new Date(parsed.fetchedAt), source: parsed.source };
    } catch {
      return null;
    }
  },

  set(noradId: string, record: TleRecord, source: string): void {
    const entry: CachedEntry = { record, fetchedAt: new Date().toISOString(), source };
    storage.set(noradId, JSON.stringify(entry));
  },

  clear(noradId: string): void {
    storage.remove(noradId);
  },
};
