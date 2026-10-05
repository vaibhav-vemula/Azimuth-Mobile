import { areaParts, distanceParts, longDistanceParts, rangeLabel, regionOfLocale, resolveSystem, systemForRegion, walkedParts } from '../units';

describe('which units a phone gets', () => {
  it('reads the region out of a locale', () => {
    expect(regionOfLocale('en_US')).toBe('US');
    expect(regionOfLocale('fr-CA')).toBe('CA');
    expect(regionOfLocale('en_GB@calendar=gregorian')).toBe('GB');
    expect(regionOfLocale('en')).toBeNull();
    expect(regionOfLocale(undefined)).toBeNull();
  });

  it('uses miles and feet in the US and Canada, kilometres and metres elsewhere', () => {
    expect(systemForRegion('US')).toBe('imperial');
    expect(systemForRegion('CA')).toBe('imperial');
    expect(systemForRegion('GB')).toBe('imperial');
    expect(systemForRegion('IN')).toBe('metric');
    expect(systemForRegion('DE')).toBe('metric');
    expect(systemForRegion(null)).toBe('metric');
  });

  it('lets the setting override the region either way', () => {
    expect(resolveSystem('auto', 'US')).toBe('imperial');
    expect(resolveSystem('metric', 'US')).toBe('metric');
    expect(resolveSystem('imperial', 'DE')).toBe('imperial');
  });
});

describe('distances', () => {
  it('metric: metres then kilometres', () => {
    expect(distanceParts(120, 'metric')).toEqual({ value: '120', unit: 'm' });
    expect(distanceParts(1400, 'metric')).toEqual({ value: '1.4', unit: 'km' });
    expect(distanceParts(12_000, 'metric')).toEqual({ value: '12', unit: 'km' });
  });

  it('imperial: feet then miles', () => {
    expect(distanceParts(100, 'imperial')).toEqual({ value: '330', unit: 'ft' }); // 328 ft
    expect(distanceParts(1609.344, 'imperial')).toEqual({ value: '1.0', unit: 'mi' });
    expect(distanceParts(16_093, 'imperial')).toEqual({ value: '10', unit: 'mi' });
    expect(distanceParts(9960, 'metric')).toEqual({ value: '10', unit: 'km' });
  });

  it('never shows a distance below the minimum', () => {
    expect(distanceParts(1, 'metric', { minimum: 5 }).value).toBe('5');
  });

  it('range limits read naturally', () => {
    expect(rangeLabel(60, 'metric')).toBe('60 m');
    expect(rangeLabel(60, 'imperial')).toBe('200 ft');
    expect(rangeLabel(30, 'imperial')).toBe('100 ft');
  });

  it('walked distance and explored area follow the system', () => {
    expect(walkedParts(0, 'imperial')).toEqual({ value: '0', unit: 'ft' });
    expect(walkedParts(1609.344, 'imperial')).toEqual({ value: '1.00', unit: 'mi' });
    expect(walkedParts(2000, 'metric')).toEqual({ value: '2.00', unit: 'km' });
    expect(areaParts(0, 'imperial')).toEqual({ value: '0', unit: 'sq ft' });
    expect(areaParts(0.004, 'imperial')).toEqual({ value: '43,100', unit: 'sq ft' }); // 4,000 m²
    expect(areaParts(0.00001, 'imperial')).toEqual({ value: '110', unit: 'sq ft' }); // 10 m²
    expect(areaParts(2.589988, 'imperial')).toEqual({ value: '1.00', unit: 'mi²' });
    expect(areaParts(0.42, 'metric')).toEqual({ value: '0.42', unit: 'km²' });
  });

  it('long distances for satellites', () => {
    expect(longDistanceParts(1000, 'metric')).toEqual({ value: '1000', unit: 'km' });
    expect(longDistanceParts(1000, 'imperial')).toEqual({ value: '621', unit: 'mi' });
  });
});

import { useUnits } from '../units';

describe('the setting', () => {
  it('is remembered as a choice and goes back to automatic', () => {
    useUnits.getState().setPreference('imperial');
    expect(useUnits.getState().preference).toBe('imperial');
    useUnits.getState().setPreference('auto');
    expect(useUnits.getState().preference).toBe('auto');
  });
});
