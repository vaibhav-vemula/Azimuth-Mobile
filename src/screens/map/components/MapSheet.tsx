import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../../../theme';

const HANDLE_H = 26;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  /** Whether the sheet is pulled up to show its full contents. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Always visible, even when collapsed: the title row and the main button. */
  header: ReactNode;
  /** Shown when the sheet is pulled up. */
  children: ReactNode;
  /** How much of the screen the open sheet covers. */
  openFraction?: number;
  /** Tells the screen how tall the collapsed sheet is, so other controls can sit above it. */
  onCollapsedHeight?: (height: number) => void;
  /** Raise this number to make the sheet rise part of the way for a moment, to show there is more under it. */
  peekSignal?: number;
}

/**
 * A bottom sheet that rests as a small bar and is swiped up for the full contents, like a maps app. Drag the handle up or
 * down, or tap it to toggle. The header (including the main button) stays in view.
 */
export function MapSheet({ open, onOpenChange, header, children, openFraction = 0.62, onCollapsedHeight, peekSignal = 0 }: Props) {
  const { height: screenH } = useWindowDimensions();
  const openH = Math.round(screenH * openFraction);
  const [headerH, setHeaderH] = useState(120);
  const collapsedH = HANDLE_H + headerH;
  const offset = Math.max(0, openH - collapsedH);

  const ty = useRef(new Animated.Value(open ? 0 : offset)).current;
  const start = useRef(0);
  const offsetRef = useRef(offset);
  const openRef = useRef(open);
  const changeRef = useRef(onOpenChange);
  offsetRef.current = offset;
  openRef.current = open;
  changeRef.current = onOpenChange;

  /** How far to rise when peeking: enough to show the first rows of the contents. */
  const peekRise = Math.min(Math.max(0, openH - collapsedH), 250);
  const peekRef = useRef(peekRise);
  peekRef.current = peekRise;

  const settle = (toOpen: boolean) => {
    Animated.spring(ty, { toValue: toOpen ? 0 : offsetRef.current, useNativeDriver: true, bounciness: 3, speed: 14 }).start();
  };

  // Follow the prop (for example when a session ends and the summary should show) and the measured height.
  useEffect(() => settle(open), [open, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onCollapsedHeight?.(collapsedH), [collapsedH, onCollapsedHeight]);

  // A short peek: rise, wait, settle back, unless the player has taken over by then.
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    if (openRef.current || peekSignal === 0) return;
    Animated.sequence([
      Animated.timing(ty, { toValue: Math.max(0, offsetRef.current - peekRef.current), duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(ty, { toValue: offsetRef.current, duration: 520, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [peekSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where the current touch started, and how far the contents are scrolled, so a drag goes to the right thing.
  const touchInHeader = useRef(false);
  const scrollY = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  // While the contents sit at the very top, the sheet handles every vertical drag itself: a native scroll view would
  // otherwise grab the touch first on Android and a pull down would do nothing. (A drag up scrolls the contents by hand.)
  const [atTop, setAtTop] = useState(true);

  const pan = useRef(
    PanResponder.create({
      // Taps and scrolling are left to the buttons and the list inside; the sheet only takes over once a drag is clearly vertical.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (_, g) => {
        const vertical = Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.4;
        if (!vertical) return false;
        // A drag that starts on the bar (the handle, title, counters or button) always moves the sheet, up or down.
        if (touchInHeader.current) return true;
        // In the contents: while the sheet is not fully open any vertical drag opens it; once open, any drag from the very
        // top of the list is ours (down closes, up scrolls), and a list that is already scrolled scrolls on its own.
        return !openRef.current || scrollY.current <= 0;
      },
      onPanResponderGrant: () => {
        ty.stopAnimation((v) => {
          start.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        ty.setValue(clamp(start.current + g.dy, 0, offsetRef.current));
        // Open and dragged up from the top of the contents: scroll them.
        if (openRef.current && g.dy < 0) scrollRef.current?.scrollTo({ y: -g.dy, animated: false });
      },
      onPanResponderRelease: (_, g) => {
        const position = clamp(start.current + g.dy, 0, offsetRef.current);
        // An open sheet only closes on a pull down; a drag up that scrolled the contents leaves it open.
        if (openRef.current && g.dy <= 0) {
          settle(true);
          return;
        }
        // A quick flick decides by its direction; a slow drag decides by which half it ended in.
        const toOpen = g.vy < -0.3 ? true : g.vy > 0.3 ? false : position < offsetRef.current / 2;
        changeRef.current(toOpen);
        settle(toOpen);
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  return (
    <Animated.View style={[styles.sheet, { height: openH, transform: [{ translateY: ty }] }]} {...pan.panHandlers}>
      <View onTouchStart={() => (touchInHeader.current = true)} onLayout={(e) => {
          // The resting height is what places the sheet, so a header that grows while open (more labels) is not measured.
          if (!openRef.current) setHeaderH(Math.ceil(e.nativeEvent.layout.height) - HANDLE_H);
        }}>
        <Pressable style={styles.handleArea} onPress={() => changeRef.current(!openRef.current)} accessibilityRole="button" accessibilityLabel={open ? 'Collapse the mapping panel' : 'Expand the mapping panel'}>
          <View style={styles.handle} />
        </Pressable>
        {header}
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={open && !atTop}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          scrollY.current = y;
          setAtTop((was) => (was === y <= 0 ? was : y <= 0));
        }}
        onTouchStart={() => (touchInHeader.current = false)}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11,15,26,0.97)',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderColor: colors.accentMuted,
    borderWidth: 1,
    borderBottomWidth: 0,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
  },
  handleArea: { height: HANDLE_H, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.surfaceBorder },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 14, paddingBottom: 24, gap: 12 },
});

/** A small chevron that bobs upward with a line of text, to show that the sheet can be pulled up. */
export function SwipeHint({ text }: { text: string }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <View style={hintStyles.row} pointerEvents="none">
      <Animated.View style={{ transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [2, -3] }) }] }}>
        <Ionicons name="chevron-up" size={16} color={colors.accent} />
      </Animated.View>
      <Text style={hintStyles.text}>{text}</Text>
    </View>
  );
}

const hintStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  text: { ...typography.caption, color: colors.accent },
});
