import { memo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GlassCard } from '../../../components/GlassCard';
import { SpectrumVisualizer } from '../../../components/SpectrumVisualizer';
import { Badge, Row, SectionLabel } from '../../../components/ui';
import { SATELLITE_SAMPLE_RATE_HZ } from '../../../../modules/rtl-sdr';
import { LRPT_FREQUENCIES_HZ } from '../../../data/satellites';
import { useReceiver } from '../../../receiver/useReceiver';
import { colors, typography } from '../../../theme';
import { formatFrequencyMHz } from '../../../utils/format';
import { analyzeSignalAt, centerBinFor, classifyStrength } from '../../../utils/signal';

const EMPTY_BINS: number[] = new Array(64).fill(0);
const STRENGTH_LABEL = { weak: 'Weak LRPT-like signal', good: 'LRPT-like signal', strong: 'Strong LRPT-like signal' } as const;
const STRENGTH_COLOR = { weak: colors.warning, good: colors.accent, strong: colors.success } as const;
const METER_FULL_SCALE_DB = 12;
const BIN_SMOOTHING = 0.2;

interface Props {
  /** Frequency at the middle of the spectrum (the scan centre while setting up, the downlink while recording). */
  centerHz: number;
  /** Where the LRPT signal is expected; the check is done on that part of the spectrum. */
  targetHz: number;
  active: boolean;
}

/**
 * Spectrum plus the LRPT signal check. It is the only part of the capture screen that listens to the
 * 20+ Hz spectrum stream, so the controls around it stay still.
 */
function LiveSignalCardComponent({ centerHz, targetHz, active }: Props) {
  const bins = useReceiver((s) => s.bins);
  const smoothed = useRef<number[]>(EMPTY_BINS);

  // Average over a fraction of a second so the verdict does not flicker with every frame.
  smoothed.current = bins.map((value, i) => (smoothed.current[i] ?? value) * (1 - BIN_SMOOTHING) + value * BIN_SMOOTHING);
  const analysis = analyzeSignalAt(smoothed.current, centerBinFor(targetHz - centerHz, SATELLITE_SAMPLE_RATE_HZ, smoothed.current.length));
  const strength = classifyStrength(analysis.snrDb);

  const label =
    analysis.verdict === 'lrpt'
      ? STRENGTH_LABEL[strength]
      : analysis.verdict === 'narrow'
        ? 'Narrow carrier (not LRPT)'
        : analysis.verdict === 'wide'
          ? 'Broad signal (not LRPT)'
          : 'No signal';
  const color =
    analysis.verdict === 'lrpt' ? STRENGTH_COLOR[strength] : analysis.verdict === 'none' ? colors.textTertiary : colors.warning;

  const note = !active
    ? 'The live spectrum appears here once the receiver is connected and set up.'
    : analysis.verdict === 'lrpt'
      ? `The centre block is ${analysis.snrDb.toFixed(1)} dB above the noise beside it and about the right width for LRPT. Check that it sits at the green marker.`
      : analysis.verdict === 'none'
        ? 'Nothing above the noise at the centre. This is normal until the satellite rises. A real LRPT signal is a flat-topped block about 140 kHz wide with a clear drop on both sides.'
        : 'Something is there, but it is the wrong shape for LRPT (a spike or an overly wide hump): most likely interference or a receiver spur, not the satellite.';

  return (
    <GlassCard style={{ gap: 12 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <SectionLabel>Signal</SectionLabel>
        {active ? <Badge label={label} color={color} /> : null}
      </Row>
      <SpectrumVisualizer
        bins={active ? bins : EMPTY_BINS}
        frequencyHz={centerHz}
        sampleRateHz={SATELLITE_SAMPLE_RATE_HZ}
        isStreaming={active}
        markers={LRPT_FREQUENCIES_HZ.map((hz) => ({
          frequencyHz: hz,
          label: formatFrequencyMHz(hz, 1),
          color: hz === targetHz ? colors.success : colors.textTertiary,
        }))}
        height={130}
      />
      <View style={styles.meter}>
        <View style={[styles.meterFill, { width: `${Math.min(1, analysis.snrDb / METER_FULL_SCALE_DB) * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.note}>{note}</Text>
    </GlassCard>
  );
}

export const LiveSignalCard = memo(LiveSignalCardComponent);

const styles = StyleSheet.create({
  meter: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceStrong, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  note: { ...typography.caption, color: colors.textSecondary },
});
