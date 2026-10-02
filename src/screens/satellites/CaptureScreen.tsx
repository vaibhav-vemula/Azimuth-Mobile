import { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { GlassCard } from '../../components/GlassCard';
import { Screen } from '../../components/Screen';
import { SpectrumVisualizer } from '../../components/SpectrumVisualizer';
import { Badge, Button, Chip, EmptyState, Row, SectionLabel, Stat } from '../../components/ui';
import { RECORDING_BYTES_PER_SECOND, SATELLITE_SAMPLE_RATE_HZ, exportRecording, setBiasTee, setGain, tune } from '../../../modules/rtl-sdr';
import { LRPT_FREQUENCIES_HZ } from '../../data/satellites';
import { getCurrentTrackPoint } from '../../data/propagation/passes';
import { useNow } from '../../hooks/useNow';
import { useAppStore } from '../../state/useAppStore';
import { errorMessage, useReceiver } from '../../receiver/useReceiver';
import { useCapture } from '../../capture/useCapture';
import { DATA_FILE_NAME, estimateRecordingBytes } from '../../capture/sigmf';
import { colors, typography } from '../../theme';
import { classifySnr, estimateSnrDb } from '../../utils/signal';
import {
  formatAzimuth,
  formatBytes,
  formatClock,
  formatCountdown,
  formatDuration,
  formatFrequencyMHz,
} from '../../utils/format';

const SIGNAL_LABEL = { none: 'No signal', weak: 'Weak', good: 'Good', strong: 'Strong' } as const;
const SIGNAL_COLOR = {
  none: colors.textTertiary,
  weak: colors.warning,
  good: colors.accent,
  strong: colors.success,
} as const;
const METER_FULL_SCALE_DB = 12;

export default function CaptureScreen() {
  const navigation = useNavigation();
  const now = useNow(1000);

  const options = useCapture((s) => s.options);
  const phase = useCapture((s) => s.phase);
  const progress = useCapture((s) => s.progress);
  const result = useCapture((s) => s.result);
  const captureError = useCapture((s) => s.error);

  const status = useReceiver((s) => s.status);
  const sampleRate = useReceiver((s) => s.sampleRate);
  const bins = useReceiver((s) => s.bins);
  const gains = useReceiver((s) => s.gains);
  const deviceName = useReceiver((s) => s.deviceName);
  const busy = useReceiver((s) => s.busy);

  const settings = useAppStore((s) => s.settings);
  const location = useAppStore((s) => s.location);
  const tles = useAppStore((s) => s.tles);

  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const snrRef = useRef(0);

  const recording = phase === 'recording';
  const working = phase === 'preparing' || phase === 'finishing';
  const locked = recording || working;
  const monitoring = phase === 'idle' && status === 'streaming' && sampleRate === SATELLITE_SAMPLE_RATE_HZ;
  const streamingSat = (recording || phase === 'preparing' || monitoring) && status === 'streaming';

  const snrDb = estimateSnrDb(bins);
  snrRef.current = snrRef.current * 0.85 + snrDb * 0.15;
  const smoothedSnr = snrRef.current;
  const signal = classifySnr(smoothedSnr);

  const applyFrequency = useCallback(
    async (hz: number) => {
      if (!options) return;
      useAppStore.getState().setSatelliteFrequency(options.pass.noradId, hz);
      useCapture.getState().prepare({ ...options, frequencyHz: hz });
      if (monitoring) {
        try {
          await tune(hz);
          useReceiver.setState({ frequencyHz: hz });
        } catch (e) {
          setActionError(errorMessage(e));
        }
      }
    },
    [options, monitoring]
  );

  const applyGain = useCallback(
    async (gainDb: number | null) => {
      useAppStore.getState().updateSettings({ satelliteGainDb: gainDb });
      if (options) useCapture.getState().prepare({ ...options, gainDb });
      if (monitoring) {
        try {
          await setGain(gainDb);
        } catch (e) {
          setActionError(errorMessage(e));
        }
      }
    },
    [options, monitoring]
  );

  const applyBiasTee = useCallback(
    async (enabled: boolean) => {
      useAppStore.getState().updateSettings({ biasTee: enabled });
      if (options) useCapture.getState().prepare({ ...options, biasTee: enabled });
      if (monitoring) {
        try {
          await setBiasTee(enabled);
        } catch (e) {
          setActionError(errorMessage(e));
        }
      }
    },
    [options, monitoring]
  );

  const stepGain = useCallback(
    (direction: 1 | -1) => {
      if (gains.length === 0) return;
      const current = settings.satelliteGainDb;
      let index = current === null ? gains.length - 1 : gains.findIndex((g) => Math.abs(g - current) < 0.05);
      if (index < 0) index = gains.length - 1;
      const next = Math.max(0, Math.min(gains.length - 1, index + direction));
      void applyGain(gains[next]);
    },
    [gains, settings.satelliteGainDb, applyGain]
  );

  const toggleMonitor = useCallback(async () => {
    if (!options) return;
    setActionError(null);
    const receiver = useReceiver.getState();
    try {
      if (monitoring) {
        await receiver.leaveSatelliteMode();
      } else {
        if (!(await receiver.connect())) throw new Error(useReceiver.getState().error ?? 'Could not connect to the receiver.');
        await receiver.enterSatelliteMode({
          frequencyHz: options.frequencyHz,
          gainDb: options.gainDb,
          biasTee: options.biasTee,
        });
      }
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }, [options, monitoring]);

  const startRecording = useCallback(() => {
    if (!options) return;
    setActionError(null);
    void useCapture.getState().start(options);
  }, [options]);

  const confirmStop = useCallback(() => {
    Alert.alert('Stop recording?', 'The pass is still in progress. The part recorded so far will be saved.', [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Stop and save', style: 'destructive', onPress: () => void useCapture.getState().stop('user') },
    ]);
  }, []);

  const share = useCallback(async () => {
    if (!result) return;
    setActionError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(`file://${result.directory}/${DATA_FILE_NAME}`, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'Share baseband recording',
      });
    } catch (e) {
      setActionError(`${errorMessage(e)} Use Export to Downloads instead.`);
    }
  }, [result]);

  const exportToDownloads = useCallback(async () => {
    if (!result) return;
    setActionError(null);
    setExporting(true);
    try {
      const path = await exportRecording(result.name);
      Alert.alert('Exported', `Saved to ${path}\n\nOpen the Files app, or connect the phone to a computer, and look in Downloads/Azimuth.`);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }, [result]);

  const finish = useCallback(() => {
    useCapture.getState().reset();
    navigation.goBack();
  }, [navigation]);

  if (!options) {
    return (
      <Screen topInset={false}>
        <EmptyState icon="radio-outline" title="No pass selected" message="Open a pass from the Satellites tab and tap Capture." />
      </Screen>
    );
  }

  const { pass, satellite } = options;
  const riseMs = pass.riseTime.getTime();
  const setMs = pass.setTime.getTime();
  const timelineProgress = Math.max(0, Math.min(1, (now - riseMs) / (setMs - riseMs)));
  const beforePass = now < riseMs;
  const afterPass = now >= setMs;
  const tleRecord = tles[pass.noradId]?.record ?? options.tle;
  const sat = location && tleRecord ? getCurrentTrackPoint(tleRecord, location, new Date(now)) : null;
  const bytesWritten = progress?.bytes ?? 0;
  const dropped = progress?.droppedBlocks ?? 0;
  const elapsedSec = (progress?.elapsedMs ?? 0) / 1000;
  const remainingSec = Math.max(0, (setMs - now) / 1000) + 45;
  const expectedBytes = estimateRecordingBytes(recording ? remainingSec + elapsedSec : remainingSec);

  const stateBadge =
    phase === 'recording'
      ? { label: 'Recording', color: colors.record }
      : phase === 'preparing'
        ? { label: 'Preparing', color: colors.warning }
        : phase === 'finishing'
          ? { label: 'Saving', color: colors.warning }
          : phase === 'complete'
            ? { label: result?.error ? 'Stopped early' : 'Saved', color: result?.error ? colors.warning : colors.success }
            : phase === 'error'
              ? { label: 'Failed', color: colors.danger }
              : monitoring
                ? { label: 'Monitoring', color: colors.accent }
                : { label: 'Ready', color: colors.textSecondary };

  const gainText = settings.satelliteGainDb === null ? 'Auto' : `${settings.satelliteGainDb.toFixed(1)} dB`;
  const error = actionError ?? (phase === 'error' ? captureError : null);

  return (
    <Screen topInset={false}>
      <GlassCard style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Text style={styles.satName}>{satellite.name}</Text>
            <Text style={styles.sub}>
              {formatClock(pass.riseTime)} – {formatClock(pass.setTime)} · peak {Math.round(pass.maxElevationDeg)}° · {formatFrequencyMHz(options.frequencyHz)} MHz
            </Text>
          </View>
          <Badge label={stateBadge.label} color={stateBadge.color} />
        </Row>

        <View style={styles.timeline}>
          <View style={[styles.timelineFill, { width: `${timelineProgress * 100}%` }]} />
        </View>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.timelineText}>AOS {formatClock(pass.riseTime)}</Text>
          <Text style={[styles.timelineText, { color: colors.textPrimary }]}>
            {beforePass ? `Starts in ${formatCountdown(riseMs - now)}` : afterPass ? 'Pass ended' : `LOS in ${formatCountdown(setMs - now)}`}
          </Text>
          <Text style={styles.timelineText}>LOS {formatClock(pass.setTime)}</Text>
        </Row>

        {sat ? (
          <Row>
            <Stat label="Azimuth" value={sat.elevationDeg > 0 ? formatAzimuth(sat.azimuthDeg) : '–'} />
            <Stat label="Elevation" value={sat.elevationDeg > 0 ? `${sat.elevationDeg.toFixed(0)}°` : `${sat.elevationDeg.toFixed(0)}° (below)`} />
            <Stat label="Range" value={Math.round(sat.rangeKm).toString()} unit="km" />
          </Row>
        ) : null}
      </GlassCard>

      <GlassCard style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <SectionLabel>Signal</SectionLabel>
          {streamingSat ? <Badge label={SIGNAL_LABEL[signal]} color={SIGNAL_COLOR[signal]} /> : null}
        </Row>
        <SpectrumVisualizer
          bins={streamingSat ? bins : new Array(64).fill(0)}
          frequencyHz={options.frequencyHz}
          sampleRateHz={SATELLITE_SAMPLE_RATE_HZ}
          isStreaming={streamingSat}
          markers={LRPT_FREQUENCIES_HZ.map((hz) => ({ frequencyHz: hz, label: formatFrequencyMHz(hz, 1), color: hz === options.frequencyHz ? colors.success : colors.textTertiary }))}
          height={130}
        />
        <View style={styles.meter}>
          <View
            style={[
              styles.meterFill,
              { width: `${Math.min(1, smoothedSnr / METER_FULL_SCALE_DB) * 100}%`, backgroundColor: SIGNAL_COLOR[signal] },
            ]}
          />
        </View>
        <Text style={styles.note}>
          {streamingSat
            ? `About ${smoothedSnr.toFixed(1)} dB above the noise floor. A good LRPT signal shows as a flat-topped block roughly 140 kHz wide at the green marker.`
            : 'Start monitoring to check the antenna and frequency before the satellite rises.'}
        </Text>
      </GlassCard>

      <GlassCard style={{ gap: 14 }}>
        <SectionLabel>Receiver</SectionLabel>
        <View style={{ gap: 8 }}>
          <Text style={styles.fieldLabel}>Frequency</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {LRPT_FREQUENCIES_HZ.map((hz) => (
              <Chip
                key={hz}
                label={`${formatFrequencyMHz(hz)} MHz`}
                selected={options.frequencyHz === hz}
                onPress={locked ? undefined : () => void applyFrequency(hz)}
              />
            ))}
          </Row>
        </View>

        <View style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.fieldLabel}>Gain · {gainText}</Text>
            <Row>
              <Text style={styles.fieldHint}>Auto</Text>
              <Switch
                value={settings.satelliteGainDb === null}
                disabled={locked}
                onValueChange={(auto) => void applyGain(auto ? null : (gains[gains.length - 1] ?? 40))}
                trackColor={{ true: colors.accentMuted, false: colors.surfaceBorder }}
                thumbColor={settings.satelliteGainDb === null ? colors.accent : colors.textSecondary}
              />
            </Row>
          </Row>
          {settings.satelliteGainDb !== null ? (
            <Row>
              <Button compact variant="secondary" icon="remove" label="Less" disabled={locked} onPress={() => stepGain(-1)} />
              <Text style={styles.gainValue}>{gainText}</Text>
              <Button compact variant="secondary" icon="add" label="More" disabled={locked} onPress={() => stepGain(1)} />
            </Row>
          ) : null}
        </View>

        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Bias-tee (powers an LNA)</Text>
            <Text style={styles.fieldHint}>Only enable if your LNA or antenna expects 4.5 V on the coax.</Text>
          </View>
          <Switch
            value={settings.biasTee}
            disabled={locked}
            onValueChange={(enabled) => void applyBiasTee(enabled)}
            trackColor={{ true: colors.accentMuted, false: colors.surfaceBorder }}
            thumbColor={settings.biasTee ? colors.accent : colors.textSecondary}
          />
        </Row>
        <Text style={styles.fieldHint}>{deviceName ?? 'Receiver not connected yet. It connects when you start.'}</Text>
      </GlassCard>

      {recording || phase === 'finishing' ? (
        <GlassCard style={{ gap: 12, borderColor: colors.record }}>
          <SectionLabel>Recording</SectionLabel>
          <Row>
            <Stat label="Elapsed" value={formatDuration(elapsedSec)} />
            <Stat label="Size" value={formatBytes(bytesWritten)} />
            <Stat label="Expected" value={formatBytes(expectedBytes)} />
          </Row>
          <Row>
            <Stat label="Sample rate" value="288" unit="kS/s" />
            <Stat label="Format" value="ci8" />
            <Stat label="Gaps" value={dropped === 0 ? 'None' : `${dropped} blocks`} color={dropped === 0 ? colors.success : colors.warning} />
          </Row>
          {progress?.error ? <Text style={[styles.note, { color: colors.danger }]}>{progress.error}</Text> : null}
        </GlassCard>
      ) : null}

      {phase === 'complete' && result ? (
        <GlassCard style={{ gap: 12, borderColor: result.error ? colors.warning : colors.success }}>
          <Row>
            <Ionicons name={result.error ? 'warning' : 'checkmark-circle'} size={22} color={result.error ? colors.warning : colors.success} />
            <Text style={styles.resultTitle}>{result.error ? 'Recording stopped early' : result.interrupted ? 'Recording saved (stopped before LOS)' : 'Recording saved'}</Text>
          </Row>
          <Row>
            <Stat label="Duration" value={formatDuration(result.durationSec)} />
            <Stat label="Size" value={formatBytes(result.bytes)} />
            <Stat label="Gaps" value={result.droppedBlocks === 0 ? 'None' : `${result.droppedBlocks} blocks`} color={result.droppedBlocks === 0 ? colors.success : colors.warning} />
          </Row>
          {result.error ? <Text style={[styles.note, { color: colors.warning }]}>{result.error}</Text> : null}
          <Text style={styles.note}>Saved as {result.name}. It is a raw signal recording, not an image yet: decode it with SatDump on a computer.</Text>
          <Row>
            <Button style={{ flex: 1 }} variant="secondary" icon="share-social" label="Share" onPress={() => void share()} />
            <Button style={{ flex: 1 }} variant="secondary" icon="download" label="Export" loading={exporting} onPress={() => void exportToDownloads()} />
          </Row>
          <Button variant="ghost" icon={showHelp ? 'chevron-up' : 'help-circle-outline'} label={showHelp ? 'Hide decoding steps' : 'How do I turn this into an image?'} onPress={() => setShowHelp((v) => !v)} />
          {showHelp ? <DecodingHelp frequencyHz={options.frequencyHz} /> : null}
        </GlassCard>
      ) : null}

      {error ? (
        <GlassCard style={styles.errorCard}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </GlassCard>
      ) : null}

      <View style={{ gap: 10 }}>
        {phase === 'complete' || phase === 'error' ? (
          <Button label="Done" icon="checkmark" onPress={finish} />
        ) : recording ? (
          <Button label="Stop recording" icon="stop" variant="danger" onPress={confirmStop} />
        ) : (
          <>
            <Button
              label={working ? (phase === 'preparing' ? 'Preparing receiver…' : 'Saving…') : 'Start recording'}
              icon="radio-button-on"
              variant="danger"
              loading={working || busy}
              disabled={afterPass}
              onPress={startRecording}
            />
            <Button
              label={monitoring ? 'Stop monitoring' : 'Monitor signal first'}
              icon={monitoring ? 'eye-off' : 'pulse'}
              variant="secondary"
              disabled={working || busy}
              onPress={() => void toggleMonitor()}
            />
          </>
        )}
        <Text style={styles.footnote}>
          Keep the app open or the notification visible while recording. Recording needs about {formatBytes(RECORDING_BYTES_PER_SECOND * 60)} per minute.
        </Text>
      </View>
    </Screen>
  );
}

