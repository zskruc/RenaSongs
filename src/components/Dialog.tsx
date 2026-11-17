/**
 * Simple modal dialog: title, message or optional text field, and
 * Cancel/Confirm buttons. Used for create/rename (with input) and to confirm
 * destructive actions (without input).
 */
import Icon from '@/components/Icon';
import { GlassPressable } from '@/components/glass';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ColorValue,
} from 'react-native';

import { useT } from '@/i18n';
import { usePopupMorphPresence } from '@/hooks/usePopupMorphPresence';
import { colors, fontSize, radius, spacing, themed, tracking } from '@/theme';
import { MENU_GLASS_RADIUS, MenuGlassCardFrame, MenuGlassCardHeader } from './MenuGlassCard';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  /** Override the message contrast for a specific dialog surface. */
  messageColor?: ColorValue;
  /** Anything else to show under the message. */
  children?: ReactNode;
  /** If provided, shows a text field initialized with `initialValue`. */
  input?: { placeholder?: string; initialValue?: string; secure?: boolean };
  confirmLabel: string;
  /** Optional third choice, neither confirm nor cancel (e.g. «Don't remind
   *  me»). Goes on its own line so three labels never crowd one row.
   *  `align` says which end of that line: 'start' for the ones that dismiss,
   *  which stay out of the way, and 'end' to stack it over the confirm when
   *  both are answers to the same question and get compared to each other.
   *  `icon` sits after the label, for the ones a word alone does not describe:
   *  a line of grey text among grey text reads as a label, and `open-outline`
   *  is what says this one leaves the app. */
  neutral?: {
    label: string;
    onPress: () => void;
    align?: 'start' | 'end';
    icon?: keyof typeof Icon.glyphMap;
  };
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  /** Replace a floating menu's content in its existing Modal window. */
  inlineMenu?: boolean;
  /** Keep a centered confirmation in its existing editor/viewer window. */
  inline?: boolean;
}

