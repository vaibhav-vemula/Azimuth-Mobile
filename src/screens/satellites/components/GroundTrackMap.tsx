import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Image as SvgImage, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { footprintPolygon, footprintRadiusDeg } from '../../../data/propagation/passes';
import { Observer } from '../../../types/satellite';
import { colors } from '../../../theme';
import { LatLon, continuousTrack, fitViewport, graticuleStep, nearLongitude } from '../mapGeometry';

const EARTH = require('../../../../assets/earth-day.jpg');
const ASPECT = 4 / 3;

export interface MapMarker extends LatLon {
  label: string;
  color: string;
}

interface Props {
  observer: Observer;
  /** Wider ground track for context (before and after the pass). */
  contextTrack: LatLon[];
  /** The part of the track while the satellite is above the horizon. */
  passTrack: LatLon[];
  markers: MapMarker[];
  /** Current (or selected) satellite position with its altitude; drives the visibility footprint. */
  satellite: (LatLon & { altitudeKm: number }) | null;
  satelliteLabel: string;
}

function toPoints(points: LatLon[]): string {
  return points.map((p) => `${p.longitudeDeg.toFixed(3)},${(-p.latitudeDeg).toFixed(3)}`).join(' ');
}

function GroundTrackMapComponent({ observer, contextTrack, passTrack, markers, satellite, satelliteLabel }: Props) {
  const scene = useMemo(() => {
    const reference = observer.longitudeDeg;
    const context = continuousTrack(contextTrack, reference);
    const pass = continuousTrack(passTrack, reference);
    const observerPoint = { latitudeDeg: observer.latitudeDeg, longitudeDeg: reference };

    let footprint: LatLon[] = [];
    let satPoint: (LatLon & { altitudeKm: number }) | null = null;
    if (satellite) {
      const lon = nearLongitude(satellite.longitudeDeg, reference);
      satPoint = { ...satellite, longitudeDeg: lon };
      footprint = footprintPolygon(satellite.latitudeDeg, lon, footprintRadiusDeg(satellite.altitudeKm));
    }

    const placedMarkers = markers.map((m) => ({ ...m, longitudeDeg: nearLongitude(m.longitudeDeg, reference) }));
    const focus = [observerPoint, ...pass, ...placedMarkers, ...(satPoint ? [satPoint] : [])];
    const viewport = fitViewport(focus, ASPECT, { marginFactor: 1.5, minWidthDeg: 45 });
    return { context, pass, observerPoint, footprint, satPoint, placedMarkers, viewport };
  }, [observer, contextTrack, passTrack, markers, satellite]);

  const { viewport } = scene;
  const unit = viewport.width / 300; // one "pixel" of stroke at the current zoom
  const step = graticuleStep(viewport.width);

  const meridians: number[] = [];
  for (let lon = Math.ceil(viewport.x / step) * step; lon <= viewport.x + viewport.width; lon += step) meridians.push(lon);
  const parallels: number[] = [];
  for (let lat = Math.ceil(-(viewport.y + viewport.height) / step) * step; lat <= -viewport.y; lat += step) {
    if (lat >= -90 && lat <= 90) parallels.push(lat);
  }
  const tiles = [-540, -180, 180];

  return (
    <View style={styles.wrapper}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {tiles.map((x) => (
          <SvgImage key={x} href={EARTH} x={x} y={-90} width={360} height={180} preserveAspectRatio="none" />
        ))}
        <Rect x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} fill="rgba(5,7,13,0.42)" />

        {meridians.map((lon) => (
          <Line key={`m${lon}`} x1={lon} y1={viewport.y} x2={lon} y2={viewport.y + viewport.height} stroke="rgba(255,255,255,0.18)" strokeWidth={unit * 0.6} />
        ))}
        {parallels.map((lat) => (
          <Line key={`p${lat}`} x1={viewport.x} y1={-lat} x2={viewport.x + viewport.width} y2={-lat} stroke="rgba(255,255,255,0.18)" strokeWidth={unit * 0.6} />
        ))}

        {scene.footprint.length > 0 && (
          <Polygon
            points={toPoints(scene.footprint)}
            fill="rgba(77,208,225,0.14)"
            stroke={colors.accent}
            strokeWidth={unit * 1.1}
            strokeDasharray={`${unit * 5},${unit * 3}`}
          />
        )}

        {scene.context.length > 1 && (
          <Polyline points={toPoints(scene.context)} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={unit * 1.2} strokeDasharray={`${unit * 2},${unit * 3}`} />
        )}
        {scene.pass.length > 1 && (
          <Polyline points={toPoints(scene.pass)} fill="none" stroke={colors.accent} strokeWidth={unit * 2.6} strokeLinecap="round" strokeLinejoin="round" />
        )}

        {scene.placedMarkers.map((m) => (
          <G key={m.label}>
            <Circle cx={m.longitudeDeg} cy={-m.latitudeDeg} r={unit * 3.6} fill={m.color} stroke={colors.background} strokeWidth={unit * 1} />
            <SvgText x={m.longitudeDeg + unit * 6} y={-m.latitudeDeg + unit * 3.5} fontSize={unit * 10} fill={colors.textPrimary} fontWeight="700">
              {m.label}
            </SvgText>
          </G>
        ))}

        <G>
          <Circle cx={scene.observerPoint.longitudeDeg} cy={-scene.observerPoint.latitudeDeg} r={unit * 9} fill="rgba(255,183,77,0.18)" stroke={colors.warning} strokeWidth={unit * 1.2} />
          <Circle cx={scene.observerPoint.longitudeDeg} cy={-scene.observerPoint.latitudeDeg} r={unit * 3.2} fill={colors.warning} />
        </G>

        {scene.satPoint && (
          <G>
            <Circle cx={scene.satPoint.longitudeDeg} cy={-scene.satPoint.latitudeDeg} r={unit * 9} fill="rgba(255,255,255,0.18)" />
            <Circle cx={scene.satPoint.longitudeDeg} cy={-scene.satPoint.latitudeDeg} r={unit * 4.4} fill="#FFFFFF" stroke={colors.accent} strokeWidth={unit * 1.6} />
            <SvgText x={scene.satPoint.longitudeDeg + unit * 8} y={-scene.satPoint.latitudeDeg - unit * 8} fontSize={unit * 10.5} fill="#FFFFFF" fontWeight="700">
              {satelliteLabel}
            </SvgText>
          </G>
        )}
      </Svg>
    </View>
  );
}

export const GroundTrackMap = memo(GroundTrackMapComponent);

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    aspectRatio: ASPECT,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
});
