const { withGradleProperties } = require('expo/config-plugins');

/**
 * Builds only for 64-bit ARM phones (the Seeker and nearly every phone made since 2017) when AZIMUTH_ARM64_ONLY is set, which
 * makes the APK much smaller. Without the variable the build covers every chip, so emulators still work.
 */
module.exports = function withArm64Only(config) {
  if (process.env.AZIMUTH_ARM64_ONLY !== '1') return config;
  return withGradleProperties(config, (c) => {
    const props = c.modResults.filter((p) => !(p.type === 'property' && p.key === 'reactNativeArchitectures'));
    props.push({ type: 'property', key: 'reactNativeArchitectures', value: 'arm64-v8a' });
    c.modResults = props;
    return c;
  });
};
