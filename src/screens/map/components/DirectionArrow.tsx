import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { arrowRotationDeg } from '../../../mapping/geo';
import { colors } from '../../../theme';

/**
 * The arrow itself, drawn to point straight up in its box (the tip is at the top centre). Turning the box turns the arrow.
 * It is drawn here rather than taken from an icon set because the icon I first used for this, "navigate", points up and
 * to the right, not straight up, which made every arrow 45 degrees off.
 */
export const ARROW_PATH = 'M50 6 L76 70 L50 56 L24 70 Z';
/** The two halves of the arrow, split down the middle, so the lit side and shaded side give it depth. */
const ARROW_LEFT = 'M50 6 L50 56 L24 70 Z';
const ARROW_RIGHT = 'M50 6 L76 70 L50 56 Z';

/** The shortest way round: from 350° to 10° is +20°, not −340°. */
export function shortestTurn(from: number, to: number): number {
  let delta = (((to - from) % 360) + 360) % 360;
  if (delta > 180) delta -= 360;
  return from + delta;
}

/**
 * A compass dial with an arrow that points toward a target. It turns as the phone turns, so "straight up" always means
 * "that way", and it glides to each new angle by the short way round instead of jumping or spinning the long way.
 */
export function DirectionArrow({ bearingDeg, headingDeg, size = 44, color = colors.warning }: { bearingDeg: number; headingDeg: number | null; size?: number; color?: string }) {
  const target = arrowRotationDeg(bearingDeg, headingDeg);
  const angle = useRef(new Animated.Value(target)).current;
  const last = useRef(target);

  useEffect(() => {
    const next = shortestTurn(last.current, target);
    last.current = next;
    Animated.timing(angle, { toValue: next, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [target, angle]);

  const spin = angle.interpolate({ inputRange: [-100000, 100000], outputRange: ['-100000deg', '100000deg'] });
  const arrow = size * 0.72;

  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Direction to the chest">
      {/* Fixed dial: soft glow, ring and tick marks */}
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="dial" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="0.7" stopColor={color} stopOpacity={0.08} />
            <Stop offset="1" stopColor="#05070D" stopOpacity={0.7} />
          </RadialGradient>
        </Defs>
        <Circle cx={50} cy={50} r={47} fill="url(#dial)" stroke={color} strokeOpacity={0.55} strokeWidth={2} />
        {[0, 90, 180, 270].map((deg) => (
          <G key={deg} rotation={deg} origin="50, 50">
            <Line x1={50} y1={7} x2={50} y2={deg === 0 ? 16 : 13} stroke="#FFFFFF" strokeOpacity={deg === 0 ? 0.0 : 0.35} strokeWidth={2} strokeLinecap="round" />
          </G>
        ))}
      </Svg>
      {/* Turning arrow */}
      <Animated.View style={[styles.center, { transform: [{ rotate: spin }] }]}>
        <Svg width={arrow} height={arrow} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="lit" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.95} />
              <Stop offset="1" stopColor={color} stopOpacity={1} />
            </LinearGradient>
            <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={1} />
              <Stop offset="1" stopColor={color} stopOpacity={0.6} />
            </LinearGradient>
          </Defs>
          <Path d={ARROW_PATH} fill={color} fillOpacity={0.35} stroke={color} strokeOpacity={0.35} strokeWidth={9} strokeLinejoin="round" />
          <Path d={ARROW_LEFT} fill="url(#lit)" stroke="url(#lit)" strokeWidth={2} strokeLinejoin="round" />
          <Path d={ARROW_RIGHT} fill="url(#shade)" stroke="url(#shade)" strokeWidth={2} strokeLinejoin="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
