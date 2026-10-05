import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../components/GlassCard';
import { Badge, Button, Row, SectionLabel } from '../../../components/ui';
import { colors, typography } from '../../../theme';
import { formatDistanceShort } from '../../../mapping/geo';
import { useUnitSystem } from '../../../units/units';
import { FM_MAX_MHZ, FM_MIN_MHZ, Here, NEARBY_KM, Station, distanceKm, formatMHz } from '../../../radio/online/radioBrowser';
import { FrequencyBar } from './FrequencyBar';
import { AudioBars } from './AudioBars';
import { OnlineStatus, useOnlineRadio } from '../../../radio/online/useOnlineRadio';

const STEPS = [
  { label: '−1', delta: -1 },
  { label: '−0.1', delta: -0.1 },
  { label: '+0.1', delta: 0.1 },
  { label: '+1', delta: 1 },
];
/** After the dial stops moving for this long, the new frequency is tuned in. */
const TUNE_DELAY_MS = 800;

const STATUS_LABEL: Record<OnlineStatus, string> = { idle: 'Stopped', searching: 'Searching', connecting: 'Connecting', playing: 'Playing', nomatch: 'No station', error: 'Problem' };
const STATUS_COLOR: Record<OnlineStatus, string> = { idle: colors.textTertiary, searching: colors.warning, connecting: colors.warning, playing: colors.success, nomatch: colors.textTertiary, error: colors.danger };

