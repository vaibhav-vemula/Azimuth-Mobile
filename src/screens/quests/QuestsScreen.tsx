import type React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/Screen';
import { Button } from '../../components/ui';
import { colors, typography } from '../../theme';
import { useWallet } from '../../wallet/useWallet';
import { useChallenges } from '../../challenges/useChallenges';
import type { ChallengeItem } from '../../challenges/useChallenges';
import type { Challenge } from '../../challenges/definitions';
import type { RootTabParamList } from '../../navigation/types';

type Period = Challenge['period'];

const GROUPS: { period: Period; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { period: 'daily', label: 'Daily', hint: 'Resets every day', icon: 'sunny-outline' },
  { period: 'weekly', label: 'Weekly', hint: 'Resets every Monday', icon: 'calendar-outline' },
  { period: 'once', label: 'One time', hint: 'Do it once, keep the reward', icon: 'ribbon-outline' },
];

const METRIC: Record<Challenge['metric'], { icon: keyof typeof Ionicons.glyphMap; unit: string }> = {
  mapping_minutes: { icon: 'timer-outline', unit: 'min' },
  new_cells: { icon: 'map-outline', unit: 'cells' },
  satellite_passes: { icon: 'planet-outline', unit: 'passes' },
  chests_opened: { icon: 'cube-outline', unit: 'chests' },
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function QuestsScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const status = useWallet((s) => s.status);
  const address = useWallet((s) => s.address);
  const connected = status === 'connected' && !!address;
  const { items, loading, error, claiming, message, claim } = useChallenges();

  const ready = items.filter((it) => it.state.kind === 'ready' || it.state.kind === 'rejected');
  const claimable = ready.reduce((sum, it) => sum + it.challenge.reward, 0);
  const claimed = items.filter((it) => it.state.kind === 'claimed').length;

  const action = (it: ChallengeItem) => {
    const { challenge: c, state } = it;
    switch (state.kind) {
      case 'ready':
      case 'rejected':
        return <Button label={`Claim ${c.reward} AZM`} icon="gift" loading={claiming === c.id} disabled={claiming !== null} onPress={() => void claim(c.id)} />;
      case 'waiting':
        return <Button label="Claim pending" variant="secondary" icon="hourglass-outline" disabled onPress={() => undefined} />;
      case 'claimed':
        return null;
      default:
        return <Button label="Go" variant="secondary" icon="arrow-forward" compact onPress={() => navigation.navigate(c.go)} />;
    }
  };

  return (
    <Screen>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>CHALLENGES</Text>
          <Text style={styles.title}>Quests</Text>
        </View>
        <View style={styles.trophy}>
          <Ionicons name="trophy" size={22} color={colors.warning} />
        </View>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroCol}>
          <Text style={styles.heroLabel}>READY TO CLAIM</Text>
          <View style={styles.heroValueRow}>
            <Text style={[styles.heroValue, claimable > 0 && { color: colors.warning }]}>{claimable}</Text>
            <Text style={styles.heroUnit}>AZM</Text>
          </View>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroCol}>
          <Text style={styles.heroLabel}>COMPLETED</Text>
          <View style={styles.heroValueRow}>
            <Text style={styles.heroValue}>{claimed}</Text>
            <Text style={styles.heroUnit}>of {items.length}</Text>
          </View>
        </View>
      </View>

      {!connected ? (
        <View style={styles.notice}>
          <Ionicons name="wallet-outline" size={16} color={colors.accent} />
          <Text style={styles.noticeText}>Connect your wallet in Profile to claim quest rewards.</Text>
        </View>
      ) : null}
      {error && items.length === 0 ? <Text style={styles.error}>{error}</Text> : null}
      {message ? (
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
          <Text style={styles.noticeText}>{message}</Text>
        </View>
      ) : null}
      {!error && !loading && items.length === 0 ? <Text style={styles.muted}>No challenges right now.</Text> : null}

      {GROUPS.map((g) => {
        const group = items.filter((it) => it.challenge.period === g.period);
        if (group.length === 0) return null;
        return (
          <View key={g.period} style={styles.group}>
            <View style={styles.groupHead}>
              <Ionicons name={g.icon} size={16} color={colors.accent} />
              <Text style={styles.groupLabel}>{g.label.toUpperCase()}</Text>
              <Text style={styles.groupHint}>{g.hint}</Text>
            </View>
            {group.map((it) => (
              <QuestCard key={it.challenge.id} item={it} action={connected || it.state.kind === 'progress' ? action(it) : null} />
            ))}
          </View>
        );
      })}
    </Screen>
  );
}

