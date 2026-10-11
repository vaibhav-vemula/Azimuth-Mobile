import { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StarfieldBackground } from './StarfieldBackground';
import { colors } from '../theme';

interface ScreenProps {
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pass false when a navigator header already provides the top inset. */
  topInset?: boolean;
  /** Drawn over the screen and not scrolled with it (a floating button, for example). */
  overlay?: ReactNode;
}

export function Screen({ children, scroll = true, contentStyle, topInset = true, overlay }: PropsWithChildren<ScreenProps>) {
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: topInset ? insets.top + 8 : 8, paddingBottom: 24 };

  return (
    <View style={styles.root}>
      <StarfieldBackground />
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, padding, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.fill, padding, contentStyle]}>{children}</View>
      )}
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
});
