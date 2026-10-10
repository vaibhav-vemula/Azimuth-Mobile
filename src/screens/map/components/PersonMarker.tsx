import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { colors } from '../../../theme';
import type { Activity } from '../../../mapping/headingStore';
import { ART_H, ART_W, Explorer, ExplorerCar, FEET_Y, Pose } from './PersonArt';

/** The marker is a box whose centre is the exact position. The feet stand on the centre, so the figure reaches above it. */
const W = 112;
const H = 150;
const SCALE = 0.95;
const FIG_W = ART_W * SCALE;
const FIG_H = ART_H * SCALE;
const FIG_TOP = H / 2 - FEET_Y * SCALE;
const BEAM = 112;
/** How long each half of a stride is shown while walking. */
const STEP_MS = 300;

interface Props {
  headingDeg: number | null;
  activity: Activity;
}

/**
 * You, on the map: a little radio explorer standing on a glowing ring. Standing still it breathes; walking it strides;
 * driving it sits in a small car. A soft beam on the ground shows which way the phone faces.
 */
export function PersonMarker({ headingDeg, activity }: Props) {
  const ring = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(false);

  // The ring ripples out across the ground.
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [ring]);

  // A slow rise and fall: breathing when still, a bounce with each step when walking, a gentle hum when driving.
  useEffect(() => {
    const ms = activity === 'walking' ? STEP_MS : activity === 'driving' ? 500 : 1100;
    const height = activity === 'walking' ? 1 : 0.4;
    sway.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: height, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [activity, sway]);

  // Walking swaps between the two halves of a stride.
  useEffect(() => {
    if (activity !== 'walking') {
      setStep(false);
      return;
    }
    const id = setInterval(() => setStep((s) => !s), STEP_MS);
    return () => clearInterval(id);
  }, [activity]);

  const pose: Pose = activity === 'walking' ? (step ? 'stepA' : 'stepB') : 'stand';

  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityLabel="Your position">
      {headingDeg !== null ? (
        <View style={[styles.beam, { transform: [{ rotate: `${headingDeg}deg` }] }]}>
          <Svg width={BEAM} height={BEAM} viewBox="0 0 112 112">
            <Defs>
              <RadialGradient id="meBeam" cx="56" cy="56" r="54" gradientUnits="userSpaceOnUse">
                <Stop offset="0.2" stopColor={colors.accent} stopOpacity={0.55} />
                <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            {/* A 76 degree wedge pointing up from the centre; the view is turned to the heading. */}
            <Path d="M56 56 L22.8 13.4 A54 54 0 0 1 89.2 13.4 Z" fill="url(#meBeam)" />
          </Svg>
        </View>
      ) : null}

      {/* the ground: a soft shadow, a steady ring and a ring that ripples outward */}
      <View style={styles.ground} />
      <View style={styles.ringSteady} />
      <Animated.View style={[styles.ringPulse, { opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.1] }) }] }]} />

      <Animated.View style={[styles.figure, { transform: [{ translateY: sway.interpolate({ inputRange: [0, 1], outputRange: [0, -2.4] }) }] }]}>
        {activity === 'driving' ? <ExplorerCar scale={SCALE} /> : <Explorer pose={pose} scale={SCALE} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: W, height: H, alignItems: 'center', justifyContent: 'center' },
  beam: { position: 'absolute', width: BEAM, height: BEAM },
  ground: { position: 'absolute', width: 46, height: 15, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.38)' },
  ringSteady: { position: 'absolute', width: 54, height: 20, borderRadius: 27, borderWidth: 2, borderColor: colors.accent, backgroundColor: 'rgba(77,208,225,0.16)' },
  ringPulse: { position: 'absolute', width: 54, height: 20, borderRadius: 27, borderWidth: 2, borderColor: colors.accent },
  figure: { position: 'absolute', top: FIG_TOP, width: FIG_W, height: FIG_H },
});
