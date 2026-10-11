import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

export type KitKind = 'satellite-radio' | 'radio';

const STARS: [number, number, number][] = [
  [18, 22, 1.2], [52, 48, 0.9], [96, 16, 1.1], [140, 40, 0.8], [188, 20, 1.2], [236, 34, 0.9], [284, 18, 1.1], [306, 62, 0.8],
  [26, 150, 0.9], [74, 164, 1.1], [128, 152, 0.8], [210, 166, 1], [296, 150, 0.9], [160, 14, 0.7], [40, 96, 0.8],
];

/**
 * A drawn picture of an RTL-SDR kit: the USB dongle with its OTG plug, and the antenna that goes with it. The satellite kit
 * has a V-dipole under an orbit line; the radio kit has a telescopic whip under radio waves. Vector, so it stays sharp
 * on any screen and adds nothing to the app size.
 */
export function KitArt({ kind, width = '100%', height = 180 }: { kind: KitKind; width?: number | string; height?: number }) {
  const satellite = kind === 'satellite-radio';
  return (
    <Svg width={width} height={height} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" accessibilityLabel={satellite ? 'RTL-SDR dongle with a V-dipole antenna' : 'RTL-SDR dongle with a whip antenna'}>
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#0E1B33" />
          <Stop offset="0.6" stopColor="#0A1426" />
          <Stop offset="1" stopColor="#0B2A33" />
        </LinearGradient>
        <LinearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E4E9EF" />
          <Stop offset="0.45" stopColor="#B4BDC8" />
          <Stop offset="1" stopColor="#7C8794" />
        </LinearGradient>
        <LinearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F2F4F7" />
          <Stop offset="1" stopColor="#8E98A5" />
        </LinearGradient>
        <LinearGradient id="rod" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#6FE3F0" />
          <Stop offset="1" stopColor="#2AA7BA" />
        </LinearGradient>
        <LinearGradient id="glow" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor="#4DD0E1" stopOpacity="0.28" />
          <Stop offset="1" stopColor="#4DD0E1" stopOpacity="0" />
        </LinearGradient>
      </Defs>

      <Rect x="0" y="0" width="320" height="180" fill="url(#bg)" />
      {STARS.map(([x, y, r], i) => (
        <Circle key={i} cx={x} cy={y} r={r} fill="#CFE8F2" opacity={0.55} />
      ))}
      <Ellipse cx="160" cy="176" rx="170" ry="40" fill="url(#glow)" />

      {satellite ? (
        <G>
          <Path d="M20 70 Q160 -20 300 70" stroke="#4DD0E1" strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="3 5" fill="none" />
          <G transform="translate(214 24) rotate(-18)">
            <Rect x="-5" y="-4" width="10" height="8" rx="1.5" fill="#D8DEE6" />
            <Rect x="-20" y="-3" width="13" height="6" fill="#4DD0E1" opacity={0.9} />
            <Rect x="7" y="-3" width="13" height="6" fill="#4DD0E1" opacity={0.9} />
          </G>
        </G>
      ) : (
        <G fill="none" stroke="#4DD0E1" strokeLinecap="round">
          <Path d="M268 44 Q282 36 296 44" strokeWidth={2} strokeOpacity={0.75} />
          <Path d="M258 34 Q282 18 306 34" strokeWidth={2} strokeOpacity={0.5} />
          <Path d="M248 24 Q282 0 316 24" strokeWidth={2} strokeOpacity={0.3} />
        </G>
      )}

      {/* OTG plug and cable on the left */}
      <Path d="M52 104 C34 104 30 130 14 134" stroke="#1A2230" strokeWidth={7} strokeLinecap="round" fill="none" />
      <Rect x="40" y="94" width="30" height="20" rx="4" fill="#232C3B" />
      <Rect x="44" y="98" width="22" height="12" rx="2" fill="#0E131C" />

      {/* USB plug */}
      <Rect x="68" y="92" width="26" height="24" rx="2" fill="url(#metal)" />
      <Rect x="72" y="97" width="9" height="3" fill="#2A3340" />
      <Rect x="72" y="106" width="9" height="3" fill="#2A3340" />

      {/* Dongle body */}
      <Rect x="92" y="84" width="122" height="40" rx="7" fill="url(#body)" />
      <Rect x="92" y="84" width="122" height="8" rx="4" fill="#FFFFFF" opacity={0.22} />
      <Rect x="104" y="98" width="62" height="12" rx="3" fill="#0F1624" />
      <Rect x="108" y="102" width="30" height="2.4" rx="1.2" fill="#4DD0E1" />
      <Rect x="108" y="106" width="20" height="2" rx="1" fill="#4DD0E1" opacity={0.55} />
      <Circle cx="182" cy="104" r="3.2" fill="#66BB6A" />
      <Circle cx="182" cy="104" r="6.5" fill="#66BB6A" opacity={0.2} />

      {/* SMA connector */}
      <Rect x="214" y="96" width="14" height="16" rx="2" fill="url(#metal)" />
      <Rect x="228" y="100" width="12" height="8" rx="1.5" fill="#D5B45A" />
      <Rect x="240" y="102.5" width="6" height="3" rx="1.5" fill="#F2D27A" />

      {/* Cable to the antenna base */}
      <Path d="M246 104 C262 104 258 140 276 144" stroke="#1A2230" strokeWidth={4} strokeLinecap="round" fill="none" />

      {/* Antenna */}
      <Ellipse cx="282" cy="150" rx="22" ry="6" fill="#0A0F18" opacity={0.7} />
      <Rect x="262" y="140" width="40" height="12" rx="5" fill="#2A3340" />
      <Rect x="262" y="140" width="40" height="4" rx="2" fill="#ffffff" opacity={0.12} />
      {satellite ? (
        <G stroke="url(#rod)" strokeLinecap="round" fill="none">
          <Path d="M276 141 L254 66" strokeWidth={4} />
          <Path d="M288 141 L310 66" strokeWidth={4} />
          <Circle cx="254" cy="66" r="3" fill="#6FE3F0" stroke="none" />
          <Circle cx="310" cy="66" r="3" fill="#6FE3F0" stroke="none" />
        </G>
      ) : (
        <G stroke="#4FD6E8" strokeLinecap="round" fill="none">
          <Path d="M282 141 L282 112" strokeWidth={5} />
          <Path d="M282 112 L282 88" strokeWidth={3.6} />
          <Path d="M282 88 L282 70" strokeWidth={2.6} />
          <Path d="M282 70 L282 58" strokeWidth={1.8} />
          <Circle cx="282" cy="57" r="2.8" fill="#8FEBF5" stroke="none" />
        </G>
      )}
    </Svg>
  );
}
