/** Settings › Player: looks and extras for the playback screen. */
import { DockScrollView } from '@/components/DockScrollView';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { usePlayerGlass } from '@/store/playerGlass';
import { type PlayerGlassRecipe } from '@/theme/playerGlassRecipes';
import { useToast } from '@/store/toast';

import { canBlurBars } from '@/components/BarBlur';
import {
  SelectList,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  settingsStyles,
  SwitchList,
} from '@/components/SettingsUI';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useTheme } from '@/theme';
import {
  type PlayerPresentation,
  type CoverDoubleTapAction,
  type CoverTapAction,
  type MiniPlayerButtons,
  type ScreenBackground,
  type PreviousButtonMode,
  useSettings,
} from '@/store/settings';

/**
 * The cover's actions, the same list for one tap and for two.
 *
 * Which of them belongs on which tap is the listener's call: play/pause on the
 * single and the lyrics on the double is as reasonable as the other way round.
 */
function coverTapOptions(t: ReturnType<typeof useT>): { value: CoverTapAction; label: string }[] {
  return [
    { value: 'none', label: t('Nothing') },
    { value: 'screen', label: t('Open lyrics screen') },
    { value: 'inline', label: t('Show lyrics on the cover') },
    { value: 'album', label: t('Go to album') },
    { value: 'playPause', label: t('Play or pause') },
    { value: 'favorite', label: t('Add to favorites') },
  ];
}

// Stable search links from earlier versions still open the moved lyric control.
const LEGACY_LYRIC_ANCHORS = new Set([
  'Lyrics source', 'Lyrics size', 'Lyrics weight', 'Lyrics alignment',
  'Blur inactive lyrics', 'Show lyrics card', 'Lyrics background', 'Lyrics card background',
]);

