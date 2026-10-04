import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV({ id: 'azimuth-wallet' });
const KEY = 'session';

/** What is kept between launches. The auth token lets the wallet skip the approval prompt next time. */
export interface WalletSession {
  address: string;
  authToken: string;
  walletName: string | null;
}

export function loadWalletSession(): WalletSession | null {
  try {
    const raw = storage.getString(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WalletSession>;
    if (typeof parsed.address !== 'string' || typeof parsed.authToken !== 'string') return null;
    return { address: parsed.address, authToken: parsed.authToken, walletName: parsed.walletName ?? null };
  } catch {
    return null;
  }
}

export function saveWalletSession(session: WalletSession): void {
  storage.set(KEY, JSON.stringify(session));
}

export function clearWalletSession(): void {
  storage.remove(KEY);
}

const GUEST_KEY = 'guest';

/** True when the user chose to use the app without connecting a wallet. */
export function loadGuest(): boolean {
  return storage.getBoolean(GUEST_KEY) ?? false;
}

export function saveGuest(guest: boolean): void {
  storage.set(GUEST_KEY, guest);
}
