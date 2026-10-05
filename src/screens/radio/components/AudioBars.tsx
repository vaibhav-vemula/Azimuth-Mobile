import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors, typography } from '../../../theme';
import { SPECTRUM_VIEW_WIDTH, buildBarsPath } from '../../../utils/spectrumPath';
import { useAudioBars } from '../../../radio/online/useOnlineRadio';

const HEIGHT = 120;
const GRID = [0.25, 0.5, 0.75];

/**
 * The signal bars for online radio. They follow the real sound when the phone lets the app read it, and otherwise move on
 * their own (see useOnlineRadio).
 */
function AudioBarsComponent({ playing }: { playing: boolean }) {
  const bins = useAudioBars((s) => s.bins);
  const path = useMemo(() => buildBarsPath(bins, HEIGHT), [bins]);

  return (
    <View>
      <View style={styles.chart}>
        <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${SPECTRUM_VIEW_WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="audioBarsGradient" gradientUnits="userSpaceOnUse" x1="0" y1={HEIGHT} x2="0" y2="0">
              <Stop offset="0" stopColor={colors.spectrumLow} />
              <Stop offset="1" stopColor={colors.spectrumHigh} />
            </LinearGradient>
          </Defs>
          {GRID.map((f) => (
            <Line key={f} x1="0" x2={SPECTRUM_VIEW_WIDTH} y1={HEIGHT * f} y2={HEIGHT * f} stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
          ))}
          <Path d={path} fill="url(#audioBarsGradient)" />
        </Svg>
        {!playing ? (
          <View style={styles.message} pointerEvents="none">
            <Text style={styles.messageText}>No signal stream</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>Low</Text>
        <Text style={styles.axisText}>Sound of the station</Text>
        <Text style={styles.axisText}>High</Text>
      </View>
    </View>
  );
}

export const AudioBars = memo(AudioBarsComponent);

const styles = StyleSheet.create({
  chart: { height: HEIGHT, backgroundColor: '#03050A', borderRadius: 10, overflow: 'hidden' },
  message: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  messageText: { ...typography.caption, color: colors.textTertiary, textAlign: 'center' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 },
  axisText: { ...typography.caption, color: colors.textTertiary },
});
