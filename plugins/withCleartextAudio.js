const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Many internet radio stations only offer plain http streams, and Android blocks those unless the app allows it. This turns
 * that on. Everything else Azimuth talks to (the database, the map, the wallet) uses https.
 */
module.exports = function withCleartextAudio(config) {
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return c;
  });
};
