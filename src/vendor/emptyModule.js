// Stand-in for satellite.js's optional WebAssembly API (src/wasm), which needs Node built-ins that
// React Native does not have. Azimuth only uses the pure-JavaScript SGP4 functions.
module.exports = {};
