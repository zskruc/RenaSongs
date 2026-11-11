import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Dialog } from '@/components/Dialog';
import { GlassPressable } from '@/components/glass';
import { SettingsGroup, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { listRecentlyDeleted, permanentlyDeleteRecentlyDeleted, recentlyDeletedOwner, restoreRecentlyDeleted, type RecentlyDeletedItem } from '@/lib/recentlyDeleted';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useRecentlyDeleted } from '@/store/recentlyDeleted';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
const List = Animated.createAnimatedComponent(FlatList<RecentlyDeletedItem>);
export default function RecentlyDeletedScreen() {
  useAuthStore((s) => s.auth); useAuthStore((s) => s.offlineSource); useAuthStore((s) => s.offline);
  return <RecentlyDeletedBody key={JSON.stringify([profileScopeId(), useAuthStore.getState().offlineSource, useAuthStore.getState().offline])} />;
}
function RecentlyDeletedBody() {
  useTheme(); const t = useT(), bottom = useScreenBottomPadding(), onScroll = useLiquidDockScrollHandler();
  const [rows, setRows] = useState<RecentlyDeletedItem[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState<{ id?: string; restore?: boolean }>();
  const mounted = useRef(true), request = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const revision = useRecentlyDeleted((s) => s.revision), toast = useToast((s) => s.show);
  const load = useCallback(async () => {
    const owner = recentlyDeletedOwner(), token = ++request.current; setLoading(true); setError(false);
    const sameRequest = () => mounted.current && token === request.current;
    try { const items = await listRecentlyDeleted(owner); if (sameRequest() && owner.current()) setRows(items); }
    catch { if (sameRequest()) setError(true); }
    finally { if (sameRequest()) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, revision]);
  async function confirm() {
    if (!confirmation || busy) return;
    const action = confirmation, owner = recentlyDeletedOwner(); setConfirmation(undefined); setBusy(true);
    try {
      if (action.restore && action.id) await restoreRecentlyDeleted(action.id, owner);
      else await permanentlyDeleteRecentlyDeleted(action.id, owner);
      if (owner.current()) { toast(t(action.restore ? 'Restored as a new item' : 'Permanently deleted')); await load(); }
    } catch { if (owner.current()) toast(t('Could not complete this action. The recovery copy has been kept.')); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <SettingsPage title={t('Recently deleted')}>
    <List data={rows} keyExtractor={(item) => item.id} onScroll={onScroll} scrollEventThrottle={16} initialNumToRender={8} windowSize={5} maxToRenderPerBatch={6}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottom }}
      ListHeaderComponent={<>
        <Text style={settingsStyles.sectionDescription}>{t('Recover playlists, smart playlists and custom scraper configurations deleted in this App. Audio files are never deleted here. Restoring a server playlist creates a new playlist.')}</Text>
        <Text style={settingsStyles.sectionDescription}>{t('Recovery copies stay in this profile until you permanently delete them. Credentials are not included in scraper recovery copies.')}</Text>
        <GlassPressable style={styles.button} disabled={busy || !rows.length} onPress={() => setConfirmation({})}><Text style={styles.danger}>{t('Empty recently deleted')}</Text></GlassPressable>
        {loading || busy ? <ActivityIndicator color={colors.accent} /> : null}
        {error ? <GlassPressable style={styles.button} onPress={() => { void load(); }}><Text style={styles.action}>{t('Could not load recently deleted. Tap to retry.')}</Text></GlassPressable> : null}
      </>}
      ListEmptyComponent={!loading && !error ? <Text style={styles.muted}>{t('No recently deleted items')}</Text> : null}
      renderItem={({ item }) => <SettingsGroup>
        <View style={styles.row}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.muted}>{t(item.kind === 'playlist' ? 'Playlist' : item.kind === 'smart-playlist' ? 'Smart playlist' : 'Scraper configuration')} · {new Date(item.deletedAt).toLocaleString()}</Text>
          {!item.confirmed ? <Text style={styles.muted}>{t('Deletion was not confirmed. The original item may still exist; restoring creates a separate copy.')}</Text> : null}
          <View style={styles.actions}>
            <GlassPressable style={styles.button} disabled={busy} onPress={() => setConfirmation({ id: item.id, restore: true })}><Text style={styles.action}>{t('Restore')}</Text></GlassPressable>
            <GlassPressable style={styles.button} disabled={busy} onPress={() => setConfirmation({ id: item.id })}><Text style={styles.danger}>{t('Delete permanently')}</Text></GlassPressable>
          </View>
        </View>
      </SettingsGroup>} />
    <Dialog visible={!!confirmation} title={t(confirmation?.restore ? 'Restore as a new item?' : 'Permanently delete?')} message={t(confirmation?.restore ? 'The existing library is not overwritten. A server playlist will be recreated with a new ID.' : 'This removes the recovery copy only and cannot be undone. Audio files and server music are not changed.')}
      destructive={!confirmation?.restore} confirmLabel={t(confirmation?.restore ? 'Restore' : 'Delete permanently')} onCancel={() => setConfirmation(undefined)} onConfirm={() => { void confirm(); }} />
  </SettingsPage>;
}
const styles = themed((theme) => ({
  row: { padding: spacing.md, gap: spacing.xs }, title: { color: theme.text, fontSize: fontSize.md, fontWeight: '600' },
  muted: { color: theme.textSecondary, fontSize: fontSize.sm }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { backgroundColor: theme.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center', marginVertical: spacing.sm },
  action: { color: theme.accent, fontWeight: '600' }, danger: { color: theme.danger },
}));
