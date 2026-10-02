import { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../theme';

/** Translucent panel. A flat fill is used instead of a live blur: cheaper, and identical on every device. */
export function GlassCard({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.surfaceBorder,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 18,
    padding: 16,
    overflow: 'hidden',
  },
});
