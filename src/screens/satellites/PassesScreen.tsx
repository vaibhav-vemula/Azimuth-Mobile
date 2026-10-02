import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GlassCard } from '../../components/GlassCard';
import { ManualLocationPrompt } from '../../components/ManualLocationPrompt';
import { StarfieldBackground } from '../../components/StarfieldBackground';
import { Badge, Button, Chip, EmptyState, Row, SectionLabel } from '../../components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MONITORED_SATELLITES, getMonitoredSatellite } from '../../data/satellites';
import { PASS_QUALITY_LABEL, classifyPass } from '../../data/propagation/passes';
import { useNow } from '../../hooks/useNow';
import { SatellitesStackParamList } from '../../navigation/types';
import { Reminders } from '../../notifications/reminders';
import { SatellitePass, selectUpcomingPasses, useAppStore } from '../../state/useAppStore';
import { useCapture } from '../../capture/useCapture';
import { captureWindow } from '../../capture/window';
import { colors, typography } from '../../theme';
import { formatClock, formatCountdown, formatDay } from '../../utils/format';
import { PassCard, QUALITY_COLOR } from './components/PassCard';

type Nav = NativeStackNavigationProp<SatellitesStackParamList, 'Passes'>;

const BUCKET_MS = 12 * 3600_000;

export default function PassesScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const now = useNow(1000);

  const location = useAppStore((s) => s.location);
  const locationStatus = useAppStore((s) => s.locationStatus);
  const passes = useAppStore((s) => s.passes);
  const passesComputing = useAppStore((s) => s.passesComputing);
  const passesComputedFor = useAppStore((s) => s.passesComputedFor);
  const tles = useAppStore((s) => s.tles);
  const tleLoading = useAppStore((s) => s.tleLoading);
  const tleError = useAppStore((s) => s.tleError);
  const settings = useAppStore((s) => s.settings);
  const capturePhase = useCapture((s) => s.phase);
  const captureOptions = useCapture((s) => s.options);

  const [filter, setFilter] = useState<string>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [reminderTick, setReminderTick] = useState(0);

  useEffect(() => {
    const store = useAppStore.getState();
    void store.requestLocation();
    void store.refreshTles();
  }, []);

  // The cached pass window covers 12 h buckets; roll it forward when the bucket changes.
  useEffect(() => {
    if (!location || Object.keys(tles).length === 0 || passesComputing) return;
    const bucket = Math.floor(now / BUCKET_MS) * BUCKET_MS;
    const expected = `${location.latitudeDeg.toFixed(3)},${location.longitudeDeg.toFixed(3)}@${bucket}`;
    if (passesComputedFor !== expected) useAppStore.getState().recomputePasses();
  }, [now, location, tles, passesComputing, passesComputedFor]);

  const upcoming = useMemo(() => selectUpcomingPasses(passes, now), [passes, now]);
  const visible = useMemo(
    () => (filter === 'all' ? upcoming : upcoming.filter((p) => p.noradId === filter)),
    [upcoming, filter]
  );
  const next = visible[0];

  const groups = useMemo(() => {
    const result: { day: string; passes: SatellitePass[] }[] = [];
    const reference = new Date(now);
    for (const pass of visible) {
      const day = formatDay(pass.riseTime, reference);
      const last = result[result.length - 1];
      if (last && last.day === day) last.passes.push(pass);
      else result.push({ day, passes: [pass] });
    }
    return result;
  }, [visible, now]);

  const outdated = Object.values(tles).some((t) => t.outdated);
  const stale = Object.values(tles).some((t) => t.stale);
  const recording = capturePhase === 'recording' || capturePhase === 'preparing' || capturePhase === 'finishing';

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const store = useAppStore.getState();
    await store.requestLocation();
    await store.refreshTles(true);
    setRefreshing(false);
  }, []);

  const toggleReminder = useCallback(
    async (pass: SatellitePass) => {
      const name = getMonitoredSatellite(pass.noradId)?.name ?? 'Satellite';
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
            Alert.alert('Notifications blocked', 'Allow notifications for Azimuth in system settings to get pass reminders.');
            return;
          }
          const scheduled = await Reminders.schedule(pass.id, pass, name, store.settings.reminderMinutes);
          if (!scheduled) Alert.alert('Pass already started', 'This pass has already begun.');
        }
      } catch (e) {
        Alert.alert('Reminder failed', e instanceof Error ? e.message : 'Unknown error');
      }
      setReminderTick((n) => n + 1);
    },
    []
  );

  let body;
  if (!location && locationStatus !== 'loading') {
    body = (
      <GlassCard style={{ gap: 12 }}>
        <Text style={styles.cardTitle}>Where are you?</Text>
        <Text style={styles.cardText}>
          Pass times depend on your position. Allow location access, or enter your coordinates below.
        </Text>
        <Button label="Use my location" icon="locate" onPress={() => void useAppStore.getState().requestLocation()} />
        <ManualLocationPrompt onSubmit={(lat, lon) => useAppStore.getState().setManualLocation(lat, lon)} />
      </GlassCard>
    );
  } else if (!location) {
    body = <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;
  } else if (Object.keys(tles).length === 0) {
    body = tleError ? (
      <GlassCard style={{ gap: 12 }}>
        <Text style={styles.cardTitle}>Couldn't load orbital data</Text>
        <Text style={styles.cardText}>{tleError}</Text>
        <Button label="Retry" icon="refresh" onPress={() => void useAppStore.getState().refreshTles(true)} />
      </GlassCard>
    ) : (
      <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
    );
  } else {
    body = (
      <>
        {next ? (
          <NextPassHero pass={next} now={now} onOpen={() => navigation.navigate('PassDetail', { passId: next.id })} />
        ) : null}

        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
          {MONITORED_SATELLITES.map((s) => (
            <Chip key={s.noradId} label={s.shortName} selected={filter === s.noradId} onPress={() => setFilter(s.noradId)} />
          ))}
          <View style={{ flex: 1 }} />
          <Text style={styles.filterNote}>≥ {settings.minElevationDeg}° · 3 days</Text>
        </Row>

        {passesComputing && visible.length === 0 ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="telescope-outline"
            title="No passes found"
            message={`No passes reach ${settings.minElevationDeg}° elevation in the next 3 days. Lower the minimum elevation in Settings.`}
          />
        ) : (
          groups.map((group) => (
            <View key={group.day} style={{ gap: 10 }}>
              <SectionLabel>{group.day}</SectionLabel>
              {group.passes.map((pass) => (
                <PassCard
                  key={`${pass.id}-${reminderTick}`}
                  pass={pass}
                  now={now}
                  reminderSet={Reminders.has(pass.id)}
                  onToggleReminder={() => void toggleReminder(pass)}
                  onPress={() => navigation.navigate('PassDetail', { passId: pass.id })}
                />
              ))}
            </View>
          ))
        )}
      </>
    );
  }

  return (
    <View style={styles.root}>
      <StarfieldBackground />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing || tleLoading} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Satellites</Text>
            <Text style={styles.subtitle}>
              {location
                ? `Meteor-M LRPT passes over ${location.latitudeDeg.toFixed(2)}°, ${location.longitudeDeg.toFixed(2)}°`
                : 'Meteor-M LRPT pass predictions'}
            </Text>
          </View>
          {tleLoading ? <ActivityIndicator color={colors.accent} /> : null}
        </View>

        {recording ? (
          <Pressable onPress={() => navigation.navigate('Capture')}>
            <GlassCard style={styles.recordingBanner}>
              <Ionicons name="radio-button-on" size={18} color={colors.record} />
              <Text style={styles.recordingText}>
                {capturePhase === 'recording'
                  ? `Recording ${captureOptions?.satellite.name ?? 'pass'}`
                  : capturePhase === 'preparing'
                    ? 'Preparing receiver…'
                    : 'Finishing recording…'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </GlassCard>
          </Pressable>
        ) : null}

        {outdated || stale ? (
          <GlassCard style={styles.warnCard}>
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <Text style={styles.warnText}>
              {outdated
                ? 'Orbital data is more than 5 days old, so pass times may be off by a minute or more. Pull down to refresh.'
                : 'Offline: using saved orbital data. Pull down to refresh when connected.'}
            </Text>
          </GlassCard>
        ) : null}

        {body}
      </ScrollView>
    </View>
  );
}

