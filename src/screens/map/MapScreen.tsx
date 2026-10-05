import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/ui';
import { colors, typography } from '../../theme';
import { LiveMap, LiveMapHandle, MapChest, MapLoadState } from './components/LiveMap';
import { ConnectedChestCompass } from './components/ChestCompass';
import { SessionDetails } from './components/SessionDetails';
import { SignalChips, SignalLegend } from './components/SignalControls';
import { SignalLayer, signalPoints } from '../../mapping/signalLayer';
import { Sheet } from './components/Sheet';
import { MapSheet, SwipeHint } from './components/MapSheet';
import { useReceiver } from '../../receiver/useReceiver';
import { MiniStats, SheetTimer } from './components/SheetHeaderParts';
import { ChestCard } from '../chests/ChestCard';
import { hexCenter, parseCellId } from '../../mapping/hexGrid';
import type { LatLon } from '../../mapping/hexGrid';
import { distanceM } from '../../mapping/hexGrid';
import { nearestOf } from '../../mapping/geo';
import { ChestARView } from '../../ar/ChestARView';
import { chestPoint } from '../../ar/orientation';
import { exploredAreaKm2, formatArea } from '../../mapping/explore';
import { useMapping } from '../../mapping/useMapping';
import { useDevicePose } from '../../mapping/useDevicePose';
import { useChests } from '../../network/useChests';
import { verifierConfigured } from '../../network/config';
import type { Chest } from '../../network/api';
import { useWallet } from '../../wallet/useWallet';
import { formatDistance } from '../chests/chestInfo';
import { useUnitSystem } from '../../units/units';

type Panel = 'none' | 'chests' | 'chest';

/** Opacity steps that fake a gradient from the screen edge inwards. */
const SCRIM = [0.62, 0.42, 0.24, 0.1, 0];

