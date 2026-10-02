import { CAPTURE_OPENS_BEFORE_MS, canCapture, captureWindow } from './window';

const RISE = Date.parse('2026-10-02T19:20:00Z');
const SET = Date.parse('2026-10-02T19:29:00Z');

describe('captureWindow', () => {
  it('counts down while it is too early', () => {
    const w = captureWindow(RISE, SET, RISE - 3600_000);
    expect(w).toEqual({ state: 'upcoming', opensInMs: 3600_000 - CAPTURE_OPENS_BEFORE_MS });
    expect(canCapture(w)).toBe(false);
  });

  it('unlocks exactly 5 minutes before the rise', () => {
    expect(captureWindow(RISE, SET, RISE - CAPTURE_OPENS_BEFORE_MS - 1).state).toBe('upcoming');
    const open = captureWindow(RISE, SET, RISE - CAPTURE_OPENS_BEFORE_MS);
    expect(open.state).toBe('open');
    expect(canCapture(open)).toBe(true);
  });

  it('is live while the satellite is up and ended afterwards', () => {
    expect(captureWindow(RISE, SET, RISE).state).toBe('live');
    expect(canCapture(captureWindow(RISE, SET, SET - 1))).toBe(true);
    const ended = captureWindow(RISE, SET, SET);
    expect(ended.state).toBe('ended');
    expect(canCapture(ended)).toBe(false);
  });
});
