import { chooseHeading, courseFrom, onTurnedMap, useHeadingStore } from '../headingStore';

describe('direction of travel', () => {
  it('is only taken from a moving fix that has a direction', () => {
    expect(courseFrom(1.5, 90, 1000)).toEqual({ deg: 90, atMs: 1000 });
    expect(courseFrom(0.4, 90, 1000)).toBeNull(); // standing or shuffling: GPS direction is noise
    expect(courseFrom(2, -1, 1000)).toBeNull(); // the phone had no direction
    expect(courseFrom(null, 90, 1000)).toBeNull();
    expect(courseFrom(2, NaN, 1000)).toBeNull();
  });

  it('replaces the compass while fresh, and gives way to it afterwards', () => {
    const course = { deg: 200, atMs: 10_000 };
    expect(chooseHeading(15, course, 12_000)).toBe(200);
    expect(chooseHeading(15, course, 14_001)).toBe(15);
    expect(chooseHeading(15, null, 12_000)).toBe(15);
    expect(chooseHeading(null, null, 12_000)).toBeNull();
  });
});

describe('a turned map', () => {
  it('turns the beam back by the map bearing, staying within 0 to 360', () => {
    expect(onTurnedMap(90, 0)).toBe(90);
    expect(onTurnedMap(90, 90)).toBe(0); // map turned so east is up: facing east points up
    expect(onTurnedMap(10, 30)).toBe(340);
    expect(onTurnedMap(350, -20)).toBe(10);
  });

  it('keeps the map bearing in the store, ignoring tiny changes', () => {
    useHeadingStore.setState({ mapBearing: 0 });
    useHeadingStore.getState().setMapBearing(0.4);
    expect(useHeadingStore.getState().mapBearing).toBe(0);
    useHeadingStore.getState().setMapBearing(45);
    expect(useHeadingStore.getState().mapBearing).toBe(45);
    useHeadingStore.getState().setMapBearing(NaN);
    expect(useHeadingStore.getState().mapBearing).toBe(0);
  });
});
