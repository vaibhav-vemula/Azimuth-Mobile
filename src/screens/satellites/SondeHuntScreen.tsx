import { useEffect, useMemo } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useRoute } from '@react-navigation/native';
import { GlassCard } from '../../components/GlassCard';
import { Badge, Button, EmptyState, SectionLabel } from '../../components/ui';
import { colors, typography } from '../../theme';
import { SatellitesStackParamList } from '../../navigation/types';
import { DirectionArrow } from '../map/components/DirectionArrow';
import { useDevicePose } from '../../mapping/useDevicePose';
import { useHeadingStore } from '../../mapping/headingStore';
import { compassPoint, formatDistanceShort } from '../../mapping/geo';
import type { LatLon } from '../../mapping/hexGrid';
import { useAppStore } from '../../state/useAppStore';
import { useReceiver } from '../../receiver/useReceiver';
import { Sonde, ago, bearingTo, distanceTo, estimatedLanding, secondsToGround, target } from '../../sondes/sondehub';
import { useSondes } from '../../sondes/useSondes';
import { useUnitSystem, currentSystem } from '../../units/units';
import { STATUS_STYLE } from './components/SondesPanel';

type Route = RouteProp<SatellitesStackParamList, 'SondeHunt'>;
const REFRESH_MS = 30_000;

/** Speed in the user's units: km/h, or mph. */
export function speedLabel(mps: number): string {
  return currentSystem() === 'imperial' ? `${Math.round(mps * 2.23694)} mph` : `${Math.round(mps * 3.6)} km/h`;
}

/** A link that opens a maps app with directions to the place. */
export function mapsUrl(point: LatLon, label: string): string {
  const { latitudeDeg: lat, longitudeDeg: lon } = point;
  return Platform.OS === 'ios' ? `http://maps.apple.com/?ll=${lat},${lon}&q=${encodeURIComponent(label)}` : `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(label)})`;
}

/** The screen for going to collect one sonde: which way, how far, where it is, and what to do when you get there. */
export default function SondeHuntScreen() {
  useUnitSystem(); // redraw when the unit setting changes
  const { serial } = useRoute<Route>().params;
  const sonde = useSondes((s) => s.sondes.find((x) => x.serial === serial) ?? null);
  const tracked = useSondes((s) => s.tracked.includes(serial));
  const appLocation = useAppStore((s) => s.location);
  const pose = useDevicePose(true);
  const dongle = useReceiver((s) => s.status === 'connected' || s.status === 'streaming');

  const here: LatLon | null = pose.position ?? (appLocation ? { latitudeDeg: appLocation.latitudeDeg, longitudeDeg: appLocation.longitudeDeg } : null);

  // Keep the position fresh while you are on the way: SondeHub has a new packet every few seconds while a sonde is flying.
  useEffect(() => {
    if (!here) return;
    const id = setInterval(() => void useSondes.getState().refresh(here), REFRESH_MS);
    return () => clearInterval(id);
  }, [here]);

  if (!sonde) return <EmptyState icon="balloon-outline" title="Sonde not found" message="It is no longer in the list. Go back and refresh." />;
  return <Hunt sonde={sonde} here={here} tracked={tracked} dongle={dongle} />;
}

