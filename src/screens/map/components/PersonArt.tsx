import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * The artwork for your marker: a little radio explorer in a cap and headphones, with a backpack and an antenna, drawn
 * facing you. Everything is drawn in a 64 x 84 box with the feet at y = 78. Only literal numbers are used here so the
 * same shapes can be drawn outside the app when previewing.
 */
export const ART_W = 64;
export const ART_H = 84;
/** Where the feet are in the drawing, so the marker can put them on the exact position. */
export const FEET_Y = 78;

export type Pose = 'stand' | 'stepA' | 'stepB';

function Gradients() {
  return (
    <Defs>
      <LinearGradient id="pJacket" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#7DF3E0" />
        <Stop offset="1" stopColor="#1FA6C8" />
      </LinearGradient>
      <LinearGradient id="pPack" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#FFC857" />
        <Stop offset="1" stopColor="#F09A12" />
      </LinearGradient>
      <LinearGradient id="pCap" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#3FB9D6" />
        <Stop offset="1" stopColor="#1E7FA0" />
      </LinearGradient>
      <LinearGradient id="pCar" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#7DF3E0" />
        <Stop offset="1" stopColor="#1FA6C8" />
      </LinearGradient>
    </Defs>
  );
}

/** The explorer. `stepA` and `stepB` are the two halves of a stride, shown one after the other while walking. */
export function Explorer({ pose, scale = 1 }: { pose: Pose; scale?: number }) {
  // Legs and arms for each pose: how far each foot is lifted, and how far each arm swings out.
  const leftLift = pose === 'stepA' ? 4 : 0;
  const rightLift = pose === 'stepB' ? 4 : 0;
  const leftArm = pose === 'stepA' ? 4 : pose === 'stepB' ? -3 : 0;
  const rightArm = pose === 'stepB' ? 4 : pose === 'stepA' ? -3 : 0;
  return (
    <Svg width={ART_W * scale} height={ART_H * scale} viewBox="0 0 64 84">
      <Gradients />
      {/* backpack, with its antenna and a signal arc */}
      <Rect x={18} y={33} width={28} height={25} rx={8} fill="url(#pPack)" />
      <Path d="M41 34 L46 11" stroke="#D5E4EE" strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={46.4} cy={10} r={2.4} fill="#FFB020" />
      <Path d="M50 6.5 A6 6 0 0 1 50 13.5" stroke="#7DF3E0" strokeWidth={1.4} strokeLinecap="round" fill="none" />
      <Path d="M53 4 A10 10 0 0 1 53 16" stroke="#7DF3E0" strokeWidth={1.2} strokeLinecap="round" strokeOpacity={0.6} fill="none" />
      {/* legs and shoes */}
      <Rect x={23.5} y={55} width={8.5} height={19 - leftLift} rx={4.2} fill="#2B3A55" />
      <Rect x={32} y={55} width={8.5} height={19 - rightLift} rx={4.2} fill="#2B3A55" />
      <Ellipse cx={27.3} cy={75.2 - leftLift} rx={6.2} ry={3.2} fill="#0F1826" />
      <Ellipse cx={36.7} cy={75.2 - rightLift} rx={6.2} ry={3.2} fill="#0F1826" />
      <Ellipse cx={26} cy={74.2 - leftLift} rx={2.6} ry={1} fill="#FFFFFF" fillOpacity={0.25} />
      <Ellipse cx={38} cy={74.2 - rightLift} rx={2.6} ry={1} fill="#FFFFFF" fillOpacity={0.25} />
      {/* arms */}
      <Rect x={14.5} y={35} width={7.5} height={21} rx={3.75} fill="#1FA6C8" transform={`rotate(${leftArm} 18 37)`} />
      <Rect x={42} y={35} width={7.5} height={21} rx={3.75} fill="#1FA6C8" transform={`rotate(${-rightArm} 46 37)`} />
      <Circle cx={18.2 - leftArm * 0.25} cy={56.5} r={3.2} fill="#F2C6A0" />
      <Circle cx={45.8 + rightArm * 0.25} cy={56.5} r={3.2} fill="#F2C6A0" />
      {/* jacket */}
      <Rect x={20.5} y={31} width={23} height={28} rx={9} fill="url(#pJacket)" />
      <Path d="M32 33 L32 58" stroke="#FFFFFF" strokeWidth={1.2} strokeOpacity={0.45} />
      <Rect x={24} y={42} width={6} height={5} rx={1.6} fill="#FFFFFF" fillOpacity={0.28} />
      <Path d="M21.5 56.5 H42.5" stroke="#16627C" strokeWidth={2.2} strokeOpacity={0.55} strokeLinecap="round" />
      {/* head */}
      <Circle cx={32} cy={21.5} r={10.4} fill="#F4CBA6" />
      <Circle cx={28.2} cy={23} r={1.35} fill="#1B2433" />
      <Circle cx={35.8} cy={23} r={1.35} fill="#1B2433" />
      <Path d="M28.6 27 Q32 29.8 35.4 27" stroke="#1B2433" strokeWidth={1.2} strokeLinecap="round" fill="none" />
      <Circle cx={25.4} cy={26} r={1.9} fill="#F08A7E" fillOpacity={0.4} />
      <Circle cx={38.6} cy={26} r={1.9} fill="#F08A7E" fillOpacity={0.4} />
      {/* cap with a brim, and headphones */}
      <Path d="M21.4 19.6 A10.7 10.7 0 0 1 42.6 19.6 Z" fill="url(#pCap)" />
      <Path d="M21.4 19.8 Q32 22.2 42.6 19.8" stroke="#E9F7FB" strokeWidth={1.6} strokeLinecap="round" fill="none" />
      <Path d="M32.5 19.6 Q40.5 18 46.5 21.5 Q40 22.8 32.5 20.8 Z" fill="#1A6E8C" />
      <Path d="M22 21 A10.5 10.5 0 0 1 42 21" stroke="#10202E" strokeWidth={1.7} fill="none" strokeLinecap="round" />
      <Rect x={19} y={19.6} width={4.4} height={7.4} rx={2.2} fill="#10202E" />
      <Rect x={40.6} y={19.6} width={4.4} height={7.4} rx={2.2} fill="#10202E" />
      <Rect x={19.9} y={21} width={1.2} height={4.4} rx={0.6} fill="#7DF3E0" />
      <Rect x={42.9} y={21} width={1.2} height={4.4} rx={0.6} fill="#7DF3E0" />
    </Svg>
  );
}

