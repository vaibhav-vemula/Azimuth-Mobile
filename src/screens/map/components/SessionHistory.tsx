import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../../../theme';
import { useMapping } from '../../../mapping/useMapping';
import { SessionRecord, sessionDate, useSessionView } from '../../../mapping/sessionHistory';
import { formatElapsed } from '../../../mapping/hudFormat';
import { areaParts, walkedParts, useUnitSystem } from '../../../units/units';

/** Past mapping sessions, newest first. Tap one to see the ground it cleared outlined on the map. */
export function SessionHistory() {
  useUnitSystem(); // redraw when the unit setting changes
  const sessions = useMapping((s) => s.sessions);
  const selectedId = useSessionView((s) => s.selectedId);
  const show = useSessionView((s) => s.show);
  const remove = useMapping((s) => s.removeSession);

  if (sessions.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>SESSION HISTORY</Text>
      {sessions.map((r) => (
        <Row
          key={r.id}
          record={r}
          selected={r.id === selectedId}
          onShow={() => show(r.id === selectedId ? null : r.id)}
          onDelete={() =>
            Alert.alert('Delete this session?', 'It is removed from the history. The fog it cleared stays cleared.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  if (r.id === selectedId) show(null);
                  remove(r.id);
                },
              },
            ])
          }
        />
      ))}
    </View>
  );
}

function Row({ record: r, selected, onShow, onDelete }: { record: SessionRecord; selected: boolean; onShow: () => void; onDelete: () => void }) {
  const area = areaParts(r.areaKm2);
  const dist = walkedParts(r.distanceM);
  return (
    <Pressable onPress={onShow} accessibilityRole="button" accessibilityLabel={`Show the session from ${sessionDate(r.startedMs)} on the map`} style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}>
      <View style={styles.top}>
        <Text style={styles.date}>{sessionDate(r.startedMs)}</Text>
        <Pressable onPress={onDelete} hitSlop={10} accessibilityRole="button" accessibilityLabel="Delete this session">
          <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
        </Pressable>
      </View>
      <Text style={styles.summary}>
        {formatElapsed(r.durationSec)} · {dist.value} {dist.unit} · {area.value} {area.unit} cleared
      </Text>
      <View style={styles.chips}>
        <Stat icon="cellular" color="#3DDC84" value={r.towers} label="towers" />
        <Stat icon="wifi" color="#B388FF" value={r.wifi} label="Wi-Fi" />
        <Stat icon="bluetooth" color="#FF80AB" value={r.bluetooth} label="Bluetooth" />
        {r.radioDbfs !== null ? <Stat icon="radio" color="#4FC3F7" value={`${r.radioDbfs} dBFS`} label="radio" /> : null}
      </View>
      <View style={styles.foot}>
        <Ionicons name={selected ? 'eye' : 'map-outline'} size={13} color={selected ? '#FFC857' : colors.textTertiary} />
        <Text style={[styles.footText, selected && { color: '#FFC857' }]}>{selected ? 'Showing on the map. Tap to hide.' : 'Tap to show on the map'}</Text>
      </View>
    </Pressable>
  );
}

function Stat({ icon, color, value, label }: { icon: keyof typeof Ionicons.glyphMap; color: string; value: number | string; label: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[styles.statText, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  heading: { ...typography.label, fontSize: 10, color: colors.textTertiary, letterSpacing: 1, marginTop: 4 },
  row: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 12, gap: 6, borderWidth: 1, borderColor: 'transparent' },
  rowSelected: { borderColor: '#FFC857', backgroundColor: 'rgba(255,200,87,0.08)' },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { ...typography.subheading, fontSize: 15, color: colors.textPrimary },
  summary: { ...typography.caption, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  statText: { ...typography.caption, fontSize: 12, fontVariant: ['tabular-nums'] },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  footText: { ...typography.caption, fontSize: 11, color: colors.textTertiary },
});
