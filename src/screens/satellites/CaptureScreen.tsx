import { longDistanceParts, useUnitSystem } from '../../units/units';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../../components/dialog';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { GlassCard } from '../../components/GlassCard';
import { Screen } from '../../components/Screen';
import { Badge, Button, EmptyState, Row, SectionLabel, Stat } from '../../components/ui';
import { SATELLITE_SAMPLE_RATE_HZ, exportRecording } from '../../../modules/rtl-sdr';
import { SCAN_CENTER_HZ } from '../../capture/autoSetup';
import { useAutoSetup } from '../../capture/autoSetupStore';
import { RECORDING_FORMATS, RecordingFormat, estimateRecordingBytes } from '../../capture/sigmf';
import { setupInputFor } from '../../capture/setupInput';
import { useCapture } from '../../capture/useCapture';
import { TEST_RECORDING_SEC, captureWindow, isTestRun } from '../../capture/window';
import { getCurrentTrackPoint } from '../../data/propagation/passes';
import { useNow } from '../../hooks/useNow';
import { errorMessage, useReceiver } from '../../receiver/useReceiver';
import { useAppStore } from '../../state/useAppStore';
import { colors, typography } from '../../theme';
import {
  formatAzimuth,
  formatBytes,
  formatClock,
  formatCountdown,
  formatDuration,
  formatFrequencyMHz,
} from '../../utils/format';
import { primaryAction } from './captureAction';
import { LiveSignalCard } from './components/LiveSignalCard';
import { ReceiverCard } from './components/capture/ReceiverCard';
import { SetupChecklist } from './components/capture/SetupChecklist';
import { TipsCard } from './components/capture/TipsCard';
import { PassReceiptCard } from './components/capture/PassReceiptCard';

