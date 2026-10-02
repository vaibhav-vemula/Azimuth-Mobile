import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../../components/GlassCard';
import { Badge, Row } from '../../../../components/ui';
import { colors, typography } from '../../../../theme';

interface Props {
  connected: boolean;
  deviceName: string | null;
  /** Gain currently applied, once known. */
  gainDb: number | null;
  antennaPower: boolean;
}

function ReceiverCardComponent({ connected, deviceName, gainDb, antennaPower }: Props) {
  return (
    <GlassCard style={{ gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <View style={[styles.dot, { backgroundColor: connected ? colors.success : colors.danger }]} />
          <View>
            <Text style={styles.name}>{connected ? (deviceName ?? 'RTL-SDR') : 'Receiver not connected'}</Text>
            <Text style={styles.sub}>{connected ? 'Connected over USB' : 'Plug in the dongle with the OTG cable, then connect'}</Text>
          </View>
        </Row>
        <Badge label={connected ? 'Connected' : 'Offline'} color={connected ? colors.success : colors.danger} />
      </Row>

      <View style={styles.facts}>
        <Fact icon="options-outline" label="Gain" value={gainDb === null ? 'Auto-optimised' : `${gainDb.toFixed(1)} dB`} />
        <Fact icon="pulse-outline" label="Sampling" value="2.304 MS/s" />
        <Fact icon="flash-outline" label="Antenna power" value={antennaPower ? 'On (LNA)' : 'Off'} />
      </View>
    </GlassCard>
  );
}

function Fact({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={colors.textTertiary} />
      <Text style={styles.factValue}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

export const ReceiverCard = memo(ReceiverCardComponent);

const styles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { ...typography.subheading, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 2, maxWidth: 230 },
  facts: { flexDirection: 'row', backgroundColor: colors.background, borderRadius: 12, padding: 12, gap: 8 },
  fact: { flex: 1, alignItems: 'center', gap: 3 },
  factValue: { ...typography.subheading, fontSize: 14, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  factLabel: { ...typography.label, fontSize: 9, color: colors.textTertiary },
});
