import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/Screen';
import { GlassCard } from '../../components/GlassCard';
import { Badge, Button, SectionLabel } from '../../components/ui';
import { colors, typography } from '../../theme';
import { useWallet } from '../../wallet/useWallet';
import { useChallenges } from '../../challenges/useChallenges';
import type { ChallengeItem } from '../../challenges/useChallenges';
import type { RootTabParamList } from '../../navigation/types';

const GROUPS: { period: 'daily' | 'weekly' | 'once'; label: string }[] = [
  { period: 'daily', label: 'Daily' },
  { period: 'weekly', label: 'Weekly' },
  { period: 'once', label: 'One time' },
];

export default function QuestsScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const status = useWallet((s) => s.status);
  const address = useWallet((s) => s.address);
  const connected = status === 'connected' && !!address;
  const { items, loading, error, claiming, message, claim } = useChallenges();

  const action = (it: ChallengeItem) => {
    const { challenge: c, state } = it;
    switch (state.kind) {
      case 'ready':
      case 'rejected':
        return <Button label="Claim" icon="gift-outline" loading={claiming === c.id} disabled={claiming !== null} onPress={() => void claim(c.id)} />;
      case 'waiting':
        return <Button label="Waiting for check" variant="secondary" disabled onPress={() => undefined} />;
      case 'claimed':
        return <Button label="Claimed" variant="secondary" icon="checkmark-circle" disabled onPress={() => undefined} />;
      default:
        return <Button label="Go" variant="secondary" icon="arrow-forward" onPress={() => navigation.navigate(c.go)} />;
    }
  };

  return (
    <Screen>
      <Text style={styles.title}>Quests</Text>
      {!connected ? <Text style={styles.muted}>Connect your wallet in Profile to claim quest rewards.</Text> : null}
      {error && items.length === 0 ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.muted}>{message}</Text> : null}
      {!error && !loading && items.length === 0 ? <Text style={styles.muted}>No challenges right now.</Text> : null}
      {GROUPS.map((g) => {
        const group = items.filter((it) => it.challenge.period === g.period);
        if (group.length === 0) return null;
        return (
          <View key={g.period} style={styles.group}>
            <SectionLabel>{g.label}</SectionLabel>
            {group.map((it) => {
              const { challenge: c, value, state } = it;
              return (
                <GlassCard key={c.id} style={styles.card}>
                  <View style={styles.head}>
                    <Text style={styles.cardTitle}>{c.title}</Text>
                    <Badge label={`+${c.reward} AZM`} color={colors.success} />
                  </View>
                  {c.blurb ? <Text style={styles.muted}>{c.blurb}</Text> : null}
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.min(100, (value / c.goal) * 100)}%` }]} />
                  </View>
                  <Text style={styles.muted}>{`${value} / ${c.goal}`}</Text>
                  {state.kind === 'rejected' ? (
                    <View style={styles.rejected}>
                      <Ionicons name="alert-circle-outline" size={14} color={colors.danger} />
                      <Text style={styles.error}>{state.reason}</Text>
                    </View>
                  ) : null}
                  {connected || state.kind === 'progress' ? action(it) : null}
                </GlassCard>
              );
            })}
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.heading, color: colors.textPrimary },
  group: { gap: 10 },
  card: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { ...typography.subheading, flex: 1, color: colors.textPrimary },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceBorder, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  rejected: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  muted: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.danger },
});
