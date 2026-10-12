import { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../../theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** A titled group of settings: a round icon, a title and a line of context, then the rows in one card. */
export function Section({ icon, title, subtitle, tone = 'accent', right, children }: { icon: IconName; title: string; subtitle?: string; tone?: 'accent' | 'warning'; right?: ReactNode; children: ReactNode }) {
  const tint = tone === 'warning' ? colors.warning : colors.accent;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={[styles.sectionIcon, { borderColor: tint, backgroundColor: `${tint}1F` }]}>
          <Ionicons name={icon} size={17} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/** A row inside a section's card. Rows after the first get a thin line above them. */
export function Row({ label, hint, right, first, children }: { label?: string; hint?: string; right?: ReactNode; first?: boolean; children?: ReactNode }) {
  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      {label || right ? (
        <View style={styles.rowTop}>
          <View style={{ flex: 1, gap: 2 }}>
            {label ? <Text style={styles.rowLabel}>{label}</Text> : null}
            {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function ToggleRow({ label, hint, value, onChange, first }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; first?: boolean }) {
  return (
    <Row
      label={label}
      hint={hint}
      first={first}
      right={
        <Switch
          value={value}
          onValueChange={onChange}
          accessibilityLabel={label}
          trackColor={{ true: colors.accentMuted, false: colors.surfaceBorder }}
          thumbColor={value ? colors.accent : colors.textSecondary}
        />
      }
    />
  );
}

/** A pill-shaped picker: one option is lit, the others are tapped to choose. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.segment, on && styles.segmentOn]}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A value with a round minus and plus button either side. */
export function StepperPill({ value, onMinus, onPlus }: { value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onMinus} hitSlop={8} accessibilityRole="button" accessibilityLabel="Decrease" style={styles.stepBtn}>
        <Ionicons name="remove" size={18} color={colors.accent} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable onPress={onPlus} hitSlop={8} accessibilityRole="button" accessibilityLabel="Increase" style={styles.stepBtn}>
        <Ionicons name="add" size={18} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
  sectionIcon: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { ...typography.subheading, color: colors.textPrimary },
  sectionSub: { ...typography.caption, color: colors.textTertiary },
  card: { borderRadius: 18, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.surfaceBorder, overflow: 'hidden' },
  row: { paddingHorizontal: 14, paddingVertical: 13, gap: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.surfaceBorder },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { ...typography.subheading, fontSize: 15, color: colors.textPrimary },
  rowHint: { ...typography.caption, color: colors.textSecondary, lineHeight: 17 },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, padding: 3, borderWidth: 1, borderColor: colors.surfaceBorder },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 6, borderRadius: 11 },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { ...typography.caption, fontFamily: 'SpaceGrotesk_500Medium', color: colors.textSecondary },
  segmentTextOn: { color: colors.background },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: 999, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 3 },
  stepBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFaint },
  stepValue: { ...typography.subheading, fontSize: 14, minWidth: 72, textAlign: 'center', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
});