export default function MapScreen() {
  useUnitSystem(); // redraw when the unit setting changes
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const pose = useDevicePose(focused);
  const mapRef = useRef<LiveMapHandle>(null);

  const status = useMapping((s) => s.status);
  const error = useMapping((s) => s.error);
  const explored = useMapping((s) => s.explored);
  const signals = useMapping((s) => s.signals);
  const fogStyle = useMapping((s) => s.fogStyle);
  const currentCellId = useMapping((s) => s.currentCellId);
  const newCells = useMapping((s) => s.newCellsThisSession);
  const scans = useMapping((s) => s.scansThisSession);
  const lastReport = useMapping((s) => s.lastReport);
  const start = useMapping((s) => s.start);
  const stop = useMapping((s) => s.stop);
  const address = useWallet((s) => s.address);
  const chests = useChests((s) => s.chests);
  const loadingChests = useChests((s) => s.loading);
  const chestError = useChests((s) => s.error);
  const refreshChests = useChests((s) => s.refresh);

  const [panel, setPanel] = useState<Panel>('none');
  const [arChest, setArChest] = useState<Chest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(150);
  const [peekSignal, setPeekSignal] = useState(0);
  const [sheetSeen, setSheetSeen] = useState(false);
  const [selected, setSelected] = useState<Chest | null>(null);
  const [following, setFollowing] = useState(true);
  const [layer, setLayer] = useState<SignalLayer>('cellular');
  const [loadState, setLoadState] = useState<MapLoadState>('loading');
  const [mapKey, setMapKey] = useState(0);
  const [slow, setSlow] = useState(false);

  const running = status === 'running';
  const busy = status === 'starting' || status === 'stopping';

  useEffect(() => {
    if (focused) void refreshChests();
  }, [focused, refreshChests]);

  // Say so if the map is slow to appear, instead of leaving a blank screen.
  useEffect(() => {
    if (loadState !== 'loading') {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [loadState, mapKey]);

  // Where the user is: the live fix, or the last cell mapping reported.
  const here = useMemo<LatLon | null>(() => {
    if (pose.position) return pose.position;
    const parsed = currentCellId ? parseCellId(currentCellId) : null;
    return parsed ? hexCenter(parsed.hex, parsed.sizeM) : null;
  }, [pose.position, currentCellId]);

  // The Radio layer is offered once a dongle is plugged in or radio readings exist.
  const dongleConnected = useReceiver((s) => s.status === 'connected' || s.status === 'streaming');
  const hasRadio = useMemo(() => dongleConnected || Object.values(signals).some((s) => (s.rn ?? 0) > 0), [dongleConnected, signals]);
  const signalData = useMemo(() => signalPoints(signals, layer), [signals, layer]);
  const sessionCleared = useMapping((s) => s.sessionClearedCells);
  const exploredSet = useMemo(() => new Set(Object.keys(explored)), [explored]);
  const areaLabelSession = useMemo(() => `+${formatArea(exploredAreaKm2(sessionCleared, here?.latitudeDeg ?? 38.9))}`, [sessionCleared, here]);
  const areaLabel = useMemo(() => formatArea(exploredAreaKm2(exploredSet.size, here?.latitudeDeg ?? 38.9)), [exploredSet, here]);

  // Chests are only shown while mapping is on.
  const mapChests = useMemo<MapChest[]>(
    () =>
      !running
        ? []
        : chests.flatMap((chest) => {
        const parsed = parseCellId(chest.cellId);
        if (!parsed || chest.remaining <= 0 || chest.expiresMs <= Date.now()) return [];
        // Exact coordinates when the requester gave them; otherwise the centre of the chest's cell.
        return [{ chest, position: chestPoint(chest.spec, hexCenter(parsed.hex, parsed.sizeM)) }];
      }),
    [chests, running]
  );

  const nearest = useMemo(() => (here ? nearestOf(here, mapChests.map((m) => ({ item: m.chest, position: m.position }))) : null), [here, mapChests]);
  const nearestPosition = useMemo(() => (nearest ? mapChests.find((m) => m.chest.id === nearest.item.id)?.position ?? null : null), [nearest, mapChests]);

  const onToggle = useCallback(async () => {
    if (running) {
      const report = await stop(address);
      if (!report && address) Alert.alert('Nothing recorded', 'No usable readings were collected this time.');
      else if (report) setSheetOpen(true);
    } else {
      setSheetSeen(false);
      const ok = await start();
      // Show there is more under the bar: the sheet rises for a moment.
      if (ok) setPeekSignal((n) => n + 1);
    }
  }, [running, stop, start, address]);

  const openChest = useCallback((chest: Chest) => {
    setSelected(chest);
    setPanel('chest');
  }, []);

  const closePanel = useCallback(() => setPanel('none'), []);

  const positionOf = useCallback(
    (chest: Chest): LatLon | null => {
      const parsed = parseCellId(chest.cellId);
      return parsed ? chestPoint(chest.spec, hexCenter(parsed.hex, parsed.sizeM)) : null;
    },
    []
  );
  const selectedDistance = useMemo(() => {
    const at = selected ? positionOf(selected) : null;
    return at && here ? distanceM(here, at) : null;
  }, [selected, here, positionOf]);

  return (
    <View style={styles.root}>
      <LiveMap
        key={mapKey}
        ref={mapRef}
        position={pose.position}
        explored={exploredSet}
        chests={mapChests}
        nearestId={nearest?.item.id ?? null}
        signal={signalData}
        fogStyle={fogStyle}
        showVision={running}
        following={following}
        onFollowingChange={setFollowing}
        onChestPress={openChest}
        onLoadState={setLoadState}
      />

      {/* Soft shading so the buttons stay readable over any map */}
      <View style={[styles.scrimTop, { height: insets.top + 130 }]} pointerEvents="none">
        {SCRIM.map((o, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: `rgba(5,7,13,${o})` }} />
        ))}
      </View>
      <View style={styles.scrimBottom} pointerEvents="none">
        {[...SCRIM].reverse().map((o, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: `rgba(5,7,13,${o})` }} />
        ))}
      </View>

      {/* Top bar */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.pill}>
          <View style={styles.pillIcon}>
            <Ionicons name="compass" size={18} color={colors.accent} />
          </View>
          <View>
            <Text style={styles.pillValue}>{areaLabel}</Text>
            <Text style={styles.pillLabel}>{running ? `explored · mapping, ${newCells} new` : 'explored'}</Text>
          </View>
          {running ? <View style={styles.liveDot} /> : null}
        </View>
        <View style={styles.topButtons}>
          {running ? <RoundButton icon="cube-outline" label="All chests" badge={mapChests.length} onPress={() => setPanel('chests')} /> : null}
        </View>
      </View>

      {/* What to tint mapped ground by */}
      <View style={[styles.layerRow, { top: insets.top + 66 }]} pointerEvents="box-none">
        <SignalChips value={layer} onChange={setLayer} showRadio={hasRadio} />
      </View>

      {/* Nearest chest: an arrow toward it and how far away, under the signal chips */}
      {nearest ? (
        <View style={[styles.compassRow, { top: insets.top + 108 }]} pointerEvents="box-none">
          <ConnectedChestCompass
            chest={nearest.item}
            distanceM={nearest.distanceM}
            bearingDeg={nearest.bearingDeg}
            onPress={() => {
              openChest(nearest.item);
              if (nearestPosition) mapRef.current?.showBoth(nearestPosition);
            }}
            onAr={() => setArChest(nearest.item)}
          />
        </View>
      ) : null}

      {/* Map status: never leave a blank screen unexplained */}
      {loadState === 'failed' ? (
        <View style={[styles.notice, { top: insets.top + 168 }]}>
          <Ionicons name="cloud-offline-outline" size={22} color={colors.warning} />
          <View style={{ flex: 1 }}>
            <Text style={styles.noticeTitle}>The map could not load</Text>
            <Text style={styles.noticeText}>Map tiles need an internet connection.</Text>
          </View>
          <Button compact label="Retry" onPress={() => { setLoadState('loading'); setMapKey((k) => k + 1); }} />
        </View>
      ) : loadState === 'loading' ? (
        <View style={[styles.chip, { top: insets.top + 168 }]} pointerEvents="none">
          <Ionicons name="map-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.chipText}>{slow ? 'Still loading the map. Check your internet connection.' : 'Loading the map…'}</Text>
        </View>
      ) : pose.permission === 'granted' && !pose.position ? (
        <View style={[styles.chip, { top: insets.top + 168 }]} pointerEvents="none">
          <Ionicons name="locate-outline" size={14} color={colors.accent} />
          <Text style={styles.chipText}>Finding your location…</Text>
        </View>
      ) : null}

      {/* Location prompt */}
      {pose.permission !== 'granted' ? (
        <View style={[styles.prompt, { top: insets.top + 168 }]}>
          <Ionicons name="locate-outline" size={20} color={colors.accent} />
          <Text style={styles.promptText}>Turn on location to see yourself on the map.</Text>
          <Button compact label="Turn on" onPress={() => void pose.request()} />
        </View>
      ) : null}

      {/* Location button: always there. Tap to fly to you at street zoom; it lights up while the map follows you. */}
      <Pressable
        style={[styles.recenter, { bottom: sheetHeight + 14 }, !pose.position && styles.recenterOff]}
        onPress={() => mapRef.current?.recenter()}
        disabled={!pose.position}
        accessibilityRole="button"
        accessibilityLabel="Go to my location"
      >
        <Ionicons name={following ? 'locate' : 'locate-outline'} size={24} color={following ? colors.accent : colors.textPrimary} />
      </Pressable>

      {/* Legend for the signal colours, above the sheet */}
      {layer !== 'off' ? (
        <View style={[styles.legendWrap, { bottom: sheetHeight + 12 }]} pointerEvents="none">
          <SignalLegend layer={layer} hasData={signalData.features.length > 0} />
        </View>
      ) : null}

      {/* Mapping sheet: a small bar with the timer and the main button; swipe it up for the full stats */}
      <MapSheet
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (o) setSheetSeen(true);
        }}
        onCollapsedHeight={setSheetHeight}
        peekSignal={peekSignal}
        header={
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              {running ? (
                <>
                  <View style={styles.sheetDot} />
                  <Text style={styles.liveLabel}>MAPPING</Text>
                  <Text style={styles.sheetStat}>{areaLabelSession}</Text>
                  <SheetTimer />
                </>
              ) : (
                <>
                  <Ionicons name="map-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.readyLabel}>
                    {lastReport ? 'Session finished. Swipe up to submit it.' : chests.length > 0 ? 'Start mapping to clear the fog and see chests.' : 'Start mapping to clear the fog.'}
                  </Text>
                </>
              )}
            </View>
            {running ? <MiniStats showLabels={sheetOpen} /> : null}
            {running && !sheetSeen && !sheetOpen ? <SwipeHint text="Swipe up for all your stats" /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label={running ? 'Stop mapping' : 'Start mapping'}
              icon={running ? 'stop-circle-outline' : 'play-circle-outline'}
              variant={running ? 'danger' : 'primary'}
              onPress={() => void onToggle()}
              loading={busy}
            />
          </View>
        }
      >
        <SessionDetails />
      </MapSheet>

      <Sheet visible={panel === 'chests'} title="Chests" onClose={closePanel}>
        {mapChests.length === 0 ? (
          <Text style={styles.sheetEmpty}>{verifierConfigured ? 'No chests are open right now.' : 'Chests are off in this build.'}</Text>
        ) : (
          [...mapChests]
            .sort((a, b) => (here ? distanceM(here, a.position) - distanceM(here, b.position) : 0))
            .map((m) => (
              <Pressable key={m.chest.id} onPress={() => openChest(m.chest)} accessibilityRole="button" style={styles.listRow}>
                <Text style={styles.listTitle} numberOfLines={1}>
                  {m.chest.title}
                </Text>
                <Text style={styles.listMeta}>
                  {here ? formatDistance(distanceM(here, m.position)) : '—'} · {m.chest.rewardUsdc} USDC
                </Text>
              </Pressable>
            ))
        )}
      </Sheet>

      <Sheet visible={panel === 'chest' && !!selected} title="Chest" onClose={closePanel}>
        {selected ? (
          <ChestCard
            chest={selected}
            distance={selectedDistance}
            mappingRunning={running}
            scans={scans}
            onAr={() => {
              setPanel('none');
              setArChest(selected);
            }}
          />
        ) : null}
      </Sheet>
      <ChestARView visible={!!arChest} chest={arChest} target={arChest ? positionOf(arChest) : null} mappingRunning={running} scans={scans} onClose={() => setArChest(null)} />
    </View>
  );
}

