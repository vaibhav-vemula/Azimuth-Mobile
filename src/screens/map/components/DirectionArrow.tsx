import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { arrowRotationDeg } from '../../../mapping/geo';
import { colors } from '../../../theme';

/** An arrow that points toward a target: it turns as the phone turns, so "straight up" always means "that way". */
export function DirectionArrow({ bearingDeg, headingDeg, size = 44, color = colors.warning }: { bearingDeg: number; headingDeg: number | null; size?: number; color?: string }) {
  const rotation = arrowRotationDeg(bearingDeg, headingDeg);
  return (
    <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: color }]} accessibilityLabel="Direction to the chest">
      <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>
        <Ionicons name="navigate" size={size * 0.5} color={color} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, backgroundColor: 'rgba(5,7,13,0.55)' },
});
