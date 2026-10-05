import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Chest } from '../../../network/api';
import { AR_RANGE_M } from '../../../ar/orientation';
import { compassPoint, formatDistanceShort } from '../../../mapping/geo';
import { colors, typography } from '../../../theme';
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
  onPress: () => void;
  /** Opens the camera view. Shown when the chest is within AR range. */
  onAr: () => void;
}

/** A small indicator for the nearest chest: an arrow that points toward it, and how far away it is. */
export function ChestCompass({ chest, distanceM, bearingDeg, headingDeg, onPress, onAr }: Props) {
  const kind = CHEST_KIND[chest.kind];
  const arrived = distanceM <= ARRIVED_M;
  const inArRange = distanceM <= AR_RANGE_M;

  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Nearest chest: ${chest.title}`} style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
        <DirectionArrow bearingDeg={bearingDeg} headingDeg={headingDeg} size={36} color={arrived ? colors.success : kind.color} />
        <View>
          <Text style={styles.distance}>{formatDistanceShort(distanceM)}</Text>
          <Text style={styles.sub}>{arrived ? 'You are here' : compassPoint(bearingDeg)}</Text>
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
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(11,15,26,0.94)', borderColor: colors.surfaceBorder, borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingLeft: 7, paddingRight: 14 },
  pressed: { opacity: 0.85 },
  distance: { ...typography.subheading, fontSize: 17, color: colors.textPrimary, lineHeight: 19 },
  sub: { ...typography.caption, fontSize: 11, color: colors.textSecondary },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
  rewardText: { ...typography.caption, fontSize: 12, color: colors.textPrimary },
  ar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
});

/** The compass wired to the live heading, so only this small piece redraws as the phone turns. */
export function ConnectedChestCompass(props: Omit<Props, 'headingDeg'>) {
  const heading = useHeadingStore((s) => s.heading);
  return <ChestCompass {...props} headingDeg={heading} />;
}
