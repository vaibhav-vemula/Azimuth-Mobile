import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import * as Location from 'expo-location';
import { Button } from '../../components/ui';
import { Row, Section } from './SettingsParts';
import { colors, typography } from '../../theme';
import { useChests } from '../../network/useChests';
import { useHeadingStore } from '../../mapping/headingStore';

/** Drops a chest a few metres from where you stand, so the AR opening can be tried anywhere. It exists only on this phone. */
export function TestChestCard() {
  const hasTest = useChests((s) => s.chests.some((c) => c.spec.test === true));
  const addTestChest = useChests((s) => s.addTestChest);
  const clearTestChests = useChests((s) => s.clearTestChests);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const drop = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Location permission is needed to place the chest where you are.');
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      addTestChest({ latitudeDeg: here.coords.latitude, longitudeDeg: here.coords.longitude }, useHeadingStore.getState().heading);
      setMessage('Test chest placed right where you are standing. Go to the Map tab and start mapping: the pill at the top shows it with a distance of about 0, and the camera button opens AR, where the chest appears in front of you, in the direction you were facing now.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon="cube-outline" title="Test chest" subtitle="Try opening a chest in AR anywhere" tone="warning">
      <Row first>
        <Text style={styles.hint}>
          Puts a chest right where you are standing, to try opening it in AR. It exists only on this phone, needs one reading and no wallet, and opening it sends nothing and pays nothing.
        </Text>
        <Button label={busy ? 'Finding you…' : 'Drop a test chest here'} icon="cube-outline" loading={busy} disabled={busy} onPress={() => void drop()} />
        {hasTest ? <Button label="Remove test chests" variant="secondary" onPress={clearTestChests} /> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </Row>
    </Section>
  );
}

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary },
  message: { ...typography.caption, color: colors.accent },
});
