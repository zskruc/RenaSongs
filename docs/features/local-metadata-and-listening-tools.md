# Local metadata and listening tools / 本地元数据与聆听工具

This preview keeps the current screen layouts and saved glass settings. Metadata,
artwork, descriptions and lyric edits are app-owned overlays. It does not write
ID3/Vorbis tags, sidecars or audio back to Navidrome, NAS shares or original local
music documents. Existing manual server actions such as favorites and playlist
editing retain their normal behavior.

此预览版保留现有布局与玻璃参数。刮削结果、封面、简介与歌词修改只保存在
App 内，不写回 Navidrome、NAS 共享目录或原始音乐文件。原有收藏、编辑歌单等
明确的服务器操作仍保持原来的行为。

## Entry points / 入口

Settings → Music tools and customization → Metadata centre. To choose a target,
use a song, album or artist menu → Metadata and local artwork / Find metadata for
this song. Review candidates before applying individual fields. Source settings
and pending tasks are available even when no target is selected.

设置 → 音乐工具与自定义 → 元数据中心。先在歌曲、专辑或艺人菜单选择目标，
再搜索候选、检查版本与逐字段应用。来源配置和任务列表可直接从设置管理。

Album, artist and playlist menus also offer **Batch scrape metadata**, which opens
one shared chooser with the entity identity. Opening the chooser does not fetch
an entire discography first. The separate **Metadata and local artwork** entry
still opens the album/artist artwork and sourced description tools directly.
Song-list multi-select menus offer **Scrape selected songs**. Their complete unique
song IDs are handed to the chooser in app memory, rather than embedded in a long
URL or truncated to the first 1,000. A replaced selection, account/source change
or app restart retires the previous handoff; failed task creation can keep the
current selection for retry.

专辑、艺人和播放列表菜单新增“批量刮削元数据”，统一进入批量选择页面；
打开页面时只传递目标身份，不先加载整套唱片目录。原有“元数据与本地封面”
仍可直接进入专辑／艺人的本地封面和来源简介工具。歌曲列表的多选菜单新增
“刮削所选歌曲”，完整去重后的歌曲编号通过本次 App 会话传递，不塞入长链接，
也不截取前 1,000 首。重新选择、切换账号／来源或重启 App 后旧选择失效；
任务创建失败时可保留当前选择重试。

- iTunes and MusicBrainz: recording/release candidates, artwork and release reconciliation.
- LRCLIB, AMLL TTML and custom endpoints: selectable lyric candidates.
- MusicBrainz/Wikipedia: sourced artist/album text, with provenance.
- Custom JSON configuration: preview domains, requests and scripts before enabling;
  credentials live in secure storage and are excluded from exported configurations.
- Batch work: app-local checkpoints, pause/cancel/retry; accepted manual edits are
  protected against stale apply/undo. Background protection is shared with downloads
  using independent leases. It does not start unattended library scraping.
- GIF/WebP: original bytes are retained; animation uses the existing player policy.
- Local backup includes source configurations and selected artwork within a bounded
  archive. Omitted images are listed; audio and credentials are excluded.

## Thirteen optional features / 十三项可选功能

