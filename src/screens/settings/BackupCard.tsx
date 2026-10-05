import { StyleSheet, Text } from 'react-native';
import { GlassCard } from '../../components/GlassCard';
import { Badge, Button, SectionLabel } from '../../components/ui';
import { colors, typography } from '../../theme';
import { useBackup } from '../../backup/useBackup';
import { useWallet } from '../../wallet/useWallet';

function when(ms: number | null): string {
  if (!ms) return 'not yet';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Turns on the encrypted, wallet-keyed backup of the map progress, and syncs it. */
export function BackupCard() {
  const { phase, enabled, lastMs, message, error, available, enable, syncNow, disable } = useBackup();
  const address = useWallet((s) => s.address);
  const busy = phase !== 'idle';

  return (
    <GlassCard style={{ gap: 12 }}>
      <SectionLabel>Back up your map</SectionLabel>
      <Text style={styles.text}>
        Keeps your cleared fog and signal map safe if you reinstall or switch phones. It is encrypted on this phone with a key made from your wallet, so nobody else can read it, not even us. Restore it on any phone by turning backup on with the same wallet.
      </Text>

      {!available ? (
        <Text style={styles.text}>Online backup is not available in this build. Android's automatic backup still protects your progress if it is turned on in your phone's settings.</Text>
      ) : !address ? (
        <Text style={styles.text}>Connect a wallet in Profile to turn on backup.</Text>
      ) : enabled ? (
        <>
          <Badge label={`On · last backup ${when(lastMs)}`} color={colors.success} />
          <Text style={styles.text}>It also runs by itself when you stop mapping.</Text>
          <Button label={phase === 'syncing' ? 'Syncing…' : 'Back up and sync now'} icon="cloud-upload-outline" loading={phase === 'syncing'} disabled={busy} onPress={() => void syncNow()} />
          <Button label="Turn off" variant="secondary" disabled={busy} onPress={disable} />
        </>
      ) : (
        <>
          <Button label={phase === 'unlocking' ? 'Waiting for wallet…' : 'Turn on backup'} icon="shield-checkmark-outline" loading={busy} disabled={busy} onPress={() => void enable()} />
          <Text style={styles.small}>Your wallet asks you to approve signing a short message. It costs nothing and sends nothing on-chain.</Text>
        </>
      )}

      {message ? <Text style={styles.ok}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  text: { ...typography.body, color: colors.textSecondary },
  small: { ...typography.caption, color: colors.textTertiary },
  ok: { ...typography.caption, color: colors.success },
  error: { ...typography.caption, color: colors.danger },
});
