/** Lyrics display and typography; song-specific editing stays in Lyrics tools. */
import { DockScrollView } from '@/components/DockScrollView';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SelectList, SettingRow, SettingsGroup, SettingsPage, settingsStyles, SliderRow, SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { type CardBackground, type LyricsAlign, type LyricsWeight, type LyricsSource, type ScreenBackground,
  LYRICS_SIZE_MIN, LYRICS_SIZE_MAX, useSettings } from '@/store/settings';
import { useTheme } from '@/theme';

export default function LyricsSettings() {
  useTheme();
  const t = useT(), router = useRouter();
  const lyricsSize = useSettings((s) => s.lyricsSize);
  const setLyricsSize = useSettings((s) => s.setLyricsSize);
  const lyricsWeight = useSettings((s) => s.lyricsWeight);
  const setLyricsWeight = useSettings((s) => s.setLyricsWeight);
  const lyricsAlign = useSettings((s) => s.lyricsAlign);
  const setLyricsAlign = useSettings((s) => s.setLyricsAlign);
  const blurInactiveLyrics = useSettings((s) => s.blurInactiveLyrics);
  const setBlurInactiveLyrics = useSettings((s) => s.setBlurInactiveLyrics);
  const lyricsBackground = useSettings((s) => s.lyricsBackground);
  const setLyricsBackground = useSettings((s) => s.setLyricsBackground);
  const lyricsCardBackground = useSettings((s) => s.lyricsCardBackground);
  const setLyricsCardBackground = useSettings((s) => s.setLyricsCardBackground);
  const showLyricsCard = useSettings((s) => s.showLyricsCard);
  const setShowLyricsCard = useSettings((s) => s.setShowLyricsCard);
  const lyricsSource = useSettings((s) => s.lyricsSource);
  const setLyricsSource = useSettings((s) => s.setLyricsSource);
  return (
    <SettingsPage title={t('Lyrics')}>
      <DockScrollView contentContainerStyle={settingsStyles.content}>
        <SettingsGroup title={t('Lyrics source')}>
          <SelectList<LyricsSource>
            label={t('Lyrics source')}
            description={t(
              'Where to get lyrics from. Online search uses LRCLIB (sends the artist and title).',
            )}
            options={[
              { value: 'local', label: t('Prefer local lyrics') },
              { value: 'online', label: t('Prefer online search') },
              { value: 'off', label: t('Disable online search') },
            ]}
            value={lyricsSource}
            onChange={setLyricsSource}
          />
        </SettingsGroup>
        <SettingsGroup title={t('Font')}>
          <SettingRow label={t('Lyric fonts')} chevron onPress={() => router.push('/settings/lyric-fonts')} />
          <SliderRow
            label={t('Lyrics size')}
            value={lyricsSize}
            min={LYRICS_SIZE_MIN}
            max={LYRICS_SIZE_MAX}
            step={1}
            formatValue={(value) => `${Math.round(value)}`}
            onChange={setLyricsSize}
          />
          <SelectList<LyricsWeight>
            label={t('Lyrics weight')}
            options={[
              { value: '300', label: t('Light font weight') },
              { value: '400', label: t('Regular font weight') },
              { value: '500', label: t('Medium font weight') },
              { value: '600', label: t('Semi-bold font weight') },
              { value: '700', label: t('Bold font weight') },
            ]}
            value={lyricsWeight}
            onChange={setLyricsWeight}
          />
          <SelectList<LyricsAlign>
            label={t('Lyrics alignment')}
            options={[
              { value: 'left', label: t('Left') },
              { value: 'center', label: t('Centered') },
            ]}
            value={lyricsAlign}
            onChange={setLyricsAlign}
          />
        </SettingsGroup>
        <SettingsGroup title={t('Background')}>
          <SwitchList
            options={[
              ...(Platform.OS === 'android'
                ? [
                    {
                      label: t('Blur inactive lyrics'),
                      description: t(
                        'Slightly blur synchronized lyrics other than the current line to emphasize what is playing.',
                      ),
                      value: blurInactiveLyrics,
                      onChange: setBlurInactiveLyrics,
                    },
                  ]
                : []),
              {
                label: t('Show lyrics card'),
                value: showLyricsCard,
                onChange: setShowLyricsCard,
              },
            ]}
          />
          <SelectList<ScreenBackground>
            label={t('Lyrics background')}
            options={[
              { value: 'none', label: t('Plain') },
              { value: 'color', label: t('Cover color') },
              { value: 'cover', label: t('Blurred cover') },
            ]}
            value={lyricsBackground}
            onChange={setLyricsBackground}
          />
          <SelectList<CardBackground>
            label={t('Lyrics card background')}
            options={[
              { value: 'none', label: t('Plain') },
              { value: 'color', label: t('Cover color') },
            ]}
            value={lyricsCardBackground}
            onChange={setLyricsCardBackground}
          />
        </SettingsGroup>
        <SettingsGroup title={t('Lyrics tools')}>
          <SettingRow label={t('Lyric sources')} chevron onPress={() => router.push('/settings/lyric-sources')} />
          <SettingRow label={t('Lyrics tools')} description={t('Timing, translation and lyric editing for the selected song.')}
            chevron onPress={() => router.push('/settings/lyrics-tools')} />
        </SettingsGroup>
      </DockScrollView>
    </SettingsPage>
  );
}
