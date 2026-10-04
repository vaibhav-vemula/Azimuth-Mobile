import { create } from 'zustand';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import type { Account } from '@solana-mobile/mobile-wallet-adapter-protocol';
import bs58 from 'bs58';
import { clearWalletSession, loadGuest, loadWalletSession, saveGuest, saveWalletSession } from './walletStorage';

/** Devnet while the network is being built; switch to 'solana:mainnet' before any real payout. */
export const SOLANA_CHAIN = 'solana:devnet';

const APP_IDENTITY = {
  name: 'Azimuth',
  uri: 'https://azimuth.app',
  icon: 'favicon.png',
};

export type WalletStatus = 'disconnected' | 'connecting' | 'connected';

interface WalletState {
  status: WalletStatus;
  address: string | null;
  walletName: string | null;
  error: string | null;
  /** The user skipped connecting a wallet; radio and satellite features still work. */
  guest: boolean;
  continueAsGuest: () => void;
  /** Restores the saved session, if any. Does not contact the wallet. */
  restore: () => void;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
}

let authToken: string | null = null;

export function getAuthToken(): string | null {
  return authToken;
}

export function addressOf(account: Pick<Account, 'address'>): string {
  return bs58.encode(Buffer.from(account.address, 'base64'));
}

function describeError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/cancel|declin|reject/i.test(message)) return 'Connection was cancelled.';
  if (/not found|no wallet|activity/i.test(message)) return 'No compatible wallet found. On a Seeker, use the built-in Seed Vault wallet.';
  return message;
}

export const useWallet = create<WalletState>((set, get) => ({
  status: 'disconnected',
  address: null,
  walletName: null,
  error: null,
  guest: false,

  continueAsGuest: () => {
    saveGuest(true);
    set({ guest: true });
  },

  restore: () => {
    set({ guest: loadGuest() });
    const saved = loadWalletSession();
    if (!saved) return;
    authToken = saved.authToken;
    set({ status: 'connected', address: saved.address, walletName: saved.walletName, error: null });
  },

  connect: async () => {
    if (get().status === 'connecting') return false;
    set({ status: 'connecting', error: null });
    try {
      const result = await transact(async (wallet) => {
        const auth = await wallet.authorize({
          chain: SOLANA_CHAIN,
          identity: APP_IDENTITY,
          auth_token: authToken ?? undefined,
        });
        return auth;
      });
      const account = result.accounts[0];
      if (!account) throw new Error('The wallet did not return an account.');
      const address = addressOf(account);
      authToken = result.auth_token;
      const walletName = account.label ?? null;
      saveWalletSession({ address, authToken: result.auth_token, walletName });
      saveGuest(false);
      set({ status: 'connected', address, walletName, error: null, guest: false });
      return true;
    } catch (e) {
      set({ status: get().address ? 'connected' : 'disconnected', error: describeError(e) });
      return false;
    }
  },

  disconnect: async () => {
    const token = authToken;
    authToken = null;
    clearWalletSession();
    set({ status: 'disconnected', address: null, walletName: null, error: null });
    if (!token) return;
    try {
      await transact(async (wallet) => {
        await wallet.deauthorize({ auth_token: token });
      });
    } catch {
      // The local session is already cleared; failing to tell the wallet is not worth surfacing.
    }
  },
}));
