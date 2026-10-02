import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme';
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

const BIN_COUNT = 64;
const MIN_BAR_HEIGHT = 2;
const COLOR_STEPS = 64;

const CYAN: [number, number, number] = [0x00, 0xe5, 0xff];
const RED: [number, number, number] = [0xff, 0x45, 0x00];

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

const GRADIENT: string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i <= COLOR_STEPS; i += 1) {
    const t = i / COLOR_STEPS;
    out.push(
      `#${toHex(CYAN[0] + (RED[0] - CYAN[0]) * t)}${toHex(CYAN[1] + (RED[1] - CYAN[1]) * t)}${toHex(CYAN[2] + (RED[2] - CYAN[2]) * t)}`
    );
  }
  return out;
})();

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function SpectrumVisualizerComponent({ bins, frequencyHz, sampleRateHz, isStreaming, markers, height = 150 }: SpectrumVisualizerProps) {
  const bars = useMemo(() => {
    const items: { height: number; color: string }[] = [];
    for (let i = 0; i < BIN_COUNT; i += 1) {
      const power = clamp01(bins[i] ?? 0);
      items.push({
        height: Math.max(MIN_BAR_HEIGHT, power * height),
        color: GRADIENT[Math.round(power * COLOR_STEPS)],
      });
    }
    return items;
  }, [bins, height]);

  const halfSpanMHz = sampleRateHz / 2 / 1e6;
  const visibleMarkers = (markers ?? [])
    .map((m) => ({ ...m, position: 0.5 + (m.frequencyHz - frequencyHz) / sampleRateHz }))
    .filter((m) => m.position >= 0.02 && m.position <= 0.98);

  return (
    <View>
      <View style={[styles.chart, { height }]}>
        {bars.map((bar, index) => (
          <View key={index} style={[styles.barSlot, { height }]}>
            <View style={[styles.bar, { height: bar.height, backgroundColor: bar.color }]} />
          </View>
        ))}
        {visibleMarkers.map((m) => (
          <View key={m.label} pointerEvents="none" style={[styles.marker, { left: `${m.position * 100}%` }]}>
            <View style={[styles.markerLine, { backgroundColor: m.color ?? colors.warning }]} />
            <Text style={[styles.markerLabel, { color: m.color ?? colors.warning }]}>{m.label}</Text>
          </View>
        ))}
        {!isStreaming && (
          <View style={styles.idle} pointerEvents="none">
            <Text style={styles.idleText}>No signal stream</Text>
          </View>
        )}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>−{halfSpanMHz.toFixed(2)} MHz</Text>
        <Text style={styles.axisText}>{formatFrequencyMHz(frequencyHz)} MHz</Text>
        <Text style={styles.axisText}>+{halfSpanMHz.toFixed(2)} MHz</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#03050A',
    borderRadius: 10,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  barSlot: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 0.75 },
  bar: { width: '100%', borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5 },
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
