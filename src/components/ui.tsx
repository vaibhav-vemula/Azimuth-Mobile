import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../theme';

export function SectionLabel({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.sectionLabel, style]}>{children.toUpperCase()}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function Button({ label, onPress, variant = 'primary', icon, disabled, loading, style, compact }: ButtonProps) {
  const inactive = disabled || loading;
  const textColor =
    variant === 'primary' ? colors.background : variant === 'danger' ? colors.textPrimary : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        inactive && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={textColor} /> : icon ? <Ionicons name={icon} size={compact ? 16 : 18} color={textColor} /> : null}
      {label ? <Text style={[styles.buttonLabel, { color: textColor }]}>{label}</Text> : null}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, color = colors.accent }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

export function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function EmptyState({ icon, title, message }: { icon: keyof typeof Ionicons.glyphMap; title: string; message?: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={36} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { ...typography.label, color: colors.textSecondary, marginBottom: 2 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    minHeight: 48,
  },
  buttonCompact: { paddingVertical: 9, paddingHorizontal: 12, minHeight: 38, borderRadius: 11 },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.accentFaint, borderWidth: 1, borderColor: colors.accentMuted },
  buttonDanger: { backgroundColor: colors.record },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.75 },
  buttonLabel: { ...typography.subheading, fontSize: 15 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentFaint },
  chipLabel: { ...typography.caption, color: colors.textSecondary },
  chipLabelSelected: { color: colors.accent },
  badge: { borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 9 },
  badgeLabel: { ...typography.caption, fontSize: 11 },
  stat: { flex: 1 },
  statLabel: { ...typography.label, color: colors.textTertiary },
  statValue: { ...typography.subheading, color: colors.textPrimary, marginTop: 3, fontVariant: ['tabular-nums'] },
  statUnit: { ...typography.caption, color: colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  empty: { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyTitle: { ...typography.subheading, color: colors.textPrimary },
  emptyMessage: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 24 },
});
