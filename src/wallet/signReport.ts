import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Report, SignedReport, reportHash, signingMessage } from '../reports/report';
import { APP_IDENTITY, SOLANA_CHAIN, forgetAuthToken, getAuthToken, rememberAuthToken } from './useWallet';
import bs58 from 'bs58';

const SIGNATURE_BYTES = 64;
const IDENTITY = APP_IDENTITY;

/** The slice of a wallet session this file uses, so the retry below can be tested without a phone. */
export interface WalletSession {
  authorize: (params: { chain: string; identity: typeof IDENTITY; auth_token?: string }) => Promise<{ auth_token: string; accounts: { address: string }[] }>;
}

type TransactFn = <T>(callback: (wallet: never) => Promise<T>) => Promise<T>;

/** True when the wallet turned down the saved authorization (as opposed to the user backing out). */
export function isAuthorizationFailure(e: unknown): boolean {
  return /authorization request failed|ERROR_AUTHORIZATION_FAILED|-1\/auth/i.test(e instanceof Error ? e.message : String(e));
}

const sameAccount = (a: string, b: string) => bs58.encode(Buffer.from(a, 'base64')) === bs58.encode(Buffer.from(b, 'base64'));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work` inside a wallet session that is authorized for this app's account. The saved authorization is tried first,
 * so there is no extra prompt. If the wallet refuses it ("authorization request failed": the token expired or was issued
 * under other settings), the wallet closes that session, so it is retried as a NEW session without the token, which shows
 * the wallet's approval screen once; the new token is kept. The approved account must be the one the app is signed in with.
 */
export async function inWalletSession<T>(expectedBase64: string, work: (wallet: any) => Promise<T>, transactImpl: TransactFn = transact as unknown as TransactFn): Promise<T> {
  const attempt = (token: string | null) =>
    transactImpl(async (wallet) => {
      const session = wallet as unknown as WalletSession;
      const result = await session.authorize({ chain: SOLANA_CHAIN, identity: IDENTITY, auth_token: token ?? undefined });
      rememberAuthToken(result.auth_token);
      if (!result.accounts.some((acc) => sameAccount(acc.address, expectedBase64))) {
        throw new Error('The wallet approved a different account than the one this app is signed in with. Choose the same account.');
      }
      return work(wallet);
    });
  const saved = getAuthToken();
  try {
    return await attempt(saved);
  } catch (e) {
    if (!saved || !isAuthorizationFailure(e)) throw e;
    forgetAuthToken();
    await pause(400); // let the wallet finish closing the first session
    return attempt(null);
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Asks the connected wallet to sign a short text message. Returns the base64 signature. */
export async function signText(text: string, walletAddressBase64: string): Promise<string> {
  const message = new TextEncoder().encode(text);
  const signed = await inWalletSession(walletAddressBase64, async (wallet) => {
    const result = await wallet.signMessages({ addresses: [walletAddressBase64], payloads: [message] });
    return result[0] as Uint8Array;
  });
  if (!signed || signed.length < SIGNATURE_BYTES) throw new Error('The wallet did not return a signature.');
  return toBase64(signed.slice(signed.length - SIGNATURE_BYTES));
}

/**
 * Asks the wallet to sign the same message `count` times in ONE wallet session, so there is a single approval screen.
 * Returns the base64 signatures. Used to check that the wallet's signatures are repeatable.
 */
export async function signTextRepeated(text: string, walletAddressBase64: string, count: number): Promise<string[]> {
  const message = new TextEncoder().encode(text);
  const signed = await inWalletSession<Uint8Array[]>(walletAddressBase64, (wallet) =>
    wallet.signMessages({ addresses: Array(count).fill(walletAddressBase64), payloads: Array(count).fill(message) })
  );
  if (!signed || signed.length !== count || signed.some((s) => !s || s.length < SIGNATURE_BYTES)) throw new Error('The wallet did not return the signatures.');
  return signed.map((s) => toBase64(s.slice(s.length - SIGNATURE_BYTES)));
}

/** Asks the connected wallet (Seed Vault on a Seeker) to sign the report. */
export async function signReport(report: Report, walletAddressBase64: string): Promise<SignedReport> {
  const message = signingMessage(report);
  const signed = await inWalletSession(walletAddressBase64, async (wallet) => {
    const result = await wallet.signMessages({ addresses: [walletAddressBase64], payloads: [message] });
    return result[0] as Uint8Array;
  });
  if (!signed || signed.length < SIGNATURE_BYTES) throw new Error('The wallet did not return a signature.');

  // MWA returns the message followed by the signature.
  const echoed = signed.slice(0, signed.length - SIGNATURE_BYTES);
  const signature = signed.slice(signed.length - SIGNATURE_BYTES);
  if (echoed.length > 0 && !equal(echoed, message)) throw new Error('The wallet signed different data than requested.');

  return { report, signature: toBase64(signature), hash: reportHash(report) };
}