/** Online mode: tune a frequency like a dial and hear the station that broadcasts there, over the internet. */
export function OnlineRadio() {
  const mhz = useOnlineRadio((s) => s.mhz);
  const status = useOnlineRadio((s) => s.status);
  const stations = useOnlineRadio((s) => s.stations);
  const current = useOnlineRadio((s) => s.current);
  const error = useOnlineRadio((s) => s.error);
  const volume = useOnlineRadio((s) => s.volume);
  const here = useOnlineRadio((s) => s.here);
  const listTitle = useOnlineRadio((s) => s.listTitle);
  const [text, setText] = useState(() => formatMHz(mhz));
  const [typing, setTyping] = useState(false);
  const [query, setQuery] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (!typing) setText(formatMHz(mhz));
  }, [mhz, typing]);

  const tuneNow = useCallback((value: number) => {
    if (timer.current) clearTimeout(timer.current);
    void useOnlineRadio.getState().tune(value);
  }, []);

  // Turning the dial: the number moves at once and the station is looked up when you stop.
  const nudge = useCallback(
    (delta: number) => {
      const radio = useOnlineRadio.getState();
      // Turning the dial silences the old station straight away; the new one is looked up when you stop turning.
      if (radio.current || radio.status === 'playing' || radio.status === 'connecting') radio.stop();
      radio.setFrequency(radio.mhz + delta);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => tuneNow(useOnlineRadio.getState().mhz), TUNE_DELAY_MS);
    },
    [tuneNow]
  );

  // Dragging the bar: the number follows the finger and whatever was playing goes quiet; the station is found when you let go.
  const scrub = useCallback((value: number) => {
    const radio = useOnlineRadio.getState();
    if (radio.current || radio.status === 'playing' || radio.status === 'connecting') radio.stop();
    radio.setFrequency(value);
  }, []);

  const submitText = useCallback(() => {
    Keyboard.dismiss();
    const value = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(value) || value < FM_MIN_MHZ || value > FM_MAX_MHZ) {
      setText(formatMHz(mhz));
      return;
    }
    useOnlineRadio.getState().setFrequency(value);
    tuneNow(value);
  }, [text, mhz, tuneNow]);

  const busy = status === 'searching' || status === 'connecting';

  return (
    <>
      <GlassCard style={{ gap: 14 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <SectionLabel>Online radio · FM</SectionLabel>
            <Text style={styles.frequency}>
              {formatMHz(mhz)}
              <Text style={styles.unit}> MHz</Text>
            </Text>
          </View>
          <Badge label={STATUS_LABEL[status]} color={STATUS_COLOR[status]} />
        </Row>

        <AudioBars playing={status === 'playing'} />

        <FrequencyBar mhz={mhz} onScrub={scrub} onCommit={tuneNow} />

        <View style={styles.steps}>
          {STEPS.map((s) => (
            <Pressable key={s.label} onPress={() => nudge(s.delta)} accessibilityRole="button" accessibilityLabel={`Tune ${s.label} megahertz`} style={({ pressed }) => [styles.step, pressed && styles.pressed]}>
              <Text style={styles.stepText}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <Row>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            onSubmitEditing={submitText}
            keyboardType="decimal-pad"
            returnKeyType="go"
            placeholder="98.7"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Frequency in megahertz"
          />
          <Button label="Tune" icon="radio" loading={busy} onPress={submitText} style={{ flex: 1 }} />
        </Row>
      </GlassCard>

      {current ? (
        <GlassCard style={{ gap: 12 }}>
          <SectionLabel>Now playing</SectionLabel>
          <Text style={styles.stationName} numberOfLines={2}>
            {current.name}
          </Text>
          <Text style={styles.stationMeta}>{[current.country, current.codec && current.bitrate ? `${current.codec} ${current.bitrate} kbps` : current.codec].filter(Boolean).join(' · ')}</Text>
          <Row>
            <Button style={{ flex: 1 }} variant="danger" icon="stop" label="Stop" onPress={() => useOnlineRadio.getState().stop()} />
            <View style={styles.volumeBox}>
              <Pressable hitSlop={10} onPress={() => useOnlineRadio.getState().setVolume(volume - 0.1)} accessibilityLabel="Volume down">
                <Ionicons name="remove-circle-outline" size={28} color={colors.accent} />
              </Pressable>
              <Text style={styles.volumeValue}>{Math.round(volume * 100)}%</Text>
              <Pressable hitSlop={10} onPress={() => useOnlineRadio.getState().setVolume(volume + 0.1)} accessibilityLabel="Volume up">
                <Ionicons name="add-circle-outline" size={28} color={colors.accent} />
              </Pressable>
            </View>
          </Row>
        </GlassCard>
      ) : null}

      {status === 'nomatch' ? (
        <GlassCard>
          <Text style={styles.note}>No station found for {formatMHz(mhz)} MHz. The directory lists stations by name, so a station that does not put its frequency in its name will not show up. Try another frequency, or search by name below.</Text>
        </GlassCard>
      ) : null}

      {error ? (
        <GlassCard style={styles.errorCard}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </GlassCard>
      ) : null}

      {stations.length > 0 ? <StationList title={`${listTitle ?? 'Stations'} · ${stations.length}`} stations={stations} currentId={current?.id ?? null} here={here} limit={100} /> : null}

      <NearMe currentId={current?.id ?? null} />

      <GlassCard style={{ gap: 10 }}>
        <SectionLabel>Search by name</SectionLabel>
        <Row>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void useOnlineRadio.getState().search(query)}
            returnKeyType="search"
            placeholder="Station, city or style"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Search stations by name"
          />
          <Button label="Search" icon="search" variant="secondary" onPress={() => void useOnlineRadio.getState().search(query)} style={{ flex: 1 }} />
        </Row>
        <Text style={styles.note}>Online mode plays internet streams of radio stations. It is not the signal from your dongle; switch to Dongle for that.</Text>
      </GlassCard>
    </>
  );
}

/** The distance to a station in the user's units, or nothing if either position is unknown. */
function awayText(station: Station, here: Here | null): string | null {
  const km = here ? distanceKm(station, here) : null;
  return km === null ? null : `${formatDistanceShort(km * 1000)} away`;
}

function StationList({ title, stations, currentId, here, limit = 12 }: { title: string; stations: Station[]; currentId: string | null; here: Here | null; limit?: number }) {
  useUnitSystem(); // redraw when the unit setting changes
  return (
    <GlassCard style={{ gap: 4 }}>
      <SectionLabel>{title}</SectionLabel>
      {stations.slice(0, limit).map((s) => {
        const away = awayText(s, here);
        return (
          <Pressable key={s.id} onPress={() => void useOnlineRadio.getState().play(s)} accessibilityRole="button" accessibilityLabel={`Play ${s.name}`} style={({ pressed }) => [styles.row, s.id === currentId && styles.rowActive, pressed && styles.pressed]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {[away, s.state || s.country, s.codec].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {s.id === currentId ? <Ionicons name="volume-high" size={18} color={colors.success} /> : <Ionicons name="play" size={16} color={colors.textTertiary} />}
          </Pressable>
        );
      })}
    </GlassCard>
  );
}

/** Stations around the listener, whatever their frequency. */
function NearMe({ currentId }: { currentId: string | null }) {
  const nearby = useOnlineRadio((s) => s.nearby);
  const status = useOnlineRadio((s) => s.nearbyStatus);
  const here = useOnlineRadio((s) => s.here);
  useUnitSystem();

  return (
    <>
      <GlassCard style={{ gap: 10 }}>
        <SectionLabel>Near me</SectionLabel>
        <Text style={styles.note}>Stations broadcasting within about {formatDistanceShort(NEARBY_KM * 1000)} of where you are. When you tune a frequency, the nearest station on it plays first.</Text>
        <Button label={status === 'loading' ? 'Looking…' : nearby.length > 0 ? 'Refresh' : 'Find stations near me'} icon="location" variant="secondary" loading={status === 'loading'} onPress={() => void useOnlineRadio.getState().findNearby()} />
        {status === 'no-location' ? <Text style={styles.note}>Allow location for Azimuth to find stations near you.</Text> : null}
        {status === 'empty' ? <Text style={styles.note}>No stations with a known position were found near you. Try the frequency dial or the name search.</Text> : null}
      </GlassCard>
      {nearby.length > 0 ? <StationList title={`${nearby.length} near you`} stations={nearby} currentId={currentId} here={here} limit={25} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  frequency: { ...typography.display, color: colors.accent, fontVariant: ['tabular-nums'] },
  unit: { ...typography.subheading, color: colors.textSecondary },
  steps: { flexDirection: 'row', gap: 8 },
  step: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.surfaceBorder },
  stepText: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.8 },
  input: { flex: 1.4, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.background, paddingHorizontal: 14, color: colors.textPrimary, ...typography.body },
  stationName: { ...typography.heading, fontSize: 20, color: colors.textPrimary },
  stationMeta: { ...typography.caption, color: colors.textSecondary },
  volumeBox: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.background, borderRadius: 14, borderWidth: 1, borderColor: colors.surfaceBorder, paddingHorizontal: 10, minHeight: 48 },
  volumeValue: { ...typography.subheading, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  note: { ...typography.caption, color: colors.textSecondary },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12 },
  rowActive: { backgroundColor: 'rgba(61,220,132,0.10)' },
  rowTitle: { ...typography.body, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textTertiary },
});
