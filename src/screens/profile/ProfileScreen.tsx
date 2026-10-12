import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../../components/dialog';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/Screen';
import { Badge, Button } from '../../components/ui';
import { Row, Section } from '../settings/SettingsParts';
import { colors, typography } from '../../theme';
import { shortAddress } from '../../wallet/format';
import { skrNameFromLabel, useSkrName } from '../../wallet/skrName';
import { useUnitSystem } from '../../units/units';
import { useWallet } from '../../wallet/useWallet';
import { useMapping } from '../../mapping/useMapping';
import { exploredAreaKm2, formatArea } from '../../mapping/explore';
import { NodeSummary, deleteMyData, fetchNodeSummary, verifySeeker } from '../../network/api';
import bs58 from 'bs58';
import { signText } from '../../wallet/signReport';
import { AZM_MINT, directMode, verifierConfigured } from '../../network/config';
import { fetchAzmBalance } from '../../wallet/azmBalance';
import type { ProfileStackParamList } from '../../navigation/types';

export default function ProfileScreen() {
  useUnitSystem(); // redraw when the unit setting changes
  const status = useWallet((s) => s.status);
  const address = useWallet((s) => s.address);
  const walletName = useWallet((s) => s.walletName);
  const error = useWallet((s) => s.error);
  const connect = useWallet((s) => s.connect);
  const disconnect = useWallet((s) => s.disconnect);

  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const exploredCount = useMapping((s) => Object.keys(s.explored).length);
  const [summary, setSummary] = useState<NodeSummary | null>(null);
  const [azm, setAzm] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!address || !verifierConfigured) return;
      let cancelled = false;
      fetchNodeSummary(address)
        .then((r) => !cancelled && setSummary(r))
        .catch(() => undefined);
      if (AZM_MINT) {
        fetchAzmBalance(address)
          .then((n) => !cancelled && setAzm(n))
          .catch(() => undefined);
      }
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
    appAlert(
      'Delete your data from the network?',
      'This erases the readings and places the verifier holds for this wallet. Your map progress on this phone stays. Records needed to prevent fraud and to pay what you are owed are kept; they contain no readings or places.',
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
              appAlert(
                result.ok ? (result.queued ? 'Request sent' : 'Deleted') : 'Could not delete',
                result.ok ? (result.queued ? 'It will be carried out at the next review, usually within a day.' : `Removed ${result.deletedBuckets ?? 0} stored readings.`) : result.error ?? 'Try again.'
              );
            } catch (e) {
              appAlert('Could not delete', e instanceof Error ? e.message : String(e));
            } finally {
              setErasing(false);
            }
          },
        },
      ]
    );

  const eraseFog = () =>
    appAlert('Erase your map progress?', 'The places you have uncovered on this phone will be covered again. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase', style: 'destructive', onPress: clearFog },
    ]);

  const seekerMint = summary?.seekerMint ?? null;
  const chestsOpened = summary ? summary.entries.filter((e) => e.kind === 'chest').length : 0;

  const connected = status === 'connected' && !!address;
  // The Seeker's wallet already gives the account its .skr name as its label (it shows next to the network), so that is the
  // user name. Only if the label is not a .skr name is the name looked up on-chain.
  const labelName = skrNameFromLabel(walletName);
  const lookedUp = useSkrName(connected && !labelName ? address : null);
  const skrName = labelName ?? lookedUp;
  const initials = skrName ? skrName.slice(0, 2).toUpperCase() : address ? address.slice(0, 2).toUpperCase() : '?';

  const confirmDisconnect = () =>
    appAlert('Disconnect wallet?', 'You can connect again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect() },
    ]);

  // A .skr name (Seeker ID) is only given to Seeker owners, so having one counts as having the Genesis Token. The reviewer
  // still checks the token itself when reports are reviewed; this is what the page shows.
  const seekerOk = !!seekerMint || !!skrName;
  const waiting = summary?.pendingReports ?? 0;
  const approvedUsdc = summary?.approvedUsdc ?? 0;
  const paidUsdc = summary?.paidUsdc ?? 0;
  const dash = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : String(v));

  return (
    <Screen>
      <View style={styles.topBar}>
        <Text style={styles.pageTitle} accessibilityRole="header">
          Profile
        </Text>
        <Pressable onPress={() => navigation.navigate('Settings')} accessibilityRole="button" accessibilityLabel="Settings" style={({ pressed }) => [styles.settingsBtn, pressed && styles.menuPressed]}>
          <Ionicons name="settings-outline" size={18} color={colors.accent} />
          <Text style={styles.settingsText}>Settings</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <View style={styles.avatarRing}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </View>
        {connected ? (
          <>
            <Text style={styles.userName} numberOfLines={1} accessibilityRole="header">
              {skrName ?? shortAddress(address!, 5, 5)}
            </Text>
            {skrName ? <Text style={styles.address}>{shortAddress(address!, 5, 5)}</Text> : null}
            <View style={styles.badges}>
              <Badge label="Wallet connected" color={colors.success} />
              {seekerOk ? <Badge label="Seeker verified" color={colors.accent} /> : null}
            </View>
          </>
        ) : (
          <>
            <Text style={styles.userName}>Welcome</Text>
            <Text style={styles.muted}>Connect your wallet to sign reports and receive rewards.</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Connect wallet" icon="wallet-outline" onPress={() => void connect()} loading={status === 'connecting'} style={styles.connect} />
          </>
        )}
      </View>

      <View style={styles.tiles}>
        {AZM_MINT ? (
          <View style={[styles.tile, styles.tileMain]}>
            <Text style={styles.tileLabel}>AZM BALANCE</Text>
            <Text style={[styles.tileValue, styles.tileValueMain]}>{dash(azm)}</Text>
          </View>
        ) : null}
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>USDC EARNED</Text>
          <Text style={styles.tileValue}>{dash(summary?.totalUsdc)}</Text>
        </View>
      </View>
      <View style={styles.tiles}>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>EXPLORED</Text>
          <Text style={styles.tileValueSm}>{formatArea(exploredAreaKm2(exploredCount, 38.9))}</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileLabel}>CHESTS OPENED</Text>
          <Text style={styles.tileValueSm}>{summary ? String(chestsOpened) : '—'}</Text>
        </View>
      </View>

      {connected && verifierConfigured ? (
        <Section icon="wallet-outline" title="Rewards" subtitle="Every submission is checked, approved rewards are paid weekly">
          <Row first label="Waiting for review" right={<Text style={styles.rowValue}>{waiting}</Text>} />
          <Row label="Approved" right={<Text style={styles.rowValue}>{approvedUsdc} USDC</Text>} />
          <Row label="Paid out" right={<Text style={styles.rowValue}>{paidUsdc} USDC</Text>} />
          {summary?.verified?.length
            ? summary.verified.slice(0, 5).map((v) => (
                <Pressable key={v.hash} onPress={() => void Linking.openURL(`https://explorer.solana.com/address/${v.record}?cluster=devnet`)} accessibilityRole="link" accessibilityLabel={`${v.type.replace('-', ' ')}, ${v.amount} AZM, view on Solana Explorer`}>
                  <Row
                    label={v.type.replace('-', ' ')}
                    hint="Verified on-chain"
                    right={
                      <View style={styles.paid}>
                        <Text style={styles.paidText}>+{v.amount} AZM</Text>
                        <Ionicons name="open-outline" size={15} color={colors.textTertiary} />
                      </View>
                    }
                  />
                </Pressable>
              ))
            : null}
        </Section>
      ) : null}

      <Section icon="shield-checkmark-outline" title="Seeker" subtitle="One node per Seeker device">
        <Row
          first
          label="Genesis Token"
          hint={
            seekerMint
              ? `Verified · ${shortAddress(seekerMint, 5, 5)}`
              : skrName
                ? `Verified · Seeker ID ${skrName}`
                : !connected
                ? 'Connect a wallet to check.'
                : !verifierConfigured
                  ? 'Needs a network connection.'
                  : directMode
                    ? 'Checked when your reports are reviewed.'
                    : 'Check that this wallet holds one.'
          }
          right={<Ionicons name={seekerOk ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={seekerOk ? colors.success : colors.textTertiary} />}
        >
          {seekerNote ? <Text style={styles.error}>{seekerNote}</Text> : null}
          {connected && verifierConfigured && !directMode && !seekerOk ? (
            <Button label="Check my Seeker" variant="secondary" compact icon="shield-checkmark-outline" loading={checking} onPress={() => void checkSeeker()} />
          ) : null}
        </Row>
      </Section>

      <Section icon="apps-outline" title="More" subtitle="Everything else in the app">
        <MoreRow icon="settings-outline" title="Settings" subtitle="Units, location, receiver and backup" onPress={() => navigation.navigate('Settings')} />
        <View style={styles.moreDivider} />
        <MoreRow icon="albums-outline" title="Recordings" subtitle="Your saved satellite passes and exports" onPress={() => navigation.navigate('Recordings')} />
      </Section>

      <Section icon="lock-closed-outline" title="Others" subtitle="Your map progress stays on this phone. Only rounded cell counts and signal levels are sent.">
        <Pressable onPress={eraseFog} disabled={!mappingIdle} accessibilityRole="button" style={!mappingIdle && styles.disabled}>
          <Row first label="Erase map progress on this phone" hint={mappingIdle ? undefined : 'Stop mapping first.'} right={<Ionicons name="trash-outline" size={19} color={colors.danger} />} />
        </Pressable>
        {connected && verifierConfigured ? (
          <Pressable onPress={eraseFromNetwork} disabled={erasing} accessibilityRole="button" style={erasing && styles.disabled}>
            <Row label="Delete my data from the network" hint={erasing ? 'Working…' : undefined} right={<Ionicons name="cloud-offline-outline" size={19} color={colors.danger} />} />
          </Pressable>
        ) : null}
      </Section>

      {connected ? <Button label="Disconnect wallet" variant="ghost" icon="log-out-outline" onPress={confirmDisconnect} /> : null}
    </Screen>
  );
}

