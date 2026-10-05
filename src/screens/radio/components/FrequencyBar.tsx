import { useRef, useState } from 'react';
import { GestureResponderEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../../../theme';
import { FM_MAX_MHZ, FM_MIN_MHZ, clampFm } from '../../../radio/online/radioBrowser';

const SPAN = FM_MAX_MHZ - FM_MIN_MHZ;
const LABELS = [88, 92, 96, 100, 104, 108];
const PAD = 14; // room at both ends so the needle and the end labels are not clipped

/** Where a frequency sits on the bar, 0 (87.5 MHz) to 1 (108.0 MHz). */
export function mhzToFraction(mhz: number): number {
  return Math.min(1, Math.max(0, (mhz - FM_MIN_MHZ) / SPAN));
}

/** The frequency under a touch at `fraction` along the bar, on the 0.1 MHz grid. */
export function fractionToMhz(fraction: number): number {
  return clampFm(FM_MIN_MHZ + Math.min(1, Math.max(0, fraction)) * SPAN);
}

interface Props {
  mhz: number;
  /** The needle is being dragged or tapped: called with each new frequency. */
  onScrub: (mhz: number) => void;
  /** The finger came up: time to find the station. */
  onCommit: (mhz: number) => void;
}

/** A tuning bar for the FM band: drag the needle, or tap anywhere on the scale. */
export function FrequencyBar({ mhz, onScrub, onCommit }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const latest = useRef(mhz);
  latest.current = mhz;

  const at = (e: GestureResponderEvent) => fractionToMhz((e.nativeEvent.locationX - PAD) / Math.max(1, widthRef.current - PAD * 2));
  const handlers = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => onScrubRef.current(at(e)),
      onPanResponderMove: (e) => onScrubRef.current(at(e)),
      onPanResponderRelease: () => onCommitRef.current(latest.current),
    })
  ).current;
  const onScrubRef = useRef(onScrub);
  const onCommitRef = useRef(onCommit);
  onScrubRef.current = onScrub;
  onCommitRef.current = onCommit;

  const usable = Math.max(0, width - PAD * 2);
  const x = PAD + mhzToFraction(mhz) * usable;
  const ticks: number[] = [];
  for (let f = Math.ceil(FM_MIN_MHZ); f <= FM_MAX_MHZ; f += 1) ticks.push(f);

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Frequency bar"
      accessibilityValue={{ text: `${mhz.toFixed(1)} megahertz` }}
    >
      <View style={styles.scale} pointerEvents="none">
        {width > 0
          ? ticks.map((f) => {
              const major = f % 4 === 0;
              return <View key={f} style={[styles.tick, major && styles.tickMajor, { left: PAD + mhzToFraction(f) * usable }]} />;
            })
          : null}
        {width > 0
          ? LABELS.map((f) => (
              <Text key={f} style={[styles.label, { left: PAD + mhzToFraction(f) * usable - 14 }]}>
                {f}
              </Text>
            ))
          : null}
        <View style={[styles.fill, { width: Math.max(0, x - PAD) }]} />
        <View style={[styles.needle, { left: x - 1.5 }]} />
        <View style={[styles.knob, { left: x - 9 }]} />
      </View>
      {/* A clear layer on top takes the touches, so the position it reports is always along the bar. */}
      <View style={StyleSheet.absoluteFill} {...handlers.panHandlers} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 64, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.surfaceBorder, overflow: 'hidden' },
  scale: { ...StyleSheet.absoluteFill },
  tick: { position: 'absolute', top: 22, width: 1, height: 10, backgroundColor: colors.textTertiary, opacity: 0.6 },
  tickMajor: { top: 18, height: 18, opacity: 1 },
  label: { position: 'absolute', top: 40, width: 28, textAlign: 'center', ...typography.caption, fontSize: 10, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  fill: { position: 'absolute', left: PAD, top: 11, height: 3, borderRadius: 2, backgroundColor: colors.accentMuted },
  needle: { position: 'absolute', top: 6, width: 3, height: 34, borderRadius: 2, backgroundColor: colors.accent },
  knob: { position: 'absolute', top: 2, width: 18, height: 12, borderRadius: 6, backgroundColor: colors.accent },
});