function QuestCard({ item, action }: { item: ChallengeItem; action: React.ReactNode }) {
  const { challenge: c, value, state } = item;
  const m = METRIC[c.metric];
  const done = state.kind === 'claimed';
  const ready = state.kind === 'ready' || state.kind === 'rejected';
  const ratio = Math.min(1, c.goal > 0 ? value / c.goal : 0);
  const accent = done ? colors.success : ready ? colors.warning : colors.accent;
  return (
    <View style={[styles.card, ready && { borderColor: colors.warning, ...styles.cardReady }, done && styles.cardDone]}>
      <View style={styles.cardTop}>
        <View style={[styles.iconWrap, { borderColor: accent, backgroundColor: `${accent}22` }]}>
          <Ionicons name={done ? 'checkmark' : m.icon} size={22} color={accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.cardTitle, done && { color: colors.textSecondary }]}>{c.title}</Text>
          {c.blurb ? <Text style={styles.blurb}>{c.blurb}</Text> : null}
        </View>
        <View style={[styles.reward, { borderColor: accent }]}>
          <Text style={[styles.rewardValue, { color: accent }]}>+{c.reward}</Text>
          <Text style={[styles.rewardUnit, { color: accent }]}>AZM</Text>
        </View>
      </View>

      {!done ? (
        <View style={styles.progress}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: accent }]} />
          </View>
          <View style={styles.progressText}>
            <Text style={styles.progressValue}>
              {fmt(value)} <Text style={styles.progressGoal}>/ {fmt(c.goal)} {m.unit}</Text>
            </Text>
            <Text style={[styles.percent, { color: accent }]}>{Math.round(ratio * 100)}%</Text>
          </View>
        </View>
      ) : (
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.doneText}>Claimed. {c.reward} AZM paid out.</Text>
        </View>
      )}

      {state.kind === 'rejected' ? (
        <View style={styles.rejected}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
          <Text style={styles.error}>{state.reason}</Text>
        </View>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyebrow: { ...typography.label, color: colors.accent },
  title: { ...typography.display, fontSize: 30, color: colors.textPrimary },
  trophy: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,183,77,0.12)', borderWidth: 1, borderColor: 'rgba(255,183,77,0.4)' },
  hero: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingVertical: 16, paddingHorizontal: 12, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accentMuted },
  heroCol: { flex: 1, alignItems: 'center', gap: 4 },
  heroDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.surfaceBorder },
  heroLabel: { ...typography.label, color: colors.textSecondary },
  heroValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  heroValue: { ...typography.display, fontSize: 32, color: colors.textPrimary },
  heroUnit: { ...typography.caption, color: colors.textSecondary },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.accentFaint, borderWidth: 1, borderColor: colors.accentMuted },
  noticeText: { ...typography.caption, flex: 1, color: colors.textPrimary },
  group: { gap: 10, marginTop: 4 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  groupLabel: { ...typography.label, color: colors.textPrimary },
  groupHint: { ...typography.caption, color: colors.textTertiary, flex: 1, textAlign: 'right' },
  card: { borderRadius: 20, padding: 14, gap: 12, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.surfaceBorder },
  cardReady: { shadowColor: colors.warning, shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  cardDone: { opacity: 0.78 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...typography.subheading, color: colors.textPrimary },
  blurb: { ...typography.caption, color: colors.textSecondary },
  reward: { minWidth: 58, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1 },
  rewardValue: { ...typography.heading, fontSize: 18, lineHeight: 20 },
  rewardUnit: { ...typography.label, fontSize: 9, letterSpacing: 1 },
  progress: { gap: 6 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceBorder, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  progressText: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progressValue: { ...typography.subheading, fontSize: 14, color: colors.textPrimary },
  progressGoal: { ...typography.caption, color: colors.textSecondary },
  percent: { ...typography.caption, fontFamily: 'SpaceGrotesk_700Bold' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { ...typography.caption, color: colors.success },
  rejected: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  muted: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.danger, flex: 1 },
});
