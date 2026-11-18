import { createContext, forwardRef, useCallback, useContext, useId, useLayoutEffect, useRef } from 'react';
import { findNodeHandle, Pressable, type PressableProps, type View } from 'react-native';

import { MenuItemRegistry } from '@/lib/menuItems';

export const MenuItemsContext = createContext<MenuItemRegistry | null>(null);
type Props = Omit<PressableProps, 'onPress'> & {
  /** Only explicit finite options register; inputs, sliders and arbitrary body
   * content remain ordinary React Native controls. */
  menuItemId?: string;
  selected?: boolean;
  keepOpen?: boolean;
  /** Preserve ordinary presses for mixed/nested controls, without drag hit-testing. */
  menuDrag?: boolean;
  fullWidth?: boolean;
  onPress?: () => void;
};

export const MenuMorphItem = forwardRef<View, Props>(function MenuMorphItem({
  menuItemId, selected, keepOpen = false, menuDrag = true, fullWidth = true, onPress, disabled, ...props
}, forwardedRef) {
  const registry = useContext(MenuItemsContext);
  const generated = useId();
  const id = menuItemId ?? generated;
  const owner = useRef({});
  const node = useRef<View | null>(null);
  const setRef = useCallback((view: View | null) => {
    node.current = view;
    if (typeof forwardedRef === 'function') forwardedRef(view);
    else if (forwardedRef) forwardedRef.current = view;
  }, [forwardedRef]);
  useLayoutEffect(() => {
    if (!registry) return;
    const tag = menuDrag && node.current ? findNodeHandle(node.current) : null;
    registry.register(id, owner.current, {
      tag, enabled: !disabled && !!onPress, selected: selected ?? !!(props.accessibilityState?.selected || props.accessibilityState?.checked === true),
      keepOpen, fullWidth, action: onPress ?? (() => {}),
    });
  }, [registry, id, disabled, selected, props.accessibilityState?.selected, props.accessibilityState?.checked, keepOpen, onPress, menuDrag, fullWidth]);
  useLayoutEffect(() => {
    const binding = owner.current;
    return () => registry?.unregister(id, binding);
  }, [registry, id]);
  return <Pressable {...props} ref={setRef} collapsable={false} disabled={disabled}
    onPress={() => { if (registry) registry.press(id, owner.current); else onPress?.(); }} />;
});
