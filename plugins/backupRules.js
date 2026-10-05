/**
 * The Android backup rules for Azimuth: which files Google's automatic backup (and a phone-to-phone transfer) may copy.
 * Only the map progress is included: the fog, the visited cells and the signal map, kept by MMKV in files/mmkv under the
 * name "azimuth-mapping". Everything else is left out on purpose, in particular the wallet session and the backup key
 * (stored under other names), so they never travel with the backup.
 */
const PROGRESS_FILES = ['mmkv/azimuth-mapping', 'mmkv/azimuth-mapping.crc'];

const includes = (indent) => PROGRESS_FILES.map((path) => `${indent}<include domain="file" path="${path}" />`).join('\n');

/** Android 11 and older: res/xml/azimuth_backup_rules.xml, named by android:fullBackupContent. */
function fullBackupContentXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${includes('  ')}
</full-backup-content>
`;
}

/** Android 12 and newer: res/xml/azimuth_data_extraction_rules.xml, named by android:dataExtractionRules. */
function dataExtractionRulesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${includes('    ')}
  </cloud-backup>
  <device-transfer>
${includes('    ')}
  </device-transfer>
</data-extraction-rules>
`;
}

module.exports = { PROGRESS_FILES, fullBackupContentXml, dataExtractionRulesXml };