function DecodingHelp({ frequencyHz }: { frequencyHz: number }) {
  const steps = [
    'Share or Export the recording to your computer (the file is baseband.cs8).',
    'Install SatDump (free, satdump.org) and open Offline processing.',
    'Pipeline: "METEOR M2-X LRPT 72k" (meteor_m2-x_lrpt). If it finds no frames, try "METEOR M2-x LRPT 80k".',
    'Input level: Baseband. Baseband format: cs8 (signed 8-bit I/Q). Sample rate: 288000. Select baseband.cs8.',
    'Press Start. When it finishes, the images (channels and composites) appear in the output folder.',
  ];
  return (
    <View style={styles.help}>
      {steps.map((step, i) => (
        <Row key={i} style={{ alignItems: 'flex-start' }}>
          <Text style={styles.helpIndex}>{i + 1}</Text>
          <Text style={styles.helpText}>{step}</Text>
        </Row>
      ))}
      <Text style={styles.fieldHint}>Recorded at {formatFrequencyMHz(frequencyHz)} MHz.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  satName: { ...typography.heading, fontSize: 24, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  timeline: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceStrong, overflow: 'hidden' },
  timelineFill: { height: 6, backgroundColor: colors.accent },
  timelineText: { ...typography.caption, color: colors.textTertiary, fontVariant: ['tabular-nums'] },
  meter: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceStrong, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  note: { ...typography.caption, color: colors.textSecondary },
  fieldLabel: { ...typography.subheading, fontSize: 14, color: colors.textPrimary },
  fieldHint: { ...typography.caption, color: colors.textTertiary },
  gainValue: { ...typography.subheading, color: colors.textPrimary, flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
  resultTitle: { ...typography.subheading, color: colors.textPrimary, flex: 1 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger, flex: 1 },
  footnote: { ...typography.caption, color: colors.textTertiary, textAlign: 'center' },
  help: { gap: 8, backgroundColor: colors.background, borderRadius: 12, padding: 12 },
  helpIndex: { ...typography.label, color: colors.accent, width: 16 },
  helpText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
});
