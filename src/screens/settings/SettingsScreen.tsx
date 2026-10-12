import { BackupCard } from './BackupCard';
import { TestChestCard } from './TestChestCard';
import { useUnits } from '../../units/units';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../../components/dialog';
import Constants from 'expo-constants';
import { AzimuthMark } from '../../components/Logo';
import { ManualLocationPrompt } from '../../components/ManualLocationPrompt';
import { Screen } from '../../components/Screen';
import { Badge, Button } from '../../components/ui';
import { Row, Section, Segmented, StepperPill, ToggleRow } from './SettingsParts';
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
  const unitPreference = useUnits((s) => s.preference);
  const setUnitPreference = useUnits((s) => s.setPreference);
  const fogStyle = useMapping((s) => s.fogStyle);
  const setFogStyle = useMapping((s) => s.setFogStyle);
  const locationLabel =
    locationStatus === 'manual' ? 'Entered manually' : locationStatus === 'granted' ? 'From GPS' : locationStatus === 'denied' ? 'Permission denied' : 'Locating…';

  return (
    <Screen topInset={false}>
      <View style={styles.hero}>
        <AzimuthMark size={56} tile />
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Azimuth</Text>
          <Text style={styles.heroSub}>Version {Constants.expoConfig?.version ?? ''}</Text>
        </View>
        <Badge label="Devnet" color={colors.warning} />
      </View>

      <BackupCard />

      <Section icon="map-outline" title="Map" subtitle="Units and how unexplored ground looks">
        <Row first label="Units" hint="Distances on the map, in chests and in session stats. Automatic follows the country you are in.">
          <Segmented
            value={unitPreference}
            onChange={setUnitPreference}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'imperial', label: 'Miles' },
              { value: 'metric', label: 'Km' },
            ]}
          />
        </Row>
        <Row label="Unmapped ground" hint="How the map looks where you have not been yet.">
          <Segmented
            value={fogStyle}
            onChange={setFogStyle}
            options={[
              { value: 'sky', label: 'Night sky' },
              { value: 'terrain', label: 'Terrain lines' },
            ]}
          />
        </Row>
      </Section>

      <Section icon="location-outline" title="Your location" subtitle="Used for pass predictions and the map" right={<Badge label={locationLabel} color={locationStatus === 'denied' ? colors.danger : colors.accent} />}>
        <Row first label="Coordinates">
          <Text style={styles.coords}>{location ? `${location.latitudeDeg.toFixed(4)}°, ${location.longitudeDeg.toFixed(4)}°` : 'Not set'}</Text>
          <View style={styles.buttons}>
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
          </View>
          {showManual ? (
            <ManualLocationPrompt
              onSubmit={(lat, lon) => {
                useAppStore.getState().setManualLocation(lat, lon);
                setShowManual(false);
              }}
            />
          ) : null}
        </Row>
      </Section>

      <Section icon="planet-outline" title="Satellite passes" subtitle="Which passes to show and when to remind you">
        <Row
          first
          label="Minimum peak elevation"
          hint="Low passes are noisy and rarely decode. 15° or higher is a good start."
          right={
            <StepperPill
              value={`${settings.minElevationDeg}°`}
              onMinus={() => update({ minElevationDeg: step(MIN_ELEVATIONS, settings.minElevationDeg, -1) })}
              onPlus={() => update({ minElevationDeg: step(MIN_ELEVATIONS, settings.minElevationDeg, 1) })}
            />
          }
        />
        <ToggleRow label="Pass reminders" hint="Notify before a pass starts." value={settings.notificationsEnabled} onChange={(enabled) => update({ notificationsEnabled: enabled })} />
        {settings.notificationsEnabled ? (
          <Row
            label="Remind me"
            right={
              <StepperPill
                value={`${settings.reminderMinutes} min`}
                onMinus={() => update({ reminderMinutes: step(REMINDER_MINUTES, settings.reminderMinutes, -1) })}
                onPlus={() => update({ reminderMinutes: step(REMINDER_MINUTES, settings.reminderMinutes, 1) })}
              />
            }
          />
        ) : null}
      </Section>

      <Section icon="radio-outline" title="Receiver" subtitle="Recording and antenna power">
        <Row first label="Recording format">
          <Segmented
            value={settings.recordingFormat}
            onChange={(key) => update({ recordingFormat: key })}
            options={(Object.keys(RECORDING_FORMATS) as RecordingFormat[]).map((key) => ({ value: key, label: `${RECORDING_FORMATS[key].label} · ${RECORDING_FORMATS[key].rateLabel}` }))}
          />
          <Text style={styles.hint}>
            {settings.recordingFormat === 'fullband'
              ? "Records the receiver's whole stream the way SatDump does: 2.3 MHz of spectrum with both Meteor downlinks, nothing filtered. About 4.6 MB per second, so roughly 2.8 GB for a 10 minute pass."
              : 'Records only a 0.29 MHz slice around the downlink, filtered and with DC removed. About 0.58 MB per second, roughly 350 MB for a 10 minute pass, but the other downlink is not in the file.'}
          </Text>
        </Row>
        <ToggleRow
          label="My antenna has a powered LNA"
          hint="Sends 4.5 V (up to 180 mA) up the coax to power an LNA or active antenna. Leave this off for a plain antenna. Never turn it on with a DC-shorted antenna (many QFH, loop and some V-dipole designs): it can damage the receiver."
          value={settings.biasTee}
          onChange={(enabled) => {
            if (!enabled) {
              update({ biasTee: false });
              return;
            }
            appAlert(
              'Turn on antenna power?',
              'Only do this if your LNA or active antenna needs power from the receiver and you know the antenna is not DC-shorted. A short circuit can damage the receiver.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Turn on', style: 'destructive', onPress: () => update({ biasTee: true }) },
              ]
            );
          }}
        />
        <Row>
          <Text style={styles.hint}>Gain and frequency are always chosen automatically during capture.</Text>
        </Row>
      </Section>

      <Section
        icon="cloud-download-outline"
        title="Orbital data"
        subtitle="Satellite positions come from CelesTrak and SatNOGS"
        right={<Button compact variant="secondary" icon="refresh" label="Refresh" loading={tleLoading} onPress={() => void useAppStore.getState().refreshTles(true)} />}
      >
        {MONITORED_SATELLITES.map((sat, i) => {
          const tle = tles[sat.noradId];
          return (
            <Row
              key={sat.noradId}
              first={i === 0}
              label={sat.name}
              hint={`NORAD ${sat.noradId}${tle ? ` · ${tle.source} · ${ageLabel(tle.fetchedAt)}` : ''}`}
              right={
                tle ? (
                  <Badge label={tle.outdated ? 'Outdated' : tle.stale ? 'Offline copy' : 'Up to date'} color={tle.outdated || tle.stale ? colors.warning : colors.success} />
                ) : (
                  <Badge label="Not loaded" color={colors.textTertiary} />
                )
              }
            />
          );
        })}
        {tleError ? (
          <Row>
            <Text style={[styles.hint, { color: colors.danger }]}>{tleError}</Text>
          </Row>
        ) : null}
      </Section>

      <Section icon="hardware-chip-outline" title="Storage" subtitle="Recordings stay in the app until you export or delete them">
        <Row first label="Free space" right={<Text style={styles.value}>{freeBytes === null ? '–' : formatBytes(freeBytes)}</Text>} hint="A 10 minute pass records about 2.8 GB in Full band format, or about 350 MB in Compact." />
      </Section>

      <Section icon="flask-outline" title="Testing" subtitle="Tools for trying things without a real pass or chest" tone="warning">
        <ToggleRow
          first
          label="Unlock capture for any pass"
          hint="Lets you start a 2 minute test recording at any time, to check the dongle, storage and export. Test recordings are flagged in their metadata. During a real pass the normal behaviour applies either way."
          value={settings.captureTestMode}
          onChange={(enabled) => update({ captureTestMode: enabled })}
        />
      </Section>

      <TestChestCard />

      <View style={styles.about}>
        <Text style={styles.aboutTitle}>Azimuth {Constants.expoConfig?.version ?? ''}</Text>
        <Text style={styles.aboutText}>
          Orbital data from CelesTrak and SatNOGS DB. Receiver driver: RTL-SDR Blog librtlsdr (GPL) with libusb (LGPL). Azimuth is licensed GPL-3.0-or-later.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 20, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.accentMuted },
  heroTitle: { ...typography.heading, fontSize: 22, color: colors.textPrimary },
  heroSub: { ...typography.caption, color: colors.textSecondary },
  coords: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  buttons: { flexDirection: 'row', gap: 10 },
  value: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  hint: { ...typography.caption, color: colors.textSecondary, lineHeight: 17 },
  about: { gap: 4, paddingHorizontal: 6, paddingBottom: 8 },
  aboutTitle: { ...typography.subheading, fontSize: 13, color: colors.textSecondary },
  aboutText: { ...typography.caption, color: colors.textTertiary, lineHeight: 17 },
});
