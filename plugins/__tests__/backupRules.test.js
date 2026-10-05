const { PROGRESS_FILES, dataExtractionRulesXml, fullBackupContentXml } = require('../backupRules');

describe('Android backup rules', () => {
  it('include the map progress files, both the data and its checksum', () => {
    expect(PROGRESS_FILES).toEqual(['mmkv/azimuth-mapping', 'mmkv/azimuth-mapping.crc']);
  });

  it('use an allow-list: only those files, and never the wallet session or the backup key', () => {
    for (const xml of [fullBackupContentXml(), dataExtractionRulesXml()]) {
      expect(xml).toContain('path="mmkv/azimuth-mapping"');
      expect(xml).toContain('path="mmkv/azimuth-mapping.crc"');
      expect(xml).not.toMatch(/azimuth-wallet|azimuth-backup|domain="sharedpref"|domain="root"/);
      expect(xml).not.toContain('<exclude');
    }
  });

  it('cover both cloud backup and phone-to-phone transfer on Android 12+', () => {
    const xml = dataExtractionRulesXml();
    expect(xml).toContain('<cloud-backup>');
    expect(xml).toContain('<device-transfer>');
  });

  it('are well-formed', () => {
    for (const xml of [fullBackupContentXml(), dataExtractionRulesXml()]) {
      expect(xml.startsWith('<?xml')).toBe(true);
      const open = (xml.match(/<(?!\?|\/)[a-z-]+[^>]*[^/]>/g) ?? []).length;
      const close = (xml.match(/<\/[a-z-]+>/g) ?? []).length;
      expect(open).toBe(close);
    }
  });
});
