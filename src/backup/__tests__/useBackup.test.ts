import { Buffer } from 'buffer';
import bs58 from 'bs58';

const mockStore = new Map<string, { payload: string; createdMs: number }>();
const mockPut = jest.fn(async (node: string, tag: string, payload: string) => {
  mockStore.set(`${node}:${tag}`, { payload, createdMs: Date.now() });
});
const mockFetch = jest.fn(async (node: string, tag: string) => mockStore.get(`${node}:${tag}`) ?? null);

jest.mock('../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));
jest.mock('../../network/config', () => ({ backendMode: 'direct', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' }));
jest.mock('../../network/supabaseApi', () => ({ createSupabaseApi: () => ({ putBackup: (...a: [string, string, string]) => mockPut(...a), fetchBackup: (...a: [string, string]) => mockFetch(...a) }) }));

let mockSignature = Buffer.alloc(64, 5).toString('base64');
const mockSign = jest.fn(async () => mockSignature);
jest.mock('../../wallet/signReport', () => ({ signText: (...a: unknown[]) => (mockSign as (...x: unknown[]) => Promise<string>)(...a) }));

import { useBackup } from '../useBackup';
import { useMapping } from '../../mapping/useMapping';
import { useWallet } from '../../wallet/useWallet';

const ADDRESS = bs58.encode(Buffer.alloc(32, 9));

function reset(explored: Record<string, number>) {
  useBackup.getState().disable();
  mockStore.clear();
  mockPut.mockClear();
  mockFetch.mockClear();
  mockSign.mockClear();
  mockSignature = Buffer.alloc(64, 5).toString('base64');
  useWallet.setState({ address: ADDRESS, status: 'connected' });
  useMapping.setState({ status: 'idle', explored, visited: {}, signals: {} });
}

describe('wallet-keyed encrypted backup', () => {
  it('signs twice to be sure the key is stable, then uploads only encrypted data', async () => {
    reset({ a: 1, b: 2 });
    const ok = await useBackup.getState().enable();
    if (!ok) throw new Error('enable failed: ' + useBackup.getState().error);
    expect(mockSign).toHaveBeenCalledTimes(2);
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [node, tag, payload] = mockPut.mock.calls[0];
    expect(node).toBe(ADDRESS);
    expect(tag).toMatch(/^[0-9a-f]{32}$/);
    expect(payload).not.toContain('"a"'); // not readable
    expect(Buffer.from(payload, 'base64').toString('latin1')).not.toContain('explored');
    expect(useBackup.getState().enabled).toBe(true);
    expect(useBackup.getState().message).toMatch(/Backed up 2/);
  });

  it('restores onto a new phone: the same wallet signature opens the backup and the cells come back', async () => {
    reset({ a: 1, b: 2, c: 3 });
    await useBackup.getState().enable();
    // A new phone: no progress, no saved key, same wallet.
    useBackup.getState().disable();
    useMapping.setState({ explored: {} });
    expect(await useBackup.getState().enable()).toBe(true);
    expect(Object.keys(useMapping.getState().explored).sort()).toEqual(['a', 'b', 'c']);
    expect(useBackup.getState().message).toMatch(/Restored 3/);
    expect(mockPut).toHaveBeenCalledTimes(1); // nothing new to upload the second time
  });

  it('merges two phones and uploads the union', async () => {
    reset({ a: 1 });
    await useBackup.getState().enable();
    useMapping.setState({ explored: { z: 9 } }); // this phone explored somewhere else meanwhile
    await useBackup.getState().syncNow();
    expect(Object.keys(useMapping.getState().explored).sort()).toEqual(['a', 'z']);
    expect(mockPut).toHaveBeenCalledTimes(2);
  });

  it('refuses a wallet whose signatures change, and stays off', async () => {
    reset({ a: 1 });
    let n = 0;
    mockSign.mockImplementation(async () => Buffer.alloc(64, ++n).toString('base64'));
    expect(await useBackup.getState().enable()).toBe(false);
    expect(useBackup.getState().enabled).toBe(false);
    expect(useBackup.getState().error).toMatch(/different signature/);
    expect(mockPut).not.toHaveBeenCalled();
    mockSign.mockImplementation(async () => mockSignature);
  });

  it('stays off when the wallet prompt is cancelled', async () => {
    reset({ a: 1 });
    mockSign.mockRejectedValueOnce(new Error('User declined'));
    expect(await useBackup.getState().enable()).toBe(false);
    expect(useBackup.getState().enabled).toBe(false);
    expect(useBackup.getState().error).toMatch(/Cancelled/);
  });

  it('does not open a backup made with another wallet key, and does not touch the map', async () => {
    reset({ a: 1 });
    await useBackup.getState().enable();
    // Someone swaps the stored payload for junk under the same tag
    const [key] = [...mockStore.keys()];
    mockStore.set(key, { payload: Buffer.alloc(80, 1).toString('base64'), createdMs: 1 });
    expect(await useBackup.getState().syncNow()).toBe(false);
    expect(useBackup.getState().error).toMatch(/cannot be opened/);
    expect(Object.keys(useMapping.getState().explored)).toEqual(['a']);
  });

  it('will not merge while a session is running', async () => {
    reset({ a: 1 });
    await useBackup.getState().enable();
    useMapping.setState({ status: 'running' });
    expect(await useBackup.getState().syncNow()).toBe(false);
    expect(useBackup.getState().error).toMatch(/Stop mapping/);
    useMapping.setState({ status: 'idle' });
  });

  it('is off for a different wallet', async () => {
    reset({ a: 1 });
    await useBackup.getState().enable();
    useWallet.setState({ address: bs58.encode(Buffer.alloc(32, 3)) });
    useBackup.getState().refresh();
    expect(useBackup.getState().enabled).toBe(false);
  });
});