function NextPassHero({ pass, now, onOpen }: { pass: SatellitePass; now: number; onOpen: () => void }) {
  const satellite = getMonitoredSatellite(pass.noradId);
  const quality = classifyPass(pass.maxElevationDeg);
  const rise = pass.riseTime.getTime();
  const set = pass.setTime.getTime();
  const live = now >= rise;
  const capture = captureWindow(rise, set, now);

  return (
    <GlassCard style={styles.hero}>
      <Row style={{ justifyContent: 'space-between' }}>
        <SectionLabel>{live ? 'In progress' : 'Next pass'}</SectionLabel>
        <Badge label={`${PASS_QUALITY_LABEL[quality]} · ${Math.round(pass.maxElevationDeg)}°`} color={QUALITY_COLOR[quality]} />
      </Row>
      <Text style={styles.heroName}>{satellite?.name ?? pass.noradId}</Text>
      <Text style={[styles.heroCountdown, live && { color: colors.record }]}>
        {live ? formatCountdown(set - now) : formatCountdown(rise - now)}
      </Text>
      <Text style={styles.heroCaption}>
        {live ? 'until loss of signal' : `until rise at ${formatClock(pass.riseTime)}`}
      </Text>
      <View style={styles.captureInfo}>
        <Ionicons
          name={capture.state === 'upcoming' ? 'time-outline' : 'radio-button-on'}
          size={16}
          color={capture.state === 'upcoming' ? colors.textSecondary : colors.success}
        />
        <Text style={[styles.captureInfoText, capture.state !== 'upcoming' && { color: colors.success }]}>
          {capture.state === 'upcoming'
            ? `Capture opens in ${formatCountdown(capture.opensInMs)}`
            : capture.state === 'open'
              ? 'Capture is open now'
              : 'Capture is open: pass in progress'}
        </Text>
      </View>
      <Button label="Pass details" icon="map-outline" variant="secondary" onPress={onOpen} />
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { ...typography.heading, fontSize: 28, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  cardTitle: { ...typography.subheading, color: colors.textPrimary },
  cardText: { ...typography.body, color: colors.textSecondary },
  hero: { gap: 6, borderColor: colors.accentMuted },
  heroName: { ...typography.subheading, color: colors.textSecondary },
  heroCountdown: { ...typography.display, fontSize: 46, color: colors.accent, fontVariant: ['tabular-nums'] },
  heroCaption: { ...typography.caption, color: colors.textSecondary },
  captureInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  captureInfoText: { ...typography.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  filterNote: { ...typography.caption, color: colors.textTertiary },
  recordingBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.record },
  recordingText: { ...typography.subheading, fontSize: 14, color: colors.textPrimary, flex: 1 },
  warnCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.warning },
  warnText: { ...typography.caption, color: colors.warning, flex: 1 },
});
