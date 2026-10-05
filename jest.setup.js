// The native signal scanner does not exist under Jest; screens that import it get this stand-in.
jest.mock('./modules/signal-scan/src/SignalScanModule', () => ({
  __esModule: true,
  default: {
    getCapabilities: jest.fn(async () => ({ telephony: true, wifi: true, bluetoothLe: true, sdk: 34, model: 'Test phone' })),
    startMapping: jest.fn(async () => undefined),
    stopMapping: jest.fn(async () => undefined),
    startOrientation: jest.fn(async () => undefined),
    stopOrientation: jest.fn(async () => undefined),
    addListener: jest.fn(() => ({ remove: () => undefined })),
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

// Camera and GL are native; AR screens get plain stand-ins under Jest.
jest.mock('expo-camera', () => {
  const React = require('react');
  return {
    CameraView: ({ children }) => React.createElement(React.Fragment, null, children),
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn(async () => ({ granted: true }))],
  };
});
jest.mock('expo-gl', () => {
  const React = require('react');
  return { GLView: () => React.createElement(React.Fragment, null) };
});

// Playing audio needs the phone's media player; tests use a stand-in that records what it was asked to do.
jest.mock('expo-audio', () => {
  const players = [];
  return {
    __players: players,
    setAudioModeAsync: jest.fn(async () => undefined),
    createAudioPlayer: jest.fn((source) => {
      const listeners = [];
      const p = {
        source,
        volume: 1,
        playing: false,
        removed: false,
        play: jest.fn(function () { p.playing = true; }),
        pause: jest.fn(function () { p.playing = false; }),
        remove: jest.fn(function () { p.removed = true; }),
        addListener: jest.fn((event, fn) => { listeners.push(fn); return { remove: jest.fn() }; }),
        emit: (status) => listeners.forEach((fn) => fn(status)),
      };
      players.push(p);
      return p;
    }),
  };
});
