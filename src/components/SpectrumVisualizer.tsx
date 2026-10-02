import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors, typography } from '../theme';
import { SPECTRUM_VIEW_WIDTH, buildBarsPath } from '../utils/spectrumPath';
import { formatFrequencyMHz } from '../utils/format';

export interface SpectrumMarker {
  frequencyHz: number;
  label: string;
  color?: string;
}

export interface SpectrumVisualizerProps {
  bins: number[];
  frequencyHz: number;
  sampleRateHz: number;
  isStreaming: boolean;
  markers?: SpectrumMarker[];
  height?: number;
}

const GRID_FRACTIONS = [0.25, 0.5, 0.75];

/** Everything that does not change from frame to frame, so only the bars are redrawn. */
const Backdrop = memo(function Backdrop({ height }: { height: number }) {
  return (
    <>
      <Defs>
        <LinearGradient id="spectrumGradient" gradientUnits="userSpaceOnUse" x1="0" y1={height} x2="0" y2="0">
          <Stop offset="0" stopColor={colors.spectrumLow} />
          <Stop offset="1" stopColor={colors.spectrumHigh} />
        </LinearGradient>
      </Defs>
      {GRID_FRACTIONS.map((f) => (
        <Line
          key={f}
          x1="0"
          x2={SPECTRUM_VIEW_WIDTH}
          y1={height * f}
          y2={height * f}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={1}
        />
      ))}
    </>
  );
});

const Markers = memo(function Markers({ markers, frequencyHz, sampleRateHz }: { markers: SpectrumMarker[]; frequencyHz: number; sampleRateHz: number }) {
  const visible = markers
    .map((m) => ({ ...m, position: 0.5 + (m.frequencyHz - frequencyHz) / sampleRateHz }))
    .filter((m) => m.position >= 0.02 && m.position <= 0.98);
  return (
    <>
      {visible.map((m) => (
        <View key={m.label} pointerEvents="none" style={[styles.marker, { left: `${m.position * 100}%` }]}>
          <View style={[styles.markerLine, { backgroundColor: m.color ?? colors.warning }]} />
          <Text style={[styles.markerLabel, { color: m.color ?? colors.warning }]}>{m.label}</Text>
        </View>
      ))}
    </>
  );
});

const Axis = memo(function Axis({ frequencyHz, sampleRateHz }: { frequencyHz: number; sampleRateHz: number }) {
  const halfSpanMHz = sampleRateHz / 2 / 1e6;
  return (
    <View style={styles.axis}>
      <Text style={styles.axisText}>−{halfSpanMHz.toFixed(2)} MHz</Text>
      <Text style={styles.axisText}>{formatFrequencyMHz(frequencyHz)} MHz</Text>
      <Text style={styles.axisText}>+{halfSpanMHz.toFixed(2)} MHz</Text>
    </View>
  );
});

function SpectrumVisualizerComponent({ bins, frequencyHz, sampleRateHz, isStreaming, markers, height = 150 }: SpectrumVisualizerProps) {
  const path = useMemo(() => buildBarsPath(bins, height), [bins, height]);

  return (
    <View>
      <View style={[styles.chart, { height }]}>
        <Svg width="100%" height={height} viewBox={`0 0 ${SPECTRUM_VIEW_WIDTH} ${height}`} preserveAspectRatio="none">
          <Backdrop height={height} />
          <Path d={path} fill="url(#spectrumGradient)" />
        </Svg>
        {markers && markers.length > 0 ? <Markers markers={markers} frequencyHz={frequencyHz} sampleRateHz={sampleRateHz} /> : null}
        {!isStreaming && (
          <View style={styles.idle} pointerEvents="none">
            <Text style={styles.idleText}>No signal stream</Text>
          </View>
        )}
      </View>
      <Axis frequencyHz={frequencyHz} sampleRateHz={sampleRateHz} />
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    backgroundColor: '#03050A',
    borderRadius: 10,
    overflow: 'hidden',
  },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  markerLine: { flex: 1, width: 1, opacity: 0.8 },
  markerLabel: { ...typography.caption, fontSize: 10, position: 'absolute', top: 2, left: 4, width: 70 },
  idle: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  idleText: { ...typography.caption, color: colors.textTertiary },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  axisText: { ...typography.caption, color: colors.textTertiary, fontVariant: ['tabular-nums'] },
});

export const SpectrumVisualizer = memo(SpectrumVisualizerComponent);
export default SpectrumVisualizer;
