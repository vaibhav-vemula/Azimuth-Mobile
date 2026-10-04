import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { GlassCard } from '../../components/GlassCard';
import { ManualLocationPrompt } from '../../components/ManualLocationPrompt';
import { Screen } from '../../components/Screen';
import { Badge, Button, Chip, Row, SectionLabel } from '../../components/ui';
import { RECORDING_FORMATS, RecordingFormat } from '../../capture/sigmf';
import { getFreeStorageBytes } from '../../../modules/rtl-sdr';
import { MONITORED_SATELLITES } from '../../data/satellites';
import { useAppStore } from '../../state/useAppStore';
import { useMapping } from '../../mapping/useMapping';
import { colors, typography } from '../../theme';
import { formatBytes } from '../../utils/format';

const MIN_ELEVATIONS = [0, 5, 10, 15, 20, 25, 30, 40];
const REMINDER_MINUTES = [5, 10, 15, 30, 60];

function ageLabel(date: Date): string {
  const hours = (Date.now() - date.getTime()) / 3600_000;
  if (hours < 1) return 'just now';
  if (hours < 48) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function step<T>(values: T[], current: T, direction: 1 | -1): T {
  const index = Math.max(0, values.indexOf(current));
  return values[Math.max(0, Math.min(values.length - 1, index + direction))];
}

export default function SettingsScreen() {
  const settings = useAppStore((s) => s.settings);
  const location = useAppStore((s) => s.location);
  const locationStatus = useAppStore((s) => s.locationStatus);
  const tles = useAppStore((s) => s.tles);
  const tleLoading = useAppStore((s) => s.tleLoading);
  const tleError = useAppStore((s) => s.tleError);
  const [showManual, setShowManual] = useState(false);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);

  useEffect(() => {
    getFreeStorageBytes().then(setFreeBytes).catch(() => setFreeBytes(null));
  }, []);

  const update = useAppStore.getState().updateSettings;
  const fogStyle = useMapping((s) => s.fogStyle);
  const setFogStyle = useMapping((s) => s.setFogStyle);
  const locationLabel =
    locationStatus === 'manual' ? 'Entered manually' : locationStatus === 'granted' ? 'From GPS' : locationStatus === 'denied' ? 'Permission denied' : 'Locating…';

  return (
    <Screen topInset={false}>
      <View>
        <Text style={styles.subtitle}>Location, predictions and storage</Text>
      </View>

      <GlassCard style={{ gap: 12 }}>
        <SectionLabel>Unmapped ground</SectionLabel>
        <Text style={styles.subtitle}>How the map looks where you have not been yet.</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="Night sky" selected={fogStyle === 'sky'} onPress={() => setFogStyle('sky')} />
          <Chip label="Terrain lines" selected={fogStyle === 'terrain'} onPress={() => setFogStyle('terrain')} />
        </Row>
      </GlassCard>

      <GlassCard style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <SectionLabel>Your location</SectionLabel>
          <Badge label={locationLabel} color={locationStatus === 'denied' ? colors.danger : colors.accent} />
        </Row>
        <Text style={styles.value}>
          {location ? `${location.latitudeDeg.toFixed(4)}°, ${location.longitudeDeg.toFixed(4)}°` : 'Not set'}
        </Text>
        <Row>
          <Button
            style={{ flex: 1 }}
            compact
            variant="secondary"
            icon="locate"
            label="Use GPS"
            onPress={() => {
              if (locationStatus === 'manual') useAppStore.setState({ locationStatus: 'loading' });
              void useAppStore.getState().requestLocation();
            }}
          />
          <Button style={{ flex: 1 }} compact variant="secondary" icon="pencil" label="Enter manually" onPress={() => setShowManual((v) => !v)} />
        </Row>
        {showManual ? (
          <ManualLocationPrompt
            onSubmit={(lat, lon) => {
              useAppStore.getState().setManualLocation(lat, lon);
              setShowManual(false);
            }}
          />
        ) : null}
      </GlassCard>

      <GlassCard style={{ gap: 14 }}>
        <SectionLabel>Pass predictions</SectionLabel>
        <Stepper
          label="Minimum peak elevation"
          hint="Low passes are noisy and rarely decode. 15° or higher is a good start."
          value={`${settings.minElevationDeg}°`}
          onMinus={() => update({ minElevationDeg: step(MIN_ELEVATIONS, settings.minElevationDeg, -1) })}
          onPlus={() => update({ minElevationDeg: step(MIN_ELEVATIONS, settings.minElevationDeg, 1) })}
        />
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Pass reminders</Text>
            <Text style={styles.hint}>Notify before a pass starts.</Text>
          </View>
          <Switch
            value={settings.notificationsEnabled}
            onValueChange={(enabled) => update({ notificationsEnabled: enabled })}
            trackColor={{ true: colors.accentMuted, false: colors.surfaceBorder }}
            thumbColor={settings.notificationsEnabled ? colors.accent : colors.textSecondary}
          />
        </Row>
        {settings.notificationsEnabled ? (
          <Stepper
            label="Remind me"
            value={`${settings.reminderMinutes} min before`}
            onMinus={() => update({ reminderMinutes: step(REMINDER_MINUTES, settings.reminderMinutes, -1) })}
            onPlus={() => update({ reminderMinutes: step(REMINDER_MINUTES, settings.reminderMinutes, 1) })}
          />
        ) : null}
      </GlassCard>

      <GlassCard style={{ gap: 12 }}>
        <SectionLabel>Recording format</SectionLabel>
        <Row>
          {(Object.keys(RECORDING_FORMATS) as RecordingFormat[]).map((key) => (
            <Chip
              key={key}
              label={`${RECORDING_FORMATS[key].label} · ${RECORDING_FORMATS[key].rateLabel}`}
              selected={settings.recordingFormat === key}
              onPress={() => update({ recordingFormat: key })}
            />
          ))}
        </Row>
        <Text style={styles.hint}>
          {settings.recordingFormat === 'fullband'
            ? 'Records the receiver\'s whole stream the way SatDump does: 2.3 MHz of spectrum with both Meteor downlinks, nothing filtered. About 4.6 MB per second, so roughly 2.8 GB for a 10 minute pass.'
            : 'Records only a 0.29 MHz slice around the downlink, filtered and with DC removed. About 0.58 MB per second, roughly 350 MB for a 10 minute pass, but the other downlink is not in the file.'}
        </Text>
      </GlassCard>

      <GlassCard style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <SectionLabel>Antenna power (bias-tee)</SectionLabel>
            <Text style={styles.label}>My antenna has a powered LNA</Text>
            <Text style={styles.hint}>
              Sends 4.5 V (up to 180 mA) up the coax to power an LNA or active antenna. Leave this off for a plain antenna. Never turn
              it on with a DC-shorted antenna (many QFH, loop and some V-dipole designs): it can damage the receiver.
            </Text>
          </View>
          <Switch
            value={settings.biasTee}
            onValueChange={(enabled) => {
              if (!enabled) {
                update({ biasTee: false });
                return;
              }
              Alert.alert(
                'Turn on antenna power?',
                'Only do this if your LNA or active antenna needs power from the receiver and you know the antenna is not DC-shorted. A short circuit can damage the receiver.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Turn on', style: 'destructive', onPress: () => update({ biasTee: true }) },
                ]
              );
            }}
            trackColor={{ true: colors.accentMuted, false: colors.surfaceBorder }}
            thumbColor={settings.biasTee ? colors.accent : colors.textSecondary}
          />
        </Row>
        <Text style={styles.hint}>Gain and frequency are always chosen automatically during capture.</Text>
      </GlassCard>

      <GlassCard style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <SectionLabel>Orbital data</SectionLabel>
          <Button compact variant="secondary" icon="refresh" label="Refresh" loading={tleLoading} onPress={() => void useAppStore.getState().refreshTles(true)} />
        </Row>
        {MONITORED_SATELLITES.map((sat) => {
          const tle = tles[sat.noradId];
          return (
            <Row key={sat.noradId} style={{ justifyContent: 'space-between' }}>
              <View>
                <Text style={styles.label}>{sat.name}</Text>
                <Text style={styles.hint}>NORAD {sat.noradId}</Text>
              </View>
              {tle ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Badge label={tle.outdated ? 'Outdated' : tle.stale ? 'Offline copy' : 'Up to date'} color={tle.outdated ? colors.warning : tle.stale ? colors.warning : colors.success} />
                  <Text style={styles.hint}>
                    {tle.source} · {ageLabel(tle.fetchedAt)}
                  </Text>
                </View>
              ) : (
                <Badge label="Not loaded" color={colors.textTertiary} />
              )}
            </Row>
          );
        })}
        {tleError ? <Text style={[styles.hint, { color: colors.danger }]}>{tleError}</Text> : null}
      </GlassCard>

      <GlassCard style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <SectionLabel>Testing</SectionLabel>
            <Text style={styles.label}>Unlock capture for any pass</Text>
            <Text style={styles.hint}>
              Lets you start a 2 minute test recording at any time, to check the dongle, storage and export. Test recordings
              are flagged in their metadata. During a real pass the normal behaviour applies either way.
            </Text>
          </View>
          <Switch
            value={settings.captureTestMode}
            onValueChange={(enabled) => update({ captureTestMode: enabled })}
            trackColor={{ true: colors.accentMuted, false: colors.surfaceBorder }}
            thumbColor={settings.captureTestMode ? colors.accent : colors.textSecondary}
          />
        </Row>
      </GlassCard>

      <GlassCard style={{ gap: 10 }}>
        <SectionLabel>Storage</SectionLabel>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.label}>Free space</Text>
          <Text style={styles.value}>{freeBytes === null ? '–' : formatBytes(freeBytes)}</Text>
        </Row>
        <Text style={styles.hint}>
          A 10 minute pass records about 2.8 GB in Full band format, or about 350 MB in Compact. Recordings are kept in the app's storage until you export or delete them.
        </Text>
      </GlassCard>

      <GlassCard style={{ gap: 6 }}>
        <SectionLabel>About</SectionLabel>
        <Text style={styles.label}>Azimuth {Constants.expoConfig?.version ?? ''}</Text>
        <Text style={styles.hint}>
          Orbital data from CelesTrak and SatNOGS DB. Receiver driver: RTL-SDR Blog librtlsdr (GPL) with libusb (LGPL). Azimuth is
          licensed GPL-3.0-or-later.
        </Text>
      </GlassCard>
    </Screen>
  );
}

function Stepper({ label, hint, value, onMinus, onPlus }: { label: string; hint?: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <Row>
        <Button compact variant="secondary" icon="remove" label="" onPress={onMinus} />
        <Text style={styles.stepperValue}>{value}</Text>
        <Button compact variant="secondary" icon="add" label="" onPress={onPlus} />
      </Row>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.heading, fontSize: 28, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  label: { ...typography.subheading, fontSize: 14, color: colors.textPrimary },
  value: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  hint: { ...typography.caption, color: colors.textTertiary },
  stepperValue: { ...typography.subheading, color: colors.textPrimary, flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
