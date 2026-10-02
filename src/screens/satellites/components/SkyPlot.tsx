import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { TrackPoint } from '../../../types/satellite';
import { colors } from '../../../theme';
import { polarPoint } from '../skyGeometry';

interface Props {
  track: TrackPoint[];
  /** The current look direction, when the satellite is above the horizon. */
  current: { azimuthDeg: number; elevationDeg: number } | null;
  minElevationDeg: number;
  size?: number;
}

const PADDING = 26;

function SkyPlotComponent({ track, current, minElevationDeg, size = 300 }: Props) {
  const radius = size / 2 - PADDING;
  const c = size / 2;

  const geometry = useMemo(() => {
    const points = track.map((t) => polarPoint(t.azimuthDeg, t.elevationDeg, radius, c, c));
    let peak = 0;
    for (let i = 1; i < track.length; i += 1) if (track[i].elevationDeg > track[peak].elevationDeg) peak = i;
    return {
      path: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
      start: points[0],
      end: points[points.length - 1],
      peak: points[peak],
    };
  }, [track, radius, c]);

  const rings = [0, 30, 60];
  const spokes = [0, 45, 90, 135, 180, 225, 270, 315];
  const currentPoint = current ? polarPoint(current.azimuthDeg, current.elevationDeg, radius, c, c) : null;
  const mask = minElevationDeg > 0 ? ((90 - minElevationDeg) / 90) * radius : null;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size}>
        {spokes.map((az) => {
          const p = polarPoint(az, 0, radius, c, c);
          return <Line key={az} x1={c} y1={c} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />;
        })}
        {rings.map((el) => (
          <G key={el}>
            <Circle cx={c} cy={c} r={((90 - el) / 90) * radius} fill={el === 0 ? 'rgba(255,255,255,0.03)' : 'none'} stroke="rgba(255,255,255,0.22)" strokeWidth={el === 0 ? 1.5 : 1} />
            {el > 0 && (
              <SvgText x={c + 3} y={c - ((90 - el) / 90) * radius - 3} fontSize={9} fill={colors.textTertiary}>
                {el}°
              </SvgText>
            )}
          </G>
        ))}
        {mask !== null && (
          <Circle cx={c} cy={c} r={mask} fill="none" stroke={colors.warning} strokeWidth={1} strokeDasharray="4,4" opacity={0.7} />
        )}

        {(
          [
            ['N', 0],
            ['E', 90],
            ['S', 180],
            ['W', 270],
          ] as const
        ).map(([label, az]) => {
          const p = polarPoint(az, 0, radius + 15, c, c);
          return (
            <SvgText key={label} x={p.x} y={p.y + 4} fontSize={13} fontWeight="700" fill={label === 'N' ? colors.accent : colors.textSecondary} textAnchor="middle">
              {label}
            </SvgText>
          );
        })}

        {track.length > 1 && (
          <>
            <Polyline points={geometry.path} fill="none" stroke={colors.accent} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={geometry.start.x} cy={geometry.start.y} r={5.5} fill={colors.success} stroke={colors.background} strokeWidth={1.5} />
            <SvgText x={geometry.start.x} y={geometry.start.y - 9} fontSize={10} fontWeight="700" fill={colors.success} textAnchor="middle">
              AOS
            </SvgText>
            <Circle cx={geometry.end.x} cy={geometry.end.y} r={5.5} fill={colors.record} stroke={colors.background} strokeWidth={1.5} />
            <SvgText x={geometry.end.x} y={geometry.end.y - 9} fontSize={10} fontWeight="700" fill={colors.record} textAnchor="middle">
              LOS
            </SvgText>
            <Circle cx={geometry.peak.x} cy={geometry.peak.y} r={4} fill="#FFFFFF" stroke={colors.accent} strokeWidth={1.5} />
          </>
        )}

        {currentPoint && (
          <G>
            <Circle cx={currentPoint.x} cy={currentPoint.y} r={11} fill="rgba(255,255,255,0.2)" />
            <Circle cx={currentPoint.x} cy={currentPoint.y} r={5.5} fill="#FFFFFF" stroke={colors.accent} strokeWidth={2} />
          </G>
        )}
      </Svg>
    </View>
  );
}

export const SkyPlot = memo(SkyPlotComponent);
