/** Capture unlocks this long before a pass rises, so there is time to connect and check the signal. */
export const CAPTURE_OPENS_BEFORE_MS = 5 * 60_000;

export type CaptureWindowState =
  /** Too early: `opensInMs` counts down to the unlock. */
  | { state: 'upcoming'; opensInMs: number }
  /** Unlocked but the satellite has not risen yet. */
  | { state: 'open'; opensInMs: 0 }
  /** The satellite is above the horizon. */
  | { state: 'live'; opensInMs: 0 }
  | { state: 'ended'; opensInMs: 0 };

export function captureWindow(riseMs: number, setMs: number, nowMs: number): CaptureWindowState {
  if (nowMs >= setMs) return { state: 'ended', opensInMs: 0 };
  if (nowMs >= riseMs) return { state: 'live', opensInMs: 0 };
  const opensInMs = riseMs - CAPTURE_OPENS_BEFORE_MS - nowMs;
  return opensInMs > 0 ? { state: 'upcoming', opensInMs } : { state: 'open', opensInMs: 0 };
}

/** A test recording outside the pass window lasts this long, regardless of the pass times. */
export const TEST_RECORDING_SEC = 120;

/** True when the Capture button should be enabled. Test mode unlocks it for any pass at any time. */
export function canCapture(window: CaptureWindowState, testMode = false): boolean {
  return testMode || window.state === 'open' || window.state === 'live';
}

/** True when a capture started now is a test run rather than a recording of the real pass. */
export function isTestRun(window: CaptureWindowState, testMode: boolean): boolean {
  return testMode && !canCapture(window, false);
}
