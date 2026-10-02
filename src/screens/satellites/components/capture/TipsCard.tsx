import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../../components/GlassCard';
import { SectionLabel } from '../../../../components/ui';
import { colors, typography } from '../../../../theme';

/** Practical guidance from experienced Meteor LRPT operators. */
const TIPS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'git-network-outline',
    title: 'Antenna',
    body: 'A V-dipole with two 53.4 cm arms at 120°, both parallel to the ground and pointing at the sky, works well. Keep it outdoors or at a window with a clear view, and away from metal.',
  },
  {
    icon: 'phone-portrait-outline',
    title: 'Keep noise away',
    body: 'Phones, chargers, routers and LED lights create interference. Use the longest OTG cable you can and put the dongle and antenna away from the phone.',
  },
  {
    icon: 'trending-up-outline',
    title: 'Choose high passes',
    body: 'Passes that peak above about 30° give the strongest, longest signal. Below 15° the signal is short and weak.',
  },
  {
    icon: 'flash-outline',
    title: 'Powered LNA',
    body: 'Only if your LNA needs power from the dongle, turn on Antenna power in Settings. Never enable it with a DC-shorted antenna (many QFH and loop antennas): it can damage the receiver.',
  },
  {
    icon: 'time-outline',
    title: 'Start early',
    body: 'Press Start a minute or two before the satellite rises so the set-up has settled. Recording stops by itself shortly after it sets.',
  },
];

function TipsCardComponent() {
  const [open, setOpen] = useState(false);
  return (
    <GlassCard style={{ gap: 12 }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.header} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <SectionLabel>Tips for a good capture</SectionLabel>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </Pressable>
      {open
        ? TIPS.map((tip) => (
            <View key={tip.title} style={styles.tip}>
              <Ionicons name={tip.icon} size={18} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipBody}>{tip.body}</Text>
              </View>
            </View>
          ))
        : null}
    </GlassCard>
  );
}

export const TipsCard = memo(TipsCardComponent);

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tip: { flexDirection: 'row', gap: 12 },
  tipTitle: { ...typography.subheading, fontSize: 14, color: colors.textPrimary },
  tipBody: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
