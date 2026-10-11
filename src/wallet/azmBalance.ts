import { PublicKey } from '@solana/web3.js';
import { AZM_MINT, DEVNET_RPC } from '../network/config';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** The wallet's associated token account for a mint (base58). */
export function azmTokenAccount(owner: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
    ASSOCIATED_PROGRAM
  );
  return ata.toBase58();
}

/** Whole AZMTest in the wallet. Zero when it has no token account yet. */
export async function fetchAzmBalance(
  owner: string,
  opts: { mint?: string; rpc?: string; fetchImpl?: typeof fetch } = {}
): Promise<number> {
  const mint = opts.mint ?? AZM_MINT;
  if (!mint) return 0;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(opts.rpc ?? DEVNET_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountBalance', params: [azmTokenAccount(owner, mint)] }),
  });
  if (res.status !== 200) throw new Error(`Could not read the AZMTest balance (HTTP ${res.status}).`);
  const json = (await res.json()) as { result?: { value?: { amount?: string } }; error?: { message?: string } };
  if (json.error) {
    if (/could not find account/i.test(json.error.message ?? '')) return 0;
    throw new Error(json.error.message ?? 'Could not read the AZMTest balance.');
  }
  return Number(json.result?.value?.amount ?? 0);
}
