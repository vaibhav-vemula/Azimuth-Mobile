import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/Screen';
import { GlassCard } from '../../components/GlassCard';
import { Button } from '../../components/ui';
import { colors, typography } from '../../theme';
import { useWallet } from '../../wallet/useWallet';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  { icon: 'map-outline', title: 'Clear the fog', text: 'Turn mapping on and uncover the signals around you.' },
  { icon: 'cube-outline', title: 'Open bounty chests', text: 'Take on requests for specific measurements and get paid.' },
  { icon: 'planet-outline', title: 'Catch satellites', text: 'Record weather-satellite passes with an RTL-SDR.' },
];

export function ConnectScreen() {
  const status = useWallet((s) => s.status);
  const error = useWallet((s) => s.error);
  const connect = useWallet((s) => s.connect);
  const continueAsGuest = useWallet((s) => s.continueAsGuest);

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.mark}>
          <Ionicons name="radio" size={34} color={colors.accent} />
        </View>
        <Text style={styles.title}>Welcome to Azimuth</Text>
        <Text style={styles.subtitle}>Explore the radio world around you and get rewarded for what you find.</Text>
      </View>

      <GlassCard style={styles.points}>
        {POINTS.map((p) => (
          <View key={p.title} style={styles.point}>
            <View style={styles.pointIcon}>
              <Ionicons name={p.icon} size={20} color={colors.accent} />
            </View>
            <View style={styles.pointText}>
              <Text style={styles.pointTitle}>{p.title}</Text>
              <Text style={styles.pointBody}>{p.text}</Text>
            </View>
          </View>
        ))}
      </GlassCard>

      <View style={styles.actions}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Connect wallet" icon="wallet-outline" onPress={() => void connect()} loading={status === 'connecting'} />
        <Button label="Continue without a wallet" variant="ghost" onPress={continueAsGuest} disabled={status === 'connecting'} />
        <Text style={styles.note}>
          Your wallet is only used to sign in and sign your reports. Azimuth never moves funds without your approval.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', gap: 22, paddingVertical: 24 },
  hero: { alignItems: 'center', gap: 10 },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentFaint,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.heading, fontSize: 26, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 12 },
  points: { gap: 16 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  pointIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.accentFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: { flex: 1, gap: 2 },
  pointTitle: { ...typography.subheading, color: colors.textPrimary },
  pointBody: { ...typography.caption, color: colors.textSecondary },
  actions: { gap: 10 },
  error: { ...typography.caption, color: colors.danger, textAlign: 'center' },
  note: { ...typography.caption, color: colors.textTertiary, textAlign: 'center', paddingHorizontal: 12 },
});