function Hunt({ sonde, here, tracked, dongle }: { sonde: Sonde; here: LatLon | null; tracked: boolean; dongle: boolean }) {
  const style = STATUS_STYLE[sonde.status];
  const where = useMemo(() => target(sonde), [sonde]);
  const landing = useMemo(() => (sonde.status === 'descending' ? estimatedLanding(sonde) : null), [sonde]);
  const eta = secondsToGround(sonde);
  const label = `${sonde.type} ${sonde.serial}`;
  const heading = sonde.frequencyMHz;

  const tune = async () => {
    if (heading === null) return;
    try {
      await useReceiver.getState().tuneTo(Math.round(heading * 1e6));
    } catch {
      // The Radio tab shows tuning problems; here the button just does nothing more.
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <GlassCard style={{ gap: 10 }}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{sonde.serial}</Text>
            <Text style={styles.sub}>
              {sonde.type}
              {sonde.frequencyMHz !== null ? ` · ${sonde.frequencyMHz.toFixed(3)} MHz` : ''}
            </Text>
          </View>
          <Badge label={style.label} color={style.color} />
        </View>
        <Text style={styles.line}>
          {sonde.status === 'landed'
            ? `Landed where it was last heard, ${ago(sonde.lastSeenMs)}.`
            : sonde.status === 'descending'
              ? eta !== null
                ? `Coming down. About ${Math.max(1, Math.round(eta / 60))} min to the ground at this speed.`
                : 'Coming down.'
              : sonde.status === 'ascending'
                ? 'Still climbing. It will burst high up and come down some distance away. Check back in an hour or two.'
                : `Went quiet ${ago(sonde.lastSeenMs)} while still high up, so where it landed is not known.`}
        </Text>
      </GlassCard>

      <GlassCard style={styles.direction}>
        {here ? (
          <>
            <Dial here={here} sonde={sonde} />
            <Text style={styles.distance}>{formatDistanceShort(distanceTo(here, sonde))}</Text>
            <Text style={styles.sub}>
              {compassPoint(bearingTo(here, sonde))} · {Math.round(bearingTo(here, sonde))}° · {landing ? 'estimated landing' : sonde.status === 'landed' ? 'where it landed' : 'last position'}
            </Text>
          </>
        ) : (
          <Text style={styles.line}>Allow location to see which way to go.</Text>
        )}
      </GlassCard>

      <GlassCard style={{ gap: 12 }}>
        <Button label="Get directions" icon="navigate" onPress={() => void Linking.openURL(mapsUrl(where, label))} />
        <Row2>
          <Button style={{ flex: 1 }} variant="secondary" icon={tracked ? 'star' : 'star-outline'} label={tracked ? 'Tracking' : 'Track'} onPress={() => useSondes.getState().toggleTracked(sonde.serial)} />
          <Button style={{ flex: 1 }} variant="secondary" icon="share-outline" label="Share" onPress={() => void Share.share({ message: `${label}\n${where.latitudeDeg.toFixed(5)}, ${where.longitudeDeg.toFixed(5)}\n${mapsUrl(where, label)}` })} />
        </Row2>
        {sonde.frequencyMHz !== null ? (
          <Button variant="secondary" icon="radio" label={dongle ? `Tune the dongle to ${sonde.frequencyMHz.toFixed(3)} MHz` : `Needs the dongle: ${sonde.frequencyMHz.toFixed(3)} MHz`} disabled={!dongle} onPress={() => void tune()} />
        ) : null}
      </GlassCard>

      <GlassCard style={{ gap: 8 }}>
        <SectionLabel>Details</SectionLabel>
        <Fact name="Last heard" value={ago(sonde.lastSeenMs)} />
        <Fact name="Height when last heard" value={formatDistanceShort(sonde.altM)} />
        <Fact name={sonde.climbMps < 0 ? 'Falling at' : 'Climbing at'} value={speedLabel(Math.abs(sonde.climbMps))} />
        <Fact name="Drifting at" value={sonde.headingDeg !== null ? `${speedLabel(sonde.speedMps)} toward ${compassPoint(sonde.headingDeg)}` : speedLabel(sonde.speedMps)} />
        <Fact name="Last position" value={`${sonde.lat.toFixed(5)}, ${sonde.lon.toFixed(5)}`} />
        {landing ? <Fact name="Estimated landing" value={`${landing.latitudeDeg.toFixed(5)}, ${landing.longitudeDeg.toFixed(5)}`} /> : null}
      </GlassCard>

      <GlassCard style={{ gap: 8 }}>
        <SectionLabel>Before you go</SectionLabel>
        <Text style={styles.note}>The signal fades before the sonde reaches the ground, so it is usually within a few hundred metres of the last position, often downwind. Look in trees, fields and ditches.</Text>
        <Text style={styles.note}>Ask before going onto private land. Stay away from roads, power lines, water and anything you would have to climb. The sonde has a small battery: handle it gently. Many have a label with a return address, and the weather service often wants them back.</Text>
      </GlassCard>
    </ScrollView>
  );
}

/** The arrow, in its own component because the heading changes about 20 times a second and nothing else should redraw. */
function Dial({ here, sonde }: { here: LatLon; sonde: Sonde }) {
  const heading = useHeadingStore((s) => s.heading);
  return <DirectionArrow bearingDeg={bearingTo(here, sonde)} headingDeg={heading} size={132} color={STATUS_STYLE[sonde.status].color} />;
}

function Row2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}

function Fact({ name, value }: { name: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factName}>{name}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { ...typography.heading, fontSize: 22, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary },
  line: { ...typography.body, color: colors.textSecondary },
  direction: { alignItems: 'center', gap: 8, paddingVertical: 22 },
  distance: { ...typography.display, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  factName: { ...typography.caption, color: colors.textSecondary },
  factValue: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  note: { ...typography.caption, color: colors.textSecondary },
});
