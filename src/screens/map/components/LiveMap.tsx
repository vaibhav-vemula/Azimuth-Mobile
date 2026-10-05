import { Ref, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Camera, GeoJSONSource, Images, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import type { CameraRef, StyleSpecification } from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { clearedBoundary, fogFeature } from '../../../mapping/fog';
import { VISION_RADIUS_M } from '../../../mapping/explore';
import { HEAT_RADIUS_M, circleRing, radiusForMetres } from '../../../mapping/signalLayer';
import type { FogStyle } from '../../../mapping/mappingStorage';
import type { LatLon } from '../../../mapping/hexGrid';
import { colors } from '../../../theme';
import type { Chest } from '../../../network/api';
import { CHEST_KIND } from '../../chests/chestInfo';

import { BASE_STYLE_URL, MAP_COLORS, loadThemedStyle } from '../mapStyle';

/** Free vector tiles, no key needed. Attribution is shown by the map as the licence asks. */
const START_ZOOM = 17;
/**
 * Unmapped ground is opaque, so nothing of the map shows through it: either a night sky of stars, or topographic
 * contour lines on dark ground. (The images are made by scripts/make-fog-textures.cjs.)
 */
const FOG_IMAGES = {
  'fog-sky': require('../../../../assets/fog-sky.png') as number,
  'fog-terrain': require('../../../../assets/fog-terrain.png') as number,
};
const FOG_DEEP = '#050A16';
/** Neon edge between mapped and unmapped ground. */
const RIM = '#7DF3FF';
const RIM_GLOW = '#2EE6FF';
const EDGE_FADE = [30, 22, 15, 9, 4];
const EDGE_GLOW = [22, 12, 6];

export type MapLoadState = 'loading' | 'ready' | 'failed';

export interface LiveMapHandle {
  /** Move the camera back to the user and follow them again. */
  recenter: () => void;
  /** Show the user and a place together. */
  showBoth: (target: LatLon) => void;
}

export interface MapChest {
  chest: Chest;
  position: LatLon;
}

interface Props {
  position: LatLon | null;
  headingDeg: number | null;
  /** Fog-grid cells cleared so far. */
  explored: ReadonlySet<string>;
  chests: MapChest[];
  nearestId: string | null;
  /** Points tinted by measured signal, drawn as soft glows on mapped ground. */
  signal: GeoJSON.FeatureCollection<GeoJSON.Point>;
  fogStyle: FogStyle;
  /** Show the ring that marks how far you clear the fog around you: only while mapping. */
  showVision: boolean;
  following: boolean;
  onFollowingChange: (following: boolean) => void;
  onChestPress: (chest: Chest) => void;
  onLoadState: (state: MapLoadState) => void;
  ref?: Ref<LiveMapHandle>;
}

const lngLat = (p: LatLon): [number, number] => [p.longitudeDeg, p.latitudeDeg];

/**
 * The home map: a real street map under a layer of fog. Ground you have walked is cleared, with a soft edge where
 * the fog begins. Chests sit on top; 
 */
export function LiveMap({ position, headingDeg, explored, chests, nearestId, signal, fogStyle, showVision, following, onFollowingChange, onChestPress, onLoadState, ref }: Props) {
  const camera = useRef<CameraRef>(null);
  const firstFix = useRef(true);
  const mapStyle = useMapStyle(onLoadState);

  const fog = useMemo(() => fogFeature(explored), [explored]);
  const edge = useMemo(() => clearedBoundary(explored), [explored]);
  const vision = useMemo<GeoJSON.Feature<GeoJSON.LineString> | null>(
    () => (position ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: circleRing(position, VISION_RADIUS_M) } } : null),
    [position]
  );
  useImperativeHandle(
    ref,
    () => ({
      recenter: () => {
        if (!position) return;
        onFollowingChange(true);
        camera.current?.flyTo({ center: lngLat(position), zoom: START_ZOOM, duration: 700 });
      },
      showBoth: (target) => {
        if (!position) return;
        onFollowingChange(false);
        const lons = [position.longitudeDeg, target.longitudeDeg];
        const lats = [position.latitudeDeg, target.latitudeDeg];
        camera.current?.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], {
          padding: { top: 150, bottom: 320, left: 70, right: 70 },
          duration: 700,
        });
      },
    }),
    [position, onFollowingChange]
  );

  // Fly to the first fix, then keep the user centred while following.
  useEffect(() => {
    if (!position) return;
    if (firstFix.current) {
      firstFix.current = false;
      camera.current?.flyTo({ center: lngLat(position), zoom: START_ZOOM, duration: 900 });
    } else if (following) {
      camera.current?.easeTo({ center: lngLat(position), duration: 500 });
    }
  }, [position, following]);

  // Until the themed style is ready, show the map colour instead of an empty screen.
  if (!mapStyle) return <View style={[styles.fill, { backgroundColor: MAP_COLORS.land }]} />;

  return (
    <View style={styles.fill}>
      <Map
        style={styles.map}
        mapStyle={mapStyle}
        logo={false}
        compass
        compassPosition={{ top: 132, right: 14 }}
        attribution
        attributionPosition={{ bottom: 6, left: 8 }}
        onDidFinishLoadingMap={() => onLoadState('ready')}
        onDidFailLoadingMap={() => onLoadState('failed')}
        onRegionDidChange={(e) => {
          if (e.nativeEvent.userInteraction) onFollowingChange(false);
        }}
      >
        <Camera ref={camera} initialViewState={{ center: position ? lngLat(position) : [-77.0369, 38.9072], zoom: position ? START_ZOOM : 12 }} />

        <Images images={FOG_IMAGES} />

        {/* Signal map: soft glowing blobs where you measured, tinted by what the phone found, so a walk becomes a
            heat trail. Under the fog, so it only shows on mapped ground. */}
        <GeoJSONSource id="signal" data={signal}>
          <Layer
            id="signal-glow"
            type="circle"
            paint={{
              'circle-color': ['get', 'color'],
              'circle-radius': radiusForMetres(HEAT_RADIUS_M, position?.latitudeDeg ?? 38.9) as never,
              'circle-blur': 0.85,
              'circle-opacity': 0.8,
            }}
          />
        </GeoJSONSource>

        {/* Unmapped ground. Opaque, so the map is hidden everywhere you have not walked. */}
        <GeoJSONSource id="fog" data={fog}>
          <Layer id="fog-fill" type="fill" paint={{ 'fill-pattern': `fog-${fogStyle}`, 'fill-opacity': 1 }} />
        </GeoJSONSource>

        {/* The edge of mapped ground: it fades in over a few steps (several translucent lines of growing width, which
            avoids the streaks a blur setting leaves on thick lines), then a neon glow and a thin bright line. */}
        <GeoJSONSource id="edge" data={edge}>
          {EDGE_FADE.map((width) => (
            <Layer key={width} id={`edge-fade-${width}`} type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': FOG_DEEP, 'line-width': width, 'line-opacity': 0.3 }} />
          ))}
          {EDGE_GLOW.map((width, i) => (
            <Layer key={width} id={`edge-glow-${width}`} type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': RIM_GLOW, 'line-width': width, 'line-opacity': [0.05, 0.09, 0.16][i] }} />
          ))}
          <Layer id="edge-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': RIM, 'line-width': 1.6, 'line-opacity': 0.95 }} />
        </GeoJSONSource>

        {/* How far you can see: a faint dashed ring around you. */}
        {vision && showVision ? (
          <GeoJSONSource id="vision" data={vision}>
            <Layer id="vision-ring" type="line" paint={{ 'line-color': RIM, 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [2, 3] }} />
          </GeoJSONSource>
        ) : null}

        {chests.map(({ chest, position: at }) => (
          <Marker key={chest.id} id={`chest-${chest.id}`} lngLat={lngLat(at)} onPress={() => onChestPress(chest)}>
            <ChestPin chest={chest} nearest={chest.id === nearestId} />
          </Marker>
        ))}

        {position ? (
          <Marker id="me" lngLat={lngLat(position)} anchor="center">
            <MeMarker headingDeg={headingDeg} />
          </Marker>
        ) : null}
      </Map>
    </View>
  );
}

