import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { appAlert } from '../../components/dialog';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { GlassCard } from '../../components/GlassCard';
import { Screen } from '../../components/Screen';
import { Badge, Button, EmptyState, Row, SectionLabel, Stat } from '../../components/ui';
import { RecordingInfo, deleteRecording, exportRecording, getFreeStorageBytes, listRecordings } from '../../../modules/rtl-sdr';
import { DATA_FILE_NAME, RECORDING_FORMATS, parseRecordingMetadata } from '../../capture/sigmf';
import { useCapture } from '../../capture/useCapture';
import { colors, typography } from '../../theme';
import { formatBytes, formatClock, formatDay, formatDuration, formatFrequencyMHz } from '../../utils/format';

export default function RecordingsScreen() {
  const [recordings, setRecordings] = useState<RecordingInfo[] | null>(null);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const capturePhase = useCapture((s) => s.phase);

  const load = useCallback(async () => {
    try {
      const [list, free] = await Promise.all([listRecordings(), getFreeStorageBytes()]);
      setRecordings(list);
      setFreeBytes(free);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRecordings((current) => current ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, capturePhase])
  );

  const share = useCallback(async (recording: RecordingInfo) => {
    setBusyName(recording.name);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(`file://${recording.directory}/${DATA_FILE_NAME}`, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'Share baseband recording',
      });
    } catch (e) {
      appAlert('Could not share', `${e instanceof Error ? e.message : String(e)}\n\nTry Export instead.`);
    } finally {
      setBusyName(null);
    }
  }, []);

  const exportIt = useCallback(async (recording: RecordingInfo) => {
    setBusyName(recording.name);
    try {
      const path = await exportRecording(recording.name);
      appAlert('Exported', `Saved to ${path}\n\nLook in Downloads/Azimuth in the Files app, or from a computer.`);
    } catch (e) {
      appAlert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyName(null);
    }
  }, []);

  const remove = useCallback(
    (recording: RecordingInfo) => {
      appAlert('Delete recording?', `${recording.name} (${formatBytes(recording.dataBytes)}) will be removed from this phone.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyName(recording.name);
            try {
              await deleteRecording(recording.name);
              await load();
            } catch (e) {
              appAlert('Delete failed', e instanceof Error ? e.message : String(e));
            } finally {
              setBusyName(null);
            }
          },
        },
      ]);
    },
    [load]
  );

  const totalBytes = (recordings ?? []).reduce((sum, r) => sum + r.dataBytes, 0);

  return (
    <Screen topInset={false}>
      <View>
        <Text style={styles.subtitle}>Raw baseband captures of satellite passes</Text>
      </View>

      <GlassCard>
        <Row>
          <Stat label="Recordings" value={String(recordings?.length ?? 0)} />
          <Stat label="Used" value={formatBytes(totalBytes)} />
          <Stat label="Free" value={freeBytes === null ? '–' : formatBytes(freeBytes)} />
        </Row>
      </GlassCard>

      {error ? (
        <GlassCard style={styles.errorCard}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </GlassCard>
      ) : null}

      {recordings !== null && recordings.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          title="No recordings yet"
          message="Open a pass in the Satellites tab and tap Capture. Finished recordings appear here, ready to share and decode with SatDump."
        />
      ) : null}

      {(recordings ?? []).map((recording) => {
        const meta = parseRecordingMetadata(recording.metadata);
        const started = meta.startedAt ?? new Date(recording.modifiedMs);
        const busy = busyName === recording.name;
        const failed = meta.status === 'failed';
        const partial = meta.status === 'interrupted' || meta.status === 'recording';
        const statusBadge = recording.active
          ? { label: 'Recording', color: colors.record }
          : failed
            ? { label: 'Failed', color: colors.danger }
            : partial
              ? { label: meta.status === 'recording' ? 'Incomplete' : 'Partial', color: colors.warning }
              : { label: 'Complete', color: colors.success };

        return (
          <GlassCard key={recording.name} style={{ gap: 12 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{meta.satelliteName ?? recording.name}</Text>
                <Text style={styles.when}>
                  {formatDay(started)} · {formatClock(started)}
                  {meta.frequencyHz ? ` · ${formatFrequencyMHz(meta.frequencyHz)} MHz` : ''}
                </Text>
              </View>
              <Row>
                {meta.testRecording ? <Badge label="Test" color={colors.warning} /> : null}
                {meta.format ? <Badge label={RECORDING_FORMATS[meta.format].label} color={colors.textSecondary} /> : null}
                <Badge label={statusBadge.label} color={statusBadge.color} />
              </Row>
            </Row>

            <Row>
              <Stat label="Duration" value={meta.durationSec !== null ? formatDuration(meta.durationSec) : '–'} />
              <Stat label="Size" value={formatBytes(recording.dataBytes)} />
              <Stat label="Peak el" value={meta.maxElevationDeg !== null ? `${Math.round(meta.maxElevationDeg)}°` : '–'} />
              <Stat
                label="Gaps"
                value={meta.droppedBlocks === null ? '–' : meta.droppedBlocks === 0 ? 'None' : String(meta.droppedBlocks)}
                color={meta.droppedBlocks ? colors.warning : undefined}
              />
            </Row>

            {meta.error ? <Text style={styles.warn}>{meta.error}</Text> : null}

            {!recording.active ? (
              <Row>
                <Button style={{ flex: 1 }} compact variant="secondary" icon="share-social" label="Share" disabled={busy} onPress={() => void share(recording)} />
                <Button style={{ flex: 1 }} compact variant="secondary" icon="download" label="Export" disabled={busy} onPress={() => void exportIt(recording)} />
                <Button compact variant="ghost" icon="trash-outline" label="" disabled={busy} onPress={() => remove(recording)} />
              </Row>
            ) : null}
          </GlassCard>
        );
      })}

      {(recordings?.length ?? 0) > 0 ? (
        <GlassCard style={{ gap: 6 }}>
          <SectionLabel>Turning a recording into an image</SectionLabel>
          <Text style={styles.help}>
            Export or share the recording to a computer and open it in SatDump (satdump.org): Offline processing, pipeline
            "METEOR M2-X LRPT 72k" (or the 80k variant), input level Baseband, format cs8 (signed 8-bit I/Q), and the sample rate shown
            in the recording's metadata (2304000 for Full band, 288000 for Compact).
          </Text>
        </GlassCard>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.heading, fontSize: 28, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  name: { ...typography.subheading, color: colors.textPrimary },
  when: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  warn: { ...typography.caption, color: colors.warning },
  help: { ...typography.caption, color: colors.textSecondary },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: colors.danger },
  errorText: { ...typography.caption, color: colors.danger, flex: 1 },
});
