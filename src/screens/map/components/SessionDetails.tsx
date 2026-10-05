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
import { levelDbfs } from '../../../mapping/radio';
import { useUnitSystem } from '../../../units/units';
import { Quality, cellularBars, cellularQuality, formatAreaParts, formatElapsed, formatPlmn, formatWalked, techLabel } from '../../../mapping/hudFormat';

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
  useUnitSystem(); // redraw when the unit setting changes
  const cleared = useMapping((s) => s.sessionClearedCells);
  const walked = useMapping((s) => s.sessionDistanceM);
  const newCells = useMapping((s) => s.newCellsThisSession);
  const totals = useMapping((s) => s.sessionTotals);
  const lastScan = useMapping((s) => s.lastScan);
  const radioEnabled = useMapping((s) => s.radioEnabled);
  const radioStatus = useMapping((s) => s.radioStatus);
  const setRadioEnabled = useMapping((s) => s.setRadioEnabled);
  const cell = useMapping((s) => s.currentCellId);
  const dongle = useReceiver((s) => s.status !== 'disconnected' && s.status !== 'error');

  const parsed = cell ? parseCellId(cell) : null;
  const lat = parsed ? hexCenter(parsed.hex, parsed.sizeM).latitudeDeg : 38.9;
  const area = formatAreaParts(exploredAreaKm2(cleared, lat));
  const dist = formatWalked(walked);

  const best = lastScan?.cellular.cells.length ? Math.max(...lastScan.cellular.cells.map((c) => c.dbm)) : null;
  const quality = cellularQuality(best);
  const techs = (['nr', 'lte', 'wcdma', 'gsm'] as const).filter((t) => totals.towersByTech[t] > 0);

  return (
    <>
      <View style={styles.tiles}>
        <Tile icon="map" value={area.value} unit={area.unit} label="Cleared" accent />
        <Tile icon="walk" value={dist.value} unit={dist.unit} label="Walked" />
        <Tile icon="sparkles" value={String(newCells)} label="New cells" />
      </View>

      <StatCard icon="cellular" color={QUALITY_COLOR[quality]} title="Cell towers" big={String(totals.towers)} bigLabel={totals.towers === 1 ? 'tower heard' : 'different towers heard'}>
        {techs.length > 0 ? (
          <View style={styles.chips}>
            {techs.map((t) => (
              <View key={t} style={styles.chip}>
                <Text style={styles.chipText}>
                  {techLabel(t)} · {totals.towersByTech[t]}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <Row label="Connected to" value={totals.serving ? `${techLabel(totals.serving.tech)} · channel ${totals.serving.channel}` : lastScan?.cellular.available ? 'No signal right now' : 'No access'} />
        {totals.serving ? <Row label="Network" value={formatPlmn(totals.serving.plmn)} /> : null}
        <Row
          label="Signal now"
          value={best === null ? '—' : `${Math.round(best)} dBm`}
          right={<Bars count={cellularBars(best)} color={QUALITY_COLOR[quality]} />}
        />
        <Row label="Session range" value={totals.cellularMin === null ? '—' : `${Math.round(totals.cellularMin)} to ${Math.round(totals.cellularMax ?? 0)} dBm (avg ${Math.round(totals.cellularAvg ?? 0)})`} />
        <Row label="Dead spots" value={`${totals.deadReadings} ${totals.deadReadings === 1 ? 'reading' : 'readings'} with no signal`} />
      </StatCard>

      <StatCard icon="wifi" color="#B388FF" title="Wi-Fi" big={String(totals.wifiUnique)} bigLabel={totals.wifiUnique === 1 ? 'network seen' : 'different networks seen'}>
        <Row label="Around you now" value={lastScan?.wifi.available ? `${totals.wifiNow}` : 'No access'} />
        <Row label="Bands now" value={`2.4 GHz ${totals.wifiBands.ghz24} · 5 GHz ${totals.wifiBands.ghz5} · 6 GHz ${totals.wifiBands.ghz6}`} />
        <Row label="Strongest this session" value={totals.wifiStrongestDbm === null ? '—' : `${Math.round(totals.wifiStrongestDbm)} dBm`} />
      </StatCard>

      <StatCard icon="bluetooth" color="#FF80AB" title="Bluetooth" big={String(totals.bluetoothUnique)} bigLabel={totals.bluetoothUnique === 1 ? 'device seen' : 'different devices seen'}>
        <Row label="Around you now" value={lastScan?.bluetooth?.available ? `${totals.bluetoothNow}` : lastScan ? 'Next scan soon' : '—'} />
        <Row label="Most at once" value={String(totals.bluetoothPeak)} />
      </StatCard>

      <StatCard icon="navigate" color={colors.accent} title="GPS" big={totals.gpsUsed === null ? '—' : String(totals.gpsUsed)} bigLabel="satellites in use">
        <Row label="Best signal" value={totals.gpsBestCn0 === null ? '—' : `${totals.gpsBestCn0.toFixed(0)} dB-Hz`} />
      </StatCard>

      <StatCard
        icon="radio"
        color="#4FC3F7"
        title="Radio signal (RTL-SDR)"
        big={!radioEnabled ? 'Off' : !dongle ? 'No dongle' : lastScan?.radio ? `${levelDbfs(lastScan.radio.rms).toFixed(0)} dBFS` : radioStatus === 'skipped' ? 'Busy' : 'Waiting'}
        bigLabel={lastScan?.radio ? `across ${lastScan.radio.windows ?? 1} bands · gain ${lastScan.radio.gainDb} dB` : 'plug an RTL-SDR in, then start mapping'}
        small
      >
        <View style={styles.toggle}>
          <Text style={styles.toggleText}>Take dongle readings when an RTL-SDR is plugged in</Text>
          <Switch value={radioEnabled} onValueChange={setRadioEnabled} trackColor={{ true: colors.accent, false: colors.surfaceBorder }} />
        </View>
      </StatCard>

      <Text style={styles.note}>
        A reading is taken about every {Math.round(SCAN_INTERVAL_MS / 1000)} seconds, and the fog clears as you walk. Android limits Wi-Fi scans, so some readings reuse the last result. Different networks and devices are counted without keeping their names or addresses, and those counts stay on your phone.
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

function StatCard({ icon, color, title, big, bigLabel, small, children }: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; big: string; bigLabel: string; small?: boolean; children?: React.ReactNode }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHead}>
        <View style={[styles.statIcon, { backgroundColor: `${color}22` }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        <Text style={styles.statTitle}>{title.toUpperCase()}</Text>
      </View>
      <View style={styles.bigRow}>
        <Text style={[styles.big, small && styles.bigSmall, { color }]}>{big}</Text>
        <Text style={styles.bigLabel}>{bigLabel}</Text>
      </View>
      {children ? <View style={styles.statBody}>{children}</View> : null}
    </View>
  );
}

function Row({ label, value, right }: { label: string; value: string; right?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueBox}>
        <Text style={styles.rowValue} numberOfLines={2}>
          {value}
        </Text>
        {right}
      </View>
    </View>
  );
}

function Tile({ icon, value, unit, label, accent }: { icon?: keyof typeof Ionicons.glyphMap; value: string; unit?: string; label: string; accent?: boolean }) {
  return (
    <View style={[styles.tile, accent && styles.tileAccent]} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}>
      {icon ? <Ionicons name={icon} size={16} color={accent ? '#7DF3FF' : colors.textSecondary} /> : null}
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
  statCard: { backgroundColor: 'rgba(255,255,255,0.045)', borderRadius: 18, padding: 14, gap: 10, borderColor: colors.surfaceBorder, borderWidth: 1 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statTitle: { ...typography.label, color: colors.textSecondary },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  big: { ...typography.display, fontSize: 38, fontVariant: ['tabular-nums'], lineHeight: 44 },
  bigSmall: { fontSize: 24, lineHeight: 30 },
  bigLabel: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  statBody: { gap: 8, borderTopColor: colors.surfaceBorder, borderTopWidth: StyleSheet.hairlineWidth * 2, paddingTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { ...typography.caption, color: colors.textPrimary },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  rowLabel: { ...typography.caption, color: colors.textSecondary, flexShrink: 0 },
  rowValueBox: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  rowValue: { ...typography.caption, color: colors.textPrimary, textAlign: 'right', flexShrink: 1 },
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
