import { ensureDongle } from '../radioProbe';
import { useReceiver } from '../../receiver/useReceiver';

jest.mock('../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  getGains: jest.fn(async () => []),
  setAudioEnabled: jest.fn(),
  setBiasTee: jest.fn(),
  setGain: jest.fn(),
  setSampleRate: jest.fn(),
  setVolume: jest.fn(),
  startStream: jest.fn(),
  stopStream: jest.fn(),
  tune: jest.fn(),
}));

describe('connecting the dongle when mapping starts', () => {
  it('does nothing when it is already connected', async () => {
    const connect = jest.fn();
    useReceiver.setState({ status: 'connected', connect } as never);
    expect(await ensureDongle(true)).toBe(true);
    expect(connect).not.toHaveBeenCalled();
  });

  it('connects when a dongle is plugged in but not connected yet', async () => {
    const connect = jest.fn(async () => {
      useReceiver.setState({ status: 'connected' });
      return true;
    });
    useReceiver.setState({ status: 'disconnected', connect } as never);
    expect(await ensureDongle(true)).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('carries on without it when there is no dongle', async () => {
    const connect = jest.fn(async () => {
      throw new Error('No RTL-SDR receiver found.');
    });
    useReceiver.setState({ status: 'error', connect } as never);
    expect(await ensureDongle(true)).toBe(false);
  });
});
