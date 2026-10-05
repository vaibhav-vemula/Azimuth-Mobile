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

describe('running inside an authorized wallet session', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { inWalletSession, isAuthorizationFailure } = require('../signReport');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rememberAuthToken, forgetAuthToken, getAuthToken } = require('../useWallet');
  const account = Buffer.alloc(32, 7).toString('base64');

  /** A fake wallet app: each call to transact is one session; `behaviours` says what authorize does in each. */
  function fakeWallet(behaviours: ('ok' | 'auth-failed' | 'declined')[], address = account) {
    const authorizeCalls: (string | undefined)[] = [];
    let session = 0;
    const transact = jest.fn(async (callback: (w: unknown) => Promise<unknown>) => {
      const mode = behaviours[session++];
      return callback({
        authorize: async (p: { auth_token?: string }) => {
          authorizeCalls.push(p.auth_token);
          if (mode === 'auth-failed') throw new Error('-1/authorization request failed');
          if (mode === 'declined') throw new Error('User declined');
          return { auth_token: `token-${session}`, accounts: [{ address }] };
        },
      });
    });
    return { transact, authorizeCalls, sessions: () => session };
  }

  it('uses the saved token first and keeps the one it gets back', async () => {
    rememberAuthToken('old');
    const w = fakeWallet(['ok']);
    expect(await inWalletSession(account, async () => 'signed', w.transact)).toBe('signed');
    expect(w.authorizeCalls).toEqual(['old']);
    expect(getAuthToken()).toBe('token-1');
  });

  it('retries in a NEW session without the token when the wallet refuses it', async () => {
    rememberAuthToken('stale');
    const w = fakeWallet(['auth-failed', 'ok']);
    expect(await inWalletSession(account, async () => 'signed', w.transact)).toBe('signed');
    expect(w.sessions()).toBe(2);
    expect(w.authorizeCalls).toEqual(['stale', undefined]);
    expect(getAuthToken()).toBe('token-2');
  });

  it('does not retry when the user declined, or when there was no saved token', async () => {
    rememberAuthToken('t');
    const declined = fakeWallet(['declined', 'ok']);
    await expect(inWalletSession(account, async () => 1, declined.transact)).rejects.toThrow('declined');
    expect(declined.sessions()).toBe(1);
    forgetAuthToken();
    const none = fakeWallet(['auth-failed', 'ok']);
    await expect(inWalletSession(account, async () => 1, none.transact)).rejects.toThrow('authorization request failed');
    expect(none.sessions()).toBe(1);
  });

  it('refuses a different account', async () => {
    rememberAuthToken('t');
    const other = fakeWallet(['ok'], Buffer.alloc(32, 9).toString('base64'));
    await expect(inWalletSession(account, async () => 1, other.transact)).rejects.toThrow(/different account/);
  });

  it('recognises the wallet refusing a token, but not other errors', () => {
    expect(isAuthorizationFailure(new Error('-1/authorization request failed'))).toBe(true);
    expect(isAuthorizationFailure(new Error('User declined'))).toBe(false);
    expect(isAuthorizationFailure(new Error('Local association cancelled by user'))).toBe(false);
  });
});

describe('a saved authorization for an older website address', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useWallet, getAuthToken, APP_IDENTITY } = require('../useWallet');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { saveWalletSession } = require('../walletStorage');

  it('is not reused, so the wallet is asked again and shows the current address', () => {
    saveWalletSession({ address: 'A'.repeat(44), authToken: 'old-token', walletName: 'Seed Vault', identityUri: 'https://azimuth.app' });
    useWallet.getState().restore();
    expect(getAuthToken()).toBeNull();
    expect(useWallet.getState().status).toBe('connected'); // still signed in, just not reusing the token
  });

  it('is reused when it was issued for the current address', () => {
    saveWalletSession({ address: 'A'.repeat(44), authToken: 'fresh-token', walletName: 'Seed Vault', identityUri: APP_IDENTITY.uri });
    useWallet.getState().restore();
    expect(getAuthToken()).toBe('fresh-token');
  });

  it('is not reused when the saved session predates identity tracking', () => {
    saveWalletSession({ address: 'A'.repeat(44), authToken: 'legacy', walletName: null });
    useWallet.getState().restore();
    expect(getAuthToken()).toBeNull();
  });
});
