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
    expect(walkedParts(0, 'imperial')).toEqual({ value: '0.00', unit: 'mi' });
    expect(walkedParts(100, 'imperial')).toEqual({ value: '0.06', unit: 'mi' }); // 328 ft: miles, never feet
    expect(walkedParts(16_100, 'imperial')).toEqual({ value: '10.0', unit: 'mi' });
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

describe('which country a place is in', () => {
  const { inMilesCountry } = require('../units');
  const cities: [string, number, number, boolean][] = [
    ['Washington, DC', 38.9072, -77.0369, true],
    ['New York', 40.7128, -74.006, true],
    ['Los Angeles', 34.0522, -118.2437, true],
    ['San Diego', 32.7157, -117.1611, true],
    ['Miami', 25.7617, -80.1918, true],
    ['Houston', 29.7604, -95.3698, true],
    ['El Paso', 31.7619, -106.485, true],
    ['Brownsville', 25.9, -97.5, true],
    ['Seattle', 47.6062, -122.3321, true],
    ['Anchorage', 61.2181, -149.9003, true],
    ['Honolulu', 21.3069, -157.8583, true],
    ['San Juan', 18.4655, -66.1057, true],
    ['Toronto', 43.6532, -79.3832, true],
    ['Vancouver', 49.2827, -123.1207, true],
    ['Montreal', 45.5017, -73.5673, true],
    ["St. John's", 47.5615, -52.7126, true],
    ['Yellowknife', 62.454, -114.3718, true],
    ['Mexico City', 19.4326, -99.1332, false],
    ['Monterrey', 25.6866, -100.3161, false],
    ['Ciudad Juarez', 31.7, -106.49, false],
    ['Matamoros', 25.85, -97.5, false],
    ['Havana', 23.1136, -82.3666, false],
    ['Bogota', 4.711, -74.0721, false],
    ['London', 51.5074, -0.1278, false],
    ['Reykjavik', 64.1466, -21.9426, false],
    ['Delhi', 28.6139, 77.209, false],
    ['Sydney', -33.8688, 151.2093, false],
  ];
  it.each(cities)('%s', (_name, lat, lon, expected) => {
    expect(inMilesCountry(lat, lon)).toBe(expected);
  });
});

describe('Automatic goes by where the phone is', () => {
  it('prefers the country over the phone region, and falls back to the region before it is located', () => {
    expect(resolveSystem('auto', 'IN', 'imperial')).toBe('imperial'); // a phone set to India, used in the US
    expect(resolveSystem('auto', 'US', 'metric')).toBe('metric'); // a US phone taken abroad
    expect(resolveSystem('auto', 'US', null)).toBe('imperial');
    expect(resolveSystem('auto', 'IN', null)).toBe('metric');
  });

  it('never overrides a choice made in Settings', () => {
    expect(resolveSystem('metric', 'US', 'imperial')).toBe('metric');
    expect(resolveSystem('imperial', 'DE', 'metric')).toBe('imperial');
  });

  it('is updated when the phone reports where it is', () => {
    const { useUnits: units } = require('../units');
    units.getState().setPreference('auto');
    units.getState().noteLocation(38.9072, -77.0369);
    expect(units.getState().place).toBe('imperial');
    units.getState().noteLocation(28.6139, 77.209);
    expect(units.getState().place).toBe('metric');
  });
});

describe('one setting everywhere', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { group, heightParts, formatQuantity, areaParts: area, walkedParts: walked } = require('../units');

  it('groups thousands', () => {
    expect(group(1234567)).toBe('1,234,567');
    expect(group('999')).toBe('999');
  });

  it('gives a height in metres or feet, never kilometres or miles', () => {
    expect(formatQuantity(heightParts(12_345, 'metric'))).toBe('12,350 m');
    expect(formatQuantity(heightParts(12_345, 'imperial'))).toBe('40,500 ft');
    expect(formatQuantity(heightParts(Number.NaN, 'metric'))).toBe('– m');
  });

  it('puts every measurement of the same setting in the same family of units', () => {
    const metricUnits = [walked(5000, 'metric').unit, area(2, 'metric').unit, distanceParts(5000, 'metric').unit, longDistanceParts(1000, 'metric').unit, heightParts(500, 'metric').unit];
    expect(metricUnits.every((u: string) => /^(m|km|m²|km²)$/.test(u))).toBe(true);
    const imperialUnits = [walked(5000, 'imperial').unit, area(2, 'imperial').unit, distanceParts(5000, 'imperial').unit, longDistanceParts(1000, 'imperial').unit, heightParts(500, 'imperial').unit];
    expect(imperialUnits.every((u: string) => /^(ft|mi|sq ft|mi²)$/.test(u))).toBe(true);
  });

  it('groups large areas and counts the same area the same way in each setting', () => {
    expect(area(1234.5, 'metric').value).toBe('1,235');
    expect(area(2589.988, 'imperial').value).toBe('1,000');
    expect(area(0.0123, 'metric').unit).toBe('km²');
  });
});
