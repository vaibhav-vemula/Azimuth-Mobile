import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { arrowRotationDeg } from '../../../mapping/geo';
import { colors } from '../../../theme';

/**
 * The arrow itself, drawn to point straight up in its box (the tip is at the top centre). Turning the box turns the arrow.
 * It is drawn here rather than taken from an icon set because the icon I first used for this, "navigate", points up and
 * to the right, not straight up, which made every arrow 45 degrees off.
 */
export const ARROW_PATH = 'M50 6 L76 70 L50 56 L24 70 Z';

/** An arrow that points toward a target: it turns as the phone turns, so "straight up" always means "that way". */
export function DirectionArrow({ bearingDeg, headingDeg, size = 44, color = colors.warning }: { bearingDeg: number; headingDeg: number | null; size?: number; color?: string }) {
  const rotation = arrowRotationDeg(bearingDeg, headingDeg);
  const inner = size * 0.62;
  return (
    <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: color }]} accessibilityLabel="Direction to the chest">
      <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>
        <Svg width={inner} height={inner} viewBox="0 0 100 100">
          <Path d={ARROW_PATH} fill={color} stroke={color} strokeWidth={4} strokeLinejoin="round" />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, backgroundColor: 'rgba(5,7,13,0.55)' },
});
