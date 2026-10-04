/**
 * The base map is OpenFreeMap's "dark" style, which is nearly black: buildings are darker than the ground and roads
 * are #181818, so under fog it reads as an empty screen. This recolours it into a readable night-navy map: blue
 * water, teal parks, clearly visible roads and soft labels. Layers that are not in the style are skipped, so a
 * future change to the base style cannot break the map.
 */
export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export const MAP_COLORS = {
  land: '#172B57',
  residential: '#172B58',
  park: '#14483F',
  water: '#1D5FA3',
  building: '#223F7C',
  buildingEdge: '#33619F',
  pathRoad: '#3F68AA',
  minorRoad: '#5C86CC',
  majorRoadCasing: '#274A86',
  majorRoad: '#86ADEC',
  motorwayCasing: '#2E5594',
  motorway: '#BBD6FF',
  railway: '#3A5C98',
  boundary: '#4A70AE',
  label: '#C2D4F2',
  placeLabel: '#DCE7FA',
  roadLabel: '#9DB8E2',
  waterLabel: '#7DB1EE',
  halo: '#172B57',
} as const;

type Paint = Record<string, unknown>;
type Layer = { id: string; type: string; paint?: Paint; layout?: Paint; [key: string]: unknown };
export type StyleJson = { layers: Layer[]; [key: string]: unknown };

const C = MAP_COLORS;

/** Paint changes by layer id. */
const PAINT: Record<string, Paint> = {
  background: { 'background-color': C.land },
  water: { 'fill-color': C.water },
  waterway: { 'line-color': C.water },
  landcover_ice_shelf: { 'fill-color': C.land },
  landcover_glacier: { 'fill-color': '#12213F' },
  landuse_residential: { 'fill-color': C.residential },
  landcover_wood: { 'fill-color': C.park },
  landuse_park: { 'fill-color': C.park },
  building: { 'fill-color': C.building, 'fill-outline-color': C.buildingEdge },
  'aeroway-taxiway': { 'line-color': C.minorRoad },
  'aeroway-runway-casing': { 'line-color': C.majorRoadCasing },
  'aeroway-area': { 'fill-color': '#12213F' },
  'aeroway-runway': { 'line-color': C.majorRoad },
  road_area_pier: { 'fill-color': C.land },
  road_pier: { 'line-color': C.land },
  highway_path: { 'line-color': C.pathRoad, 'line-opacity': 0.55 },
  highway_minor: { 'line-color': C.minorRoad },
  highway_major_casing: { 'line-color': C.majorRoadCasing },
  highway_major_inner: { 'line-color': C.majorRoad },
  highway_major_subtle: { 'line-color': C.minorRoad },
  highway_motorway_casing: { 'line-color': C.motorwayCasing },
  highway_motorway_inner: { 'line-color': C.motorway },
  highway_motorway_subtle: { 'line-color': C.minorRoad },
  railway_transit: { 'line-color': C.railway },
  railway_transit_dashline: { 'line-color': C.land },
  railway_minor: { 'line-color': C.railway },
  railway_minor_dashline: { 'line-color': C.land },
  railway: { 'line-color': C.railway },
  railway_dashline: { 'line-color': C.land },
  boundary_state: { 'line-color': C.boundary },
  'boundary_country_z0-4': { 'line-color': C.boundary },
  'boundary_country_z5-': { 'line-color': C.boundary },
  water_name: { 'text-color': C.waterLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
  highway_name_other: { 'text-color': C.roadLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
  highway_name_motorway: { 'text-color': C.roadLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
};

const PLACE = /^place_/;

/** Returns a recoloured copy. The input is not changed. */
export function themeStyle<T extends StyleJson>(base: T): T {
  const layers = base.layers.map((layer) => {
    const patch = PAINT[layer.id] ?? (PLACE.test(layer.id) && layer.type === 'symbol' ? { 'text-color': C.placeLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } : null);
    if (!patch) return layer;
    return { ...layer, paint: { ...(layer.paint ?? {}), ...patch } };
  });
  return { ...base, layers };
}

let cached: StyleJson | null = null;

/** Downloads and themes the base style once per run. Rejects if the style cannot be fetched. */
export async function loadThemedStyle(fetchImpl: typeof fetch = fetch): Promise<StyleJson> {
  if (cached) return cached;
  const res = await fetchImpl(BASE_STYLE_URL);
  if (!res.ok) throw new Error(`Map style answered HTTP ${res.status}`);
  const json = (await res.json()) as StyleJson;
  if (!Array.isArray(json.layers)) throw new Error('Map style is not valid');
  cached = themeStyle(json);
  return cached;
}

/** Test hook. */
export function resetStyleCache() {
  cached = null;
}
