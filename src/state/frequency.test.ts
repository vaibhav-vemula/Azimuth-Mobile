import { effectiveFrequencyHz } from './frequency';

const auto = (frequencyHz: number) => ({ frequencyHz, goodCount: 5, latestGoodAt: null, fetchedAt: '', source: 'satnogs' as const });

describe('effectiveFrequencyHz', () => {
  const manual = { '59051': 137_100_000, '57166': 137_900_000 };

  it('uses the SatNOGS choice in Auto mode', () => {
    const state = { settings: { autoFrequency: true, frequencyHzBySatellite: manual }, autoFrequencies: { '59051': auto(137_900_000) } };
    expect(effectiveFrequencyHz(state, '59051')).toBe(137_900_000);
  });

  it('uses the manual choice when Auto is off', () => {
    const state = { settings: { autoFrequency: false, frequencyHzBySatellite: manual }, autoFrequencies: { '59051': auto(137_900_000) } };
    expect(effectiveFrequencyHz(state, '59051')).toBe(137_100_000);
  });

  it('falls back to the manual/default value while Auto has no answer yet', () => {
    const state = { settings: { autoFrequency: true, frequencyHzBySatellite: manual }, autoFrequencies: {} };
    expect(effectiveFrequencyHz(state, '59051')).toBe(137_100_000);
    expect(effectiveFrequencyHz(state, '57166')).toBe(137_900_000);
  });

  it('handles an unknown satellite', () => {
    const state = { settings: { autoFrequency: true, frequencyHzBySatellite: {} }, autoFrequencies: {} };
    expect(effectiveFrequencyHz(state, '1')).toBe(137_900_000);
  });
});
