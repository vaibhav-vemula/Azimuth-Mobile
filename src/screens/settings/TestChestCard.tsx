import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import * as Location from 'expo-location';
import { Button } from '../../components/ui';
import { Row, Section } from './SettingsParts';
import { colors, typography } from '../../theme';
import { useChests } from '../../network/useChests';
import { useHeadingStore } from '../../mapping/headingStore';

/** Drops three treasure chests at once: one where you stand and two about 200 m away. Each pays 5 AZM once a day. */
export function TestChestCard() {
  const hasTest = useChests((s) => s.chests.some((c) => c.spec.test === true));
  const addTreasureChests = useChests((s) => s.addTreasureChests);
  const clearTreasureChests = useChests((s) => s.clearTreasureChests);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const drop = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Location permission is needed to place the chests near you.');
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      addTreasureChests({ latitudeDeg: here.coords.latitude, longitudeDeg: here.coords.longitude }, useHeadingStore.getState().heading);
      setMessage('Three treasure chests are placed: one right where you stand and two about 200 m away. Go to the Explore tab and start mapping. Walk to a chest, open it, and 5 AZM is sent to your wallet.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon="cube-outline" title="Treasure chests" subtitle="Three chests near you, 5 AZM each">
      <Row first>
        <Text style={styles.hint}>
          Puts three chests near you at once: one right where you stand and two about 200 m away. Each pays 5 AZM to your wallet when opened, once a day, so you need a connected wallet and the app mapping.
        </Text>
        <Button label={busy ? 'Finding you…' : 'Drop treasure chests near me'} icon="cube-outline" loading={busy} disabled={busy} onPress={() => void drop()} />
        {hasTest ? <Button label="Remove treasure chests" variant="secondary" onPress={clearTreasureChests} /> : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </Row>
    </Section>
  );
}

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary },
  message: { ...typography.caption, color: colors.accent },
});
