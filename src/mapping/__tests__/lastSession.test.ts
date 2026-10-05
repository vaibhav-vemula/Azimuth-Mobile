import { loadPending, loadSessionCells, saveBackfilled, saveExplored, savePending, saveSessions } from '../mappingStorage';
import { useMapping } from '../useMapping';

jest.mock('../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));

const T0 = 1_700_000_000_000;
const walk = (n: number, start = T0) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`h5:${i}:${i}`, start + i * 4_000]));

beforeEach(() => {
  saveBackfilled(false);
  saveSessions([]);
  savePending(null);
  saveExplored({});
  useMapping.setState({ sessions: [], lastReport: null });
});

describe('what the panel shows after the app is reopened', () => {
  it('rebuilds the last session from the fog map, once', () => {
    saveExplored(walk(80));
    useMapping.getState().load();
    const sessions = useMapping.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ clearedCells: 80, estimated: true, startedMs: T0 });
    expect(loadSessionCells(sessions[0].id)).toHaveLength(80);

    // Loading again does not add it a second time, even after the history is cleared by hand.
    useMapping.getState().load();
    expect(useMapping.getState().sessions).toHaveLength(1);
  });

  it('brings back a report that was not submitted before the app closed', () => {
    const report = { version: 1, type: 'mapping-session', node: 'N'.repeat(40), device: { model: 'x', app: '1' }, buckets: [{ cellId: 'c' }], checks: {} };
    savePending(JSON.stringify(report));
    useMapping.getState().load();
    expect(useMapping.getState().lastReport?.node).toBe('N'.repeat(40));
  });

  it('ignores a damaged saved report', () => {
    savePending('{not json');
    useMapping.getState().load();
    expect(useMapping.getState().lastReport).toBeNull();
    savePending(JSON.stringify({ type: 'something-else' }));
    useMapping.getState().load();
    expect(useMapping.getState().lastReport).toBeNull();
  });

  it('forgets the saved report once it has been sent', () => {
    savePending('{"x":1}');
    useMapping.getState().reportSent();
    expect(loadPending()).toBeNull();
  });
});
