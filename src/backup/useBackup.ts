import { create } from 'zustand';
import bs58 from 'bs58';
import { createMMKV } from 'react-native-mmkv';
import { SUPABASE_KEY, SUPABASE_URL, backendMode } from '../network/config';
import { createSupabaseApi } from '../network/supabaseApi';
import { useMapping } from '../mapping/useMapping';
import { useWallet } from '../wallet/useWallet';
import { signText } from '../wallet/signReport';
import { BackupKeys, deriveKeys, open, seal, unlockMessage } from './crypto';
import { Snapshot, hasNewerThan, packSnapshot, unpackSnapshot } from './snapshot';

/**
 * The backup key is kept here, in its own store, apart from the map progress. Android's automatic backup copies only the
 * progress (see plugins/backupRules.js), so the key never travels with it.
 */
const storage = createMMKV({ id: 'azimuth-backup' });
const KEY = 'state';

interface Saved extends BackupKeys {
  node: string;
  lastMs: number | null;
}

function load(): Saved | null {
  try {
    const raw = storage.getString(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Saved>;
    return typeof p.node === 'string' && typeof p.key === 'string' && typeof p.tag === 'string' ? { node: p.node, key: p.key, tag: p.tag, lastMs: p.lastMs ?? null } : null;
  } catch {
    return null;
  }
}

const save = (s: Saved | null) => (s ? storage.set(KEY, JSON.stringify(s)) : storage.remove(KEY));

export type BackupPhase = 'idle' | 'unlocking' | 'syncing';

interface BackupState {
  phase: BackupPhase;
  /** Backup is on for the wallet that is connected now. */
  enabled: boolean;
  lastMs: number | null;
  /** A short plain sentence about the last thing that happened. */
  message: string | null;
  error: string | null;
  /** Whether the server side exists (direct mode with the publishable key). */
  available: boolean;

  refresh: () => void;
  /** Asks the wallet to sign once, derives the key, then pulls any existing backup and uploads what is new. */
  enable: () => Promise<boolean>;
  /** Merges the stored backup into this phone and uploads anything new. */
  syncNow: () => Promise<boolean>;
  disable: () => void;
}

const api = backendMode === 'direct' ? createSupabaseApi({ url: SUPABASE_URL, key: SUPABASE_KEY }) : null;

const fmt = (n: number) => n.toLocaleString('en-US');
const cellsIn = (s: Snapshot) => Object.keys(s.explored).length;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function current(): Saved | null {
  const saved = load();
  const address = useWallet.getState().address;
  return saved && address && saved.node === address ? saved : null;
}

export const useBackup = create<BackupState>((set, get) => ({
  phase: 'idle',
  enabled: false,
  lastMs: null,
  message: null,
  error: null,
  available: api !== null,

  refresh: () => {
    const saved = current();
    set({ enabled: saved !== null, lastMs: saved?.lastMs ?? null });
  },

  enable: async () => {
    const address = useWallet.getState().address;
    if (!api) return fail(set, 'Backup needs the online service, which is not configured in this build.');
    if (!address) return fail(set, 'Connect a wallet first.');
    if (get().phase !== 'idle') return false;
    set({ phase: 'unlocking', error: null, message: null });
    try {
      const base64 = Buffer.from(bs58.decode(address)).toString('base64');
      const text = unlockMessage(address);
      const first = await signText(text, base64);
      // The key comes from this signature, so the wallet must give the same one every time. Ask once more to be sure.
      const second = await signText(text, base64);
      if (first !== second) throw new Error('This wallet gives a different signature each time, so it cannot unlock a backup safely.');
      const keys = deriveKeys(new Uint8Array(Buffer.from(first, 'base64')));
      save({ node: address, ...keys, lastMs: null });
      get().refresh();
    } catch (e) {
      return fail(set, /cancel|declin|reject/i.test(errorText(e)) ? 'Cancelled. Backup is still off.' : errorText(e));
    }
    set({ phase: 'idle' });
    return get().syncNow();
  },

  syncNow: async () => {
    const saved = current();
    if (!api || !saved) return fail(set, 'Turn backup on first.');
    if (get().phase === 'syncing') return false;
    set({ phase: 'syncing', error: null, message: null });
    try {
      const mapping = useMapping.getState();
      const remoteRow = await api.fetchBackup(saved.node, saved.tag);
      let remote: Snapshot | null = null;
      if (remoteRow) remote = unpackSnapshot(open(remoteRow.payload, saved.key));

      let restored = 0;
      if (remote) {
        const before = cellsIn(mapping.progress());
        if (mapping.status !== 'idle') throw new Error('Stop mapping first, then sync.');
        mapping.importProgress(remote);
        restored = Math.max(0, cellsIn(useMapping.getState().progress()) - before);
      }

      const now = useMapping.getState().progress();
      let uploaded = false;
      if (!remote || hasNewerThan(now, remote)) {
        await api.putBackup(saved.node, saved.tag, seal(packSnapshot(now), saved.key));
        uploaded = true;
      }
      const lastMs = Date.now();
      save({ ...saved, lastMs });
      const parts = [restored > 0 ? `Restored ${fmt(restored)} cleared cells from your backup.` : null, uploaded ? `Backed up ${fmt(cellsIn(now))} cleared cells.` : 'Already up to date.'].filter(Boolean);
      set({ phase: 'idle', lastMs, message: parts.join(' '), error: null });
      return true;
    } catch (e) {
      return fail(set, errorText(e));
    }
  },

  disable: () => {
    save(null);
    set({ enabled: false, lastMs: null, message: 'Backup is off. Your map stays on this phone.', error: null });
  },
}));

function fail(set: (p: Partial<BackupState>) => void, error: string): false {
  set({ phase: 'idle', error, message: null });
  return false;
}

let started = false;
/** Backs up quietly when a mapping session ends. Called once at launch. */
export function initBackup() {
  if (started) return;
  started = true;
  useBackup.getState().refresh();
  let ran = false;
  useMapping.subscribe((s) => {
    if (s.status === 'running') ran = true;
    if (s.status === 'idle' && ran) {
      ran = false;
      const { enabled, phase, syncNow } = useBackup.getState();
      if (enabled && phase === 'idle') void syncNow();
    }
  });
  useWallet.subscribe(() => useBackup.getState().refresh());
}