export function Dialog(props: Props) {
  // Keep the last visible content through an externally requested exit. Some
  // callers clear the selected item at the same time as hiding the dialog.
  const [retainedProps, setRetainedProps] = useState(props);
  if (props.visible && retainedProps !== props) setRetainedProps(props);
  const {
    title, message, messageColor, children, input, confirmLabel, neutral,
    destructive, onCancel, onConfirm, inlineMenu = false, inline = false,
  } = props.visible ? props : retainedProps;
  const visible = props.visible;
  const popup = usePopupMorphPresence(visible, JSON.stringify([title, message, input?.initialValue, input?.secure, confirmLabel]));
  const { animation } = popup;
  const t = useT();
  const [value, setValue] = useState(input?.initialValue ?? '');
  const inputRef = useRef<TextInput>(null);
  const hasInput = !!input;

  // Reset the text every time it opens.
  useEffect(() => {
    if (visible) setValue(input?.initialValue ?? '');
  }, [visible, input?.initialValue]);

  useEffect(() => {
    if (!visible || !popup.mounted || (!inline && !inlineMenu) || !hasInput) return;
    // The parent Modal already owns focus. Wait for this field to attach,
    // without opening another window whose backdrop loses the editor below.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visible, inline, inlineMenu, hasInput, popup.mounted, popup.session]);

  const canConfirm = input ? value.trim().length > 0 : true;
  const close = (after: () => void) => {
    inputRef.current?.blur();
    popup.close(after);
  };

  if (!popup.mounted) return null;

  if (inlineMenu) {
    return <MenuDialog animation={animation} close={close} title={title} message={message} messageColor={messageColor} input={input} inputRef={inputRef}
      value={value} onChangeText={setValue} onCancel={onCancel} onConfirm={() => onConfirm(value.trim())}
      confirmLabel={confirmLabel} destructive={destructive} canConfirm={canConfirm} neutral={neutral}>
      {children}
    </MenuDialog>;
  }

  const content = (
    <MenuGlassCardFrame onClose={() => close(onCancel)} motion={animation.motion}
      backdropStyle={animation.backdropStyle} cardStyle={animation.sheetStyle} onLayout={animation.onSheetLayout}>
      <MenuGlassCardHeader title={title} onClose={() => close(onCancel)} />
      <ScrollView style={styles.menuBody} contentContainerStyle={{ gap: spacing.md }}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {message ? <Text style={[styles.message, messageColor != null && { color: messageColor }]}>{message}</Text> : null}
          {children}
          {input ? (
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={input.placeholder}
              placeholderTextColor={colors.textMuted}
              value={value}
              onChangeText={setValue}
              secureTextEntry={input.secure}
            />
          ) : null}
          {neutral ? (
            <GlassPressable
              variant="subtle"
              hitSlop={8}
              style={[
                styles.neutral,
                neutral.align === 'end' && { alignSelf: 'flex-end' },
              ]}
              onPress={() => close(neutral.onPress)}
            >
              <Text style={styles.cancel}>{neutral.label}</Text>
              {neutral.icon ? (
                <Icon name={neutral.icon} size={15} color={colors.textSecondary} />
              ) : null}
            </GlassPressable>
          ) : null}
          <View style={styles.actions}>
            <GlassPressable variant="subtle" hitSlop={8} onPress={() => close(onCancel)}>
              <Text style={styles.cancel}>{t('Cancel')}</Text>
            </GlassPressable>
            <GlassPressable
              variant="regular"
              hitSlop={8}
              disabled={!canConfirm}
              onPress={() => close(() => onConfirm(value.trim()))}
            >
              <Text
                style={[
                  styles.confirm,
                  { color: colors.accent },
                  destructive && { color: colors.danger },
                  !canConfirm && { opacity: 0.4 },
                ]}
              >
                {confirmLabel}
              </Text>
            </GlassPressable>
          </View>
      </ScrollView>
    </MenuGlassCardFrame>
  );

  if (inline) return content;
  return (
    <Modal transparent visible={popup.mounted} animationType="none" onRequestClose={() => close(onCancel)}
      // Native windows take focus only after showing; inline fields use the
      // existing window and focus after attachment instead.
      onShow={() => { animation.onModalShow(); inputRef.current?.focus(); }}>
      {content}
    </Modal>
  );
}

/** A subdialog shares the menu window, so one glass capture remains sufficient. */
function MenuDialog({ animation, close, title, message, messageColor, input, inputRef, value, onChangeText, onCancel, onConfirm,
  confirmLabel, destructive, canConfirm, neutral, children }: {
  animation: ReturnType<typeof usePopupMorphPresence>['animation']; close: (after: () => void) => void;
  title: string; message?: string; messageColor?: Props['messageColor']; input?: Props['input']; inputRef: RefObject<TextInput | null>;
  value: string; onChangeText: (value: string) => void; onCancel: () => void; onConfirm: () => void;
  confirmLabel: string; destructive?: boolean; canConfirm: boolean; neutral?: Props['neutral']; children?: ReactNode;
}) {
  const t = useT();
  return (
    <MenuGlassCardFrame onClose={() => close(onCancel)} motion={animation.motion} backdropStyle={animation.backdropStyle}
      cardStyle={animation.sheetStyle} onLayout={animation.onSheetLayout}>
      <ScrollView style={styles.menuBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <MenuGlassCardHeader title={title} onClose={() => close(onCancel)} />
        {message ? <Text style={[styles.menuMessage, messageColor != null && { color: messageColor }]}>{message}</Text> : null}
        {children}
        {input ? <TextInput ref={inputRef} style={styles.input} placeholder={input.placeholder}
          placeholderTextColor={colors.textMuted} value={value} onChangeText={onChangeText}
          secureTextEntry={input.secure} accessibilityLabel={input.placeholder ?? title} /> : null}
        {neutral ? <GlassPressable onPress={() => close(neutral.onPress)} accessibilityRole="button"
          style={[styles.neutral, neutral.align === 'end' && { alignSelf: 'flex-end' }]}>
          <Text style={styles.cancel}>{neutral.label}</Text>
          {neutral.icon ? <Icon name={neutral.icon} size={15} color={colors.textSecondary} /> : null}
        </GlassPressable> : null}
      </ScrollView>
      <View style={styles.menuActions}>
        <GlassPressable onPress={() => close(onCancel)} accessibilityRole="button" style={styles.menuButton}>
          <Text style={styles.cancel}>{t('Cancel')}</Text>
        </GlassPressable>
        <GlassPressable tint={destructive ? colors.danger : colors.accent} onPress={() => close(onConfirm)} disabled={!canConfirm} accessibilityRole="button"
          style={[styles.menuButton, { backgroundColor: destructive ? colors.danger : colors.accent }, !canConfirm && { opacity: 0.4 }]}>
          <Text style={[styles.confirm, { color: colors.onAccent }]}>{confirmLabel}</Text>
        </GlassPressable>
      </View>
    </MenuGlassCardFrame>
  );
}

const styles = themed((colors) => ({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdropStrong },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    backgroundColor: 'transparent',
    borderRadius: MENU_GLASS_RADIUS,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.lg, letterSpacing: tracking.heading, fontWeight: '500' },
  message: { color: colors.textSecondary, fontSize: fontSize.md },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  neutral: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  cancel: { color: colors.textSecondary, fontSize: fontSize.md, fontWeight: '500' },
  confirm: { color: colors.accent, fontSize: fontSize.md, fontWeight: '600' },
  menuBody: { flexShrink: 1, minHeight: 0 },
  menuMessage: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 16 },
  menuActions: { flexDirection: 'row', gap: 8, marginTop: 18, flexShrink: 0 },
  menuButton: { flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', padding: 10 },
}));
