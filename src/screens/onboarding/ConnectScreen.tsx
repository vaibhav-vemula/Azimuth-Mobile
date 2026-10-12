import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/Screen';
import { AzimuthMark } from '../../components/Logo';
import { GlassCard } from '../../components/GlassCard';
import { Button } from '../../components/ui';
import { colors, typography } from '../../theme';
import { useWallet } from '../../wallet/useWallet';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  { icon: 'map-outline', title: 'Clear the fog', text: 'Turn mapping on and uncover the signals around you.' },
  { icon: 'cube-outline', title: 'Open chests', text: 'Take on requests for specific measurements and get paid.' },
  { icon: 'planet-outline', title: 'Catch satellites', text: 'Record weather-satellite passes with an RTL-SDR.' },
];

const BADGES: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: 'flash-outline', label: 'Solana' },
  { icon: 'shield-checkmark-outline', label: 'Seed Vault' },
  { icon: 'diamond-outline', label: 'AZM rewards' },
];

export function ConnectScreen() {
  const status = useWallet((s) => s.status);
  const error = useWallet((s) => s.error);
  const connect = useWallet((s) => s.connect);

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.ringOuter}>
          <View style={styles.ringInner}>
            <AzimuthMark size={92} tile />
          </View>
        </View>
        <Text style={styles.kicker}>WELCOME TO</Text>
        <Text style={styles.title}>Azimuth</Text>
        <Text style={styles.subtitle}>Map the world around you. Get rewarded for what you find.</Text>
        <View style={styles.badges}>
          {BADGES.map((b) => (
            <View key={b.label} style={styles.badge}>
              <Ionicons name={b.icon} size={13} color={colors.accent} />
              <Text style={styles.badgeText}>{b.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <GlassCard style={styles.points}>
        {POINTS.map((p, i) => (
          <View key={p.title}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.point}>
              <View style={styles.pointIcon}>
                <Ionicons name={p.icon} size={21} color={colors.accent} />
              </View>
              <View style={styles.pointText}>
                <Text style={styles.pointTitle}>{p.title}</Text>
                <Text style={styles.pointBody}>{p.text}</Text>
              </View>
            </View>
          </View>
        ))}
      </GlassCard>

      <View style={styles.actions}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Connect wallet" icon="wallet-outline" onPress={() => void connect()} loading={status === 'connecting'} />
        <View style={styles.trust}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.textTertiary} />
          <Text style={styles.note}>Used only to sign in and sign your reports. Nothing moves without your approval.</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', gap: 26, paddingVertical: 24 },
  hero: { alignItems: 'center', gap: 6 },
  ringOuter: {
    width: 176,
    height: 176,
    borderRadius: 88,
    borderWidth: 1,
    borderColor: colors.accentFaint,
    backgroundColor: 'rgba(77,208,225,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  ringInner: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: { ...typography.caption, color: colors.accent, letterSpacing: 3, fontWeight: '700' },
  title: { ...typography.heading, fontSize: 38, letterSpacing: 0.5, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 24, marginTop: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  badgeText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  points: { paddingVertical: 6 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 14 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceBorder },
  pointIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accentFaint,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: { flex: 1, gap: 2 },
  pointTitle: { ...typography.subheading, color: colors.textPrimary },
  pointBody: { ...typography.caption, color: colors.textSecondary },
  actions: { gap: 14 },
  error: { ...typography.caption, color: colors.danger, textAlign: 'center' },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16 },
  note: { ...typography.caption, color: colors.textTertiary, textAlign: 'center', flexShrink: 1 },
});
