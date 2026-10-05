import { useId } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** The Azimuth mark: an A whose crossbar is a satellite's orbit. Same artwork as assets/logos/21-horizon-a-bold.svg. */
const ORBIT = 'M24 138 C 66 118, 126 100, 176 94';
const NAVY_TOP = '#0A1020';
const NAVY_BOTTOM = '#04070E';

/**
 * `tile` draws the rounded app-icon square behind the mark; without it only the mark is drawn, for placing on the app's
 * own dark background. Several can be on screen at once, so each gets its own gradient ids.
 */
export function AzimuthMark({ size = 96, tile = false }: { size?: number; tile?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" accessibilityLabel="Azimuth" accessibilityRole="image">
      <Defs>
        <LinearGradient id={`bg${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={NAVY_TOP} />
          <Stop offset="1" stopColor={NAVY_BOTTOM} />
        </LinearGradient>
        <LinearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#D7E6F5" />
          <Stop offset="1" stopColor="#7FA3C7" />
        </LinearGradient>
        <LinearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#7C5CFF" />
          <Stop offset="1" stopColor="#4DD0E1" />
        </LinearGradient>
      </Defs>
      {tile ? <Rect width={200} height={200} rx={46} fill={`url(#bg${id})`} /> : null}
      <Path d="M42 156 L100 50 L158 156" fill="none" stroke={`url(#a${id})`} strokeWidth={17} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={ORBIT} fill="none" stroke={NAVY_BOTTOM} strokeWidth={18} strokeLinecap="round" />
      <Path d={ORBIT} fill="none" stroke={`url(#r${id})`} strokeWidth={9} strokeLinecap="round" />
      <Circle cx={176} cy={94} r={10.5} fill="#FFB020" />
      <Circle cx={176} cy={94} r={4.2} fill={NAVY_BOTTOM} />
    </Svg>
  );
}
