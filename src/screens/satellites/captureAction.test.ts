jest.mock('../../capture/useCapture', () => ({}));

import { primaryAction } from './captureAction';

const base = { connected: true, connecting: false, phase: 'idle' as const, passEnded: false, testMode: false, testRun: false };

describe('primaryAction', () => {
  it('asks to connect when the receiver is not connected', () => {
    expect(primaryAction({ ...base, connected: false })).toEqual({ kind: 'connect', label: 'Connect receiver', enabled: true });
  });

  it('shows progress while connecting and cannot be pressed', () => {
    expect(primaryAction({ ...base, connected: false, connecting: true })).toEqual({ kind: 'busy', label: 'Connecting…', enabled: false });
  });

  it('offers to start recording once connected', () => {
    expect(primaryAction(base)).toEqual({ kind: 'start', label: 'Start recording', enabled: true });
  });

  it('labels a test run as a test', () => {
    expect(primaryAction({ ...base, testMode: true, testRun: true }).label).toBe('Start test recording');
  });

  it('disables start after the pass has ended, unless testing', () => {
    expect(primaryAction({ ...base, passEnded: true }).enabled).toBe(false);
    expect(primaryAction({ ...base, passEnded: true, testMode: true, testRun: true }).enabled).toBe(true);
  });

  it('shows Stop while recording, even if the receiver status flickers', () => {
    expect(primaryAction({ ...base, phase: 'recording', connected: false })).toEqual({ kind: 'stop', label: 'Stop recording', enabled: true });
  });

  it('shows disabled progress while preparing and saving', () => {
    expect(primaryAction({ ...base, phase: 'preparing' })).toMatchObject({ kind: 'busy', enabled: false });
    expect(primaryAction({ ...base, phase: 'finishing' })).toMatchObject({ kind: 'busy', enabled: false });
  });

  it('offers Done after a finished or failed capture', () => {
    expect(primaryAction({ ...base, phase: 'complete' }).kind).toBe('done');
    expect(primaryAction({ ...base, phase: 'error' }).kind).toBe('done');
  });
});
