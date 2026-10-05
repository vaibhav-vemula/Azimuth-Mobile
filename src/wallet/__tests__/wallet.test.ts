import { shortAddress } from '../format';

const mockTransact = jest.fn();
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol-web3js', () => ({
  transact: (fn: (w: unknown) => Promise<unknown>) => mockTransact(fn),
}));

// 32 bytes of 1s, base64 → a valid public key.
const ACCOUNT_B64 = Buffer.alloc(32, 1).toString('base64');

describe('shortAddress', () => {
  it('shortens long addresses and leaves short ones', () => {
    expect(shortAddress('ABCDEFGHIJKLMNOPQRSTUV', 4, 4)).toBe('ABCD…STUV');
    expect(shortAddress('ABC', 4, 4)).toBe('ABC');
  });
});

describe('useWallet', () => {
  beforeEach(() => {
    jest.resetModules();
    mockTransact.mockReset();
  });

  function load() {
    return require('../useWallet') as typeof import('../useWallet');
  }

  it('connects, stores the session and exposes the base58 address', async () => {
    const { useWallet, addressOf } = load();
    mockTransact.mockImplementation(async (fn) =>
      fn({
        authorize: async () => ({ accounts: [{ address: ACCOUNT_B64, label: 'Seed Vault' }], auth_token: 'tok' }),
      })
    );
    expect(await useWallet.getState().connect()).toBe(true);
    const s = useWallet.getState();
    expect(s.status).toBe('connected');
    expect(s.address).toBe(addressOf({ address: ACCOUNT_B64 }));
    expect(s.walletName).toBe('Seed Vault');
  });

  it('reports a friendly error when the user cancels', async () => {
    const { useWallet } = load();
    mockTransact.mockRejectedValue(new Error('User declined authorization request'));
    expect(await useWallet.getState().connect()).toBe(false);
    expect(useWallet.getState().status).toBe('disconnected');
    expect(useWallet.getState().error).toBe('Connection was cancelled.');
  });

  it('disconnects locally even if the wallet cannot be reached', async () => {
    const { useWallet } = load();
    mockTransact
      .mockImplementationOnce(async (fn) => fn({ authorize: async () => ({ accounts: [{ address: ACCOUNT_B64 }], auth_token: 't' }) }))
      .mockRejectedValueOnce(new Error('wallet gone'));
    await useWallet.getState().connect();
    await useWallet.getState().disconnect();
    expect(useWallet.getState().status).toBe('disconnected');
    expect(useWallet.getState().address).toBeNull();
  });

  it('continues as guest', () => {
    const { useWallet } = load();
    useWallet.getState().continueAsGuest();
    expect(useWallet.getState().guest).toBe(true);
  });
});

describe('authorizing the wallet before signing', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { authorizeForSigning } = require('../signReport');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rememberAuthToken, getAuthToken } = require('../useWallet');
  const account = Buffer.alloc(32, 7).toString('base64');

  it('tries the saved token first and keeps the one it gets back', async () => {
    rememberAuthToken('old');
    const authorize = jest.fn(async (_p: { auth_token?: string }) => ({ auth_token: 'new', accounts: [{ address: account }] }));
    await authorizeForSigning({ authorize }, account);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize.mock.calls[0][0].auth_token).toBe('old');
    expect(getAuthToken()).toBe('new');
  });

  it('asks again without the token when the wallet refuses it ("authorization request failed")', async () => {
    rememberAuthToken('stale');
    const authorize = jest
      .fn()
      .mockRejectedValueOnce(new Error('-1/authorization request failed'))
      .mockResolvedValueOnce({ auth_token: 'fresh', accounts: [{ address: account }] });
    await authorizeForSigning({ authorize }, account);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize.mock.calls[1][0].auth_token).toBeUndefined();
    expect(getAuthToken()).toBe('fresh');
  });

  it('passes the error on when even a fresh request is refused', async () => {
    rememberAuthToken('stale');
    const authorize = jest.fn().mockRejectedValue(new Error('declined'));
    await expect(authorizeForSigning({ authorize }, account)).rejects.toThrow('declined');
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('does not retry when there was no saved token to blame', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../useWallet').forgetAuthToken();
    const authorize = jest.fn().mockRejectedValue(new Error('declined'));
    await expect(authorizeForSigning({ authorize }, account)).rejects.toThrow('declined');
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it('refuses a different account', async () => {
    rememberAuthToken('t');
    const other = Buffer.alloc(32, 9).toString('base64');
    const authorize = jest.fn(async () => ({ auth_token: 't2', accounts: [{ address: other }] }));
    await expect(authorizeForSigning({ authorize }, account)).rejects.toThrow(/different account/);
  });
});
