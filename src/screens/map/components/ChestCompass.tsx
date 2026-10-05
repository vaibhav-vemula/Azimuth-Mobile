import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Chest } from '../../../network/api';
import { AR_RANGE_M } from '../../../ar/orientation';
import { compassPoint, formatDistanceShort } from '../../../mapping/geo';
import { colors, typography } from '../../../theme';
import { useUnitSystem } from '../../../units/units';
import { CHEST_KIND } from '../../chests/chestInfo';
import { DirectionArrow } from './DirectionArrow';
import { useHeadingStore } from '../../../mapping/headingStore';

/** How close counts as "there": a chest's spot is about 100 m across. */
export const ARRIVED_M = 90;

interface Props {
  chest: Chest;
  distanceM: number;
  bearingDeg: number;
  headingDeg: number | null;
  /** The compass says it is not accurate; the pill asks for a figure-8 wave of the phone. */
  needsCalibration?: boolean;
  onPress: () => void;
  /** Opens the camera view. Shown when the chest is within AR range. */
  onAr: () => void;
}

/** A small indicator for the nearest chest: an arrow that points toward it, and how far away it is. */
export function ChestCompass({ chest, distanceM, bearingDeg, headingDeg, needsCalibration = false, onPress, onAr }: Props) {
  const kind = CHEST_KIND[chest.kind];
  useUnitSystem(); // redraw when the unit setting changes
  const arrived = distanceM <= ARRIVED_M;
  const warn = needsCalibration && !arrived;
  const inArRange = distanceM <= AR_RANGE_M;

  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Nearest chest: ${chest.title}`} style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
        <DirectionArrow bearingDeg={bearingDeg} headingDeg={headingDeg} size={52} color={arrived ? colors.success : kind.color} />
        <View style={styles.info}>
          <Text style={[styles.label, warn && styles.labelWarn]} numberOfLines={1}>
            {arrived ? 'You are here' : needsCalibration ? 'Wave phone in a figure 8' : headingDeg === null ? 'No compass · north up' : `Nearest chest · ${compassPoint(bearingDeg)}`}
          </Text>
          <Text style={styles.distance}>{formatDistanceShort(distanceM)}</Text>
        </View>
        <View style={[styles.reward, { borderColor: kind.color }]}>
          <Ionicons name="cube" size={13} color={kind.color} />
          <Text style={styles.rewardText}>{chest.rewardUsdc}</Text>
        </View>
      </Pressable>
      {inArRange ? (
        <Pressable onPress={onAr} accessibilityRole="button" accessibilityLabel="Find the chest in AR" style={({ pressed }) => [styles.ar, pressed && styles.pressed]}>
          <Ionicons name="camera" size={20} color={colors.background} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(11,15,26,0.94)', borderColor: colors.surfaceBorder, borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingLeft: 6, paddingRight: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  pressed: { opacity: 0.85 },
  info: { gap: 1 },
  label: { ...typography.caption, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textSecondary },
  labelWarn: { color: colors.warning },
  distance: { ...typography.heading, fontSize: 22, color: colors.textPrimary, lineHeight: 26 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  rewardText: { ...typography.caption, fontSize: 12, color: colors.textPrimary },
  ar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
});

/** The compass wired to the live heading, so only this small piece redraws as the phone turns. */
export function ConnectedChestCompass(props: Omit<Props, 'headingDeg' | 'needsCalibration'>) {
  const heading = useHeadingStore((s) => s.heading);
  const needsCalibration = useHeadingStore((s) => s.needsCalibration);
  return <ChestCompass {...props} headingDeg={heading} needsCalibration={needsCalibration} />;
}
