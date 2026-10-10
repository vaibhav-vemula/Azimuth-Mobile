import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../components/GlassCard';
import { Badge, Button, EmptyState, SectionLabel } from '../../../components/ui';
import { colors, typography } from '../../../theme';
import { compassPoint } from '../../../mapping/geo';
import { formatDistanceShort } from '../../../mapping/geo';
import type { LatLon } from '../../../mapping/hexGrid';
import { Sonde, SondeStatus, ago, bearingTo, distanceTo } from '../../../sondes/sondehub';
import { useSondes } from '../../../sondes/useSondes';
import { useUnitSystem } from '../../../units/units';
import { DEFAULT_RADIUS_KM } from '../../../sondes/sondehub';

export const STATUS_STYLE: Record<SondeStatus, { label: string; color: string }> = {
  landed: { label: 'Landed', color: colors.success },
  descending: { label: 'Coming down', color: colors.warning },
  ascending: { label: 'Climbing', color: colors.accent },
  lost: { label: 'Lost signal', color: colors.textTertiary },
};

interface Props {
  here: LatLon | null;
  onOpen: (serial: string) => void;
}

/** Radiosondes near you, the ones to go and collect first. Opens from the Satellites tab. */
export function SondesPanel({ here, onOpen }: Props) {
  useUnitSystem(); // redraw when the unit setting changes
  const sondes = useSondes((s) => s.sondes);
  const status = useSondes((s) => s.status);
  const error = useSondes((s) => s.error);
  const tracked = useSondes((s) => s.tracked);
  const updatedMs = useSondes((s) => s.updatedMs);
  const refresh = useSondes((s) => s.refresh);

  const load = useCallback(() => {
    if (here) void refresh(here);
  }, [here, refresh]);
  useEffect(() => {
    if (here && useSondes.getState().status === 'idle') load();
  }, [here, load]);

  if (!here) {
    return <EmptyState icon="locate-outline" title="Where are you?" message="Sondes are listed by how far they are from you. Allow location access, or enter your position on the Satellites screen." />;
  }

  const ordered = [...sondes].sort((a, b) => Number(tracked.includes(b.serial)) - Number(tracked.includes(a.serial)));
  const hunting = ordered.filter((s) => s.status !== 'lost');

  return (
    <>
      <GlassCard style={{ gap: 10 }}>
        <SectionLabel>Radiosondes near you</SectionLabel>
        <Text style={styles.note}>
          Weather balloons carry a small radio that parachutes down after the balloon bursts. SondeHub lists the ones heard in your area. Pick one to get directions to where it landed, or where it is coming down.
        </Text>
        <Button label={status === 'loading' ? 'Looking…' : 'Refresh'} icon="refresh" variant="secondary" loading={status === 'loading'} onPress={load} />
        {updatedMs ? <Text style={styles.small}>Updated {ago(updatedMs)}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </GlassCard>

      {status === 'loading' && sondes.length === 0 ? <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} /> : null}

      {status !== 'loading' && status !== 'error' && hunting.length === 0 ? (
        <EmptyState icon="balloon-outline" title="No sondes near you" message={`None have been heard in the last few days within about ${formatDistanceShort(DEFAULT_RADIUS_KM * 1000)}. Balloons are launched twice a day from weather stations, so check again later.`} />
      ) : null}

      {hunting.map((s) => (
        <SondeRow key={s.serial} sonde={s} here={here} tracked={tracked.includes(s.serial)} onPress={() => onOpen(s.serial)} />
      ))}
    </>
  );
}

function SondeRow({ sonde, here, tracked, onPress }: { sonde: Sonde; here: LatLon; tracked: boolean; onPress: () => void }) {
  const style = STATUS_STYLE[sonde.status];
  const metres = distanceTo(here, sonde);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${sonde.serial}, ${style.label}`} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.icon, { backgroundColor: `${style.color}22` }]}>
        <Ionicons name="balloon-outline" size={22} color={style.color} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {sonde.serial}
          </Text>
          {tracked ? <Ionicons name="star" size={14} color={colors.warning} /> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {sonde.type} · {formatDistanceShort(metres)} {compassPoint(bearingTo(here, sonde))} · heard {ago(sonde.lastSeenMs)}
        </Text>
      </View>
      <Badge label={style.label} color={style.color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  note: { ...typography.caption, color: colors.textSecondary },
  small: { ...typography.caption, fontSize: 11, color: colors.textTertiary },
  error: { ...typography.caption, color: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  pressed: { opacity: 0.85 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...typography.subheading, color: colors.textPrimary, flexShrink: 1 },
  meta: { ...typography.caption, color: colors.textSecondary },
});
