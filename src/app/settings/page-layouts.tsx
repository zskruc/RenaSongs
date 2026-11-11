import { useRouter } from 'expo-router';
import { DockScrollView } from '@/components/DockScrollView';
import { SelectList, SettingRow, SettingsGroup, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { type AlbumStyle, type PlaylistStyle, type UiStyle } from '@/lib/uiStyle';
import { useSettings, type CoverCorners } from '@/store/settings';

export default function PageLayoutSettings() {
  const t = useT(), router = useRouter();
  const uiStyle = useSettings((s) => s.uiStyle), setUiStyle = useSettings((s) => s.setUiStyle);
  const albumStyle = useSettings((s) => s.albumStyle), setAlbumStyle = useSettings((s) => s.setAlbumStyle);
  const playlistStyle = useSettings((s) => s.playlistStyle), setPlaylistStyle = useSettings((s) => s.setPlaylistStyle);
  const coverCorners = useSettings((s) => s.coverCorners), setCoverCorners = useSettings((s) => s.setCoverCorners);
  return <SettingsPage title={t('Page layouts')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <SettingsGroup title={t('UI style')} description={t('Switch page layouts instantly. Your playback, downloads, theme and glass settings stay as configured.')}>
      <SelectList<UiStyle> label={t('UI style')} value={uiStyle} onChange={setUiStyle} options={[
        { value: 'appleMusic', label: t('Apple Music style') }, { value: 'spotify', label: t('Spotify style') },
      ]} />
    </SettingsGroup>
    <SettingsGroup title={t('Detail pages')}>
      <SelectList<AlbumStyle> label={t('Album page style')} value={albumStyle} onChange={setAlbumStyle} options={[
        { value: 'primuse', label: t('Primuse') }, { value: 'artist', label: t('Artist page layout') },
        { value: 'volta', label: t('Volta') }, { value: 'minidisc', label: t('Minidisc') },
      ]} />
      <SelectList<PlaylistStyle> label={t('Playlist page style')} value={playlistStyle} onChange={setPlaylistStyle} options={[
        { value: 'primuse', label: t('Primuse') }, { value: 'artist', label: t('Artist page layout') }, { value: 'compact', label: t('Compact layout') },
      ]} />
      <SelectList<CoverCorners> label={t('Cover corners')} value={coverCorners} onChange={setCoverCorners} options={[
        { value: 'square', label: t('Square') }, { value: 'rounded', label: t('Rounded') }, { value: 'round', label: t('More rounded') },
      ]} />
    </SettingsGroup>
    <SettingsGroup title={t('Song lists')}>
      <SettingRow label={t('Song lists')} description={t('Track information, artwork and list actions')} chevron onPress={() => router.push('/settings/song-lists')} />
    </SettingsGroup>
  </DockScrollView></SettingsPage>;
}
