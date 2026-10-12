import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/ui';
import { colors, typography } from '../../theme';

/** How long the crate shakes, opens and bursts before the result is shown, in milliseconds. */
export const OPENING_MS = 2000;
const COINS = Array.from({ length: 10 }, (_, i) => ({ angle: (i / 10) * Math.PI * 2 + 0.3, reach: 90 + (i % 3) * 28, rise: 40 + (i % 4) * 22 }));

interface Props {
  visible: boolean;
  /** 'working' while the wallet and server are busy; 'done' once there is a result. */
  phase: 'working' | 'done';
  accepted: boolean;
  /** Big line shown with the result, for example "+5 AZM". */
  reward?: string;
  message: string;
  onClose: () => void;
}

/**
 * A crate that shakes, throws its lid open in a burst of light and coins, and then shows what the chest held. The
 * animation always plays for about two seconds, so a fast network does not skip it; the result waits for both.
 */
export function ChestOpening({ visible, phase, accepted, reward, message, onClose }: Props) {
  const shake = useRef(new Animated.Value(0)).current;
  const lid = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPlayed(false);
    [shake, lid, burst, reveal].forEach((v) => v.setValue(0));
    const run = Animated.sequence([
      Animated.sequence([-1, 1, -1, 1, 0].map((to) => Animated.timing(shake, { toValue: to, duration: 90, easing: Easing.linear, useNativeDriver: true }))),
      Animated.timing(lid, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(1.8)), useNativeDriver: true }),
      Animated.timing(burst, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    run.start();
    const timer = setTimeout(() => setPlayed(true), OPENING_MS);
    return () => {
      run.stop();
      clearTimeout(timer);
    };
  }, [visible, shake, lid, burst, reveal]);

  const showResult = played && phase === 'done';
  useEffect(() => {
    if (showResult) Animated.spring(reveal, { toValue: 1, useNativeDriver: true, bounciness: 10 }).start();
  }, [showResult, reveal]);

  const coinStyles = useMemo(
    () =>
      COINS.map((c) => ({
        opacity: burst.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(c.angle) * c.reach] }) },
          { translateY: burst.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -c.rise - 40, -c.rise + 70] }) },
          { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${c.reach * 4}deg`] }) },
        ],
      })),
    [burst]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={showResult ? onClose : undefined} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.stage}>
          <Animated.View
            pointerEvents="none"
            style={[styles.beam, { opacity: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.9, 0.45] }), transform: [{ scaleY: burst.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }]}
          />
          <Animated.View style={[styles.crate, { transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-7, 7] }) }] }]}>
            <View style={styles.body}>
              <View style={[styles.band, { left: 26 }]} />
              <View style={[styles.band, { right: 26 }]} />
              <View style={styles.inside} />
            </View>
            <Animated.View style={[styles.lid, { transform: [{ rotate: lid.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-112deg'] }) }] }]}>
              <View style={[styles.band, { left: 26 }]} />
              <View style={[styles.band, { right: 26 }]} />
            </Animated.View>
            <View style={styles.lock}>
              <Ionicons name="lock-closed" size={16} color="#4A3410" />
            </View>
          </Animated.View>
          {COINS.map((_, i) => (
            <Animated.View key={i} pointerEvents="none" style={[styles.coin, coinStyles[i]]}>
              <Text style={styles.coinText}>A</Text>
            </Animated.View>
          ))}
        </View>

        {showResult ? (
          <Animated.View style={[styles.result, { opacity: reveal, transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
            <Text style={[styles.heading, !accepted && { color: colors.danger }]}>{accepted ? 'Chest opened' : 'Could not open it'}</Text>
            {accepted && reward ? <Text style={styles.reward}>{reward}</Text> : null}
            <Text style={styles.message}>{message}</Text>
            <Button label="Done" onPress={onClose} />
          </Animated.View>
        ) : (
          <View style={styles.result}>
            <Text style={styles.opening}>{phase === 'done' ? 'Opening…' : 'Opening the chest…'}</Text>
          </View>
        )}
        {/* Tapping outside never closes it mid-opening. */}
        <Pressable style={StyleSheet.absoluteFill} pointerEvents={showResult ? 'none' : 'auto'} />
      </View>
    </Modal>
  );
}

const WOOD = '#8A5A2B';
const WOOD_DARK = '#5A3818';
const GOLD = '#F6C453';

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,8,18,0.92)', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 28 },
  stage: { width: 240, height: 230, alignItems: 'center', justifyContent: 'flex-end' },
  beam: { position: 'absolute', bottom: 70, width: 150, height: 210, borderRadius: 75, backgroundColor: 'rgba(246,196,83,0.5)' },
  crate: { width: 176, height: 120, justifyContent: 'flex-end' },
  body: { height: 82, borderRadius: 10, backgroundColor: WOOD, borderWidth: 3, borderColor: WOOD_DARK, overflow: 'hidden' },
  inside: { position: 'absolute', top: 0, left: 0, right: 0, height: 10, backgroundColor: '#2A1A0A' },
  band: { position: 'absolute', top: 0, bottom: 0, width: 14, backgroundColor: GOLD, opacity: 0.9 },
  lid: { position: 'absolute', left: 0, top: 4, width: 176, height: 42, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: '#A06A33', borderWidth: 3, borderColor: WOOD_DARK, overflow: 'hidden', transformOrigin: 'left bottom' },
  lock: { position: 'absolute', left: 76, top: 34, width: 24, height: 24, borderRadius: 6, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  coin: { position: 'absolute', bottom: 100, width: 26, height: 26, borderRadius: 13, backgroundColor: GOLD, borderWidth: 2, borderColor: '#B98A1E', alignItems: 'center', justifyContent: 'center' },
  coinText: { color: '#7A5600', fontSize: 14, fontWeight: '800' },
  result: { alignItems: 'center', gap: 12, minHeight: 150, width: '100%', maxWidth: 360, justifyContent: 'center' },
  heading: { ...typography.heading, color: colors.textPrimary },
  reward: { ...typography.heading, fontSize: 44, lineHeight: 50, color: GOLD },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  opening: { ...typography.subheading, color: colors.textSecondary },
});
