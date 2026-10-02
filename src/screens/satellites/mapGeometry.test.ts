import { continuousTrack, fitViewport, graticuleStep, nearLongitude } from './mapGeometry';

describe('map geometry', () => {
  it('shifts longitudes to sit near a reference', () => {
    expect(nearLongitude(-179, 179)).toBe(181);
    expect(nearLongitude(179, -179)).toBe(-181);
    expect(nearLongitude(10, 20)).toBe(10);
  });

  it('keeps a track continuous across the antimeridian in the observer frame', () => {
    const track = continuousTrack(
      [
        { latitudeDeg: 0, longitudeDeg: 170 },
        { latitudeDeg: 1, longitudeDeg: 179 },
        { latitudeDeg: 2, longitudeDeg: -178 },
        { latitudeDeg: 3, longitudeDeg: -170 },
      ],
      175
    );
    expect(track.map((p) => p.longitudeDeg)).toEqual([170, 179, 182, 190]);
    expect(continuousTrack([], 0)).toEqual([]);
  });

  it('frames all points with margin at the requested aspect ratio', () => {
    const points = [
      { latitudeDeg: 30, longitudeDeg: -100 },
      { latitudeDeg: 50, longitudeDeg: -60 },
    ];
    const view = fitViewport(points, 4 / 3);
    expect(view.width / view.height).toBeCloseTo(4 / 3, 6);
    for (const p of points) {
      expect(p.longitudeDeg).toBeGreaterThan(view.x);
      expect(p.longitudeDeg).toBeLessThan(view.x + view.width);
      expect(-p.latitudeDeg).toBeGreaterThan(view.y);
      expect(-p.latitudeDeg).toBeLessThan(view.y + view.height);
    }
  });

  it('never zooms in past the minimum width and never wider than the whole world', () => {
    expect(fitViewport([{ latitudeDeg: 10, longitudeDeg: 10 }], 1.5, { minWidthDeg: 40 }).width).toBe(40);
    expect(fitViewport([{ latitudeDeg: 0, longitudeDeg: -179 }, { latitudeDeg: 0, longitudeDeg: 179 }], 1.5).width).toBe(360);
  });

  it('keeps the window vertically on the globe', () => {
    const view = fitViewport([{ latitudeDeg: 88, longitudeDeg: 0 }, { latitudeDeg: 89, longitudeDeg: 5 }], 1.5, { minWidthDeg: 60 });
    expect(view.y).toBeGreaterThanOrEqual(-90);
  });

  it('picks sensible graticule spacing', () => {
    expect(graticuleStep(360)).toBe(30);
    expect(graticuleStep(120)).toBe(15);
    expect(graticuleStep(60)).toBe(10);
    expect(graticuleStep(30)).toBe(5);
  });
});
