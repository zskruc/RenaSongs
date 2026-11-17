# Upstream selective adaptation / 上游选择性适配

Candidate: **0.8.8.1-preview.1**, Android **180**.
Glass starting point: `1b3caf58ddc1867065bc10420e55d5cbe941db77`.
Reviewed upstream: `abcdd8d2e51c917c20a708cfb1ed7ed18b7cabaa` / release `v0.8.8`.

The user approved four fixes and both optional groups from the November 17
review. This is a selective adaptation, not a complete merge of upstream 0.8.8.
Current page layouts, player geometry, saved glass tuning, metadata overlays and
existing downloads remain the integration baseline.

## Sources / 来源

| Area | Upstream source |
| --- | --- |
| Player snapshots | [#349](https://github.com/juananzzz/resonus/pull/349), `6266a51804` |
| Daily favorite-podcast refresh | [#350](https://github.com/juananzzz/resonus/pull/350), `18a5829f3a`, subsequent single-pass fix `ed1cb0be1e` |
| Offline genre guards | [#341](https://github.com/juananzzz/resonus/pull/341), `9b9433c684` |
| Download-removal feedback | [#339](https://github.com/juananzzz/resonus/pull/339), `9c2a32cf4a`, `35b3b114e1`, `b601ece3e8` |
| Standalone local music | `cef865c807`, [#347](https://github.com/juananzzz/resonus/pull/347), `ea335da88e`, follow-up `7706365f04` |
| Jukebox continuation | [#333](https://github.com/juananzzz/resonus/issues/333), `51029c6932` |

## Scope and limits / 范围与边界

- Daily podcast checks run on startup/foreground use, not from a new periodic
  background service. Favorite shows covered by the existing six-hour
  auto-download refresh do not need a second daily read.
- Local-music scanning applies to device audio and user-granted SAF folders.
  It does not rescan or replace a Navidrome account's downloaded-file catalog,
  rewrite NAS metadata, or speed up server playlist queries.
- Folder images are fallbacks for local files; app-local manual artwork and the
  existing artist-artwork pipeline retain their own priorities. M3U discovery
  complements the current import/export tools instead of adding another importer.
- Jukebox follows the upstream bounded continuation window: the server receives
  the current song and up to twenty subsequent compatible, non-repeated library
  tracks. It can advance through that window while mobile JavaScript is
  suspended. Repeat-one, end-of-song timers, local audio, URL media and duplicate
  identities can shorten the window. This is not unlimited autonomous playback
  after the phone is suspended or terminated.
- Jukebox uses a single-controller session. The server API has no conditional
  queue mutation, and ordinary status replies carry indices rather than song
  identities. Replies are checked/rebased around edits, but concurrent changes
  from another client are not an atomic multi-controller synchronization contract.
- Download feedback must not equate an indexed item count with verified bytes
  physically reclaimed. Paused/cancelled transfers, profile changes and failed
  operations must not produce a stale success toast.
- PRs #329, #344, #346 and #356 are not included as whole replacements. Glass
  already has its own download deduplication, complete podcast-body deadline,
  settings search, offline outbox and background-power fixes.

## Validation / 验证

- Full JavaScript/TypeScript suite: **2,065 passed**, no failed, cancelled,
  skipped or TODO cases; Navidrome canonical-ID checks passed.
- TypeScript and translation/generated-context checks passed. Production-source
  ESLint: **0 errors, 157 warnings**. A broader all-source check also reached an
  unchanged `react/display-name` error in the pre-existing podcast UI test; it is
  recorded separately rather than represented as a warning-free repository.
- Android release Kotlin compilation passed. All 25 patched audio files are
  byte-identical to the previous accepted build; reverse patch checks passed for
  all six patched dependency packages. No dependency reinstall is needed by the
  final build path. During initial checks, the package-manager wrapper attempted
  an implicit install; affected audio files were restored from hash-verified
  local copies, then every dependency patch was checked again.
- New regressions exercise production player snapshots, server-driven Jukebox
  progression and stale commands, podcast daily/six-hour due times and account
  cancellation, download counts and stale feedback, complete SAF walks, retained
  artwork on copy failure, incremental and empty-folder scans, and serialized
  M3U import/export alongside existing playlist edits.
- Cross-review identified and corrected upstream edge cases: relative M3U files
  in separate directories are distinct; automatic import cannot overwrite a
  concurrent accepted playlist edit; external account ownership is checked
  through native scan I/O before publishing covers and catalog state.

Final APK packaging and byte-level artifact verification follow these checks.
Device testing is deferred at the user's request; no Samsung installation,
settings changes, GitHub push or Release publication is part of this task.
