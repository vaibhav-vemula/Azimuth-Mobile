import { cellularBars, cellularQuality, formatAreaParts, formatElapsed, formatPlmn, formatWalked, stepDistance, techLabel } from '../hudFormat';

describe('time', () => {
  it('shows minutes and seconds, then hours', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9)).toBe('0:09');
    expect(formatElapsed(754)).toBe('12:34');
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(3729)).toBe('1:02:09');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('distance and area', () => {
  it('walked distance steps in metres, then kilometres', () => {
    expect(formatWalked(0)).toEqual({ value: '0', unit: 'm' });
    expect(formatWalked(0.4)).toEqual({ value: '0', unit: 'm' });
    expect(formatWalked(342)).toEqual({ value: '340', unit: 'm' });
    expect(formatWalked(1234)).toEqual({ value: '1.23', unit: 'km' });
    expect(formatWalked(12_340)).toEqual({ value: '12.3', unit: 'km' });
    expect(formatWalked(NaN)).toEqual({ value: '0', unit: 'm' });
  });

  it('area steps in square metres, then square kilometres', () => {
    expect(formatAreaParts(0)).toEqual({ value: '0', unit: 'm²' });
    expect(formatAreaParts(0.0004)).toEqual({ value: '400', unit: 'm²' });
    expect(formatAreaParts(0.42)).toEqual({ value: '0.42', unit: 'km²' });
    expect(formatAreaParts(34.7)).toEqual({ value: '35', unit: 'km²' });
  });
});

describe('cellular quality', () => {
  it('maps strength to bars', () => {
    expect([-70, -85, -90, -95, -100, -105, -110, -115, -125].map(cellularBars)).toEqual([4, 4, 3, 3, 2, 2, 1, 1, 0]);
    expect(cellularBars(null)).toBe(0);
    expect(cellularBars(undefined)).toBe(0);
  });

  it('names the quality', () => {
    expect([-70, -90, -100, -110, -125].map(cellularQuality)).toEqual(['great', 'good', 'fair', 'poor', 'none']);
  });
});

describe('distance walked', () => {
  it('ignores wobble while standing still and impossible jumps', () => {
    expect(stepDistance(0.8, 2)).toBe(0);
    expect(stepDistance(14, 10)).toBe(14);
    expect(stepDistance(900, 5)).toBe(0); // 180 m/s
    expect(stepDistance(NaN, 5)).toBe(0);
  });
});

describe('tower labels', () => {
  it('names the technologies and formats the network code', () => {
    expect(['lte', 'nr', 'wcdma', 'gsm', 'cdma'].map(techLabel)).toEqual(['4G LTE', '5G', '3G', '2G', 'CDMA']);
    expect(formatPlmn('310260')).toBe('310-260');
    expect(formatPlmn('31026')).toBe('310-26');
    expect(formatPlmn('')).toBe('unknown network');
  });
});
