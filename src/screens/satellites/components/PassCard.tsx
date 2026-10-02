import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '../../../components/ui';
import { GlassCard } from '../../../components/GlassCard';
import { PASS_QUALITY_LABEL, classifyPass } from '../../../data/propagation/passes';
import { getMonitoredSatellite } from '../../../data/satellites';
import { SatellitePass } from '../../../state/useAppStore';
import { PassQuality } from '../../../types/satellite';
import { colors, typography } from '../../../theme';
import { compassPoint, formatClock, formatCountdown, formatDuration } from '../../../utils/format';

export const QUALITY_COLOR: Record<PassQuality, string> = {
  excellent: colors.success,
  good: colors.accent,
  fair: colors.warning,
  low: colors.textTertiary,
};

interface Props {
  pass: SatellitePass;
  now: number;
  onPress: () => void;
  reminderSet: boolean;
  onToggleReminder: () => void;
}

function PassCardComponent({ pass, now, onPress, reminderSet, onToggleReminder }: Props) {
  const satellite = getMonitoredSatellite(pass.noradId);
  const quality = classifyPass(pass.maxElevationDeg);
  const color = QUALITY_COLOR[quality];
  const rise = pass.riseTime.getTime();
  const set = pass.setTime.getTime();
  const inProgress = now >= rise && now < set;

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <GlassCard style={[styles.card, inProgress && styles.cardLive]}>
        <View style={[styles.qualityBar, { backgroundColor: color }]} />
        <View style={styles.body}>
          <View style={styles.topRow}>
            <View style={styles.titleRow}>
              <Text style={styles.satName}>{satellite?.name ?? pass.noradId}</Text>
              {inProgress ? <Badge label="LIVE" color={colors.record} /> : null}
            </View>
            <Pressable
              onPress={onToggleReminder}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={reminderSet ? 'Cancel reminder' : 'Set reminder'}
            >
              <Ionicons name={reminderSet ? 'notifications' : 'notifications-outline'} size={20} color={reminderSet ? colors.accent : colors.textSecondary} />
            </Pressable>
          </View>

          <Text style={styles.times}>
            {formatClock(pass.riseTime)} <Text style={styles.arrow}>→</Text> {formatClock(pass.setTime)}
            <Text style={styles.duration}>   {formatDuration(pass.durationSec)}</Text>
          </Text>

          <View style={styles.metaRow}>
            <View style={styles.meta}>
              <Text style={[styles.metaValue, { color }]}>{Math.round(pass.maxElevationDeg)}°</Text>
              <Text style={styles.metaLabel}>MAX EL</Text>
            </View>
            <View style={styles.meta}>
              <Text style={styles.metaValue}>
                {compassPoint(pass.riseAzimuthDeg)} <Text style={styles.arrow}>→</Text> {compassPoint(pass.setAzimuthDeg)}
              </Text>
              <Text style={styles.metaLabel}>DIRECTION</Text>
            </View>
            <View style={styles.meta}>
              <Text style={styles.metaValue}>{inProgress ? `LOS ${formatCountdown(set - now)}` : formatCountdown(rise - now)}</Text>
              <Text style={styles.metaLabel}>{inProgress ? 'REMAINING' : 'STARTS IN'}</Text>
            </View>
            <Badge label={PASS_QUALITY_LABEL[quality]} color={color} />
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

export const PassCard = memo(PassCardComponent);

const styles = StyleSheet.create({
  card: { flexDirection: 'row', padding: 0 },
  cardLive: { borderColor: colors.record },
  qualityBar: { width: 4 },
  body: { flex: 1, padding: 14, gap: 8 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  satName: { ...typography.subheading, color: colors.textPrimary },
  times: { ...typography.heading, fontSize: 20, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  arrow: { color: colors.textTertiary },
  duration: { ...typography.caption, color: colors.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  meta: { gap: 2 },
  metaValue: { ...typography.subheading, fontSize: 15, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  metaLabel: { ...typography.label, fontSize: 9, color: colors.textTertiary },
});
