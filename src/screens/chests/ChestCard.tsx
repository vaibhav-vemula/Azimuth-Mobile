import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../components/GlassCard';
import { Badge, Button } from '../../components/ui';
import { colors, typography } from '../../theme';
import { Chest } from '../../network/api';
import { useSubmission } from '../../network/useSubmission';
import { useMapping } from '../../mapping/useMapping';
import { useWallet } from '../../wallet/useWallet';
import { CHEST_KIND, formatDistance, timeLeft } from './chestInfo';

const DEFAULT_MIN_SAMPLES = 3;

export function ChestCard({ chest, distance, mappingRunning, scans }: { chest: Chest; distance: number | null; mappingRunning: boolean; scans: number }) {
  const kind = CHEST_KIND[chest.kind];
  const readingsNear = useMapping((s) => s.readingsNear);
  const radioReadingsNear = useMapping((s) => s.radioReadingsNear);
  const sondeDetectionsNear = useMapping((s) => s.sondeDetectionsNear);
  const buildChestReport = useMapping((s) => s.buildChestReport);
  const address = useWallet((s) => s.address);
  const { state, submit, reset } = useSubmission();

  const needed = chest.spec.minSamples ?? DEFAULT_MIN_SAMPLES;
  // `scans` is read so this recomputes whenever a new reading lands.
  const have = useMemo(() => (mappingRunning ? readingsNear(chest.cellId) : 0), [mappingRunning, readingsNear, chest.cellId, scans]);
  const dongleOnly = chest.requires === 'dongle';
  const sonde = chest.kind === 'sonde';
  const radioHave = useMemo(
    () => (mappingRunning && dongleOnly ? (sonde ? sondeDetectionsNear(chest.cellId) : radioReadingsNear(chest.cellId)) : 0),
    [mappingRunning, dongleOnly, sonde, radioReadingsNear, sondeDetectionsNear, chest.cellId, scans]
  );
  const passChest = chest.kind === 'satellite-pass';
  const ready = !passChest && mappingRunning && have >= needed && (!dongleOnly || radioHave >= 1);

  const open = async () => {
    if (!address) return;
    const report = await buildChestReport(address, { id: chest.id, cellId: chest.cellId });
    if (report) await submit(report);
  };

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
          {passChest ? (
            <Text style={styles.hint}>Record the pass from the Satellites tab. The receipt you sign afterwards claims this chest.</Text>
          ) : !address ? (
            <Text style={styles.hint}>Connect a wallet in Profile to open chests.</Text>
          ) : !mappingRunning ? (
            <Text style={styles.hint}>Start mapping on the Map tab, then walk to this chest.</Text>
          ) : (
            <Text style={styles.hint}>
              {have < needed
                ? `Readings near the chest: ${have} of ${needed}. Keep walking toward it.`
                : dongleOnly && radioHave < 1
                  ? sonde
                  ? `Listening for the sonde on ${((chest.spec.frequencyHz ?? 0) / 1e6).toFixed(3)} MHz. Walk toward the landing area with the antenna up.`
                  : 'Waiting for a dongle reading. Plug in the RTL-SDR with an antenna and stay nearby.'
                  : 'Ready to open.'}
            </Text>
          )}
          {passChest ? null : <Button
            label={state.phase === 'signing' ? 'Waiting for wallet…' : state.phase === 'sending' ? 'Sending…' : 'Open chest'}
            icon="cube-outline"
            disabled={!ready}
            loading={state.phase === 'signing' || state.phase === 'sending'}
            onPress={() => {
              reset();
              void open();
            }}
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
