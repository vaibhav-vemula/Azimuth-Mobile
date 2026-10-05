import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { colors } from '../../../theme';

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
}

/**
 * A bottom sheet that rests as a small bar and is swiped up for the full contents, like a maps app. Drag the handle up or
 * down, or tap it to toggle. The header (including the main button) stays in view.
 */
export function MapSheet({ open, onOpenChange, header, children, openFraction = 0.62, onCollapsedHeight }: Props) {
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

  const settle = (toOpen: boolean) => {
    Animated.spring(ty, { toValue: toOpen ? 0 : offsetRef.current, useNativeDriver: true, bounciness: 3, speed: 14 }).start();
  };

  // Follow the prop (for example when a session ends and the summary should show) and the measured height.
  useEffect(() => settle(open), [open, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onCollapsedHeight?.(collapsedH), [collapsedH, onCollapsedHeight]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        ty.stopAnimation((v) => {
          start.current = v;
        });
      },
      onPanResponderMove: (_, g) => ty.setValue(clamp(start.current + g.dy, 0, offsetRef.current)),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dy) < 5 && Math.abs(g.dx) < 5) {
          changeRef.current(!openRef.current); // a tap
          return;
        }
        const position = clamp(start.current + g.dy, 0, offsetRef.current);
        const toOpen = g.vy < -0.35 ? true : g.vy > 0.35 ? false : position < offsetRef.current / 2;
        changeRef.current(toOpen);
        settle(toOpen);
      },
    })
  ).current;

  return (
    <Animated.View style={[styles.sheet, { height: openH, transform: [{ translateY: ty }] }]}>
      <View onLayout={(e) => setHeaderH(Math.ceil(e.nativeEvent.layout.height) - HANDLE_H)}>
        <View {...pan.panHandlers} style={styles.handleArea} accessibilityRole="button" accessibilityLabel={open ? 'Collapse the mapping panel' : 'Expand the mapping panel'}>
          <View style={styles.handle} />
        </View>
        {header}
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false} scrollEnabled={open}>
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
