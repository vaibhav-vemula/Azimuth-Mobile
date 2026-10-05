import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import * as Location from 'expo-location';
import { GlassCard } from '../../components/GlassCard';
import { Button, SectionLabel } from '../../components/ui';
import { colors, typography } from '../../theme';
import { useChests } from '../../network/useChests';

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
      addTestChest({ latitudeDeg: here.coords.latitude, longitudeDeg: here.coords.longitude });
      setMessage('Test chest placed about 12 m north of you. Go to the Map tab and start mapping: the chest then shows as a pin just north of your dot, and in the pill at the top with an arrow and its distance. Tap the camera button on the pill to see it in AR.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard style={{ gap: 10 }}>
      <SectionLabel>Test chest</SectionLabel>
      <Text style={styles.hint}>
        Puts a chest about 12 m from where you stand, to try opening it in AR. It exists only on this phone, needs one reading and no wallet, and opening it sends nothing and pays nothing.
      </Text>
      <Button label={busy ? 'Finding you…' : 'Drop a test chest here'} icon="cube-outline" loading={busy} disabled={busy} onPress={() => void drop()} />
      {hasTest ? <Button label="Remove test chests" variant="secondary" onPress={clearTestChests} /> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary },
  message: { ...typography.caption, color: colors.accent },
});
