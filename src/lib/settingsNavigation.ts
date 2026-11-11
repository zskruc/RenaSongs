/** Settings information architecture. Routes stay stable when a control moves. */
export type SettingsDestination = {
  route: string;
  title: string;
  description?: string;
  icon: string;
  serverOnly?: boolean;
  library?: boolean;
};
export type SettingsNavigationGroup = { title: string; description?: string; rows: readonly SettingsDestination[] };

export const SETTINGS_HOME_GROUPS: readonly SettingsNavigationGroup[] = [
  { title: 'Listening', rows: [
    { route: '/settings/playback', title: 'Playback & sound', description: 'Audio quality, equalizer and playback behavior', icon: 'musical-notes-outline' },
    { route: '/settings/player', title: 'Player & lyrics', description: 'Player controls, mini player and lyric display', icon: 'play-circle-outline' },
    { route: '/settings/longform', title: 'Podcasts & long audio', description: 'Podcasts, audiobooks, bookmarks and chapters', icon: 'mic-outline' },
  ] },
  { title: 'Interface & library', rows: [
    { route: '/settings/personalization', title: 'Appearance & layout', description: 'Theme, glass, text and page layouts', icon: 'color-palette-outline' },
    { route: '/settings/music-tools', title: 'Library & metadata', description: 'Library sources, organization and local metadata', icon: 'library-outline' },
  ] },
  { title: 'Storage & maintenance', rows: [
    { route: '/settings/storage', title: 'Downloads & storage', description: 'Download queues, offline files and cache', icon: 'download-outline' },
    { route: '/settings/data-tools', title: 'Backup & transfer', description: 'Backups, imports, transfers and recovery', icon: 'archive-outline' },
    { route: '/settings/about', title: 'About & diagnostics', description: 'Version, updates, help and troubleshooting', icon: 'information-circle-outline' },
  ] },
];

export const SETTINGS_CATEGORY_PAGES = {
  library: {
    title: 'Library & metadata',
    description: 'Manage where music comes from, organize your collection and enrich its information.',
    groups: [
      { title: 'Library sources & search', rows: [
        { route: '/settings/library', title: 'Library', description: 'Server libraries, scanning and local music', icon: 'server-outline', library: true },
        { route: '/settings/music-search', title: 'Music search index', description: 'Pinyin search and local search indexing', icon: 'search-outline' },
      ] },
      { title: 'Metadata & lyrics', description: 'Metadata edits and scraping results are saved in this app.', rows: [
        { route: '/metadata', title: 'Metadata centre', description: 'Scrape music, review matches and manage sources', icon: 'document-text-outline' },
        { route: '/settings/local-customizations', title: 'Local edits and artist aliases', icon: 'create-outline' },
        { route: '/cue-import', title: 'CUE virtual tracks', icon: 'disc-outline' },
      ] },
      { title: 'Organize & explore', rows: [
        { route: '/settings/smart-playlists', title: 'Smart playlists', icon: 'sparkles-outline' },
        { route: '/settings/duplicates', title: 'Duplicate songs', icon: 'copy-outline' },
        { route: '/media-collections', title: 'Media folders and tags', icon: 'folder-outline' },
        { route: '/settings/listening-stats', title: 'Listening statistics', icon: 'stats-chart-outline' },
      ] },
    ],
  },
  longform: {
    title: 'Podcasts & long audio',
    description: 'Keep spoken audio, saved positions and listening sessions together.',
    groups: [
      { title: 'Podcasts', rows: [
        { route: '/local-podcasts', title: 'Local podcasts', icon: 'mic-outline' },
        { route: '/settings/podcast-storage', title: 'Podcast storage', description: 'Audio, artwork, catalog and automatic cleanup', icon: 'file-tray-outline' },
      ] },
      { title: 'Audiobooks & chapters', rows: [
        { route: '/settings/audiobooks', title: 'Audiobooks', icon: 'book-outline' },
        { route: '/settings/long-audio', title: 'Long audio and bookmarks', icon: 'bookmark-outline' },
        { route: '/settings/chapters', title: 'Local chapters', icon: 'list-outline' },
      ] },
      { title: 'Listening sessions', rows: [
        { route: '/settings/listening-tools', title: 'Listening sessions', description: 'Continue music, podcasts, radio and audiobooks separately', icon: 'headset-outline' },
        { route: '/listening-intents', title: 'Listening scenes', icon: 'sunny-outline' },
        { route: '/radio-discover', title: 'Discover internet radio', icon: 'radio-outline' },
      ] },
    ],
  },
  storage: {
    title: 'Downloads & storage',
    description: 'See active tasks, choose download rules and manage space on this device.',
    groups: [
      { title: 'Active tasks', rows: [
        { route: '/settings/download-manager', title: 'Download manager', description: 'Song progress, pause, resume and cancel', icon: 'download-outline', serverOnly: true },
        { route: '/settings/media-cache', title: 'Bulk artwork & lyrics', description: 'Cache artwork and lyrics across your entire library.', icon: 'images-outline' },
      ] },
      { title: 'Download & offline rules', rows: [
        { route: '/settings/downloads', title: 'Downloads & offline', description: 'Quality, concurrency, Wi-Fi and offline behavior', icon: 'cloud-offline-outline', serverOnly: true },
        { route: '/settings/podcast-storage', title: 'Podcast storage', description: 'Audio, artwork, catalog and automatic cleanup', icon: 'mic-outline' },
      ] },
      { title: 'Storage cleanup', rows: [
        { route: '/settings/cache', title: 'Cached songs', description: 'Review and clear automatically cached music', icon: 'file-tray-outline' },
      ] },
    ],
  },
  data: {
    title: 'Backup & transfer',
    description: 'Back up your personal data, move music and recover changes in one place.',
    groups: [
      { title: 'Backup & restore', rows: [
        { route: '/settings/personal-backup', title: 'Personal backup and restore', description: 'Playlists, favorites, ratings and personal data', icon: 'archive-outline' },
        { route: '/settings/preferences-file', title: 'Settings backup & reset', description: 'Export, import or restore app preferences', icon: 'options-outline' },
      ] },
      { title: 'Import, export & transfer', rows: [
        { route: '/settings/playlist-exchange', title: 'Playlist import and export', icon: 'swap-horizontal-outline' },
        { route: '/settings/wifi-transfer', title: 'Wi-Fi music transfer', icon: 'wifi-outline' },
      ] },
      { title: 'Recovery & pending changes', rows: [
        { route: '/settings/pending-marks', title: 'Pending favorites and ratings', icon: 'cloud-upload-outline' },
        { route: '/settings/playlist-recovery', title: 'Playlist recovery', icon: 'refresh-outline' },
        { route: '/settings/recently-deleted', title: 'Recently deleted', icon: 'trash-outline' },
      ] },
    ],
  },
} satisfies Record<string, { title: string; description: string; groups: readonly SettingsNavigationGroup[] }>;
