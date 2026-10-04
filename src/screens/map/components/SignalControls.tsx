import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SignalLayer, legendFor, rampColour, toHex } from '../../../mapping/signalLayer';
import { colors, typography } from '../../../theme';

const OPTIONS: { layer: SignalLayer; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { layer: 'cellular', label: 'Cellular', icon: 'cellular-outline' },
  { layer: 'wifi', label: 'Wi-Fi', icon: 'wifi-outline' },
  { layer: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth-outline' },
  { layer: 'off', label: 'Off', icon: 'eye-off-outline' },
];

/** Chooses what the mapped ground is tinted by. */
export function SignalChips({ value, onChange }: { value: SignalLayer; onChange: (layer: SignalLayer) => void }) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((o) => {
        const active = o.layer === value;
        return (
          <Pressable key={o.layer} onPress={() => onChange(o.layer)} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`Show ${o.label}`} style={[styles.chip, active && styles.chipActive]}>
            <Ionicons name={o.icon} size={14} color={active ? colors.background : colors.textSecondary} />
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const STEPS = 12;

/** A colour bar for the chosen layer, or a hint when nothing has been measured yet. */
export function SignalLegend({ layer, hasData }: { layer: Exclude<SignalLayer, 'off'>; hasData: boolean }) {
  const legend = legendFor(layer);
  return (
    <View style={styles.legend}>
      <Text style={styles.legendTitle}>{legend.title}</Text>
      {hasData ? (
        <>
          <View style={styles.bar}>
            {Array.from({ length: STEPS }, (_, i) => (
              <View key={i} style={{ flex: 1, backgroundColor: toHex(rampColour(layer, i / (STEPS - 1))) }} />
            ))}
          </View>
          <View style={styles.legendLabels}>
            <Text style={styles.legendLabel}>{legend.lowLabel}</Text>
            <Text style={styles.legendLabel}>{legend.highLabel}</Text>
          </View>
        </>
      ) : (
        <Text style={styles.legendHint}>Start mapping and walk. Measured ground lights up here.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(11,15,26,0.92)', borderColor: colors.surfaceBorder, borderWidth: 1 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  chipTextActive: { color: colors.background, fontFamily: 'SpaceGrotesk_500Medium' },
  legend: { alignSelf: 'flex-start', width: 210, backgroundColor: 'rgba(11,15,26,0.94)', borderColor: colors.surfaceBorder, borderWidth: 1, borderRadius: 14, padding: 10, gap: 6 },
  legendTitle: { ...typography.label, color: colors.textSecondary },
  bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  legendLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  legendLabel: { ...typography.caption, fontSize: 11, color: colors.textSecondary },
  legendHint: { ...typography.caption, color: colors.textTertiary },
});
