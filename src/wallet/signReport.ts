import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Report, SignedReport, reportHash, signingMessage } from '../reports/report';
import { SOLANA_CHAIN, forgetAuthToken, getAuthToken, rememberAuthToken } from './useWallet';
import bs58 from 'bs58';

const SIGNATURE_BYTES = 64;
const IDENTITY = { name: 'Azimuth', uri: 'https://azimuth.app', icon: 'favicon.png' };

/** The slice of the wallet session this file uses, so the retry below can be tested without a phone. */
export interface WalletSession {
  authorize: (params: { chain: string; identity: typeof IDENTITY; auth_token?: string }) => Promise<{ auth_token: string; accounts: { address: string }[] }>;
}

/**
 * Gets the wallet ready to sign. The saved authorization is tried first, so there is no extra prompt. If the wallet no
 * longer accepts it (the Seeker's wallet answers "authorization request failed" when a saved token has expired or was
 * issued under other settings), ask again from scratch, which shows the wallet's approval screen once, and keep the new
 * token. The account that comes back must be the one this app is signed in with.
 */
export async function authorizeForSigning(wallet: WalletSession, expectedBase64: string): Promise<void> {
  const request = (token?: string) => wallet.authorize({ chain: SOLANA_CHAIN, identity: IDENTITY, auth_token: token });
  const saved = getAuthToken();
  let result;
  try {
    result = await request(saved ?? undefined);
  } catch (e) {
    if (!saved) throw e;
    forgetAuthToken();
    result = await request();
  }
  rememberAuthToken(result.auth_token);
  const sameAccount = result.accounts.some((a) => a.address === expectedBase64 || bs58.encode(Buffer.from(a.address, 'base64')) === bs58.encode(Buffer.from(expectedBase64, 'base64')));
  if (!sameAccount) throw new Error('The wallet approved a different account than the one this app is signed in with. Choose the same account.');
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
  const signed = await transact(async (wallet) => {
    await authorizeForSigning(wallet as unknown as WalletSession, walletAddressBase64);
    const result = await wallet.signMessages({ addresses: [walletAddressBase64], payloads: [message] });
    return result[0];
  });
  if (!signed || signed.length < SIGNATURE_BYTES) throw new Error('The wallet did not return a signature.');
  return toBase64(signed.slice(signed.length - SIGNATURE_BYTES));
}

/** Asks the connected wallet (Seed Vault on a Seeker) to sign the report. */
export async function signReport(report: Report, walletAddressBase64: string): Promise<SignedReport> {
  const message = signingMessage(report);
  const signed = await transact(async (wallet) => {
    await authorizeForSigning(wallet as unknown as WalletSession, walletAddressBase64);
    const result = await wallet.signMessages({ addresses: [walletAddressBase64], payloads: [message] });
    return result[0];
  });
  if (!signed || signed.length < SIGNATURE_BYTES) throw new Error('The wallet did not return a signature.');

  // MWA returns the message followed by the signature.
  const echoed = signed.slice(0, signed.length - SIGNATURE_BYTES);
  const signature = signed.slice(signed.length - SIGNATURE_BYTES);
  if (echoed.length > 0 && !equal(echoed, message)) throw new Error('The wallet signed different data than requested.');

  return { report, signature: toBase64(signature), hash: reportHash(report) };
}
