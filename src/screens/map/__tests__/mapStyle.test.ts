import { MAP_COLORS, BASE_STYLE_URL, loadThemedStyle, resetStyleCache, themeStyle } from '../mapStyle';

const base = () => ({
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'x' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': 'rgb(12,12,12)' } },
    { id: 'building', type: 'fill', paint: { 'fill-color': 'rgb(10,10,10)', 'fill-opacity': 0.5 } },
    { id: 'highway_motorway_inner', type: 'line', paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5, 'red', 6, 'blue'] } },
    { id: 'place_city', type: 'symbol', paint: { 'text-color': 'rgb(101,101,101)' }, layout: { 'text-field': '{name}' } },
    { id: 'something_new', type: 'fill', paint: { 'fill-color': 'rgb(1,2,3)' } },
  ],
});

describe('map theme', () => {
  it('recolours known layers and keeps their other settings', () => {
    const out = themeStyle(base());
    const byId = Object.fromEntries(out.layers.map((l) => [l.id, l]));
    expect(byId.background.paint?.['background-color']).toBe(MAP_COLORS.land);
    expect(byId.building.paint?.['fill-color']).toBe(MAP_COLORS.building);
    expect(byId.building.paint?.['fill-opacity']).toBe(0.5);
    expect(byId.highway_motorway_inner.paint?.['line-color']).toBe(MAP_COLORS.motorway);
    expect(byId.place_city.paint?.['text-color']).toBe(MAP_COLORS.placeLabel);
    expect(byId.place_city.layout).toEqual({ 'text-field': '{name}' });
  });

  it('leaves layers it does not know alone, and does not change its input', () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    const out = themeStyle(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out.layers.find((l) => l.id === 'something_new')?.paint).toEqual({ 'fill-color': 'rgb(1,2,3)' });
    expect(out.sources).toEqual(input.sources);
  });

  it('makes buildings and roads brighter than the ground, which the base style did not', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    expect(lum(MAP_COLORS.building)).toBeGreaterThan(lum(MAP_COLORS.land));
    expect(lum(MAP_COLORS.minorRoad)).toBeGreaterThan(lum(MAP_COLORS.land) * 2);
    expect(lum(MAP_COLORS.motorway)).toBeGreaterThan(lum(MAP_COLORS.minorRoad));
    expect(lum(MAP_COLORS.water)).toBeGreaterThan(lum(MAP_COLORS.land));
  });

  it('fetches once, themes it, and reports bad answers', async () => {
    resetStyleCache();
    const ok = jest.fn(async () => ({ ok: true, json: async () => base() })) as unknown as typeof fetch;
    const a = await loadThemedStyle(ok);
    const b = await loadThemedStyle(ok);
    expect(a).toBe(b);
    expect(ok).toHaveBeenCalledTimes(1);
    expect((ok as unknown as jest.Mock).mock.calls[0][0]).toBe(BASE_STYLE_URL);

    resetStyleCache();
    await expect(loadThemedStyle((async () => ({ ok: false, status: 503 })) as unknown as typeof fetch)).rejects.toThrow('503');
    await expect(loadThemedStyle((async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch)).rejects.toThrow('not valid');
    resetStyleCache();
  });
});
