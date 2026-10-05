import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { StarfieldBackground } from '../../components/StarfieldBackground';
import { AzimuthMark } from '../../components/Logo';
import { colors, typography } from '../../theme';

const RINGS = [0, 1, 2];
const RING_MS = 2400;

/** Pulsing radio rings around the mark; calls onDone after the intro. */
export function SplashScreen({ onDone, durationMs = 2200 }: { onDone: () => void; durationMs?: number }) {
  const rings = useRef(RINGS.map(() => new Animated.Value(0))).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loops = rings.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((i * RING_MS) / RINGS.length),
          Animated.timing(value, { toValue: 1, duration: RING_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: true }).start();
    const timer = setTimeout(onDone, durationMs);
    return () => {
      clearTimeout(timer);
      loops.forEach((l) => l.stop());
    };
  }, [rings, fade, onDone, durationMs]);

  return (
    <View style={styles.root}>
      <StarfieldBackground />
      <View style={styles.center}>
        {rings.map((value, i) => (
          <Animated.View
            key={i}
            style={[
              styles.ring,
              {
                opacity: value.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.55, 0] }),
                transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2.6] }) }],
              },
            ]}
          />
        ))}
        <AzimuthMark size={104} tile />
      </View>
      <Animated.View style={[styles.text, { opacity: fade }]}>
        <Text style={styles.title}>AZIMUTH</Text>
        <Text style={styles.tagline}>Map the invisible</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  center: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  text: { alignItems: 'center', marginTop: 28, gap: 6 },
  title: { ...typography.display, color: colors.textPrimary, letterSpacing: 6, fontSize: 30 },
  tagline: { ...typography.body, color: colors.textSecondary },
});
