# 菜单液态展开预览 / Native menu morph preview

Version: `0.8.8.1-preview.2` / Android code `181`.

Follow-up: `0.8.8.1-preview.3` / code `182`, under the new RenaSongs name.
The first physical preview exposed a material-space bug: scaling an already
sampled card image caused its background to stretch with the shell. The follow-up
removes that canvas transform. A fixed source-to-card capture envelope and a
menu-only material viewport place/draw the glass at its actual physical screen
rectangle on each frame; the RN/Yoga content layout remains fixed. Both bitmap
and RenderNode sampling paths keep the same screen origin. No WindowBackdrop
ownership policy or optical profile is changed.

Source: [expo-glass-custom-menu](https://github.com/rit3zh/expo-glass-custom-menu/tree/0021efd8ab0d068f155bbdac62c5f673ccc39a24),
MIT, revision `0021efd8ab0d068f155bbdac62c5f673ccc39a24`.
An independent checkout is kept locally outside this repository; no demo dependencies were installed.

## 范围 / Coverage

- 歌曲、专辑、歌单、艺人、播客菜单，以及通用 SheetModal 的排序／速度／质量等选项。
- 分享、艺人选择、添加到歌单、歌曲信息和输出设备窗口。
- 文本输入与确认框、颜色选择、设置下拉选择和精细调节面板。
- 歌单／电台编辑、添加播客、OPML 管理、更新下载面板。
- 登录的账号与语言选择、本机音乐来源、资料库排序、电台菜单。

These functional popups share a source-to-card morph. Full-screen navigation,
the player/lyrics expansion, dock folding, system document/share pickers and
full-screen artwork viewers keep their existing navigation/OS-specific behavior.
Ordinary action buttons do not acquire a popup merely to show the effect.

## 实现 / Implementation

The six upstream spring/geometry/field files are retained with package/import
substitutions and their MIT notice. Existing `ResonusLiquidGlass` exposes a
`MenuMorph` host. One fixed Fabric/Yoga card contains its unchanged glass material
as the first child and one non-collapsed interactive RN content container as the
second. Android advances the original default motion channels with Choreographer;
a bounded, reusable Gaussian contour clips the material, while content has its
own translation, zoom, blur and reveal. Settled hosts stop frame callbacks and
use a simple rounded clip. No new package, per-frame JS callback, page snapshot
loop or full-screen animation texture is introduced.

The visible native window must be attached, laid out and ready for pre-draw
before motion starts. Closing keeps the native window/content alive until the
native completion acknowledgement. Session identities reject late completions
after replacement/unmount, and repeated taps cannot commit an action twice.
Keyboard/accessibility/programmatic opens have a local fallback origin. Pointer
origins are consumed once, expire after 1.2 seconds and are invalidated by scroll,
navigation, account changes and backgrounding; no UI/event object is retained.

Android 12+ content blur is transient; older platforms retain spring/fade fallback
and the same exit lifecycle. Android's disabled-animation preference is respected
by the native spring. Material profiles, optical defaults, saved tuning and final
popup geometry remain the existing Resonus settings. This is an adaptation to
arbitrary RN content, not the entire upstream demo or Apple's private framework.

## 验证 / Validation

- Native Kotlin module compilation passed.
- JVM harness: 31,058 geometry, interruption/reversal and cadence checks at
  24/60/90/120/144 Hz, including bounded Gaussian contour generation.
- JS tests cover one-shot source capture, scrolling/expired origins, native
  readiness, retained close, rapid reopen, stale completion, callback-once,
  controlled dialogs, settings selectors and input preservation.
- Full repository regression, signed APK verification and physical Samsung
  checks are recorded in local build/device receipts. Harness cadences are not
  measurements of the actual phone's frame rate.

The stationary-material follow-up passes 32,741 JVM checks and a source contract
that verifies absence of a scaled/translated material canvas. Physical visual
verification is required separately; mathematical checks alone did not establish
that the initial preview looked correct.

### 183: match the missing rendering stages

`0.8.8.1-preview.4` fixes the mismatched nonglass source treatment: ordinary
buttons do not gain an extra glass lobe, and the material follows upstream
content-progress opacity. Trigger glyph capture/restoration is owned by one
presentation. The default trigger-origin trajectory, stable presentation grid,
duration scaling, and RenderNode foreground portal (continuous, scale-corrected
DECAL blur and lens shader) replace the incomplete initial bindings. Translation
and size observation are separated so a simple translation does not remeasure
the material subtree. Native checks now cover 32,849 cases.

Modal capture staging gives existing affected background-window owners a bounded
own-redraw allowance before temporarily changing source alpha. It neither clears
real dirty flags nor changes capture sources; genuine scrolling, scene and material
updates retain the existing guard. This addresses a cross-window capture feedback
path found during the physical frame-time investigation. The 182 baseline and
183 physical comparison are private local records, not screenshots or benchmarks
uploaded to the public repository.

本预览仅在本机构建，不推送 GitHub，不发布 Release。
