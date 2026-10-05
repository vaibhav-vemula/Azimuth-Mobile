import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography } from '../../../theme';

interface Props {
  running: boolean;
  busy: boolean;
  onPress: () => void;
}

const START = { fill: '#2EE6C5', edge: '#7DF3E0', text: '#04121A' };
const STOP = { fill: '#F2455D', edge: '#FF8A9A', text: '#FFFFFF' };
const RADIUS = 32;

/**
 * The main button of the map: a bright gradient to start, and a red one with a pulsing "live" dot to stop. It presses in
 * a little, glows in its own colour, and shows a spinner while it is working.
 */
export function MappingButton({ running, busy, onPress }: Props) {
  const theme = running ? STOP : START;
  const press = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // While mapping, the dot on the Stop button pulses, so it is clear that something is recording.
  useEffect(() => {
    if (!running) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [running, pulse]);

  const animate = (to: number) => Animated.spring(press, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  const label = busy ? (running ? 'Stopping…' : 'Starting…') : running ? 'Stop mapping' : 'Start mapping';
  const hint = busy ? 'One moment' : running ? 'Finish and save this session' : 'Clear the fog and collect signals';

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale: press }], opacity: busy ? 0.85 : 1 }]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}
        style={[styles.button, { backgroundColor: theme.fill, borderColor: theme.edge }]}
      >
        {/* A lighter band across the top half gives the flat colour a little depth, with no gradient to misalign. */}
        <View style={styles.sheen} pointerEvents="none" />

        <View style={[styles.badge, { backgroundColor: running ? 'rgba(255,255,255,0.24)' : 'rgba(4,18,26,0.16)' }]}>
          {busy ? (
            <ActivityIndicator size="small" color={theme.text} />
          ) : running ? (
            <>
              <Animated.View style={[styles.ring, { borderColor: theme.text, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] }) }] }]} />
              <Ionicons name="stop" size={18} color={theme.text} />
            </>
          ) : (
            <Ionicons name="play" size={20} color={theme.text} style={styles.playIcon} />
          )}
        </View>

        <View style={styles.texts}>
          <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
          <Text style={[styles.hint, { color: theme.text }]} numberOfLines={1}>
            {hint}
          </Text>
        </View>

        {running && !busy ? (
          <View style={styles.live}>
            <View style={[styles.liveDot, { backgroundColor: theme.text }]} />
            <Text style={[styles.liveText, { color: theme.text }]}>LIVE</Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={20} color={theme.text} style={{ opacity: 0.7 }} />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  button: { alignSelf: 'stretch', minHeight: 64, borderRadius: RADIUS, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 12, paddingRight: 18, paddingVertical: 10, overflow: 'hidden' },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '48%', backgroundColor: 'rgba(255,255,255,0.08)' },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  playIcon: { marginLeft: 2 },
  ring: { position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 2 },
  texts: { flex: 1, gap: 1 },
  label: { ...typography.heading, fontSize: 18 },
  hint: { ...typography.caption, fontSize: 12, opacity: 0.78 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5 },
  liveText: { ...typography.label, fontSize: 10, letterSpacing: 1 },
});