export default function CaptureScreen() {
  const unitSystem = useUnitSystem();
  const navigation = useNavigation();
  const now = useNow(1000);

  const options = useCapture((s) => s.options);
  const phase = useCapture((s) => s.phase);
  const progress = useCapture((s) => s.progress);
  const result = useCapture((s) => s.result);
  const captureError = useCapture((s) => s.error);
  const recordingPlan = useCapture((s) => s.plan);
  const currentGainDb = useCapture((s) => s.currentGainDb);
  const runIsTest = useCapture((s) => s.testRun);
  const activeFormat = useCapture((s) => s.format);

  const receiverStatus = useReceiver((s) => s.status);
  const sampleRate = useReceiver((s) => s.sampleRate);
  const centerHz = useReceiver((s) => s.frequencyHz);
  const deviceName = useReceiver((s) => s.deviceName);
  const connecting = useReceiver((s) => s.busy);
  const receiverError = useReceiver((s) => s.error);

  const setupStatus = useAutoSetup((s) => s.status);
  const setupProgress = useAutoSetup((s) => s.progress);
  const setupPlan = useAutoSetup((s) => s.plan);
  const setupAnalysis = useAutoSetup((s) => s.analysis);
  const setupError = useAutoSetup((s) => s.error);

  const settings = useAppStore((s) => s.settings);
  const location = useAppStore((s) => s.location);
  const tles = useAppStore((s) => s.tles);

  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const connected = receiverStatus === 'connected' || receiverStatus === 'streaming';
  const recording = phase === 'recording';
  const noradId = options?.satellite.noradId ?? null;

  // Begin the automatic set-up as soon as a receiver is connected, and keep it running until recording starts.
  useEffect(() => {
    if (!noradId || !connected || phase !== 'idle' || setupStatus !== 'idle') return;
    useAutoSetup.getState().start(setupInputFor(noradId));
  }, [noradId, connected, phase, setupStatus]);

  // If the receiver goes away, drop the set-up so it starts cleanly on the next connection.
  useEffect(() => {
    if (connected || phase !== 'idle' || setupStatus === 'idle') return;
    void useAutoSetup.getState().stop().then(() => useAutoSetup.getState().reset());
  }, [connected, phase, setupStatus]);

  // Leaving the screen (without a recording in progress) stops scanning and puts the receiver back to normal.
  useEffect(
    () => () => {
      const current = useCapture.getState().phase;
      if (current === 'idle' || current === 'complete' || current === 'error') {
        void useAutoSetup
          .getState()
          .stop()
          .then(() => {
            useAutoSetup.getState().reset();
            return useReceiver.getState().leaveSatelliteMode();
          });
      }
    },
    []
  );

  const connectReceiver = useCallback(async () => {
    setActionError(null);
    await useReceiver.getState().connect();
  }, []);

  const startRecording = useCallback(() => {
    if (!options) return;
    setActionError(null);
    void useCapture.getState().start(options);
  }, [options]);

  const confirmStop = useCallback(() => {
    appAlert('Stop recording?', 'The pass is still in progress. The part recorded so far will be saved.', [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Stop and save', style: 'destructive', onPress: () => void useCapture.getState().stop('user') },
    ]);
  }, []);

  const share = useCallback(async () => {
    if (!result) return;
    setActionError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(`file://${result.dataPath}`, {
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
      appAlert('Exported', `Saved to ${path}\n\nOpen the Files app, or connect the phone to a computer, and look in Downloads/Azimuth.`);
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
  const window = captureWindow(riseMs, setMs, now);
  const testMode = settings.captureTestMode;
  const testRunNow = isTestRun(window, testMode);
  const isTest = phase === 'idle' || phase === 'preparing' ? testRunNow : runIsTest;
  const passEnded = window.state === 'ended';
  const format: RecordingFormat = phase === 'idle' || phase === 'preparing' ? settings.recordingFormat : activeFormat;
  const formatSpec = RECORDING_FORMATS[format];
  const timelineProgress = Math.max(0, Math.min(1, (now - riseMs) / (setMs - riseMs)));

  const tleRecord = tles[noradId ?? '']?.record ?? options.tle;
  const sat = location && tleRecord ? getCurrentTrackPoint(tleRecord, location, new Date(now)) : null;

  const plan = recordingPlan ?? setupPlan;
  const streamingSat = connected && receiverStatus === 'streaming' && sampleRate === SATELLITE_SAMPLE_RATE_HZ;
  const gainDb = currentGainDb ?? setupPlan?.gainDb ?? null;
  const displayCenterHz = recording ? (recordingPlan?.frequencyHz ?? centerHz) : streamingSat ? centerHz : SCAN_CENTER_HZ;
  const targetHz = plan?.frequencyHz ?? displayCenterHz;

  const action = primaryAction({ connected, connecting, phase, passEnded, testMode, testRun: isTest });
  const bytesWritten = progress?.bytes ?? 0;
  const dropped = progress?.droppedBlocks ?? 0;
  const elapsedSec = (progress?.elapsedMs ?? 0) / 1000;
  const remainingSec = isTest ? TEST_RECORDING_SEC : Math.max(0, (setMs - now) / 1000) + 45;
  const expectedBytes = estimateRecordingBytes(isTest ? TEST_RECORDING_SEC : recording ? remainingSec + elapsedSec : remainingSec, format);

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
              : !connected
                ? { label: 'Offline', color: colors.danger }
                : setupStatus === 'ready'
                  ? { label: 'Ready', color: colors.success }
                  : { label: 'Setting up', color: colors.accent };

  const caption =
    phase === 'recording'
      ? 'Recording is running. You can lock the phone: a notification keeps it alive.'
      : phase === 'complete' || phase === 'error'
        ? ''
        : !connected
          ? 'Plug the dongle in with the OTG cable, then connect. Frequency and gain are chosen automatically.'
          : setupStatus === 'ready'
            ? 'Frequency and gain are set. Recording stops by itself shortly after the satellite sets.'
            : 'Tuning the receiver automatically. You can start recording at any time.';

  const onPrimaryPress = () => {
    if (action.kind === 'connect') void connectReceiver();
    else if (action.kind === 'start') startRecording();
    else if (action.kind === 'stop') confirmStop();
    else if (action.kind === 'done') finish();
  };

  const error = actionError ?? (phase === 'error' ? captureError : null) ?? receiverError ?? (setupStatus === 'error' ? setupError : null);

  return (
    <Screen topInset={false}>
      <GlassCard style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Text style={styles.satName}>{satellite.name}</Text>
            <Text style={styles.sub}>
              {formatClock(pass.riseTime)} – {formatClock(pass.setTime)} · peak {Math.round(pass.maxElevationDeg)}°
              {plan ? ` · ${formatFrequencyMHz(plan.frequencyHz)} MHz` : ''}
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
            {window.state === 'upcoming' || window.state === 'open'
              ? `Rises in ${formatCountdown(riseMs - now)}`
              : window.state === 'ended'
                ? 'Pass ended'
                : `LOS in ${formatCountdown(setMs - now)}`}
          </Text>
          <Text style={styles.timelineText}>LOS {formatClock(pass.setTime)}</Text>
        </Row>

        {sat ? (
          <Row>
            <Stat label="Azimuth" value={sat.elevationDeg > 0 ? formatAzimuth(sat.azimuthDeg) : '–'} />
            <Stat label="Elevation" value={sat.elevationDeg > 0 ? `${sat.elevationDeg.toFixed(0)}°` : `${sat.elevationDeg.toFixed(0)}° (below)`} />
            <Stat label="Range" value={longDistanceParts(sat.rangeKm, unitSystem).value} unit={longDistanceParts(0, unitSystem).unit} />
          </Row>
        ) : null}
      </GlassCard>

      <View style={{ gap: 8 }}>
        <Button
          label={action.label}
          icon={
            action.kind === 'connect'
              ? 'flash'
              : action.kind === 'stop'
                ? 'stop'
                : action.kind === 'done'
                  ? 'checkmark'
                  : action.kind === 'start'
                    ? 'radio-button-on'
                    : undefined
          }
          variant={action.kind === 'connect' || action.kind === 'done' ? 'primary' : 'danger'}
          loading={action.kind === 'busy'}
          disabled={!action.enabled}
          onPress={onPrimaryPress}
        />
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>

      {error ? (
        <GlassCard style={styles.errorCard}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={styles.errorText}>{error}</Text>
            {setupStatus === 'error' && phase === 'idle' ? (
              <Button compact variant="secondary" icon="refresh" label="Retry set-up" onPress={() => useAutoSetup.getState().reset()} />
            ) : null}
          </View>
        </GlassCard>
      ) : null}

      {isTest && phase !== 'complete' && phase !== 'error' ? (
        <GlassCard style={styles.testCard}>
          <Ionicons name="flask-outline" size={18} color={colors.warning} />
          <Text style={styles.testText}>
            Test recording: the satellite is not in its pass window, so this records {TEST_RECORDING_SEC / 60} minutes starting when you
            press Start (about {formatBytes(estimateRecordingBytes(TEST_RECORDING_SEC, format))}). It checks the receiver, storage, file and export
            end to end, but will not contain a satellite image. It is flagged as a test in the saved metadata.
          </Text>
        </GlassCard>
      ) : null}

      {phase === 'recording' || phase === 'finishing' ? (
        <GlassCard style={{ gap: 12, borderColor: colors.record }}>
          <SectionLabel>Recording</SectionLabel>
          <Row>
            <Stat label="Elapsed" value={formatDuration(elapsedSec)} />
            <Stat label="Size" value={formatBytes(bytesWritten)} />
            <Stat label="Expected" value={formatBytes(expectedBytes)} />
          </Row>
          <Row>
            <Stat label="Gain" value={gainDb === null ? '–' : gainDb.toFixed(1)} unit="dB" />
            <Stat label="Format" value={`${formatSpec.rateLabel} · cs8`} />
            <Stat label="Gaps" value={dropped === 0 ? 'None' : `${dropped} blocks`} color={dropped === 0 ? colors.success : colors.warning} />
          </Row>
          {recordingPlan && currentGainDb !== null && currentGainDb < recordingPlan.gainDb - 0.05 ? (
            <Text style={styles.note}>
              The gain was lowered from {recordingPlan.gainDb.toFixed(1)} dB to {currentGainDb.toFixed(1)} dB because the receiver began to overload.
            </Text>
          ) : null}
          {progress?.error ? <Text style={[styles.note, { color: colors.danger }]}>{progress.error}</Text> : null}
        </GlassCard>
      ) : null}

      {phase === 'complete' && result ? (
        <GlassCard style={{ gap: 12, borderColor: result.error ? colors.warning : colors.success }}>
          <Row>
            <Ionicons name={result.error ? 'warning' : 'checkmark-circle'} size={22} color={result.error ? colors.warning : colors.success} />
            <Text style={styles.resultTitle}>
              {result.error ? 'Recording stopped early' : result.interrupted ? 'Recording saved (stopped before LOS)' : 'Recording saved'}
            </Text>
          </Row>
          <Row>
            <Stat label="Duration" value={formatDuration(result.durationSec)} />
            <Stat label="Size" value={formatBytes(result.bytes)} />
            <Stat label="Gaps" value={result.droppedBlocks === 0 ? 'None' : `${result.droppedBlocks} blocks`} color={result.droppedBlocks === 0 ? colors.success : colors.warning} />
          </Row>
          {recordingPlan ? (
            <Text style={styles.note}>
              Recorded at {formatFrequencyMHz(recordingPlan.frequencyHz)} MHz with {recordingPlan.gainDb.toFixed(1)} dB gain, chosen automatically.
            </Text>
          ) : null}
          {result.error ? <Text style={[styles.note, { color: colors.warning }]}>{result.error}</Text> : null}
          <Text style={styles.note}>Saved as {result.name}. It is a raw signal recording, not an image yet: decode it with SatDump on a computer.</Text>
          <Row>
            <Button style={{ flex: 1 }} variant="secondary" icon="share-social" label="Share" onPress={() => void share()} />
            <Button style={{ flex: 1 }} variant="secondary" icon="download" label="Export" loading={exporting} onPress={() => void exportToDownloads()} />
          </Row>
          <PassReceiptCard />
          <Button variant="ghost" icon={showHelp ? 'chevron-up' : 'help-circle-outline'} label={showHelp ? 'Hide decoding steps' : 'How do I turn this into an image?'} onPress={() => setShowHelp((v) => !v)} />
          {showHelp ? <DecodingHelp frequencyHz={recordingPlan?.frequencyHz ?? targetHz} format={result.format} /> : null}
        </GlassCard>
      ) : null}

      {phase === 'idle' || phase === 'preparing' ? (
        <>
          <ReceiverCard connected={connected} deviceName={deviceName} gainDb={gainDb} antennaPower={settings.biasTee} />
          <SetupChecklist
            connected={connected}
            deviceName={deviceName}
            status={setupStatus}
            progress={setupProgress}
            plan={setupPlan}
            analysis={setupAnalysis}
            error={setupError}
          />
        </>
      ) : null}

      {phase !== 'complete' ? <LiveSignalCard centerHz={displayCenterHz} targetHz={targetHz} active={streamingSat} /> : null}

      {phase === 'idle' ? <TipsCard /> : null}
    </Screen>
  );
}

function DecodingHelp({ frequencyHz, format }: { frequencyHz: number; format: RecordingFormat }) {
  const spec = RECORDING_FORMATS[format];
  const steps = [
    'Share or Export the recording to your computer (the file is baseband.cs8).',
    'Install SatDump (free, satdump.org) and open Offline processing.',
    'Pipeline: "METEOR M2-X LRPT 72k" (meteor_m2-x_lrpt). If it finds no frames, try "METEOR M2-x LRPT 80k".',
    `Input level: Baseband. Baseband format: cs8 (signed 8-bit I/Q). Sample rate: ${spec.sampleRateHz}. Select baseband.cs8.`,
    'Tick DC blocking if SatDump offers it. No frequency shift is needed: the recording is centred on the downlink.',
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
      <Text style={styles.note}>
        Recorded at {formatFrequencyMHz(frequencyHz)} MHz, {spec.label.toLowerCase()} ({spec.rateLabel}, about {spec.coverageLabel} of spectrum).
        {format === 'fullband' ? ' Both Meteor downlinks are in the file.' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  satName: { ...typography.heading, fontSize: 24, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  timeline: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceStrong, overflow: 'hidden' },
  timelineFill: { height: 6, backgroundColor: colors.accent },
  timelineText: { ...typography.caption, color: colors.textTertiary, fontVariant: ['tabular-nums'] },
  caption: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 12 },
  note: { ...typography.caption, color: colors.textSecondary },
  testCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderColor: colors.warning },
  testText: { ...typography.caption, color: colors.warning, flex: 1 },
  resultTitle: { ...typography.subheading, color: colors.textPrimary, flex: 1 },
  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger },
  help: { gap: 8, backgroundColor: colors.background, borderRadius: 12, padding: 12 },
  helpIndex: { ...typography.label, color: colors.accent, width: 16 },
  helpText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
});
