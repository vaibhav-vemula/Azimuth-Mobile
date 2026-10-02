import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { effectiveFrequencyHz } from '../../../state/frequency';
import { useAppStore } from '../../../state/useAppStore';
import { colors, typography } from '../../../theme';
import { formatFrequencyMHz } from '../../../utils/format';

function ago(iso: string | null): string {
  if (!iso) return '';
  const hours = (Date.now() - Date.parse(iso)) / 3600_000;
  if (hours < 1) return 'less than an hour ago';
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Read-only: the downlink is chosen automatically, first from SatNOGS evidence and then from the live signal. */
export function DownlinkInfo({ noradId }: { noradId: string }) {
  const settings = useAppStore((s) => s.settings);
  const autoFrequencies = useAppStore((s) => s.autoFrequencies);
  const hz = effectiveFrequencyHz({ settings, autoFrequencies }, noradId);
  const info = autoFrequencies[noradId];

  return (
    <View style={styles.row}>
      <Ionicons name="radio-outline" size={22} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.value}>{formatFrequencyMHz(hz)} MHz · automatic</Text>
        <Text style={styles.caption}>
          {info?.source === 'satnogs'
            ? `${info.goodCount} good SatNOGS observation${info.goodCount === 1 ? '' : 's'} here recently, latest ${ago(info.latestGoodAt)}. When you capture, the app also checks 137.1 and 137.9 MHz for the live signal and follows it.`
            : 'No recent observation data. When you capture, the app checks 137.1 and 137.9 MHz for the live signal and follows it.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  value: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  caption: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
});