/** A tappable row in the More section: icon, title, what is inside, and an arrow. */
function MoreRow({ icon, title, subtitle, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`} style={({ pressed }) => [styles.moreRow, pressed && styles.menuPressed]}>
      <View style={styles.menuIcon}>
        <Ionicons name={icon} size={22} color={colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSub}>{subtitle}</Text>
      </View>
      <View style={styles.menuArrow}>
        <Ionicons name="arrow-forward" size={18} color={colors.accent} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  moreDivider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.surfaceBorder, marginHorizontal: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { ...typography.display, fontSize: 30, color: colors.textPrimary },
  settingsBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.accentFaint, borderWidth: 1, borderColor: colors.accentMuted },
  settingsText: { ...typography.subheading, fontSize: 14, color: colors.accent },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  menuPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  menuIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { ...typography.subheading, fontSize: 17, color: colors.textPrimary },
  menuSub: { ...typography.caption, color: colors.textSecondary },
  menuArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.backgroundElevated, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 16, borderRadius: 24, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accentMuted },
  avatarRing: { padding: 4, borderRadius: 48, borderWidth: 2, borderColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.7, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.accentFaint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typography.heading, fontSize: 26, color: colors.accent },
  userName: { ...typography.heading, fontSize: 24, color: colors.textPrimary, marginTop: 4 },
  address: { ...typography.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  badges: { flexDirection: 'row', gap: 8, marginTop: 4 },
  connect: { alignSelf: 'stretch', marginTop: 8 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, gap: 6, padding: 16, borderRadius: 18, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.surfaceBorder },
  tileMain: { borderColor: colors.accentMuted, backgroundColor: colors.accentFaint },
  tileLabel: { ...typography.label, color: colors.textSecondary },
  tileValue: { ...typography.display, fontSize: 28, color: colors.textPrimary },
  tileValueMain: { color: colors.accent },
  tileValueSm: { ...typography.heading, color: colors.textPrimary },
  rowValue: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  paid: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paidText: { ...typography.subheading, fontSize: 14, color: colors.success },
  disabled: { opacity: 0.45 },
  muted: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  error: { ...typography.caption, color: colors.danger, textAlign: 'center' },
});