| Feature / 功能 | Entry / 入口 |
|---|---|
| Native A–B repeat / 原生区间循环 | Song/player menu or Music tools / 歌曲菜单或音乐工具 |
| Publisher transcripts / 发布者逐字稿 | Episode details → Read transcript in app; also lyrics while playing / 单集详情、播放时歌词页 |
| Local loudness analysis / 本地响度分析 | Music tools → Local loudness analysis / 音乐工具 → 本地响度分析 |
| Shared HTTP cooldown / 共享请求冷却 | Automatic for podcast and Apple discovery reads / 播客与 Apple 发现请求自动使用 |
| Advanced AND/OR smart rules / 高级智能歌单规则 | Settings → Smart playlists / 设置 → 智能歌单 |
| Recently deleted / 最近删除 | Music tools → Recently deleted / 音乐工具 → 最近删除 |
| Chosen animated artwork / 自选动态封面 | Target → Local artwork / 目标 → 本地封面 |
| Offline translation / 离线歌词翻译 | Lyrics tools → Offline lyric translation / 歌词工具 → 离线歌词翻译 |
| Word alignment / 逐字时间对齐 | Lyrics tools → Align lyric words / 歌词工具 → 歌词逐字对齐 |
| CUE virtual tracks / CUE 分轨 | Music tools → CUE virtual tracks / 音乐工具 → CUE 分轨播放 |
| Local podcast groups / 本机音频按播客分组 | Set local content type to Podcast, then Local podcasts / 将本地内容类型设为播客后打开本机播客 |
| Android Auto podcasts / 车载播客 | Android Auto → Podcasts, paged device catalog / Android Auto → 播客 |
| Separate spoken statistics / 区分音乐、播客与有声书统计 | Listening statistics → Content statistics / 聆听统计 → 内容统计 |

Loudness analysis only reads already local/downloaded audio. It is foreground-only,
cancellable and opt-in. Existing valid ReplayGain gain tags take priority; newly
analyzed values apply on the next source start so the current volume stays stable.
CUE imports copy user-selected audio into app storage without splitting the
original file. Physical CUE bounds are applied to both current and queued sources;
lyrics and visible playback positions are relative to each virtual track.

响度分析只读取已下载或本机音频，需主动启用，退到后台会停止。有效的原有
ReplayGain 标签优先；新分析结果在下次开始播放时生效，避免当前歌曲突然变音量。
CUE 导入会复制用户选定的音频，不分割原文件；播放、队列和歌词按每条分轨计时。

### Translation and alignment / 翻译与对齐

Offline translation uses Google ML Kit. Download the selected language models
explicitly over Wi-Fi once. Lyrics are processed on-device; the official Google
Translate attribution stays with generated translations. Model downloads need
Google's model service to be reachable. Cancelling stops the app workflow, but
Google's SDK does not expose a model-download network cancellation token.

离线翻译使用 Google ML Kit。首次需主动下载语言模型，之后可在本机翻译；
模型下载要求对应服务可达。取消会停止本次 App 工作流程，但 SDK 无法保证
已开始的模型网络传输立即停止。

Word alignment has a working client for a **user-configured compatible service**;
it does not reuse Primuse's private relay or account rights. No endpoint is
preconfigured. Only an explicit upload action sends the selected, bounded local
WAV audio and lyric text. Review the result and apply it locally. Without a
compatible service, the alignment screen can be configured but cannot produce
new timings.

逐字对齐使用用户自行配置的兼容服务，没有预置 Primuse 的私有服务或账号权限。
只有点击上传时才发送选定音频和歌词；结果须预览后应用。未配置可用服务时，
客户端可设置，但无法生成新时间轴。

Request: JSON POST with optional Bearer token, `audio_base64` (mono PCM16 WAV,
16 kHz, at most ten minutes), `mime_type: "audio/wav"`, `language`, and `lines`
containing stable line IDs, indexes, text and allowed time windows. The response
must preserve every line's identity/order/text and return ordered, bounded word
times. JSON and a completed SSE/NDJSON result are accepted. Incomplete, altered,
out-of-window or oversized output is rejected. Audio identity is checked before
preparation and before the result is committed; temporary audio is cleaned on
success, failure, cancellation and late completion.

## Upstream scope / 上游范围

Only the four approved adaptations are included: offline outbox persistence and
retry ownership; shuffle-disable queue edit retention plus remote listen state;
external Next/Previous capabilities; Android APP_MUSIC intent category.
Jukebox queue changes and other upstream PRs are excluded from this preview.

仅适配本轮批准的四项上游更新：离线队列持久化与重试归属、关闭随机时保留
队列编辑及远程播放计数、外部上一首/下一首能力、APP_MUSIC 系统分类。
