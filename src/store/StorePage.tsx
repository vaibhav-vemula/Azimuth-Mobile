import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StarfieldBackground } from '../components/StarfieldBackground';
import { colors, typography } from '../theme';
import { KitArt } from './KitArt';
import { KIT_PHOTOS } from './photos';
import { STORE_PRODUCTS, StoreProduct } from './products';

const PERKS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'logo-usd', text: 'Pay in USDC on Solana' },
  { icon: 'phone-portrait-outline', text: 'Plugs into your Seeker over USB-C' },
  { icon: 'flash-outline', text: 'Works with every Azimuth feature' },
];

/** The store: a short intro and one card per kit. Ordering is not open yet, so each card shows a disabled button. */
export function StorePage({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      <View style={styles.page}>
        <StarfieldBackground />
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>AZIMUTH STORE</Text>
            <Text style={styles.title}>Get your RTL-SDR kit</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the store" hitSlop={12} style={styles.close}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
          <View style={styles.perks}>
            {PERKS.map((p) => (
              <View key={p.text} style={styles.perk}>
                <Ionicons name={p.icon} size={16} color={colors.accent} />
                <Text style={styles.perkText}>{p.text}</Text>
              </View>
            ))}
          </View>
          {STORE_PRODUCTS.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
          <Text style={styles.footnote}>Orders are not open yet. We will let you know here when they are.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ProductCard({ product: p }: { product: StoreProduct }) {
  return (
    <View style={styles.card}>
      <View style={styles.art}>
        {KIT_PHOTOS[p.art] ? <Image source={KIT_PHOTOS[p.art]} style={styles.photo} resizeMode="cover" accessibilityLabel={p.title} /> : <KitArt kind={p.art} height={180} />}
        {p.ribbon ? (
          <View style={styles.ribbon}>
            <Text style={styles.ribbonText}>{p.ribbon.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.cardTitle}>{p.title}</Text>
          <View style={styles.price}>
            <Text style={styles.priceValue}>{p.priceUsdc}</Text>
            <Text style={styles.priceUnit}>USDC</Text>
          </View>
        </View>
        <Text style={styles.tagline}>{p.tagline}</Text>
        <View style={styles.tags}>
          {p.works.map((w) => (
            <View key={w} style={styles.tag}>
              <Text style={styles.tagText}>{w}</Text>
            </View>
          ))}
        </View>
        <View style={styles.divider} />
        <Text style={styles.included}>WHAT IS IN THE BOX</Text>
        <View style={styles.includes}>
          {p.includes.map((item) => (
            <View key={item} style={styles.includeRow}>
              <Ionicons name="checkmark-circle" size={17} color={colors.success} />
              <Text style={styles.includeText}>{item}</Text>
            </View>
          ))}
        </View>
        <View accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.order}>
          <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.orderText}>Orders open soon</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 14, gap: 12 },
  eyebrow: { ...typography.label, color: colors.accent },
  title: { ...typography.heading, fontSize: 24, color: colors.textPrimary, marginTop: 2 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, gap: 18 },
  perks: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: colors.accentFaint, borderWidth: 1, borderColor: colors.accentMuted },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  perkText: { ...typography.body, color: colors.textPrimary },
  card: { borderRadius: 22, overflow: 'hidden', backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.surfaceBorder },
  art: { backgroundColor: '#0A1426' },
  photo: { width: '100%', height: 190 },
  ribbon: { position: 'absolute', top: 12, left: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.accent },
  ribbonText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: colors.background },
  body: { padding: 16, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { ...typography.heading, flex: 1, color: colors.textPrimary },
  price: { alignItems: 'flex-end' },
  priceValue: { ...typography.display, fontSize: 30, lineHeight: 34, color: colors.accent },
  priceUnit: { ...typography.label, color: colors.textSecondary },
  tagline: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  tagText: { ...typography.caption, color: colors.textPrimary },
  divider: { height: 1, backgroundColor: colors.surfaceBorder, marginVertical: 4 },
  included: { ...typography.label, color: colors.textTertiary },
  includes: { gap: 8 },
  includeRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  includeText: { ...typography.body, flex: 1, color: colors.textPrimary },
  order: { marginTop: 6, minHeight: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  orderText: { ...typography.subheading, color: colors.textSecondary },
  footnote: { ...typography.caption, textAlign: 'center', color: colors.textTertiary, paddingHorizontal: 24 },
});