/**
 * The themed map style, or null while it downloads. If it cannot be downloaded, the plain base style URL is used so the
 * map still appears, just in the base colours.
 */
function useMapStyle(onLoadState: (s: MapLoadState) => void): string | StyleSpecification | null {
  const [style, setStyle] = useState<string | StyleSpecification | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadThemedStyle()
      .then((s) => !cancelled && setStyle(s as unknown as StyleSpecification))
      .catch(() => !cancelled && setStyle(BASE_STYLE_URL));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (style === null) onLoadState('loading');
  }, [style, onLoadState]);
  return style;
}

/** A glowing pin for a chest. The nearest one is larger and pulses so it is easy to find. */
function ChestPin({ chest, nearest }: { chest: Chest; nearest: boolean }) {
  const kind = CHEST_KIND[chest.kind];
  const pulse = usePulse(nearest);
  const size = nearest ? 46 : 36;
  return (
    <View style={styles.pinWrap}>
      {nearest ? <Animated.View style={[styles.pinPulse, { backgroundColor: kind.color, opacity: pulse.opacity, transform: [{ scale: pulse.scale }] }]} /> : null}
      <View style={[styles.pin, { width: size, height: size, borderRadius: size / 2, borderColor: kind.color, backgroundColor: nearest ? kind.color : 'rgba(11,15,26,0.94)' }]}>
        <Ionicons name="cube" size={nearest ? 22 : 17} color={nearest ? colors.background : kind.color} />
      </View>
      {nearest ? (
        <View style={[styles.pinTag, { borderColor: kind.color }]}>
          <Text style={styles.pinTagText}>{chest.rewardUsdc} USDC</Text>
        </View>
      ) : null}
    </View>
  );
}

