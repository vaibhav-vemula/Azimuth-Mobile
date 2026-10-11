import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { GlassCard } from '../../components/GlassCard';
import { LiveSpectrum } from '../../components/LiveSpectrum';
import { StoreBubble } from '../../store/StoreBubble';
import { Screen } from '../../components/Screen';
import { Badge, Button, Row, SectionLabel } from '../../components/ui';
import { errorMessage, useReceiver } from '../../receiver/useReceiver';
import { colors, typography } from '../../theme';
import { formatFrequencyMHz } from '../../utils/format';
import { useCapture } from '../../capture/useCapture';
import { FrequencyTuner } from './components/FrequencyTuner';
import { OnlineRadio } from './components/OnlineRadio';

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

export default function RadioScreen() {
  const focused = useIsFocused();
  // Note: this screen deliberately does not read `bins`. The spectrum stream updates 20+ times a second and
  // only <LiveSpectrum> listens to it.
  const status = useReceiver((s) => s.status);
  const deviceName = useReceiver((s) => s.deviceName);
  const frequencyHz = useReceiver((s) => s.frequencyHz);
  const sampleRate = useReceiver((s) => s.sampleRate);
  const listening = useReceiver((s) => s.listening);
  const volume = useReceiver((s) => s.volume);
  const busy = useReceiver((s) => s.busy);
  const streamAction = useReceiver((s) => s.streamAction);
  const receiverError = useReceiver((s) => s.error);
  const capturePhase = useCapture((s) => s.phase);

  // Dongle: the RTL-SDR and its spectrum. Online: internet stations tuned by frequency, no dongle needed.
  const [mode, setMode] = useState<'dongle' | 'online'>('dongle');
  const [localError, setLocalError] = useState<string | null>(null);
  const [listenBusy, setListenBusy] = useState(false);

  const isConnected = status === 'connected' || status === 'streaming';
  const isStreaming = status === 'streaming';
  const recording = capturePhase === 'recording' || capturePhase === 'preparing' || capturePhase === 'finishing';
  const error = localError ?? receiverError;

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
          if (receiver.listening) await receiver.setListening(false);
          await receiver.stopReceiving();
        } else {
          await receiver.startReceiving();
        }
      }),
    [isStreaming, run]
  );

  const handleListen = useCallback(async () => {
    setListenBusy(true);
    await run(() => useReceiver.getState().setListening(!useReceiver.getState().listening));
    setListenBusy(false);
  }, [run]);

  const changeVolume = useCallback(
    (delta: number) => void run(() => useReceiver.getState().changeVolume(useReceiver.getState().volume + delta)),
    [run]
  );

  const statusColor = STATUS_COLORS[status];
  const controlsLocked = !isConnected || recording;
  const streamLabel =
    streamAction === 'starting' ? 'Starting…' : streamAction === 'stopping' ? 'Stopping…' : isStreaming ? 'Stop stream' : 'Start stream';

  return (
    <Screen overlay={<StoreBubble />}>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>Radio</Text>
          <Text style={styles.subtitle}>{mode === 'online' ? 'Internet radio by frequency' : 'Wideband FM and spectrum'}</Text>
        </View>
        {mode === 'dongle' ? <Badge label={STATUS_LABELS[status]} color={statusColor} /> : null}
      </View>

      <View style={styles.modes} accessibilityRole="tablist">
        {(['dongle', 'online'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} style={[styles.mode, mode === m && styles.modeActive]}>
            <Ionicons name={m === 'dongle' ? 'hardware-chip-outline' : 'globe-outline'} size={16} color={mode === m ? colors.background : colors.textSecondary} />
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>{m === 'dongle' ? 'Dongle' : 'Online'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'online' ? (
        <OnlineRadio />
      ) : null}

      {mode === 'online' ? null : Platform.OS !== 'android' ? (
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
              <Text style={styles.deviceHint}>{isConnected ? 'RTL-SDR ready' : 'Plug the dongle in via USB-OTG, then connect'}</Text>
            </View>
            <Button
              compact
              variant={isConnected ? 'secondary' : 'primary'}
              label={isConnected ? 'Disconnect' : 'Connect'}
              icon={isConnected ? 'power' : 'flash'}
              loading={busy}
              disabled={recording || !!streamAction}
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
            <LiveSpectrum frequencyHz={frequencyHz} sampleRateHz={sampleRate} isStreaming={isStreaming} />
          </GlassCard>

          <FrequencyTuner disabled={controlsLocked} />

          <GlassCard style={{ gap: 12 }}>
            <SectionLabel>Audio · wideband FM</SectionLabel>
            <Row>
              <Button
                style={{ flex: 1 }}
                variant={listening ? 'primary' : 'secondary'}
                icon={listening ? 'volume-high' : 'headset'}
                label={listening ? 'Listening' : 'Listen'}
                loading={listenBusy}
                disabled={controlsLocked || !!streamAction}
                onPress={handleListen}
              />
              <View style={styles.volumeBox}>
                <Pressable hitSlop={10} onPress={() => changeVolume(-0.1)} accessibilityLabel="Volume down" disabled={controlsLocked}>
                  <Ionicons name="remove-circle-outline" size={28} color={colors.accent} />
                </Pressable>
                <Text style={styles.volumeValue}>{Math.round(volume * 100)}%</Text>
                <Pressable hitSlop={10} onPress={() => changeVolume(0.1)} accessibilityLabel="Volume up" disabled={controlsLocked}>
                  <Ionicons name="add-circle-outline" size={28} color={colors.accent} />
                </Pressable>
              </View>
            </Row>
            <Button
              variant={isStreaming ? 'danger' : 'secondary'}
              icon={isStreaming ? 'stop' : 'play'}
              label={streamLabel}
              loading={!!streamAction}
              disabled={controlsLocked}
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
  modes: { flexDirection: 'row', gap: 8, backgroundColor: colors.surface, borderRadius: 16, padding: 4, borderWidth: 1, borderColor: colors.surfaceBorder },
  mode: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12 },
  modeActive: { backgroundColor: colors.accent },
  modeText: { ...typography.subheading, fontSize: 14, color: colors.textSecondary },
  modeTextActive: { color: colors.background },
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
