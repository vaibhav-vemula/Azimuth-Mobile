import type { CapturePhase } from '../../capture/useCapture';

export type PrimaryActionKind = 'connect' | 'start' | 'stop' | 'done' | 'busy';

export interface PrimaryAction {
  kind: PrimaryActionKind;
  label: string;
  enabled: boolean;
}

/** What the big button at the top of the capture screen should say and do. */
export function primaryAction(input: {
  connected: boolean;
  connecting: boolean;
  phase: CapturePhase;
  passEnded: boolean;
  testMode: boolean;
  testRun: boolean;
}): PrimaryAction {
  const { connected, connecting, phase, passEnded, testMode, testRun } = input;

  if (phase === 'complete' || phase === 'error') return { kind: 'done', label: 'Done', enabled: true };
  if (phase === 'recording') return { kind: 'stop', label: 'Stop recording', enabled: true };
  if (phase === 'preparing') return { kind: 'busy', label: 'Preparing receiver…', enabled: false };
  if (phase === 'finishing') return { kind: 'busy', label: 'Saving recording…', enabled: false };

  if (connecting) return { kind: 'busy', label: 'Connecting…', enabled: false };
  if (!connected) return { kind: 'connect', label: 'Connect receiver', enabled: true };
  return {
    kind: 'start',
    label: testRun ? 'Start test recording' : 'Start recording',
    enabled: !passEnded || testMode,
  };
}
