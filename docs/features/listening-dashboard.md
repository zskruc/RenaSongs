# Listening dashboard / 聆听统计

Settings → Library & metadata → Listening statistics.

设置 → 曲库与元数据 → 听歌统计。

## What changed / 本次调整

The dashboard follows the information hierarchy of Primuse's Charts view:
period selection, four overview tiles, listening calendar, trend chart and
song/artist/album rankings. Recording preferences and counting notes live at
the bottom. The React Native implementation uses the app's existing local ledger
and theme; it adds no new native dependencies or background recording timers.

参考 Primuse 数据图表页的信息层级：时间范围、四格概览、收听日历、趋势图，
以及歌曲／艺人／专辑排行。记录开关与统计口径说明移到页尾。界面独立使用
React Native 实现，沿用原有本机记录、主题与玻璃参数，没有新增原生依赖或
后台记录定时器。

- Recent 7/30 days, a selected year or all recorded time; music, podcasts and
  audiobooks stay separate.
- Tap a day or chart column to inspect real recorded time and qualified plays.
- Rank by listening time or qualified plays. Top three are highlighted; up to
  thirty entries are available. Counts are aggregated over the complete range
  before the ranking limit is applied.
- Tap a song to play; artist/album entries with a known ID open their detail page.
- Average duration means average per **active** day. The calendar uses local dates.

支持近 7 天、近 30 天、指定年份和全部已记录时间；音乐、播客与有声书分别
统计。可点按日期和趋势图查看真实记录；排行支持按时长／有效播放次数排序，
突出前三名、最多展示三十项，完整范围汇总后才截取排行。歌曲可点按播放，
有来源编号的艺人和专辑可打开详情。平均时长按活跃日计算，日历使用本地日期。

## Data boundaries / 数据口径

Only real advancing playback is credited. Seeking/buffering and the qualification
threshold keep their previous behavior. Existing records are preserved, and the
server's lifetime counter remains a separate link. The ledger stores daily totals,
so hourly habits, exact event history, moods and music-personality reports are not
inferred. Missing artwork or identity uses an explicit placeholder; no ID is guessed.

继续按实际推进的播放时间计入，拖动、缓冲和有效播放门槛保持原有行为。
历史记录保留，服务器累计播放次数仍是单独入口。当前台账保存每日汇总，
不会据此推测小时分布、精确播放时间线、心情或音乐人格；无封面或来源编号时
使用明确的占位，不伪造编号。

Reference: [Primuse Charts view](https://github.com/chenqi92/primuse/blob/fdb1452f1e1b8e5972383889e40d33c52e0fd6ca/Primuse/Views/Settings/ListeningStatsChartsView.swift),
reviewed at `fdb1452f1e1b8e5972383889e40d33c52e0fd6ca`.
