import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface SpectrumVisualizerProps {
  bins: number[];
  frequencyHz: number;
  isStreaming: boolean;
}

const BIN_COUNT = 64;
const CHART_HEIGHT = 180;
const MIN_BAR_HEIGHT = 2;
const COLOR_STEPS = 64;

const CYAN: [number, number, number] = [0x00, 0xe5, 0xff];
const RED: [number, number, number] = [0xff, 0x45, 0x00];

function toHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

function buildGradient(): string[] {
  const colors: string[] = [];
  for (let i = 0; i <= COLOR_STEPS; i += 1) {
    const t = i / COLOR_STEPS;
    const r = CYAN[0] + (RED[0] - CYAN[0]) * t;
    const g = CYAN[1] + (RED[1] - CYAN[1]) * t;
    const b = CYAN[2] + (RED[2] - CYAN[2]) * t;
    colors.push(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
  }
  return colors;
}

const GRADIENT = buildGradient();

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function SpectrumVisualizerComponent({ bins, frequencyHz, isStreaming }: SpectrumVisualizerProps) {
  const bars = useMemo(() => {
    const items: { height: number; color: string }[] = [];
    for (let i = 0; i < BIN_COUNT; i += 1) {
      const power = clamp01(bins[i] ?? 0);
      items.push({
        height: Math.max(MIN_BAR_HEIGHT, power * CHART_HEIGHT),
        color: GRADIENT[Math.round(power * COLOR_STEPS)],
      });
    }
    return items;
  }, [bins]);

  const frequencyMHz = (frequencyHz / 1e6).toFixed(3);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>CENTER FREQUENCY</Text>
          <Text style={styles.frequency}>
            {frequencyMHz}
            <Text style={styles.unit}> MHz</Text>
          </Text>
        </View>
        <View style={[styles.liveBadge, isStreaming ? styles.liveBadgeOn : styles.liveBadgeOff]}>
          <View style={[styles.liveDot, isStreaming ? styles.liveDotOn : styles.liveDotOff]} />
          <Text style={[styles.liveText, isStreaming ? styles.liveTextOn : styles.liveTextOff]}>
            {isStreaming ? 'LIVE' : 'IDLE'}
          </Text>
        </View>
      </View>

      <View style={styles.chart}>
        {bars.map((bar, index) => (
          <View key={index} style={styles.barSlot}>
            <View style={[styles.bar, { height: bar.height, backgroundColor: bar.color }]} />
          </View>
        ))}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisText}>−1.2 MHz</Text>
        <Text style={styles.axisText}>{frequencyMHz}</Text>
        <Text style={styles.axisText}>+1.2 MHz</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#12161F',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E2533',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  label: {
    color: '#6B7690',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  frequency: {
    color: '#00E5FF',
    fontSize: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    color: '#6B7690',
    fontSize: 16,
    fontWeight: '500',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveBadgeOn: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
  },
  liveBadgeOff: {
    borderColor: '#2A3142',
    backgroundColor: 'transparent',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  liveDotOn: {
    backgroundColor: '#00E5FF',
  },
  liveDotOff: {
    backgroundColor: '#2A3142',
  },
  liveText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  liveTextOn: {
    color: '#00E5FF',
  },
  liveTextOff: {
    color: '#6B7690',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    backgroundColor: '#0A0D14',
    borderRadius: 8,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
  barSlot: {
    flex: 1,
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
    paddingHorizontal: 0.75,
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 1.5,
    borderTopRightRadius: 1.5,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  axisText: {
    color: '#6B7690',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});

const SpectrumVisualizer = memo(SpectrumVisualizerComponent);

export default SpectrumVisualizer;
