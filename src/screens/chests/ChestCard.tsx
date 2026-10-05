import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../components/GlassCard';
import { Badge, Button } from '../../components/ui';
import { colors, typography } from '../../theme';
import { Chest } from '../../network/api';
import { useChestClaim } from '../../ar/claim';
import { AR_RANGE_M } from '../../ar/orientation';
import { rangeLabel, useUnitSystem } from '../../units/units';
import { CHEST_KIND, formatDistance, timeLeft } from './chestInfo';

export function ChestCard({ chest, distance, mappingRunning, scans, onAr }: { chest: Chest; distance: number | null; mappingRunning: boolean; scans: number; onAr?: () => void }) {
  const kind = CHEST_KIND[chest.kind];
  const system = useUnitSystem();
  const { state, ready, hint, claim, passChest, dongleOnly } = useChestClaim(chest, mappingRunning, scans);

  return (
    <GlassCard style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.kindIcon, { backgroundColor: `${kind.color}22` }]}>
          <Ionicons name={kind.icon} size={22} color={kind.color} />
        </View>
        <View style={styles.cardTitleBox}>
          <Text style={styles.cardTitle}>{chest.title}</Text>
          <Text style={styles.cardMeta}>
            {chest.requester} · {formatDistance(distance)} · {timeLeft(chest.expiresMs)}
          </Text>
        </View>
        <View style={styles.reward}>
          <Text style={styles.rewardValue}>{chest.rewardUsdc}</Text>
          <Text style={styles.rewardUnit}>USDC</Text>
        </View>
      </View>

      <Text style={styles.blurb}>{kind.blurb}</Text>
      <View style={styles.badges}>
        <Badge label={kind.label} color={kind.color} />
        <Badge label={dongleOnly ? 'Needs dongle' : 'Phone only'} color={dongleOnly ? colors.warning : colors.success} />
        <Badge label={`${chest.remaining} left`} color={colors.textSecondary} />
      </View>

      {state.phase === 'done' ? (
        <View style={styles.result}>
          <Badge label={state.pending ? 'Submitted for review' : state.accepted ? 'Opened' : 'Not accepted'} color={state.accepted ? (state.pending ? colors.accent : colors.success) : colors.danger} />
          <Text style={styles.blurb}>{state.message}</Text>
        </View>
      ) : (
        <>
          {state.phase === 'error' ? <Text style={styles.error}>{state.message}</Text> : null}
          <Text style={styles.hint}>{hint}</Text>
          {onAr && !passChest ? (
            <Button
              label={distance !== null && distance <= AR_RANGE_M ? 'Find it in AR' : `AR opens within ${rangeLabel(AR_RANGE_M, system)}`}
              variant="secondary"
              icon="camera-outline"
              disabled={distance === null || distance > AR_RANGE_M}
              onPress={onAr}
            />
          ) : null}
          {passChest ? null : <Button
            label={state.phase === 'signing' ? 'Waiting for wallet…' : state.phase === 'sending' ? 'Sending…' : 'Open chest'}
            icon="cube-outline"
            disabled={!ready}
            loading={state.phase === 'signing' || state.phase === 'sending'}
            onPress={() => void claim()}
          />}
        </>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 14 },
  title: { ...typography.heading, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  card: { gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kindIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardTitleBox: { flex: 1, gap: 2 },
  cardTitle: { ...typography.subheading, color: colors.textPrimary },
  cardMeta: { ...typography.caption, color: colors.textSecondary },
  reward: { alignItems: 'flex-end' },
  rewardValue: { ...typography.heading, fontSize: 20, color: colors.accent },
  rewardUnit: { ...typography.label, color: colors.textTertiary },
  blurb: { ...typography.body, color: colors.textSecondary },
  badges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  result: { gap: 8 },
  hint: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.danger },
});
