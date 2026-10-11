import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { GlassCard } from '../../components/GlassCard';
import { Button, SectionLabel } from '../../components/ui';
import { colors, typography } from '../../theme';
import ViroGroundSpike from '../../ar/spike/ViroGroundSpike';

/** Gate A: tries ground-anchored AR with a plain box. Temporary; removed once the real chest view passes its device test. */
export function ArSpikeCard() {
  const [open, setOpen] = useState(false);
  return (
    <GlassCard style={{ gap: 10 }}>
      <SectionLabel>Ground AR test</SectionLabel>
      <Text style={styles.hint}>Opens the camera and puts a box on the floor. Walk around it: it should stay put.</Text>
      <Button label="Open ground AR test" icon="cube-outline" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent presentationStyle="fullScreen">
        {open ? (
          <View style={styles.fill}>
            <ViroGroundSpike />
            <View style={styles.close}>
              <Button label="Close" variant="secondary" onPress={() => setOpen(false)} />
            </View>
          </View>
        ) : null}
      </Modal>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  hint: { ...typography.caption, color: colors.textSecondary },
  fill: { flex: 1, backgroundColor: '#000' },
  close: { position: 'absolute', top: 48, right: 16 },
});
