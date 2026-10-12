import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';
import { colors, typography } from '../theme';

/**
 * The app's own pop-up, used in place of the system alert. `appAlert` takes the same arguments as `Alert.alert`
 * (a title, an optional message, and buttons), so it can be swapped in anywhere. The look follows what the pop-up is
 * about: a warning icon when a button is destructive, a red one for failures, a green one for things that worked.
 */
export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export type DialogTone = 'info' | 'success' | 'warning' | 'danger';

interface DialogItem {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
  tone: DialogTone;
}

/** What a pop-up is about, judged from its title and buttons. */
export function toneFor(title: string, buttons: DialogButton[]): DialogTone {
  if (buttons.some((b) => b.style === 'destructive')) return 'warning';
  if (/failed|could not|couldn't|error|unable/i.test(title)) return 'danger';
  if (/blocked|are off|already started|nothing recorded|not available|denied/i.test(title)) return 'warning';
  if (/exported|deleted|sent|saved|done|success/i.test(title)) return 'success';
  return 'info';
}

const TONES: Record<DialogTone, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  info: { icon: 'information-circle', color: colors.accent },
  success: { icon: 'checkmark-circle', color: colors.success },
  warning: { icon: 'warning', color: colors.warning },
  danger: { icon: 'alert-circle', color: colors.danger },
};

interface DialogState {
  queue: DialogItem[];
  show: (item: Omit<DialogItem, 'id'>) => void;
  close: (id: number) => void;
}

let nextId = 1;
export const useDialogs = create<DialogState>((set) => ({
  queue: [],
  show: (item) => set((s) => ({ queue: [...s.queue, { ...item, id: nextId++ }] })),
  close: (id) => set((s) => ({ queue: s.queue.filter((d) => d.id !== id) })),
}));

/** Same arguments as `Alert.alert`. With no buttons it shows one OK button. */
export function appAlert(title: string, message?: string, buttons?: DialogButton[]) {
  const list = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
  useDialogs.getState().show({ title, message, buttons: list, tone: toneFor(title, list) });
}

/** Draws the pop-up that is first in line. Mounted once, at the top of the app. */
export function DialogHost() {
  const current = useDialogs((s) => s.queue[0]);
  const close = useDialogs((s) => s.close);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!current) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [current?.id, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return null;
  const tone = TONES[current.tone];
  const cancel = current.buttons.find((b) => b.style === 'cancel');
  // Back and a tap outside close it only when there is a way out that is not a choice: a cancel button or a lone OK.
  const dismissable = !!cancel || current.buttons.length === 1;
  const dismiss = () => {
    if (!dismissable) return;
    close(current.id);
    cancel?.onPress?.();
  };
  const press = (b: DialogButton) => {
    close(current.id);
    b.onPress?.();
  };
  // Cancel sits first, then the rest in the order given.
  const ordered = [...current.buttons].sort((a, b) => Number(b.style === 'cancel') - Number(a.style === 'cancel'));
  const stacked = ordered.length > 2;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <Animated.View style={[styles.backdrop, { opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close" />
        <Animated.View
          accessibilityRole="alert"
          style={[styles.card, { borderColor: `${tone.color}55`, opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}
        >
          <View style={[styles.iconWrap, { borderColor: tone.color, backgroundColor: `${tone.color}1F` }]}>
            <Ionicons name={tone.icon} size={30} color={tone.color} />
          </View>
          <Text style={styles.title}>{current.title}</Text>
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
          <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
            {ordered.map((b, i) => (
              <DialogButtonView key={`${b.text}-${i}`} button={b} tone={tone.color} onPress={() => press(b)} stacked={stacked} />
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function DialogButtonView({ button, tone, onPress, stacked }: { button: DialogButton; tone: string; onPress: () => void; stacked: boolean }) {
  const destructive = button.style === 'destructive';
  const cancel = button.style === 'cancel';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        !stacked && styles.buttonFlex,
        cancel ? styles.buttonCancel : destructive ? styles.buttonDanger : { backgroundColor: tone },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, cancel ? styles.buttonTextCancel : destructive ? styles.buttonTextDanger : null]}>{button.text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(3,5,10,0.78)' },
  card: { width: '100%', maxWidth: 380, alignItems: 'center', gap: 10, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 20, borderRadius: 26, backgroundColor: colors.backgroundElevated, borderWidth: 1 },
  iconWrap: { width: 60, height: 60, borderRadius: 30, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { ...typography.heading, fontSize: 20, textAlign: 'center', color: colors.textPrimary },
  message: { ...typography.body, textAlign: 'center', color: colors.textSecondary, lineHeight: 20 },
  buttons: { flexDirection: 'row', alignSelf: 'stretch', gap: 10, marginTop: 12 },
  buttonsStacked: { flexDirection: 'column' },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonFlex: { flex: 1 },
  buttonCancel: { backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.surfaceBorder },
  buttonDanger: { backgroundColor: colors.record },
  buttonText: { ...typography.subheading, fontSize: 15, color: colors.background },
  buttonTextCancel: { color: colors.textPrimary },
  buttonTextDanger: { color: colors.textPrimary },
  pressed: { opacity: 0.8 },
});