export default function PlayerSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const toast = useToast((state) => state.show);
  const glassRecipe = usePlayerGlass((state) => state.recipe);
  const setGlassRecipe = usePlayerGlass((state) => state.setRecipe);
  useEffect(() => { void usePlayerGlass.getState().hydrate(); }, []);
  const playerPresentation = useSettings((state) => state.playerPresentation);
  const setPlayerPresentation = useSettings((state) => state.setPlayerPresentation);
  const showSystemVolume = useSettings((state) => state.showSystemVolume);
  const setShowSystemVolume = useSettings((state) => state.setShowSystemVolume);
  const showOutputDevice = useSettings((state) => state.showOutputDevice);
  const setShowOutputDevice = useSettings((state) => state.setShowOutputDevice);
  const playerArtworkPalette = useSettings((state) => state.playerArtworkPalette);
  const setPlayerArtworkPalette = useSettings((state) => state.setPlayerArtworkPalette);
  const router = useRouter();
  const params = useLocalSearchParams<{ setting?: string; settingVisit?: string }>();
  // Rating is a Subsonic thing: needs a server account and doesn't apply to
  // Jellyfin. It does work offline (queued in the outbox and uploaded on
  // reconnect), so its toggle is also shown offline, same as in the player.
  const hasAccount = useAuthStore((s) => !!s.auth);
  const local = useLocalProfile();
  const serverType = useAuthStore((s) => s.auth?.serverType);
  const canRate = hasAccount && serverType !== 'jellyfin';
  const showAudioQuality = useSettings((s) => s.showAudioQuality);
  const setShowAudioQuality = useSettings((s) => s.setShowAudioQuality);
  const showRating = useSettings((s) => s.showRating);
  const setShowRating = useSettings((s) => s.setShowRating);
  const showAlbumInfo = useSettings((s) => s.showAlbumInfo);
  const setShowAlbumInfo = useSettings((s) => s.setShowAlbumInfo);
  const swapPlayerButtons = useSettings((s) => s.swapPlayerButtons);
  const setSwapPlayerButtons = useSettings((s) => s.setSwapPlayerButtons);
  const showPlayedInQueue = useSettings((s) => s.showPlayedInQueue);
  const setShowPlayedInQueue = useSettings((s) => s.setShowPlayedInQueue);
  const playerBackground = useSettings((s) => s.playerBackground);
  const setPlayerBackground = useSettings((s) => s.setPlayerBackground);
  const fitCoverArt = useSettings((s) => s.fitCoverArt);
  const setFitCoverArt = useSettings((s) => s.setFitCoverArt);
  const animatedCoverBackground = useSettings((s) => s.animatedCoverBackground);
  const setAnimatedCoverBackground = useSettings((s) => s.setAnimatedCoverBackground);
  const blurMiniPlayer = useSettings((s) => s.blurMiniPlayer);
  const miniPlayerButtons = useSettings((s) => s.miniPlayerButtons);
  const setMiniPlayerButtons = useSettings((s) => s.setMiniPlayerButtons);
  const setBlurMiniPlayer = useSettings((s) => s.setBlurMiniPlayer);
  const showArtistCard = useSettings((s) => s.showArtistCard);
  const setShowArtistCard = useSettings((s) => s.setShowArtistCard);
  const coverTapAction = useSettings((s) => s.coverTapAction);
  const coverDoubleTapAction = useSettings((s) => s.coverDoubleTapAction);
  const setCoverDoubleTapAction = useSettings((s) => s.setCoverDoubleTapAction);
  const setCoverTapAction = useSettings((s) => s.setCoverTapAction);
  const marqueeTitles = useSettings((s) => s.marqueeTitles);
  const setMarqueeTitles = useSettings((s) => s.setMarqueeTitles);
  const seekButtonsSec = useSettings((s) => s.seekButtonsSec);
  const setSeekButtonsSec = useSettings((s) => s.setSeekButtonsSec);
  const previousButtonMode = useSettings((s) => s.previousButtonMode);
  const setPreviousButtonMode = useSettings((s) => s.setPreviousButtonMode);
  const keepPausedOnSkip = useSettings((s) => s.keepPausedOnSkip);
  const setKeepPausedOnSkip = useSettings((s) => s.setKeepPausedOnSkip);

  const legacyTool = params.setting ? ({ 'Lyrics tools': '/settings/lyrics-tools', 'Long audio and bookmarks': '/settings/long-audio', 'Shuffle preference': '/settings/shuffle', 'Skip leading and trailing silence': '/settings/silence-trim' } as Record<string, string>)[params.setting] : undefined;
  if (legacyTool) return <Redirect href={legacyTool} />;
  if (params.setting && LEGACY_LYRIC_ANCHORS.has(params.setting)) {
    return <Redirect href={{ pathname: '/settings/lyrics', params: { setting: params.setting, settingVisit: params.settingVisit } }} />;
  }

  return (
    <SettingsPage title={t('Player & lyrics')}>
      <DockScrollView contentContainerStyle={settingsStyles.content}>
        <SettingsGroup title={t('Lyrics')}>
          <SettingRow label={t('Lyrics')} description={t('Sources, fonts, blur and lyric backgrounds.')}
            chevron onPress={() => router.push('/settings/lyrics')} />
        </SettingsGroup>
        <SettingsGroup title={t('Player appearance')} description={t('AMLL uses a shared cover transition, full-page lyrics and an artwork mesh background. Your previous player remains available.')}>
          <SelectList<PlayerPresentation> label={t('Player layout')}
            options={[{ value: 'amll', label: t('AMLL reference') }, { value: 'resonus', label: t('Resonus layout') }]}
            value={playerPresentation} onChange={setPlayerPresentation} />
          <SelectList<ScreenBackground>
            label={t('Player background')}
            options={[
              { value: 'none', label: t('Plain') },
              { value: 'color', label: t('Cover color') },
              { value: 'cover', label: t('Blurred cover') },
            ]}
            value={playerBackground} onChange={setPlayerBackground}
          />
          <SwitchList options={[
            { label: t('Artwork palette in full player'), value: playerArtworkPalette, onChange: setPlayerArtworkPalette },
          ]} />
          <SelectList<PlayerGlassRecipe>
            label={t('Floating popup glass')}
            description={t('Popup presets keep their reference blur. Artwork colors affect only the full player, never the mini player or tabs.')}
            options={[
              { value: 'dock', label: t('Same as bottom bar') },
              { value: 'menu', label: t('Same as More menu') },
              { value: 'clear', label: t('Untinted glass') },
              { value: 'original', label: t('Previous appearance') },
            ]}
            value={glassRecipe}
            onChange={(value) => { void setGlassRecipe(value).catch(() => toast(t("Couldn't complete the action"))); }}
          />
        </SettingsGroup>
        <SettingsGroup title={t('Mini player')}>
          <SwitchList
            options={[
              // Android draws the blur from Android 12 on (see `BarBlur`).
              ...(canBlurBars
                ? [
                    {
                      label: t('Mini player blur'),
                      value: blurMiniPlayer,
                      onChange: setBlurMiniPlayer,
                    },
                  ]
                : []),
            ]}
          />
          <SelectList<MiniPlayerButtons>
            label={t('Buttons next to play')}
            options={[
              { value: 'favorite', label: t('Favorite') },
              { value: 'next', label: t('Next') },
              { value: 'previousNext', label: t('Previous and next') },
              { value: 'none', label: t('None') },
            ]}
            value={miniPlayerButtons}
            onChange={setMiniPlayerButtons}
          />
        </SettingsGroup>

        <SettingsGroup title={t('Cover art')}>
          <SwitchList
            options={[
              {
                label: t('Fit cover art'),
                value: fitCoverArt,
                onChange: setFitCoverArt,
              },
              {
                label: t('Animated cover background'),
                value: animatedCoverBackground,
                onChange: setAnimatedCoverBackground,
              },
            ]}
          />
          <SelectList<CoverTapAction>
            label={t('On cover tap')}
            options={coverTapOptions(t)}
            value={coverTapAction}
            onChange={setCoverTapAction}
          />
          <SelectList<CoverDoubleTapAction>
            label={t('On cover double tap')}
            options={coverTapOptions(t)}
            value={coverDoubleTapAction}
            onChange={setCoverDoubleTapAction}
          />
        </SettingsGroup>

        <SettingsGroup title={t('Elements')}>
        <SwitchList
          options={[
            { label: t('Show system volume'), value: showSystemVolume, onChange: setShowSystemVolume },
            { label: t('Show output device name'), value: showOutputDevice, onChange: setShowOutputDevice },
            {
              label: t('Show album & year'),
              value: showAlbumInfo,
              onChange: setShowAlbumInfo,
            },
            {
              label: t('Show quality label'),
              value: showAudioQuality,
              onChange: setShowAudioQuality,
            },
            ...(canRate
              ? [
                  {
                    label: t('Show rating'),
                    value: showRating,
                    onChange: setShowRating,
                  },
                ]
              : []),
            {
              label: t('Scroll long titles'),
              value: marqueeTitles,
              onChange: setMarqueeTitles,
            },
            // The biography comes from the server, and the local profile has
            // none to come: the row goes rather than staying dead.
            ...(local
              ? []
              : [
                  {
                    label: t('Show artist card'),
                    value: showArtistCard,
                    onChange: setShowArtistCard,
                  },
                ]),
          ]}
        />
        </SettingsGroup>

        <SettingsGroup title={t('Queue')}>
        <SwitchList
          options={[
            {
              label: t('Show previous tracks'),
              value: showPlayedInQueue,
              onChange: setShowPlayedInQueue,
            },
          ]}
        />
        </SettingsGroup>

        <SettingsGroup title={t('Buttons')}>
          <SettingRow
            label={t('Bottom row')}
            chevron
            onPress={() => router.push('/settings/player-buttons')}
          />
          <SwitchList
            options={[
              {
                label: t('Swap favorite and menu'),
                value: swapPlayerButtons,
                onChange: setSwapPlayerButtons,
              },
            ]}
          />
          <SelectList
            label={t('Skip buttons')}
            options={[
              { value: 0, label: t('No') },
              { value: 5, label: '5 s' },
              { value: 10, label: '10 s' },
              { value: 30, label: '30 s' },
            ]}
            value={seekButtonsSec}
            onChange={setSeekButtonsSec}
          />
          {/* With the skip buttons rather than with the queue: it is about what
              ⏭ and ⏮ do, and about the swipe across the cover, which is the same
              thing with a finger. */}
          <SwitchList
            options={[
              {
                label: t('Keep paused when skipping'),
                value: keepPausedOnSkip,
                onChange: setKeepPausedOnSkip,
              },
            ]}
          />
          <SelectList<PreviousButtonMode>
            label={t('Previous button')}
            options={[
              { value: 'restart', label: t('Restart, then previous track') },
              { value: 'always', label: t('Always previous track') },
            ]}
            value={previousButtonMode}
            onChange={setPreviousButtonMode}
          />
        </SettingsGroup>

      </DockScrollView>
    </SettingsPage>
  );
}
