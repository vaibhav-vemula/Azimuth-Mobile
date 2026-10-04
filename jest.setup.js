// The native signal scanner does not exist under Jest; screens that import it get this stand-in.
jest.mock('./modules/signal-scan/src/SignalScanModule', () => ({
  __esModule: true,
  default: {
    getCapabilities: jest.fn(async () => ({ telephony: true, wifi: true, bluetoothLe: true, sdk: 34, model: 'Test phone' })),
    startMapping: jest.fn(async () => undefined),
    stopMapping: jest.fn(async () => undefined),
    scan: jest.fn(async () => ({
      atMs: Date.now(),
      cellular: { available: true, cells: [] },
      wifi: { available: true, count: 0 },
      bluetooth: null,
      gnss: {},
    })),
  },
}));

// The wallet adapter pulls in ES-module-only Solana packages that Jest cannot load; tests that exercise the
// wallet mock it themselves with the behaviour they need.
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol-web3js', () => ({
  transact: jest.fn(async () => {
    throw new Error('transact is not available under Jest');
  }),
}));

// The native map has no JavaScript implementation; screens that import it get plain stand-ins.
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const stub = (name) => {
    const C = ({ children }) => React.createElement(React.Fragment, null, children);
    C.displayName = name;
    return C;
  };
  return {
    Map: stub('Map'),
    Camera: stub('Camera'),
    GeoJSONSource: stub('GeoJSONSource'),
    Layer: stub('Layer'),
    Marker: stub('Marker'),
  };
});
