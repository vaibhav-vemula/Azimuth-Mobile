import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { Report, SignedReport, reportHash, signingMessage } from '../reports/report';
import { SOLANA_CHAIN, getAuthToken } from './useWallet';

const SIGNATURE_BYTES = 64;

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
    await wallet.authorize({
      chain: SOLANA_CHAIN,
      identity: { name: 'Azimuth', uri: 'https://azimuth.app', icon: 'favicon.png' },
      auth_token: getAuthToken() ?? undefined,
    });
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
    await wallet.authorize({
      chain: SOLANA_CHAIN,
      identity: { name: 'Azimuth', uri: 'https://azimuth.app', icon: 'favicon.png' },
      auth_token: getAuthToken() ?? undefined,
    });
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