/** You: a dot with a soft pulsing ring, and a cone showing which way the phone faces. */
function MeMarker({ headingDeg }: { headingDeg: number | null }) {
  const pulse = usePulse(true);
  return (
    <View style={styles.meWrap} pointerEvents="none">
      <Animated.View style={[styles.mePulse, { opacity: pulse.opacity, transform: [{ scale: pulse.scale }] }]} />
      {headingDeg !== null ? (
        <View style={[styles.cone, { transform: [{ rotate: `${headingDeg}deg` }] }]}>
          <Ionicons name="caret-up" size={26} color={colors.accent} style={styles.coneIcon} />
        </View>
      ) : null}
      <View style={styles.meDot} />
    </View>
  );
}

function usePulse(active: boolean) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [active, t]);
  return {
    scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }),
    opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.45, 0] }),
  };
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  map: { flex: 1 },
  pinWrap: { width: 72, height: 80, alignItems: 'center', justifyContent: 'center' },
  pinPulse: { position: 'absolute', width: 46, height: 46, borderRadius: 23 },
  pin: { borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
  pinTag: { marginTop: 4, borderWidth: 1, borderRadius: 999, backgroundColor: 'rgba(11,15,26,0.95)', paddingHorizontal: 8, paddingVertical: 2 },
  pinTagText: { fontSize: 11, color: colors.textPrimary, fontFamily: 'SpaceGrotesk_500Medium' },
  meWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  mePulse: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent },
  meDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, borderWidth: 3.5, borderColor: '#fff', shadowColor: colors.accent, shadowOpacity: 0.9, shadowRadius: 8, elevation: 8 },
  cone: { position: 'absolute', width: 64, height: 64, alignItems: 'center' },
  coneIcon: { marginTop: -4 },
});
