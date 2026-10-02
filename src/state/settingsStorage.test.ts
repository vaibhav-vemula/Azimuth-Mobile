import { SettingsStorage, defaultSettings } from './settingsStorage';

describe('SettingsStorage', () => {
  it('returns defaults, including a frequency for every monitored satellite', () => {
    const settings = SettingsStorage.load();
    expect(settings).toEqual(defaultSettings());
    expect(Object.keys(settings.frequencyHzBySatellite).sort()).toEqual(['57166', '59051']);
    expect(settings.minElevationDeg).toBe(15);
  });

  it('round-trips changes and keeps defaults for fields added later', () => {
    const settings = SettingsStorage.load();
    SettingsStorage.save({ ...settings, minElevationDeg: 25, biasTee: true });
    const reloaded = SettingsStorage.load();
    expect(reloaded.minElevationDeg).toBe(25);
    expect(reloaded.biasTee).toBe(true);
    expect(reloaded.frequencyHzBySatellite['59051']).toBe(137_900_000);
  });

  it('persists and restores a location', () => {
    expect(SettingsStorage.loadLocation()).toBeNull();
    SettingsStorage.saveLocation({ latitudeDeg: 38.9, longitudeDeg: -77, heightKm: 0.05, manual: false });
    expect(SettingsStorage.loadLocation()).toEqual({ latitudeDeg: 38.9, longitudeDeg: -77, heightKm: 0.05, manual: false });
  });
});
