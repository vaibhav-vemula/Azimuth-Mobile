import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { StorePage } from './StorePage';

const SIZE = 58;

/**
 * A round store button that floats above the tab bar, with a glowing cyan ring that pulses softly, and opens the store
 * page when tapped.
 */
export function StoreBubble() {
  const [open, setOpen] = useState(false);
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  const ripple = {
    opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
    transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
  };
  return (
    <>
      <View style={styles.wrap} pointerEvents="box-none">
        <Animated.View pointerEvents="none" style={[styles.ripple, ripple]} />
        <View pointerEvents="none" style={styles.halo} />
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open the store"
          hitSlop={8}
          style={({ pressed }) => [styles.bubble, pressed && styles.pressed]}
        >
          <Ionicons name="storefront" size={25} color={colors.accent} />
        </Pressable>
        <View pointerEvents="none" style={styles.tag}>
          <Text style={styles.tagText}>STORE</Text>
        </View>
      </View>
      <StorePage visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 16, bottom: 16, width: SIZE, height: SIZE + 8, alignItems: 'center' },
  ripple: { position: 'absolute', top: 0, width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, borderColor: colors.accent },
  halo: { position: 'absolute', top: -6, width: SIZE + 12, height: SIZE + 12, borderRadius: (SIZE + 12) / 2, backgroundColor: colors.accent, opacity: 0.14 },
  bubble: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#0A1320',
    borderWidth: 2.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.95 }] },
  tag: { position: 'absolute', bottom: 0, paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 8, backgroundColor: colors.accent },
  tagText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1, color: colors.background },
});
