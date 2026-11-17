/**
 * Self-contained bottom sheet: its visibility lives here and is opened
 * imperatively via `openRef`, so showing/hiding it does NOT re-render the
 * screen (with its list) that declares it — with state in the screen, opening
 * the menu had a noticeable delay. The content comes as a function receiving
 * `close` to close after choosing an action.
 *
 * Every window uses the artist picker’s floating glass card. Existing detail
 * cards retain their own scrolling; legacy action sheets get a bounded body.
 */
import { type MutableRefObject, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView } from 'react-native';

import { MenuGlassCardFrame } from '@/components/MenuGlassCard';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { MenuRequestScope } from '@/lib/menuRequest';

export type SheetModalClose = ((after?: () => void) => void) & {
  /** Apply a reversible local selection now; retain the shell until its exit. */
  select: (action: () => void) => void;
};

export function SheetModal({
  openRef,
  onClosed,
  presentation = 'sheet',
  children,
}: {
  /** The screen holds a ref and calls `openRef.current()` to open. */
  openRef: MutableRefObject<() => void>;
  /** Runs once the sheet is off screen, however it was closed. For an action
   *  that unmounts the sheet along with whatever declares it. */
  onClosed?: () => void;
  presentation?: 'sheet' | 'card';
  children: (close: SheetModalClose) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [lifecycle] = useState(() => new MenuRequestScope());
  const closing = useRef(false);
  useEffect(() => {
    openRef.current = () => {
      closing.current = false;
      setSession(lifecycle.begin());
      setOpen(true);
    };
    return () => {
      lifecycle.invalidate();
      openRef.current = () => {};
    };
  }, [openRef, lifecycle]);
  const closeNow = useCallback((after?: () => void) => {
    if (!lifecycle.owns(session)) return;
    lifecycle.invalidate();
    setOpen(false);
    onClosed?.();
    if (typeof after === 'function') after();
  }, [session, onClosed, lifecycle]);
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout, motion, onModalShow } = useBottomSheetAnim(
    open,
    closeNow,
    'card',
    session,
  );
  // Unmount the Modal only after its exit animation, for either presentation.
  // A next modal opens only after this surface is offscreen, avoiding a
  // background switch underneath two independently visible native windows.
  const beginClose = (after?: () => void) => {
    if (!lifecycle.owns(session) || closing.current) return false;
    closing.current = true;
    // React Native passes a PressEvent to handlers supplied as onPress={close}.
    // Only explicit callbacks are actions to run after the card has left.
    const callback = typeof after === 'function' ? after : undefined;
    dismiss(() => closeNow(callback));
    return true;
  };
  function close(after?: () => void) { beginClose(after); }
  close.select = (action: () => void) => { if (typeof action === 'function' && beginClose()) action(); };
  // The render prop receives deferred press handlers; it does not run them.
  // eslint-disable-next-line react-hooks/refs
  const content = children(close);

  return (
    <Modal onShow={onModalShow} transparent animationType="none" visible={open} onRequestClose={() => close()}>
      <MenuGlassCardFrame motion={motion} onClose={() => close()} backdropStyle={backdropStyle}
        cardStyle={sheetStyle} onLayout={onSheetLayout}>
        {/* Detail cards already own their scroll view. Legacy short action
            sheets share the same shell and gain a bounded scrolling body. */}
        {presentation === 'card' ? content : (
          <ScrollView style={{ flexShrink: 1, minHeight: 0 }} showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {content}
          </ScrollView>
        )}
      </MenuGlassCardFrame>
    </Modal>
  );
}
