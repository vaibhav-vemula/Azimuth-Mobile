import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../../../theme';
import { levelDbfs } from '../../../mapping/radio';
import { formatElapsed } from '../../../mapping/hudFormat';
import { useElapsed } from '../../../mapping/useElapsed';
import { useMapping } from '../../../mapping/useMapping';

/** The session clock. It redraws every second, so it is its own component and the rest of the screen is left alone. */
export function SheetTimer() {
  const startedAtMs = useMapping((s) => s.startedAtMs);
  const elapsed = useElapsed(startedAtMs);
  return <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>;
}

/** The four live counters shown even when the sheet is collapsed, as an icon and a number: towers, Wi-Fi, Bluetooth and the radio level. */
export function MiniStats({ showLabels = false }: { showLabels?: boolean }) {
  const totals = useMapping((s) => s.sessionTotals);
  const radio = useMapping((s) => s.lastScan?.radio);
  const radioLevel = radio ? Math.round(levelDbfs(radio.rms)) : null;
  const items: { value: number | string; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
    { value: totals.towers, label: 'Towers', icon: 'cellular', color: '#3DDC84' },
    { value: totals.wifiUnique, label: 'Wi-Fi', icon: 'wifi', color: '#B388FF' },
    { value: totals.bluetoothUnique, label: 'Bluetooth', icon: 'bluetooth', color: '#FF80AB' },
    // The latest radio level in dB below full scale; a dash until the dongle has taken a reading.
    { value: radioLevel === null ? '–' : `${radioLevel}`, label: 'Radio', icon: 'radio', color: '#4FC3F7' },
  ];
  return (
    <View style={styles.row}>
      {items.map((i) => (
        <View key={i.label} style={[styles.item, showLabels && styles.itemStacked]} accessible accessibilityLabel={`${i.label}: ${i.value}`}>
          <View style={styles.top}>
            <View style={[styles.badge, { backgroundColor: `${i.color}26` }]}>
              <Ionicons name={i.icon} size={16} color={i.color} />
            </View>
            <Text style={[styles.value, { color: i.color }]}>{i.value}</Text>
          </View>
          {showLabels ? <Text style={styles.label} numberOfLines={1}>{i.label.toUpperCase()}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  timer: { ...typography.heading, fontSize: 22, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 8 },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 6 },
  itemStacked: { paddingVertical: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { ...typography.label, fontSize: 9, color: colors.textTertiary },
  badge: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  value: { ...typography.heading, fontSize: 18, fontVariant: ['tabular-nums'] },
});
