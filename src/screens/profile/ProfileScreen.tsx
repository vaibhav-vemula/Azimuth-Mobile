import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/Screen';
import { GlassCard } from '../../components/GlassCard';
import { Badge, Button, SectionLabel, Stat } from '../../components/ui';
import { colors, typography } from '../../theme';
import { shortAddress } from '../../wallet/format';
import { useSkrName } from '../../wallet/skrName';
import { SOLANA_CHAIN, useWallet } from '../../wallet/useWallet';
import { useMapping } from '../../mapping/useMapping';
import { exploredAreaKm2, formatArea } from '../../mapping/explore';
import { NodeSummary, deleteMyData, fetchNodeSummary, verifySeeker } from '../../network/api';
import bs58 from 'bs58';
import { signText } from '../../wallet/signReport';
import { directMode, verifierConfigured } from '../../network/config';
import type { ProfileStackParamList } from '../../navigation/types';

export default function ProfileScreen() {
  const status = useWallet((s) => s.status);
  const address = useWallet((s) => s.address);
  const walletName = useWallet((s) => s.walletName);
  const error = useWallet((s) => s.error);
  const connect = useWallet((s) => s.connect);
  const disconnect = useWallet((s) => s.disconnect);

  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const exploredCount = useMapping((s) => Object.keys(s.explored).length);
  const [summary, setSummary] = useState<NodeSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!address || !verifierConfigured) return;
      let cancelled = false;
      fetchNodeSummary(address)
        .then((r) => !cancelled && setSummary(r))
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [address])
  );
  const [seekerNote, setSeekerNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const checkSeeker = async () => {
    if (!address) return;
    setChecking(true);
    setSeekerNote(null);
    try {
      const result = await verifySeeker(address);
      setSeekerNote(result.eligible ? null : result.reason);
      setSummary(await fetchNodeSummary(address));
    } catch (e) {
      setSeekerNote(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };
  const clearFog = useMapping((s) => s.clearFog);
  const mappingIdle = useMapping((s) => s.status === 'idle');
  const [erasing, setErasing] = useState(false);

  const eraseFromNetwork = () =>
    Alert.alert(
      'Delete your data from the network?',
      'This erases the readings and places the verifier holds for this wallet. Your fog map on this phone stays. Records needed to prevent fraud and to pay what you are owed are kept; they contain no readings or places.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!address) return;
            setErasing(true);
            try {
              const issuedAtMs = Date.now();
              const signature = await signText(`azimuth-delete-v1\n${address}\n${issuedAtMs}`, Buffer.from(bs58.decode(address)).toString('base64'));
              const result = await deleteMyData(address, issuedAtMs, signature);
              Alert.alert(
                result.ok ? (result.queued ? 'Request sent' : 'Deleted') : 'Could not delete',
                result.ok ? (result.queued ? 'It will be carried out at the next review, usually within a day.' : `Removed ${result.deletedBuckets ?? 0} stored readings.`) : result.error ?? 'Try again.'
              );
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : String(e));
            } finally {
              setErasing(false);
            }
          },
        },
      ]
    );

  const eraseFog = () =>
    Alert.alert('Erase your fog map?', 'The places you have uncovered on this phone will be covered again. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase', style: 'destructive', onPress: clearFog },
    ]);

  const seekerMint = summary?.seekerMint ?? null;
  const chestsOpened = summary ? summary.entries.filter((e) => e.kind === 'chest').length : 0;

  const connected = status === 'connected' && !!address;
  const skrName = useSkrName(connected ? address : null);
  const initials = skrName ? skrName.slice(0, 2).toUpperCase() : address ? address.slice(0, 2).toUpperCase() : '?';

  const confirmDisconnect = () =>
    Alert.alert('Disconnect wallet?', 'You can connect again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect() },
    ]);

  return (
    <Screen>
      <Text style={styles.title}>Profile</Text>

      <GlassCard style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        {connected ? (
          <>
            {/* The .skr name (Seeker ID) is the user name; the address sits under it, smaller. */}
            <Text style={styles.userName} numberOfLines={1} accessibilityRole="header">
              {skrName ?? shortAddress(address!, 5, 5)}
            </Text>
            {skrName ? <Text style={styles.muted}>{shortAddress(address!, 5, 5)}</Text> : null}
            <View style={styles.badges}>
              <Badge label={walletName ?? 'Wallet connected'} color={colors.success} />
              <Badge label={SOLANA_CHAIN.replace('solana:', '')} color={colors.accent} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.address}>No wallet connected</Text>
            <Text style={styles.muted}>Connect to sign reports and receive rewards.</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Connect wallet" icon="wallet-outline" onPress={() => void connect()} loading={status === 'connecting'} />
          </>
        )}
      </GlassCard>

      <GlassCard style={styles.section}>
        <SectionLabel>Seeker verification</SectionLabel>
        <View style={styles.verify}>
          <Ionicons name={seekerMint ? 'shield-checkmark' : 'shield-checkmark-outline'} size={22} color={seekerMint ? colors.success : colors.textTertiary} />
          <View style={styles.verifyText}>
            <Text style={styles.rowTitle}>Seeker Genesis Token</Text>
            <Text style={styles.muted}>
              {seekerMint
                ? `Verified · ${shortAddress(seekerMint, 5, 5)}`
                : !connected
                  ? 'Connect a wallet to check.'
                  : !verifierConfigured
                    ? 'Needs a network connection, which this build does not have.'
                    : directMode
                      ? 'Checked when your reports are reviewed. One node per Seeker device.'
                      : 'One node per Seeker device. Check that this wallet holds one.'}
            </Text>
          </View>
        </View>
        {seekerNote ? <Text style={styles.error}>{seekerNote}</Text> : null}
        {connected && verifierConfigured && !directMode && !seekerMint ? (
          <Button label="Check my Seeker" variant="secondary" icon="shield-checkmark-outline" loading={checking} onPress={() => void checkSeeker()} />
        ) : null}
      </GlassCard>

      <GlassCard style={styles.section}>
        <SectionLabel>Your activity</SectionLabel>
        <View style={styles.stats}>
          <Stat label="Explored" value={formatArea(exploredAreaKm2(exploredCount, 38.9))} />
          <Stat label="Chests opened" value={summary ? String(chestsOpened) : '—'} />
          <Stat label="Earned" value={summary ? String(summary.totalUsdc) : '—'} unit="USDC" />
        </View>
        <Text style={styles.muted}>
          {verifierConfigured
            ? directMode
              ? `${summary?.pendingReports ?? 0} submissions waiting for review · approved ${summary?.approvedUsdc ?? 0} USDC · paid ${summary?.paidUsdc ?? 0} USDC. Every submission is checked by a person, and approved rewards are paid weekly.`
              : 'Earnings are recorded by the verifier. Paying them out on-chain is a separate step.'
            : 'Earnings need a network connection, which this build does not have.'}
        </Text>
      </GlassCard>

      <GlassCard style={styles.section}>
        <SectionLabel>Privacy and data</SectionLabel>
        <Text style={styles.muted}>
          The ground you clear while the app is open, and your fog map, stay on this phone. Only cell-level counts and signal levels, rounded to 15-minute windows, are ever sent, and never network names or device addresses.
        </Text>
        <Button label="Erase fog map on this phone" variant="secondary" icon="trash-outline" disabled={!mappingIdle} onPress={eraseFog} />
        {connected && verifierConfigured ? (
          <Button label="Delete my data from the network" variant="secondary" icon="cloud-offline-outline" loading={erasing} onPress={eraseFromNetwork} />
        ) : null}
      </GlassCard>

      <GlassCard style={styles.links}>
        <LinkRow icon="albums-outline" label="Recordings" onPress={() => navigation.navigate('Recordings')} />
        <LinkRow icon="settings-outline" label="Settings" onPress={() => navigation.navigate('Settings')} />
      </GlassCard>

      {connected ? <Button label="Disconnect wallet" variant="ghost" icon="log-out-outline" onPress={confirmDisconnect} /> : null}
    </Screen>
  );
}

function LinkRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.link}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.linkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  links: { gap: 4, paddingVertical: 6 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  linkLabel: { ...typography.subheading, flex: 1, color: colors.textPrimary },
  title: { ...typography.heading, color: colors.textPrimary },
  userName: { ...typography.heading, fontSize: 24, color: colors.textPrimary },
  identity: { alignItems: 'center', gap: 10, paddingVertical: 22 },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.accentFaint,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.heading, color: colors.accent },
  address: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', gap: 8 },
  section: { gap: 12 },
  verify: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  verifyText: { flex: 1, gap: 2 },
  stats: { flexDirection: 'row', gap: 10 },
  rowTitle: { ...typography.subheading, fontSize: 15, color: colors.textPrimary },
  muted: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.danger, textAlign: 'center' },
});
