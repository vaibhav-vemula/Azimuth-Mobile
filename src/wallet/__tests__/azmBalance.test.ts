import { PublicKey } from '@solana/web3.js';
import { azmTokenAccount, fetchAzmBalance } from '../azmBalance';

const OWNER = '5ZWj7a1f8tWkjBESHKgrLmXshuXxqeY9SYcfbshpAqPG';
const MINT = 'So11111111111111111111111111111111111111112';

const rpc = (body: unknown, status = 200) =>
  (async () => ({ status, json: async () => body })) as unknown as typeof fetch;

describe('azmTokenAccount', () => {
  it('derives the associated token account', () => {
    const a = azmTokenAccount(OWNER, MINT);
    expect(new PublicKey(a).toBase58()).toBe(a);
    expect(a).not.toBe(OWNER);
    expect(azmTokenAccount(OWNER, MINT)).toBe(a);
  });
});

describe('fetchAzmBalance', () => {
  it('returns the whole-token amount', async () => {
    expect(await fetchAzmBalance(OWNER, { mint: MINT, rpc: 'x', fetchImpl: rpc({ result: { value: { amount: '37', decimals: 0 } } }) })).toBe(37);
  });

  it('returns 0 for a wallet with no token account yet', async () => {
    const missing = rpc({ error: { code: -32602, message: 'Invalid param: could not find account' } });
    expect(await fetchAzmBalance(OWNER, { mint: MINT, rpc: 'x', fetchImpl: missing })).toBe(0);
  });

  it('throws on other RPC errors', async () => {
    await expect(fetchAzmBalance(OWNER, { mint: MINT, rpc: 'x', fetchImpl: rpc({ error: { code: -32005, message: 'Node is behind' } }) })).rejects.toThrow(/behind/);
    await expect(fetchAzmBalance(OWNER, { mint: MINT, rpc: 'x', fetchImpl: rpc({}, 503) })).rejects.toThrow(/503/);
  });

  it('returns 0 without any request when no mint is configured', async () => {
    const f = jest.fn();
    expect(await fetchAzmBalance(OWNER, { mint: '', rpc: 'x', fetchImpl: f as unknown as typeof fetch })).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});
