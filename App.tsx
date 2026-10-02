import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  MAX_FREQUENCY_HZ,
  MIN_FREQUENCY_HZ,
  addSignalListener,
  addStatusListener,
  connect,
  disconnect,
  setAudioEnabled,
  setVolume,
  startStream,
  stopStream,
  tune,
} from './modules/rtl-sdr';
import type { RtlSdrStatus } from './modules/rtl-sdr';
import SpectrumVisualizer from './src/components/SpectrumVisualizer';

const DEFAULT_FREQUENCY_HZ = 100_000_000;
const EMPTY_BINS: number[] = new Array(64).fill(0);
const DEFAULT_VOLUME = 0.8;
const VOLUME_STEP = 0.1;

const STATUS_COLORS: Record<RtlSdrStatus, string> = {
  disconnected: '#6B7690',
  connecting: '#FFB300',
  connected: '#00E5FF',
  streaming: '#00E676',
  error: '#FF4500',
};

const STATUS_LABELS: Record<RtlSdrStatus, string> = {
  disconnected: 'DISCONNECTED',
  connecting: 'CONNECTING…',
  connected: 'CONNECTED',
  streaming: 'STREAMING',
  error: 'ERROR',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function App() {
  const [status, setStatus] = useState<RtlSdrStatus>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [frequencyHz, setFrequencyHz] = useState<number>(DEFAULT_FREQUENCY_HZ);
  const [frequencyInput, setFrequencyInput] = useState<string>((DEFAULT_FREQUENCY_HZ / 1e6).toFixed(3));
  const [bins, setBins] = useState<number[]>(EMPTY_BINS);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState<boolean>(false);
  const [volume, setVolumeState] = useState<number>(DEFAULT_VOLUME);

  const isSupported = Platform.OS === 'android';
  const isConnected = status === 'connected' || status === 'streaming';
  const isStreaming = status === 'streaming';
  const isBusy = status === 'connecting';

  useEffect(() => {
    if (!isSupported) return undefined;

    const signalSub = addSignalListener((event) => {
      setBins(event.bins);
    });
    const statusSub = addStatusListener((event) => {
      setStatus(event.status);
      setDeviceName(event.deviceName);
      setFrequencyHz(event.frequency);
      if (event.status === 'disconnected') {
        setBins(EMPTY_BINS);
      }
    });

    return () => {
      signalSub.remove();
      statusSub.remove();
      disconnect().catch(() => undefined);
    };
  }, [isSupported]);

  const handleConnectToggle = useCallback(async () => {
    setError(null);
    try {
      if (isConnected) {
        await disconnect();
      } else {
        await connect();
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [isConnected]);

  const handleTune = useCallback(async () => {
    Keyboard.dismiss();
    setError(null);

    const megahertz = Number.parseFloat(frequencyInput.replace(',', '.'));
    const hertz = megahertz * 1e6;
    if (!Number.isFinite(megahertz) || hertz < MIN_FREQUENCY_HZ || hertz > MAX_FREQUENCY_HZ) {
      setError(
        `Enter a frequency between ${(MIN_FREQUENCY_HZ / 1e6).toFixed(1)} and ${(MAX_FREQUENCY_HZ / 1e6).toFixed(0)} MHz.`
      );
      return;
    }

    try {
      await tune(hertz);
      setFrequencyHz(hertz);
      setFrequencyInput(megahertz.toFixed(3));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [frequencyInput]);

  const handleStreamToggle = useCallback(async () => {
    setError(null);
    try {
      if (isStreaming) {
        await stopStream();
      } else {
        await startStream();
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [isStreaming]);

  const handleListenToggle = useCallback(async () => {
    setError(null);
    try {
      if (listening) {
        await setAudioEnabled(false);
        setListening(false);
      } else {
        await setAudioEnabled(true);
        setListening(true);
        if (!isStreaming) {
          await startStream();
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [listening, isStreaming]);

  const handleVolumeStep = useCallback(
    async (delta: number) => {
      const next = Math.min(1, Math.max(0, Math.round((volume + delta) * 10) / 10));
      setVolumeState(next);
      try {
        await setVolume(next);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [volume]
  );

  const statusColor = STATUS_COLORS[status];

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <Text style={styles.title}>AZIMUTH</Text>
          <Text style={styles.version}>V1 · RTL-SDR</Text>
        </View>

        <View style={[styles.banner, { borderColor: statusColor }]}>
          <View style={[styles.bannerDot, { backgroundColor: statusColor }]} />
          <View style={styles.bannerText}>
            <Text style={[styles.bannerStatus, { color: statusColor }]}>
              {isSupported ? STATUS_LABELS[status] : 'UNSUPPORTED PLATFORM'}
            </Text>
            <Text style={styles.bannerDevice} numberOfLines={1}>
              {isSupported
                ? (deviceName ?? 'No receiver attached')
                : 'Run on an Android device with a USB-OTG RTL-SDR'}
            </Text>
          </View>
        </View>

        <SpectrumVisualizer bins={bins} frequencyHz={frequencyHz} isStreaming={isStreaming} />

        <View style={styles.card}>
          <Text style={styles.cardLabel}>TUNE FREQUENCY</Text>
          <View style={styles.tuneRow}>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={frequencyInput}
                onChangeText={setFrequencyInput}
                keyboardType="decimal-pad"
                placeholder="100.000"
                placeholderTextColor="#3A4358"
                selectionColor="#00E5FF"
                editable={isSupported}
                returnKeyType="done"
                onSubmitEditing={handleTune}
              />
              <Text style={styles.inputUnit}>MHz</Text>
            </View>
            <Pressable
              onPress={handleTune}
              disabled={!isConnected}
              style={({ pressed }) => [
                styles.button,
                styles.buttonPrimary,
                !isConnected && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonPrimaryText}>TUNE</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>AUDIO · WIDEBAND FM</Text>
          <View style={styles.tuneRow}>
            <Pressable
              onPress={handleListenToggle}
              disabled={!isConnected}
              style={({ pressed }) => [
                styles.button,
                styles.buttonFlex,
                listening ? styles.buttonPrimary : styles.buttonOutline,
                !isConnected && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={listening ? styles.buttonPrimaryText : styles.buttonOutlineText}>
                {listening ? 'LISTENING' : 'LISTEN'}
              </Text>
            </Pressable>
            <View style={styles.volumeBox}>
              <Pressable
                onPress={() => handleVolumeStep(-VOLUME_STEP)}
                style={({ pressed }) => [styles.volumeButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.volumeButtonText}>−</Text>
              </Pressable>
              <Text style={styles.volumeValue}>{Math.round(volume * 100)}%</Text>
              <Pressable
                onPress={() => handleVolumeStep(VOLUME_STEP)}
                style={({ pressed }) => [styles.volumeButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.volumeButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.hint}>Tune to an FM station (88–108 MHz). Mono, 75 µs de-emphasis.</Text>
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            onPress={handleConnectToggle}
            disabled={!isSupported || isBusy}
            style={({ pressed }) => [
              styles.button,
              styles.buttonFlex,
              styles.buttonOutline,
              (!isSupported || isBusy) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonOutlineText}>{isConnected ? 'DISCONNECT' : 'CONNECT'}</Text>
          </Pressable>
          <Pressable
            onPress={handleStreamToggle}
            disabled={!isConnected}
            style={({ pressed }) => [
              styles.button,
              styles.buttonFlex,
              isStreaming ? styles.buttonDanger : styles.buttonPrimary,
              !isConnected && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={isStreaming ? styles.buttonDangerText : styles.buttonPrimaryText}>
              {isStreaming ? 'STOP STREAM' : 'START STREAM'}
            </Text>
          </Pressable>
        </View>

        {error !== null && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0A0D14',
  },
  content: {
    padding: 16,
    paddingTop: Platform.OS === 'android' ? 40 : 16,
    gap: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  title: {
    color: '#E6ECFF',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 6,
  },
  version: {
    color: '#6B7690',
    fontSize: 12,
    letterSpacing: 1.5,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#12161F',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  bannerText: {
    flex: 1,
  },
  bannerStatus: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  bannerDevice: {
    color: '#9AA5BF',
    fontSize: 13,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#12161F',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E2533',
    padding: 16,
  },
  cardLabel: {
    color: '#6B7690',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  tuneRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A0D14',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3142',
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    color: '#E6ECFF',
    fontSize: 20,
    fontWeight: '600',
    paddingVertical: 12,
    fontVariant: ['tabular-nums'],
  },
  inputUnit: {
    color: '#6B7690',
    fontSize: 14,
    marginLeft: 8,
  },
  volumeBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0A0D14',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3142',
    paddingHorizontal: 6,
  },
  volumeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeButtonText: {
    color: '#00E5FF',
    fontSize: 24,
    fontWeight: '700',
  },
  volumeValue: {
    color: '#E6ECFF',
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  hint: {
    color: '#6B7690',
    fontSize: 12,
    marginTop: 10,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonPrimary: {
    backgroundColor: '#00E5FF',
  },
  buttonPrimaryText: {
    color: '#0A0D14',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#00E5FF',
  },
  buttonOutlineText: {
    color: '#00E5FF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  buttonDanger: {
    backgroundColor: '#FF4500',
  },
  buttonDangerText: {
    color: '#0A0D14',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  errorBox: {
    backgroundColor: 'rgba(255, 69, 0, 0.1)',
    borderColor: '#FF4500',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#FF8A65',
    fontSize: 13,
  },
});
