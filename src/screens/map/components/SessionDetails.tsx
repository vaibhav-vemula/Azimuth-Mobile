import { Share, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../components/GlassCard';
import { Badge, Button, SectionLabel } from '../../../components/ui';
import { colors, typography } from '../../../theme';
import { SCAN_INTERVAL_MS, useMapping } from '../../../mapping/useMapping';
import { useReceiver } from '../../../receiver/useReceiver';
import { useSubmission } from '../../../network/useSubmission';
import { useWallet } from '../../../wallet/useWallet';
import { exploredAreaKm2 } from '../../../mapping/explore';
import { hexCenter, parseCellId } from '../../../mapping/hexGrid';
import { Quality, cellularBars, cellularQuality, formatAreaParts, formatElapsed, formatWalked } from '../../../mapping/hudFormat';
import { useElapsed } from '../../../mapping/useElapsed';

const QUALITY_COLOR: Record<Quality, string> = {
  none: colors.danger,
  poor: '#FF8A50',
  fair: colors.warning,
  good: colors.success,
  great: '#2EE6C5',
};

/** What the sheet shows when pulled up: live stats while mapping, or the last session and how to submit it. */
export function SessionDetails() {
  const status = useMapping((s) => s.status);
  const running = status === 'running';
  return <View style={styles.stack}>{running ? <LiveStats /> : <LastSession />}</View>;
}

function LiveStats() {
  const startedAtMs = useMapping((s) => s.startedAtMs);
  const cleared = useMapping((s) => s.sessionClearedCells);
  const walked = useMapping((s) => s.sessionDistanceM);
  const scans = useMapping((s) => s.scansThisSession);
  const newCells = useMapping((s) => s.newCellsThisSession);
  const lastScan = useMapping((s) => s.lastScan);
  const radioEnabled = useMapping((s) => s.radioEnabled);
  const radioStatus = useMapping((s) => s.radioStatus);
  const setRadioEnabled = useMapping((s) => s.setRadioEnabled);
  const cell = useMapping((s) => s.currentCellId);
  const dongle = useReceiver((s) => s.status !== 'disconnected' && s.status !== 'error');
  const elapsed = useElapsed(startedAtMs);

  const best = lastScan?.cellular.cells.length ? Math.max(...lastScan.cellular.cells.map((c) => c.dbm)) : null;
  const quality = cellularQuality(best);
  const bars = cellularBars(best);
  const parsed = cell ? parseCellId(cell) : null;
  const lat = parsed ? hexCenter(parsed.hex, parsed.sizeM).latitudeDeg : 38.9;
  const area = formatAreaParts(exploredAreaKm2(cleared, lat));
  const dist = formatWalked(walked);

  return (
    <>
      <View style={styles.tiles}>
        <Tile value={area.value} unit={area.unit} label="Cleared" accent />
        <Tile value={dist.value} unit={dist.unit} label="Walked" />
        <Tile value={String(scans)} label="Readings" />
        <Tile value={String(newCells)} label="New cells" />
      </View>

      <View style={styles.headRow}>
        <SectionLabel>Live signals</SectionLabel>
        <Text style={styles.note}>Session {formatElapsed(elapsed)}</Text>
      </View>
      <View style={styles.signals}>
        <Signal
          label="Cellular"
          value={lastScan?.cellular.available ? (best === null ? 'No signal' : `${Math.round(best)} dBm`) : 'No access'}
          sub={lastScan ? `${lastScan.cellular.cells.length} ${lastScan.cellular.cells.length === 1 ? 'cell' : 'cells'}` : undefined}
          color={QUALITY_COLOR[quality]}
          visual={<Bars count={bars} color={QUALITY_COLOR[quality]} />}
        />
        <Signal icon="wifi-outline" label="Wi-Fi" value={lastScan?.wifi.available ? `${lastScan.wifi.count ?? 0} networks` : 'No access'} sub={lastScan?.wifi.strongestDbm != null ? `strongest ${Math.round(lastScan.wifi.strongestDbm)} dBm` : undefined} color="#B388FF" />
        <Signal icon="bluetooth-outline" label="Bluetooth" value={lastScan?.bluetooth?.available ? `${lastScan.bluetooth.count ?? 0} devices` : lastScan ? 'Next scan soon' : '—'} color="#FF80AB" />
        <Signal icon="navigate-outline" label="GPS" value={lastScan?.gnss.used != null ? `${lastScan.gnss.used} satellites` : '—'} sub={lastScan?.gnss.avgCn0Used != null ? `${lastScan.gnss.avgCn0Used.toFixed(0)} dB-Hz` : undefined} color={colors.accent} />
        <Signal
          icon="radio-outline"
          label="Radio (NOAA)"
          value={!radioEnabled ? 'Off' : !dongle ? 'No dongle' : lastScan?.radio ? (lastScan.radio.carrier ? `Received · ${lastScan.radio.peakDb.toFixed(0)} dB` : 'No carrier') : radioStatus === 'skipped' ? 'Busy, retrying' : 'Next reading soon'}
          sub={lastScan?.radio ? `gain ${lastScan.radio.gainDb} dB` : undefined}
          color="#4FC3F7"
        />
      </View>

      <View style={styles.toggle}>
        <Text style={styles.toggleText}>Take dongle readings when an RTL-SDR is plugged in</Text>
        <Switch value={radioEnabled} onValueChange={setRadioEnabled} trackColor={{ true: colors.accent, false: colors.surfaceBorder }} />
      </View>
      <Text style={styles.note}>
        A reading is taken about every {Math.round(SCAN_INTERVAL_MS / 1000)} seconds, and the fog clears as you walk. Android limits Wi-Fi scans, so some readings reuse the last result. Only counts and signal levels are kept, never network names or device addresses.
      </Text>
    </>
  );
}

function LastSession() {
  const lastReport = useMapping((s) => s.lastReport);
  const address = useWallet((s) => s.address);
  const submission = useSubmission();

  if (!lastReport) {
    return (
      <GlassCard style={styles.card}>
        <Text style={styles.note}>Nothing recorded yet. Start mapping and walk around: the fog clears where you go, and the readings you take can be submitted afterwards.</Text>
      </GlassCard>
    );
  }
  return (
    <GlassCard style={styles.card}>
      <SectionLabel>Last session</SectionLabel>
      <View style={styles.tiles}>
        <Tile value={String(new Set(lastReport.buckets.map((b) => b.cellId)).size)} label="Cells" />
        <Tile value={String(lastReport.checks.samples)} label="Readings" />
        <Tile value={formatElapsed(lastReport.checks.durationSec)} label="Duration" />
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
  );
}

function Tile({ value, unit, label, accent }: { value: string; unit?: string; label: string; accent?: boolean }) {
  return (
    <View style={[styles.tile, accent && styles.tileAccent]}>
      <Text style={[styles.tileValue, accent && { color: '#7DF3FF' }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {unit ? <Text style={styles.tileUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

function Bars({ count, color }: { count: number; color: string }) {
  return (
    <View style={styles.bars}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: 4, height: 5 + i * 4, borderRadius: 1.5, backgroundColor: i < count ? color : 'rgba(255,255,255,0.14)' }} />
      ))}
    </View>
  );
}

function Signal({ icon, label, value, sub, color, visual }: { icon?: keyof typeof Ionicons.glyphMap; label: string; value: string; sub?: string; color: string; visual?: React.ReactNode }) {
  return (
    <View style={styles.signal}>
      <View style={[styles.signalIcon, { backgroundColor: `${color}22` }]}>{visual ?? <Ionicons name={icon ?? 'ellipse'} size={18} color={color} />}</View>
      <View style={styles.signalText}>
        <Text style={styles.signalLabel}>{label.toUpperCase()}</Text>
        <Text style={styles.signalValue} numberOfLines={1}>
          {value}
        </Text>
        {sub ? <Text style={styles.signalSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  card: { gap: 12 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 2 },
  tileAccent: { backgroundColor: 'rgba(77,208,225,0.10)', borderColor: colors.accentMuted, borderWidth: 1 },
  tileValue: { ...typography.heading, fontSize: 20, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  tileUnit: { ...typography.caption, color: colors.textSecondary },
  tileLabel: { ...typography.label, fontSize: 10, color: colors.textTertiary },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signals: { gap: 8 },
  signal: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 10 },
  signalIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  signalText: { flex: 1 },
  signalLabel: { ...typography.label, fontSize: 10, color: colors.textTertiary },
  signalValue: { ...typography.subheading, fontSize: 15, color: colors.textPrimary },
  signalSub: { ...typography.caption, color: colors.textSecondary },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  note: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  error: { ...typography.caption, color: colors.danger },
});
