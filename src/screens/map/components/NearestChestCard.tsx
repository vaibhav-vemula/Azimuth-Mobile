import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Chest } from '../../../network/api';
import { compassPoint, formatDistanceShort } from '../../../mapping/geo';
import { colors, typography } from '../../../theme';
import { CHEST_KIND, timeLeft } from '../../chests/chestInfo';
import { DirectionArrow } from './DirectionArrow';

/** How close counts as "there": the chest's cell is about 100 m across. */
export const ARRIVED_M = 90;

interface Props {
  chest: Chest;
  distanceM: number;
  bearingDeg: number;
  headingDeg: number | null;
  mappingRunning: boolean;
  onPress: () => void;
}

/** The closest chest, with an arrow pointing the way and how far it is. */
export function NearestChestCard({ chest, distanceM, bearingDeg, headingDeg, mappingRunning, onPress }: Props) {
  const kind = CHEST_KIND[chest.kind];
  const arrived = distanceM <= ARRIVED_M;
  const hint = arrived
    ? mappingRunning
      ? 'You are here. Keep mapping for a minute, then open it.'
      : 'You are here. Start mapping to take the readings.'
    : `${compassPoint(bearingDeg)} · ${headingDeg === null ? 'no compass, arrow is north-up' : 'follow the arrow'}`;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Nearest chest: ${chest.title}`} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <DirectionArrow bearingDeg={bearingDeg} headingDeg={headingDeg} color={arrived ? colors.success : kind.color} />
      <View style={styles.body}>
        <View style={styles.row}>
          <Ionicons name={kind.icon} size={14} color={kind.color} />
          <Text style={styles.kind}>{kind.label.toUpperCase()}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.meta}>{timeLeft(chest.expiresMs)}</Text>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {chest.title}
        </Text>
        <Text style={styles.hint} numberOfLines={2}>
          {hint}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.distance}>{formatDistanceShort(distanceM)}</Text>
        <Text style={styles.reward}>{chest.rewardUsdc} USDC</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(11,15,26,0.94)',
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
  },
  pressed: { opacity: 0.85 },
  body: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  kind: { ...typography.label, color: colors.textSecondary },
  dot: { color: colors.textTertiary },
  meta: { ...typography.caption, color: colors.textTertiary },
  title: { ...typography.subheading, color: colors.textPrimary },
  hint: { ...typography.caption, color: colors.textSecondary },
  right: { alignItems: 'flex-end', gap: 2 },
  distance: { ...typography.heading, fontSize: 20, color: colors.textPrimary },
  reward: { ...typography.caption, color: colors.accent },
});
