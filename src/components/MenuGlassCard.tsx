import { createContext, forwardRef, type ComponentProps, type ReactNode, useContext, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View, type ViewProps, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { GlassPressable } from '@/components/glass';
import { MenuGlassBackdrop } from '@/components/MenuGlassBackdrop';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import type { MenuMorphController } from '@/lib/menuMorph';
import { captureMenuTouchMove, captureMenuTouchStart } from '@/lib/menuOrigin';
import { MenuMorphView } from '../../modules/liquid-glass';
import { useT } from '@/i18n';
import { themed, useTheme, useThemeMode } from '@/theme';

type AnimatedViewStyle = ComponentProps<typeof Animated.View>['style'];

export const MENU_GLASS_RADIUS = 28;
export const menuGlassScrimColor = (dark: boolean) => dark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.10)';
const MenuCloseContext = createContext<((after: () => void) => void) | null>(null);
const AnimatedMenuMorph = Animated.createAnimatedComponent(MenuMorphView);

/** Fixed Yoga layout, separate native material/content tracks. Native motion
 * begins after attachment/pre-draw instead of racing creation of a Modal. */
export function MenuMorphSurface({ children, style, radius = MENU_GLASS_RADIUS, motion, onLayout, ...props }:
  Omit<ViewProps, 'style'> & { style?: AnimatedViewStyle; radius?: number; motion?: MenuMorphController }) {
  const fallback = useBottomSheetAnim(!motion, undefined, 'card');
  const controller = motion ?? fallback.motion;
  // Preserve an explicit caller defer, such as a dropdown awaiting natural
  // content height. Native attachment/pre-draw guards cover ordinary cards.
  return <AnimatedMenuMorph {...props} collapsable={false}
    style={[style, controller.fallbackStyle, { backgroundColor: 'transparent', borderRadius: radius, overflow: 'visible' }]}
    radius={radius} open={controller.open} ready={controller.ready} sessionId={controller.sessionId}
    sourceRect={controller.sourceRect} onMotionStart={controller.onMotionStart} onMotionComplete={controller.onMotionComplete}
    onLayout={(event) => { controller.onLayoutReady(); onLayout?.(event); }}>
    <MenuGlassBackdrop radius={radius} />
    <View collapsable={false} style={{ flexShrink: 1, minHeight: 0, alignSelf: 'stretch' }}>{children}</View>
  </AnimatedMenuMorph>;
}

/** The artist picker's single glass surface, also usable by anchored/inline dialogs. */
export const MenuGlassPanel = forwardRef<View, ViewProps & { radius?: number }>(function MenuGlassPanel({
  children, style, radius = MENU_GLASS_RADIUS, ...props
}, ref) {
  return (
    <View {...props} ref={ref} collapsable={false}
      style={[style, { backgroundColor: 'transparent', borderRadius: radius, overflow: 'hidden' }]}>
      <MenuGlassBackdrop radius={radius} />
      {children}
    </View>
  );
});

/** One bounded surface for a menu's details, with the same material and anchor. */
export function MenuGlassCardFrame({ children, onClose, backdropStyle, cardStyle, onLayout, maxWidth = 312, motion }: {
  children: ReactNode;
  onClose: () => void;
  backdropStyle?: AnimatedViewStyle;
  cardStyle?: AnimatedViewStyle;
  onLayout?: (event: LayoutChangeEvent) => void;
  maxWidth?: number;
  motion?: MenuMorphController;
}) {
  useTheme();
  const dark = useThemeMode() === 'dark';
  const t = useT();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const automatic = useBottomSheetAnim(!motion, onClose, 'card');
  const controller = motion ?? automatic.motion;
  const close = () => motion ? onClose() : automatic.dismiss(onClose);
  // A Dialog window can resize for the keyboard independently of the Activity.
  const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);
  const width = bounds?.width ?? window.width;
  const height = bounds?.height ?? window.height;
  const top = Math.min(insets.top + 72, Math.max(insets.top + 12, height - insets.bottom - 260));
  const cardWidth = Math.min(maxWidth, Math.max(0, width - insets.left - insets.right - 32));
  const maxHeight = Math.min(640, Math.max(0, height - top - insets.bottom - 16));

  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}
      onStartShouldSetResponderCapture={(event) => { captureMenuTouchStart(event); return false; }}
      onMoveShouldSetResponderCapture={(event) => { captureMenuTouchMove(event); return false; }} onLayout={(event) => {
      const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
      setBounds((old) => old?.width === nextWidth && old.height === nextHeight ? old : { width: nextWidth, height: nextHeight });
    }}>
      <Animated.View nativeID="resonus-menu-scrim" collapsable={false}
        style={[StyleSheet.absoluteFill, { backgroundColor: menuGlassScrimColor(dark) }, backdropStyle ?? automatic.backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={t('Close')} />
      </Animated.View>
      <MenuCloseContext.Provider value={motion ? null : automatic.dismiss}>
        <MenuMorphSurface accessibilityViewIsModal onLayout={onLayout} motion={controller}
          style={[styles.card, { top, right: 16 + insets.right, width: cardWidth, maxHeight }, cardStyle]}>
          {children}
        </MenuMorphSurface>
      </MenuCloseContext.Provider>
    </GestureHandlerRootView>
  );
}

export function MenuGlassCardHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  const colors = useTheme();
  const t = useT();
  const dismiss = useContext(MenuCloseContext);
  return (
    <View style={styles.header}>
      <View style={styles.heading}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={3}>{subtitle}</Text> : null}
      </View>
      <GlassPressable onPress={() => dismiss ? dismiss(onClose) : onClose()} accessibilityRole="button" accessibilityLabel={t('Close')}
        hitSlop={4} style={({ pressed }) => [styles.close, pressed && { opacity: 0.55 }]}>
        <Icon name="close" size={20} color={colors.textSecondary} />
      </GlassPressable>
    </View>
  );
}

const styles = themed((colors) => ({
  card: { position: 'absolute', backgroundColor: 'transparent', borderRadius: MENU_GLASS_RADIUS, overflow: 'visible', padding: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14, flexShrink: 0 },
  heading: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600', lineHeight: 24 },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  close: { width: 36, height: 36, marginTop: -5, marginRight: -6, alignItems: 'center', justifyContent: 'center' },
}));
