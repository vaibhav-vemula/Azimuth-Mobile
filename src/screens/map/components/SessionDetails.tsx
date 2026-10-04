import { useEffect, useState } from 'react';
import { Share, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../components/GlassCard';
import { Badge, Button, SectionLabel, Stat } from '../../../components/ui';
import { colors, typography } from '../../../theme';
import { SCAN_INTERVAL_MS, useMapping } from '../../../mapping/useMapping';
import { useReceiver } from '../../../receiver/useReceiver';
import { useSubmission } from '../../../network/useSubmission';
import { useWallet } from '../../../wallet/useWallet';
import { formatDuration } from '../../../utils/format';

function useElapsed(startedAtMs: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAtMs) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAtMs]);
  return startedAtMs ? Math.max(0, (now - startedAtMs) / 1000) : 0;
}

const dbmLabel = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v)} dBm` : '—');

/** Everything about the current or last mapping session: live readings, and signing and submitting the result. */
export function SessionDetails() {
  const status = useMapping((s) => s.status);
  const newCells = useMapping((s) => s.newCellsThisSession);
  const scans = useMapping((s) => s.scansThisSession);
  const lastScan = useMapping((s) => s.lastScan);
  const startedAtMs = useMapping((s) => s.startedAtMs);
  const radioEnabled = useMapping((s) => s.radioEnabled);
  const radioStatus = useMapping((s) => s.radioStatus);
  const setRadioEnabled = useMapping((s) => s.setRadioEnabled);
  const lastReport = useMapping((s) => s.lastReport);
  const dongle = useReceiver((s) => s.status !== 'disconnected' && s.status !== 'error');
  const address = useWallet((s) => s.address);
  const submission = useSubmission();
  const elapsed = useElapsed(startedAtMs);
  const running = status === 'running';
  const best = lastScan?.cellular.cells.length ? Math.max(...lastScan.cellular.cells.map((c) => c.dbm)) : null;

  return (
    <View style={styles.stack}>
      {running ? (
        <GlassCard style={styles.card}>
          <SectionLabel>This session</SectionLabel>
          <View style={styles.row}>
            <Stat label="Time" value={formatDuration(elapsed)} />
            <Stat label="New cells" value={String(newCells)} color={newCells > 0 ? colors.accent : undefined} />
            <Stat label="Readings" value={String(scans)} />
          </View>
          <SectionLabel style={styles.gap}>Live signals</SectionLabel>
          <View style={styles.signals}>
            <Signal icon="cellular-outline" label="Cellular" value={lastScan?.cellular.available ? dbmLabel(best) : 'No access'} sub={lastScan ? `${lastScan.cellular.cells.length} cells` : undefined} />
            <Signal icon="wifi-outline" label="Wi-Fi" value={lastScan?.wifi.available ? `${lastScan.wifi.count ?? 0} networks` : 'No access'} sub={lastScan?.wifi.strongestDbm != null ? dbmLabel(lastScan.wifi.strongestDbm) : undefined} />
            <Signal icon="bluetooth-outline" label="Bluetooth" value={lastScan?.bluetooth?.available ? `${lastScan.bluetooth.count ?? 0} devices` : lastScan ? 'Next scan soon' : '—'} />
            <Signal
              icon="radio-outline"
              label="Radio (NOAA)"
              value={!radioEnabled ? 'Off' : !dongle ? 'No dongle' : lastScan?.radio ? (lastScan.radio.carrier ? `Received · ${lastScan.radio.peakDb.toFixed(0)} dB` : 'No carrier') : radioStatus === 'skipped' ? 'Busy, retrying' : 'Next reading soon'}
              sub={lastScan?.radio ? `gain ${lastScan.radio.gainDb} dB` : undefined}
            />
            <Signal icon="navigate-outline" label="GNSS" value={lastScan?.gnss.avgCn0Used != null ? `${lastScan.gnss.avgCn0Used.toFixed(0)} dB-Hz` : '—'} sub={lastScan?.gnss.used != null ? `${lastScan.gnss.used} in use` : undefined} />
          </View>
          <View style={styles.toggle}>
            <Text style={styles.note}>Take dongle readings when an RTL-SDR is plugged in</Text>
            <Switch value={radioEnabled} onValueChange={setRadioEnabled} trackColor={{ true: colors.accent, false: colors.surfaceBorder }} />
          </View>
          <Text style={styles.note}>
            A reading is taken about every {Math.round(SCAN_INTERVAL_MS / 1000)} seconds. Android limits Wi-Fi scans, so some readings reuse the last result. Only counts and signal levels are kept, never network names or device addresses.
          </Text>
        </GlassCard>
      ) : null}

      {lastReport && !running ? (
        <GlassCard style={styles.card}>
          <SectionLabel>Last session</SectionLabel>
          <View style={styles.row}>
            <Stat label="Cells" value={String(new Set(lastReport.buckets.map((b) => b.cellId)).size)} />
            <Stat label="Readings" value={String(lastReport.checks.samples)} />
            <Stat label="Duration" value={formatDuration(lastReport.checks.durationSec)} />
          </View>
          {submission.state.phase === 'done' ? (
            <>
              <Badge label={submission.state.pending ? 'Submitted for review' : submission.state.accepted ? 'Accepted' : 'Rejected'} color={submission.state.accepted ? (submission.state.pending ? colors.accent : colors.success) : colors.danger} />
              <Text style={styles.note}>{submission.state.message}</Text>
            </>
          ) : (
            <>
              {submission.state.phase === 'error' ? <Text style={styles.error}>{submission.state.message}</Text> : null}
              <Button
                label={submission.state.phase === 'signing' ? 'Waiting for wallet…' : submission.state.phase === 'sending' ? 'Sending…' : 'Sign and submit'}
                icon="shield-checkmark-outline"
                disabled={!address}
                loading={submission.state.phase === 'signing' || submission.state.phase === 'sending'}
                onPress={() => void submission.submit(lastReport)}
              />
              <Button
                label="Share signed file"
                variant="secondary"
                icon="share-outline"
                disabled={!address}
                onPress={() => void submission.signOnly(lastReport).then((env) => env && Share.share({ message: JSON.stringify(env, null, 2) }))}
              />
              {!address ? <Text style={styles.note}>Connect a wallet in Profile to sign and submit.</Text> : null}
            </>
          )}
        </GlassCard>
      ) : null}

      {!running && !lastReport ? (
        <GlassCard style={styles.card}>
          <Text style={styles.note}>
            Nothing recorded yet. Tap Start mapping and walk around: the fog clears where you go, and the readings you take can be submitted afterwards.
          </Text>
        </GlassCard>
      ) : null}
    </View>
  );
}

function Signal({ icon, label, value, sub }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; sub?: string }) {
  return (
    <View style={styles.signal}>
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Text style={styles.signalLabel}>{label}</Text>
      <Text style={styles.signalValue}>{value}</Text>
      {sub ? <Text style={styles.signalSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  card: { gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  gap: { marginTop: 4 },
  signals: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  signal: { width: '47%', flexGrow: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 2 },
  signalLabel: { ...typography.label, color: colors.textTertiary },
  signalValue: { ...typography.subheading, fontSize: 15, color: colors.textPrimary },
  signalSub: { ...typography.caption, color: colors.textSecondary },
  note: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  error: { ...typography.caption, color: colors.danger },
});
