import { cellIdAt } from '../hexGrid';
// The requester console computes cell ids in the browser with its own copy of the grid maths.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const consoleHex = require('../../../server/public/hex.js') as { cellIdAt: (lat: number, lon: number, size?: number) => string };

describe('requester console hex grid', () => {
  const places: [number, number][] = [
    [38.9072, -77.0369], [0, 0], [-33.8688, 151.2093], [51.5074, -0.1278], [64.1466, -21.9426],
    [-54.8, -68.3], [35.6762, 139.6503], [40.7128, -74.006], [38.90721, -77.03691], [-0.0001, -0.0001],
  ];
  it.each(places)('matches the app for %p, %p', (lat, lon) => {
    expect(consoleHex.cellIdAt(lat, lon)).toBe(cellIdAt({ latitudeDeg: lat, longitudeDeg: lon }));
  });

  it('matches across a grid of random points', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = 0; i < 500; i++) {
      const lat = rnd() * 140 - 70;
      const lon = rnd() * 360 - 180;
      expect(consoleHex.cellIdAt(lat, lon)).toBe(cellIdAt({ latitudeDeg: lat, longitudeDeg: lon }));
    }
  });
});