function RoundButton({ icon, label, badge, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.round}>
      <Ionicons name={icon} size={20} color={colors.textPrimary} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  layerRow: { position: 'absolute', left: 12, right: 12 },
  compassRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  hintChip: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(11,15,26,0.9)', borderColor: colors.surfaceBorder, borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(11,15,26,0.92)', borderColor: colors.accentMuted, borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingLeft: 8, paddingRight: 16 },
  pillIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentFaint, alignItems: 'center', justifyContent: 'center' },
  pillValue: { ...typography.subheading, fontSize: 16, color: colors.textPrimary, lineHeight: 18 },
  pillLabel: { ...typography.caption, fontSize: 11, color: colors.textSecondary },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0 },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 250 },
  chip: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(11,15,26,0.94)', borderColor: colors.surfaceBorder, borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  chipText: { ...typography.caption, color: colors.textSecondary },
  notice: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(11,15,26,0.96)', borderColor: colors.warning, borderWidth: 1, borderRadius: 16, padding: 12 },
  noticeTitle: { ...typography.subheading, fontSize: 15, color: colors.textPrimary },
  noticeText: { ...typography.caption, color: colors.textSecondary },
  topButtons: { flexDirection: 'row', gap: 8 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,15,26,0.92)', borderColor: colors.surfaceBorder, borderWidth: 1 },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { ...typography.caption, fontSize: 10, color: colors.background },
  prompt: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(11,15,26,0.94)', borderColor: colors.surfaceBorder, borderWidth: 1, borderRadius: 16, padding: 12 },
  promptText: { ...typography.caption, color: colors.textPrimary, flex: 1 },
  recenter: { position: 'absolute', right: 14, width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,15,26,0.94)', borderColor: colors.surfaceBorder, borderWidth: 1 },
  recenterOff: { opacity: 0.4 },
  legendWrap: { position: 'absolute', left: 12 },
  sheetHeader: { paddingHorizontal: 14, paddingBottom: 12, gap: 10 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  sheetDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.success },
  liveLabel: { ...typography.label, color: colors.success, letterSpacing: 1.6 },
  sheetStat: { ...typography.caption, color: colors.accent, flex: 1 },
  timer: { ...typography.heading, fontSize: 22, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  readyLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(11,15,26,0.94)', borderColor: colors.surfaceBorder, borderWidth: 1, borderRadius: 16, padding: 14 },
  emptyText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  error: { ...typography.caption, color: colors.danger, textAlign: 'center', backgroundColor: 'rgba(11,15,26,0.9)', borderRadius: 8, padding: 6 },
  listRow: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 2 },
  listTitle: { ...typography.subheading, color: colors.textPrimary },
  listMeta: { ...typography.caption, color: colors.textSecondary },
  sheetEmpty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingVertical: 24 },
});
