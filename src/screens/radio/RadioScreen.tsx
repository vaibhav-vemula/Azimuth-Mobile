import { useCallback, useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { GlassCard } from '../../components/GlassCard';
import { Screen } from '../../components/Screen';
import { SpectrumVisualizer } from '../../components/SpectrumVisualizer';
import { Badge, Button, Row, SectionLabel } from '../../components/ui';
import { MAX_FREQUENCY_HZ, MIN_FREQUENCY_HZ } from '../../../modules/rtl-sdr';
import { errorMessage, useReceiver } from '../../receiver/useReceiver';
import { colors, typography } from '../../theme';
import { formatFrequencyMHz } from '../../utils/format';
import { useCapture } from '../../capture/useCapture';

const STATUS_COLORS = {
  disconnected: colors.textTertiary,
  connecting: colors.warning,
  connected: colors.accent,
  streaming: colors.success,
  error: colors.danger,
} as const;

const STATUS_LABELS = {
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  connected: 'Connected',
  streaming: 'Streaming',
  error: 'Error',
} as const;

const PRESETS = [
  { label: '88.5', hz: 88_500_000 },
  { label: '93.9', hz: 93_900_000 },
  { label: '98.7', hz: 98_700_000 },
  { label: '103.5', hz: 103_500_000 },
];

export default function RadioScreen() {
  const focused = useIsFocused();
  const status = useReceiver((s) => s.status);
  const deviceName = useReceiver((s) => s.deviceName);
  const frequencyHz = useReceiver((s) => s.frequencyHz);
  const sampleRate = useReceiver((s) => s.sampleRate);
  const bins = useReceiver((s) => s.bins);
  const listening = useReceiver((s) => s.listening);
  const volume = useReceiver((s) => s.volume);
  const busy = useReceiver((s) => s.busy);
  const receiverError = useReceiver((s) => s.error);
  const capturePhase = useCapture((s) => s.phase);

  const [input, setInput] = useState(formatFrequencyMHz(frequencyHz));
  const [localError, setLocalError] = useState<string | null>(null);

  const isConnected = status === 'connected' || status === 'streaming';
  const isStreaming = status === 'streaming';
  const recording = capturePhase === 'recording' || capturePhase === 'preparing' || capturePhase === 'finishing';
  const error = localError ?? receiverError;

  useEffect(() => {
    setInput(formatFrequencyMHz(frequencyHz));
  }, [frequencyHz]);

  // Returning from the satellite tools: put the dongle back into its general-purpose mode.
  useEffect(() => {
    if (focused && isConnected && !recording) {
      useReceiver.getState().enterFmMode().catch((e) => setLocalError(errorMessage(e)));
    }
  }, [focused, isConnected, recording]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setLocalError(null);
    useReceiver.getState().setError(null);
    try {
      await action();
    } catch (e) {
      setLocalError(errorMessage(e));
    }
  }, []);

  const tuneTo = useCallback(
    (hz: number) => run(() => useReceiver.getState().tuneTo(hz)),
    [run]
  );

  const handleTune = useCallback(() => {
    Keyboard.dismiss();
    const mhz = Number.parseFloat(input.replace(',', '.'));
    void run(async () => {
      if (!Number.isFinite(mhz)) throw new Error('Enter a frequency in MHz.');
      await useReceiver.getState().tuneTo(mhz * 1e6);
    });
  }, [input, run]);

  const handleConnect = useCallback(
    () =>
      run(async () => {
        const receiver = useReceiver.getState();
        if (isConnected) await receiver.disconnect();
        else await receiver.connect();
      }),
    [isConnected, run]
  );

  const handleStream = useCallback(
    () =>
      run(async () => {
        const receiver = useReceiver.getState();
        if (isStreaming) {
          await receiver.setListening(false);
          await receiver.stopReceiving();
        } else {
          await receiver.startReceiving();
        }
      }),
    [isStreaming, run]
  );

  const handleListen = useCallback(
    () => run(() => useReceiver.getState().setListening(!listening)),
    [listening, run]
  );

  const statusColor = STATUS_COLORS[status];

  return (
    <Screen>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>Radio</Text>
          <Text style={styles.subtitle}>Wideband FM and spectrum</Text>
        </View>
        <Badge label={STATUS_LABELS[status]} color={statusColor} />
      </View>

      {Platform.OS !== 'android' ? (
        <GlassCard>
          <Text style={styles.body}>The RTL-SDR receiver needs an Android device with USB-OTG.</Text>
        </GlassCard>
      ) : (
        <>
          <GlassCard style={styles.deviceCard}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.deviceName} numberOfLines={1}>
                {deviceName ?? 'No receiver attached'}
              </Text>
              <Text style={styles.deviceHint}>
                {isConnected ? 'RTL-SDR ready' : 'Plug the dongle in via USB-OTG, then connect'}
              </Text>
            </View>
            <Button
              compact
              variant={isConnected ? 'secondary' : 'primary'}
              label={isConnected ? 'Disconnect' : 'Connect'}
              icon={isConnected ? 'power' : 'flash'}
              loading={busy}
              disabled={recording}
              onPress={handleConnect}
            />
          </GlassCard>

          <GlassCard>
            <Row style={styles.frequencyHeader}>
              <View>
                <SectionLabel>Center frequency</SectionLabel>
                <Text style={styles.frequency}>
                  {formatFrequencyMHz(frequencyHz)}
                  <Text style={styles.unit}> MHz</Text>
                </Text>
              </View>
              <Badge label={isStreaming ? 'LIVE' : 'IDLE'} color={isStreaming ? colors.success : colors.textTertiary} />
            </Row>
            <SpectrumVisualizer bins={bins} frequencyHz={frequencyHz} sampleRateHz={sampleRate} isStreaming={isStreaming} />
          </GlassCard>

          <GlassCard style={{ gap: 12 }}>
            <SectionLabel>Tune</SectionLabel>
            <Row>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  keyboardType="decimal-pad"
                  placeholder="100.000"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.accent}
                  editable={isConnected && !recording}
                  returnKeyType="done"
                  onSubmitEditing={handleTune}
                />
                <Text style={styles.inputUnit}>MHz</Text>
              </View>
              <Button label="Tune" onPress={handleTune} disabled={!isConnected || recording} />
            </Row>
            <Row style={{ flexWrap: 'wrap' }}>
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  compact
                  variant="secondary"
                  label={preset.label}
                  disabled={!isConnected || recording}
                  onPress={() => tuneTo(preset.hz)}
                />
              ))}
            </Row>
            <Text style={styles.hint}>
              Range {(MIN_FREQUENCY_HZ / 1e6).toFixed(1)} to {(MAX_FREQUENCY_HZ / 1e6).toFixed(0)} MHz. Below 28.8 MHz the V4 upconverter is used.
            </Text>
          </GlassCard>

          <GlassCard style={{ gap: 12 }}>
            <SectionLabel>Audio · wideband FM</SectionLabel>
            <Row>
              <Button
                style={{ flex: 1 }}
                variant={listening ? 'primary' : 'secondary'}
                icon={listening ? 'volume-high' : 'headset'}
                label={listening ? 'Listening' : 'Listen'}
                disabled={!isConnected || recording}
                onPress={handleListen}
              />
              <View style={styles.volumeBox}>
                <Ionicons
                  name="remove-circle-outline"
                  size={28}
                  color={colors.accent}
                  onPress={() => run(() => useReceiver.getState().changeVolume(volume - 0.1))}
                />
                <Text style={styles.volumeValue}>{Math.round(volume * 100)}%</Text>
                <Ionicons
                  name="add-circle-outline"
                  size={28}
                  color={colors.accent}
                  onPress={() => run(() => useReceiver.getState().changeVolume(volume + 0.1))}
                />
              </View>
            </Row>
            <Button
              variant={isStreaming ? 'danger' : 'secondary'}
              icon={isStreaming ? 'stop' : 'play'}
              label={isStreaming ? 'Stop stream' : 'Start stream'}
              disabled={!isConnected || recording}
              onPress={handleStream}
            />
          </GlassCard>

          {recording ? (
            <GlassCard style={styles.noticeCard}>
              <Ionicons name="radio-button-on" size={18} color={colors.record} />
              <Text style={styles.noticeText}>A satellite pass is being recorded. Radio controls are locked until it finishes.</Text>
            </GlassCard>
          ) : null}

          {error ? (
            <GlassCard style={styles.errorCard}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </GlassCard>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.heading, fontSize: 28, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  body: { ...typography.body, color: colors.textSecondary },
  deviceCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  deviceName: { ...typography.subheading, color: colors.textPrimary },
  deviceHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  frequencyHeader: { justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  frequency: { ...typography.display, color: colors.accent, fontVariant: ['tabular-nums'] },
  unit: { ...typography.subheading, color: colors.textSecondary },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingHorizontal: 14,
  },
  input: { flex: 1, ...typography.subheading, fontSize: 20, color: colors.textPrimary, paddingVertical: 11, fontVariant: ['tabular-nums'] },
  inputUnit: { ...typography.caption, color: colors.textSecondary, marginLeft: 8 },
  hint: { ...typography.caption, color: colors.textTertiary },
  volumeBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingHorizontal: 10,
    minHeight: 48,
  },
  volumeValue: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.record },
  noticeText: { ...typography.caption, color: colors.textPrimary, flex: 1 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger, flex: 1 },
});
