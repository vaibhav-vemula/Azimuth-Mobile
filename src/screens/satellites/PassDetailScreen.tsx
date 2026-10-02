import { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassCard } from '../../components/GlassCard';
import { Screen } from '../../components/Screen';
import { Badge, Button, Chip, EmptyState, Row, SectionLabel, Stat } from '../../components/ui';
import {
  PASS_QUALITY_LABEL,
  classifyPass,
  getCurrentTrackPoint,
  sampleGroundTrack,
  sampleTrack,
} from '../../data/propagation/passes';
import { LRPT_FREQUENCIES_HZ, getMonitoredSatellite } from '../../data/satellites';
import { useNow } from '../../hooks/useNow';
import { SatellitesStackParamList } from '../../navigation/types';
import { Reminders } from '../../notifications/reminders';
import { useAppStore } from '../../state/useAppStore';
import { findPassById } from '../../state/passId';
import { useCapture } from '../../capture/useCapture';
import { canCapture as isCaptureOpen, captureWindow } from '../../capture/window';
import { colors, typography } from '../../theme';
import {
  formatAzimuth,
  formatClock,
  formatClockSeconds,
  formatCountdown,
  formatDay,
  formatDuration,
  formatFrequencyMHz,
} from '../../utils/format';
import { GroundTrackMap, MapMarker } from './components/GroundTrackMap';
import { QUALITY_COLOR } from './components/PassCard';
import { SkyPlot } from './components/SkyPlot';

type Nav = NativeStackNavigationProp<SatellitesStackParamList, 'PassDetail'>;
type Route = RouteProp<SatellitesStackParamList, 'PassDetail'>;

const SCRUB_STEP_MS = 60_000;

