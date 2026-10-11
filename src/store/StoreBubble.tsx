import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge, Button } from "../components/ui";
import { GlassCard } from "../components/GlassCard";
import { colors, typography } from "../theme";
import { STORE_PRODUCTS } from "./products";

/** A round store button that floats above the tab bar, and opens the store page when tapped. */
export function StoreBubble() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open the store"
        style={({ pressed }) => [styles.bubble, pressed && styles.pressed]}
      >
        <Ionicons name="storefront" size={26} color={colors.background} />
      </Pressable>
      <StorePage visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function StorePage({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      presentationStyle="fullScreen"
    >
      <View style={styles.page}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Store</Text>
            <Text style={styles.subtitle}>
              RTL-SDR kits, paid in USDC on Solana
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close the store"
            hitSlop={12}
            style={styles.close}
          >
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 24 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {STORE_PRODUCTS.map((p) => (
            <GlassCard key={p.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.iconWrap}>
                  <Ionicons name={p.icon} size={26} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{p.title}</Text>
                  <Text style={styles.cardTagline}>{p.tagline}</Text>
                </View>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.price}>{p.priceUsdc}</Text>
                <Text style={styles.priceUnit}>USDC · Solana</Text>
                <View style={{ flex: 1 }} />
                <Badge label="Coming soon" color={colors.warning} />
              </View>
              <View style={styles.includes}>
                {p.includes.map((item) => (
                  <View key={item} style={styles.includeRow}>
                    <Ionicons
                      name="checkmark-circle"
                      size={16}
                      color={colors.success}
                    />
                    <Text style={styles.includeText}>{item}</Text>
                  </View>
                ))}
              </View>
              <Button
                label="Orders open soon"
                icon="time-outline"
                variant="secondary"
                disabled
                onPress={() => undefined}
              />
            </GlassCard>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  page: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 16, gap: 14 },
  card: { gap: 12 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { ...typography.subheading, color: colors.textPrimary },
  cardTagline: { ...typography.caption, color: colors.textSecondary },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  price: { ...typography.heading, color: colors.textPrimary },
  priceUnit: { ...typography.caption, color: colors.textSecondary },
  includes: { gap: 6 },
  includeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  includeText: { ...typography.body, color: colors.textPrimary },
});
