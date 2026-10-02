import { memo, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme';

const STAR_COUNT = 70;

/** Deterministic pseudo-random so the sky does not reshuffle on every render. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function StarfieldBackgroundComponent() {
  const { width, height } = Dimensions.get('window');
  const stars = useMemo(() => {
    const random = seeded(7);
    return Array.from({ length: STAR_COUNT }, () => ({
      x: random() * width,
      y: random() * height,
      r: random() < 0.85 ? 0.7 : 1.3,
      o: 0.25 + random() * 0.55,
    }));
  }, [width, height]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        {stars.map((star, i) => (
          <Circle key={i} cx={star.x} cy={star.y} r={star.r} fill={colors.textPrimary} opacity={star.o} />
        ))}
      </Svg>
    </View>
  );
}

export const StarfieldBackground = memo(StarfieldBackgroundComponent);
