import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../../../theme';
import { formatElapsed } from '../../../mapping/hudFormat';
import { useElapsed } from '../../../mapping/useElapsed';
import { useMapping } from '../../../mapping/useMapping';

/** The session clock. It redraws every second, so it is its own component and the rest of the screen is left alone. */
export function SheetTimer() {
  const startedAtMs = useMapping((s) => s.startedAtMs);
  const elapsed = useElapsed(startedAtMs);
  return <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>;
}

/** The four live counters shown even when the sheet is collapsed: towers, Wi-Fi, Bluetooth and readings. */
export function MiniStats() {
  const totals = useMapping((s) => s.sessionTotals);
  const readings = useMapping((s) => s.scansThisSession);
  const items: { value: number; label: string; color: string }[] = [
    { value: totals.towers, label: 'Towers', color: '#3DDC84' },
    { value: totals.wifiUnique, label: 'Wi-Fi', color: '#B388FF' },
    { value: totals.bluetoothUnique, label: 'Bluetooth', color: '#FF80AB' },
    { value: readings, label: 'Readings', color: colors.accent },
  ];
  return (
    <View style={styles.row}>
      {items.map((i) => (
        <View key={i.label} style={styles.item}>
          <Text style={[styles.value, { color: i.color }]}>{i.value}</Text>
          <Text style={styles.label}>{i.label.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  timer: { ...typography.heading, fontSize: 22, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 8 },
  item: { flex: 1, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, paddingVertical: 7 },
  value: { ...typography.heading, fontSize: 18, fontVariant: ['tabular-nums'] },
  label: { ...typography.label, fontSize: 9, color: colors.textTertiary },
});
