import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors, typography } from '../../../theme';
import { SPECTRUM_VIEW_WIDTH, buildBarsPath } from '../../../utils/spectrumPath';
import { Button } from '../../../components/ui';
import { useAudioBars, useOnlineRadio } from '../../../radio/online/useOnlineRadio';

const HEIGHT = 120;
const GRID = [0.25, 0.5, 0.75];

/** The signal bars for online radio: the sound that is playing, low pitch on the left and high on the right. */
function AudioBarsComponent({ playing }: { playing: boolean }) {
  const bins = useAudioBars((s) => s.bins);
  const sampling = useAudioBars((s) => s.sampling);
  const path = useMemo(() => buildBarsPath(bins, HEIGHT), [bins]);
  const message = !playing || sampling === 'needs-permission' ? (playing ? null : 'No signal stream') : sampling === 'off' ? 'This phone cannot show the signal for this stream' : sampling === 'unknown' ? 'Waiting for audio…' : null;

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
        {playing && sampling === 'needs-permission' ? (
          <View style={styles.message}>
            <Text style={styles.messageText}>Android only lets an app read the sound it plays if it has the microphone permission. Nothing is recorded.</Text>
            <Button compact label="Show signal bars" icon="pulse" variant="secondary" onPress={() => void useOnlineRadio.getState().enableBars()} style={{ marginTop: 10 }} />
          </View>
        ) : message ? (
          <View style={styles.message} pointerEvents="none">
            <Text style={styles.messageText}>{message}</Text>
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
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  axisText: { ...typography.caption, color: colors.textTertiary },
});