export default function PassDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const now = useNow(1000);

  const pass = useAppStore((s) => findPassById(s.passes, route.params.passId));
  const location = useAppStore((s) => s.location);
  const tles = useAppStore((s) => s.tles);
  const settings = useAppStore((s) => s.settings);
  const capturePhase = useCapture((s) => s.phase);
  const captureOptions = useCapture((s) => s.options);

  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [reminderTick, setReminderTick] = useState(0);

  const satellite = pass ? getMonitoredSatellite(pass.noradId) : undefined;
  const tle = pass ? tles[pass.noradId]?.record : undefined;

  const passTrack = useMemo(
    () => (pass && tle && location ? sampleTrack(tle, location, pass.riseTime, pass.setTime, 10) : []),
    [pass, tle, location]
  );

  const contextTrack = useMemo(() => {
    if (!pass || !tle) return [];
    const from = new Date(pass.riseTime.getTime() - 20 * 60_000);
    const to = new Date(pass.setTime.getTime() + 20 * 60_000);
    return sampleGroundTrack(tle, from, to, 30);
  }, [pass, tle]);

  const riseMs = pass?.riseTime.getTime() ?? 0;
  const setMs = pass?.setTime.getTime() ?? 0;
  const live = now >= riseMs && now < setMs;
  const selectedMs = scrubMs !== null
    ? Math.max(riseMs, Math.min(setMs, scrubMs))
    : live
      ? now
      : pass?.maxElevationTime.getTime() ?? now;
  const selectedSecond = Math.round(selectedMs / 1000) * 1000;

  const selected = useMemo(
    () => (tle && location ? getCurrentTrackPoint(tle, location, new Date(selectedSecond)) : null),
    [tle, location, selectedSecond]
  );

  const markers: MapMarker[] = useMemo(() => {
    if (passTrack.length === 0) return [];
    let peak = passTrack[0];
    for (const point of passTrack) if (point.elevationDeg > peak.elevationDeg) peak = point;
    const first = passTrack[0];
    const last = passTrack[passTrack.length - 1];
    return [
      { latitudeDeg: first.latitudeDeg, longitudeDeg: first.longitudeDeg, label: 'AOS', color: colors.success },
      { latitudeDeg: peak.latitudeDeg, longitudeDeg: peak.longitudeDeg, label: 'TCA', color: '#FFFFFF' },
      { latitudeDeg: last.latitudeDeg, longitudeDeg: last.longitudeDeg, label: 'LOS', color: colors.record },
    ];
  }, [passTrack]);

  const toggleReminder = useCallback(async () => {
    if (!pass || !satellite) return;
    try {
      if (Reminders.has(pass.id)) {
        await Reminders.cancel(pass.id);
      } else {
        const store = useAppStore.getState();
        if (!store.settings.notificationsEnabled) {
          Alert.alert('Reminders are off', 'Turn on pass reminders in Settings first.');
          return;
        }
        if (!(await store.requestNotificationPermission())) {
          Alert.alert('Notifications blocked', 'Allow notifications for Azimuth in system settings.');
          return;
        }
        if (!(await Reminders.schedule(pass.id, pass, satellite.name, store.settings.reminderMinutes))) {
          Alert.alert('Pass already started', 'This pass has already begun.');
        }
      }
    } catch (e) {
      Alert.alert('Reminder failed', e instanceof Error ? e.message : 'Unknown error');
    }
    setReminderTick((n) => n + 1);
  }, [pass, satellite]);

  if (!pass || !satellite || !location || !tle) {
    return (
      <Screen topInset={false}>
        <EmptyState icon="alert-circle-outline" title="Pass not available" message="This pass is no longer in the prediction window. Go back and pick another." />
        <Button label="Back to passes" variant="secondary" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  const quality = classifyPass(pass.maxElevationDeg);
  const frequencyHz = settings.frequencyHzBySatellite[pass.noradId] ?? satellite.defaultFrequencyHz;
  const window = captureWindow(riseMs, setMs, now);
  const ended = window.state === 'ended';
  const canCapture = isCaptureOpen(window);
  const recorderBusy = capturePhase === 'recording' || capturePhase === 'preparing' || capturePhase === 'finishing';
  const recorderIsForThisPass = recorderBusy && captureOptions?.pass.id === pass.id;

  const openRecorder = () => {
    if (!recorderIsForThisPass) {
      useCapture.getState().prepare({
        pass,
        satellite,
        frequencyHz,
        gainDb: settings.satelliteGainDb,
        biasTee: settings.biasTee,
        tle,
      });
    }
    navigation.navigate('Capture');
  };

  const lookAngles = selected && selected.elevationDeg > 0 ? { azimuthDeg: selected.azimuthDeg, elevationDeg: selected.elevationDeg } : null;
  const statusText = ended
    ? 'Pass ended'
    : live
      ? `In progress · LOS in ${formatCountdown(setMs - now)}`
      : `AOS in ${formatCountdown(riseMs - now)}`;
  const scrubbing = scrubMs !== null;

  return (
    <Screen topInset={false}>
      <GlassCard style={{ gap: 6 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.satName}>{satellite.name}</Text>
          <Badge label={`${PASS_QUALITY_LABEL[quality]} · ${Math.round(pass.maxElevationDeg)}°`} color={QUALITY_COLOR[quality]} />
        </Row>
        <Text style={[styles.status, live && { color: colors.record }]}>{statusText}</Text>
        <Text style={styles.when}>
          {formatDay(pass.riseTime)} · {formatClock(pass.riseTime)} – {formatClock(pass.setTime)} · {formatDuration(pass.durationSec)}
        </Text>
      </GlassCard>

      <GlassCard style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <SectionLabel>Ground track</SectionLabel>
          <Text style={styles.timeStamp}>{formatClockSeconds(new Date(selectedSecond))}</Text>
        </Row>
        <GroundTrackMap
          observer={location}
          contextTrack={contextTrack}
          passTrack={passTrack}
          markers={markers}
          satellite={selected ? { latitudeDeg: selected.latitudeDeg, longitudeDeg: selected.longitudeDeg, altitudeKm: selected.altitudeKm } : null}
          satelliteLabel={satellite.shortName}
        />
        <Row>
          <Button compact variant="secondary" icon="play-back" label="1 min" onPress={() => setScrubMs((scrubMs ?? selectedMs) - SCRUB_STEP_MS)} />
          <Button
            compact
            style={{ flex: 1 }}
            variant={scrubbing ? 'primary' : 'ghost'}
            label={live ? 'Live' : 'Peak'}
            onPress={() => setScrubMs(null)}
          />
          <Button compact variant="secondary" icon="play-forward" label="1 min" onPress={() => setScrubMs((scrubMs ?? selectedMs) + SCRUB_STEP_MS)} />
        </Row>
        <View style={styles.legend}>
          <LegendDot color={colors.warning} label="You" />
          <LegendDot color={colors.accent} label="Pass track" />
          <LegendDot color="#FFFFFF" label={satellite.shortName} />
          <LegendDot color={colors.accent} label="Coverage" hollow />
        </View>
      </GlassCard>

      <GlassCard style={{ gap: 8 }}>
        <SectionLabel>Sky view</SectionLabel>
        <SkyPlot track={passTrack} current={lookAngles} minElevationDeg={settings.minElevationDeg} />
        <Row>
          <Stat label="Azimuth" value={lookAngles ? formatAzimuth(lookAngles.azimuthDeg) : '–'} />
          <Stat label="Elevation" value={lookAngles ? `${lookAngles.elevationDeg.toFixed(0)}°` : 'Below horizon'} />
          <Stat label="Range" value={selected ? Math.round(selected.rangeKm).toString() : '–'} unit="km" />
        </Row>
      </GlassCard>

      <GlassCard style={{ gap: 14 }}>
        <SectionLabel>Pass timeline</SectionLabel>
        <Row>
          <Stat label="AOS" value={formatClockSeconds(pass.riseTime)} />
          <Stat label="Peak" value={formatClockSeconds(pass.maxElevationTime)} />
          <Stat label="LOS" value={formatClockSeconds(pass.setTime)} />
        </Row>
        <Row>
          <Stat label="Rises" value={formatAzimuth(pass.riseAzimuthDeg)} />
          <Stat label="Peak az" value={formatAzimuth(pass.maxAzimuthDeg)} />
          <Stat label="Sets" value={formatAzimuth(pass.setAzimuthDeg)} />
        </Row>
        <Row>
          <Stat label="Max elevation" value={`${pass.maxElevationDeg.toFixed(1)}°`} color={QUALITY_COLOR[quality]} />
          <Stat label="Duration" value={formatDuration(pass.durationSec)} />
          <Stat label="Altitude" value={Math.round(selected?.altitudeKm ?? 0).toString()} unit="km" />
        </Row>
      </GlassCard>

      <GlassCard style={{ gap: 10 }}>
        <SectionLabel>Downlink frequency</SectionLabel>
        <Row style={{ flexWrap: 'wrap' }}>
          {LRPT_FREQUENCIES_HZ.map((hz) => (
            <Chip
              key={hz}
              label={`${formatFrequencyMHz(hz)} MHz`}
              selected={frequencyHz === hz}
              onPress={() => useAppStore.getState().setSatelliteFrequency(pass.noradId, hz)}
            />
          ))}
        </Row>
        <Text style={styles.note}>
          Meteor-M satellites broadcast LRPT on 137.100 or 137.900 MHz and operators switch between them. If you see
          no signal bump at one, try the other.
        </Text>
      </GlassCard>

      <View style={{ gap: 10 }}>
        {recorderIsForThisPass ? (
          <Button label="Open recorder" icon="radio-button-on" onPress={openRecorder} />
        ) : recorderBusy ? (
          <Button label="Another capture is running" icon="lock-closed" variant="secondary" disabled onPress={() => undefined} />
        ) : canCapture ? (
          <Button label="Capture this pass" icon="radio-button-on" onPress={openRecorder} />
        ) : (
          <Button
            label={ended ? 'Pass ended' : `Capture opens in ${formatCountdown(window.opensInMs)}`}
            icon="time-outline"
            variant="secondary"
            disabled
            onPress={() => undefined}
          />
        )}
        {!ended ? (
          <Button
            key={reminderTick}
            variant="ghost"
            icon={Reminders.has(pass.id) ? 'notifications' : 'notifications-outline'}
            label={Reminders.has(pass.id) ? `Reminder set · ${settings.reminderMinutes} min before` : `Remind me ${settings.reminderMinutes} min before`}
            onPress={() => void toggleReminder()}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function LegendDot({ color, label, hollow }: { color: string; label: string; hollow?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, hollow ? { borderColor: color, borderWidth: 1.5 } : { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  satName: { ...typography.heading, fontSize: 24, color: colors.textPrimary },
  status: { ...typography.subheading, color: colors.accent, fontVariant: ['tabular-nums'] },
  when: { ...typography.caption, color: colors.textSecondary },
  timeStamp: { ...typography.subheading, fontSize: 14, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...typography.caption, color: colors.textSecondary },
  note: { ...typography.caption, color: colors.textTertiary },
});
