const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const emptyModule = path.resolve(__dirname, 'src/vendor/emptyModule.js');
const upstreamResolve = config.resolver.resolveRequest;

// satellite.js re-exports an optional WebAssembly API whose loader imports `node:module`.
// Metro cannot resolve that, and the app only needs the plain JS propagator, so that one
// re-export is replaced with an empty module.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = (context.originModulePath || '').replace(/\\/g, '/');
  if (origin.includes('/node_modules/satellite.js/dist/') && /(^|\/)wasm(\/index\.js)?$/.test(moduleName)) {
    return { type: 'sourceFile', filePath: emptyModule };
  }
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
