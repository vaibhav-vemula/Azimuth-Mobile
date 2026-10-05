const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { dataExtractionRulesXml, fullBackupContentXml } = require('./backupRules');

/** Turns on Android's automatic backup for the map progress only (see backupRules.js). The android folder is generated, so this is where it is defined. */
module.exports = function withAzimuthBackup(config) {
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:allowBackup'] = 'true';
      app.$['android:fullBackupContent'] = '@xml/azimuth_backup_rules';
      app.$['android:dataExtractionRules'] = '@xml/azimuth_data_extraction_rules';
    }
    return c;
  });
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'azimuth_backup_rules.xml'), fullBackupContentXml());
      fs.writeFileSync(path.join(dir, 'azimuth_data_extraction_rules.xml'), dataExtractionRulesXml());
      return c;
    },
  ]);
};