/** The same explorer at the wheel of a small car, seen from the front, for when you are driving. */
export function ExplorerCar({ scale = 1 }: { scale?: number }) {
  return (
    <Svg width={ART_W * scale} height={ART_H * scale} viewBox="0 0 64 84">
      <Gradients />
      {/* cabin and window with the explorer in it */}
      <Path d="M15 44 L20 24 Q21 21 24.5 21 H39.5 Q43 21 44 24 L49 44 Z" fill="url(#pCar)" />
      <Path d="M19 43 L23 26 Q23.6 24 26 24 H38 Q40.4 24 41 26 L45 43 Z" fill="#12263A" />
      <Circle cx={32} cy={32} r={5.6} fill="#F4CBA6" />
      <Path d="M26.5 30.6 A5.8 5.8 0 0 1 37.5 30.6 Z" fill="#1E7FA0" />
      <Rect x={25.4} y={30} width={2.6} height={5} rx={1.3} fill="#10202E" />
      <Rect x={36} y={30} width={2.6} height={5} rx={1.3} fill="#10202E" />
      <Path d="M23 25 L31 25 L26 43 L21 43 Z" fill="#FFFFFF" fillOpacity={0.12} />
      {/* body */}
      <Rect x={8} y={42} width={48} height={24} rx={10} fill="url(#pCar)" />
      <Rect x={8} y={42} width={48} height={11} rx={8} fill="#FFFFFF" fillOpacity={0.16} />
      <Rect x={24} y={55} width={16} height={5} rx={2.5} fill="#16627C" fillOpacity={0.6} />
      <Circle cx={15.5} cy={52} r={3.3} fill="#FFE9A8" />
      <Circle cx={48.5} cy={52} r={3.3} fill="#FFE9A8" />
      <Circle cx={15.5} cy={52} r={5.4} fill="#FFE9A8" fillOpacity={0.3} />
      <Circle cx={48.5} cy={52} r={5.4} fill="#FFE9A8" fillOpacity={0.3} />
      {/* wheels */}
      <Rect x={11} y={62} width={9} height={14} rx={3.5} fill="#0F1826" />
      <Rect x={44} y={62} width={9} height={14} rx={3.5} fill="#0F1826" />
      <Rect x={13.2} y={64} width={4.6} height={10} rx={2} fill="#2B3A55" />
      <Rect x={46.2} y={64} width={4.6} height={10} rx={2} fill="#2B3A55" />
      {/* the antenna from the explorer's backpack, on the roof */}
      <Path d="M41 21 L46 8" stroke="#D5E4EE" strokeWidth={1.7} strokeLinecap="round" />
      <Circle cx={46.4} cy={7} r={2.4} fill="#FFB020" />
    </Svg>
  );
}
