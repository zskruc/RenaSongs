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

### 184: remove blocking capture and bound transient filtering

The 183 physical run failed the performance gate. For a recognized single-card
scaffold, 184 records an acyclic Activity-plus-literal-scrim source without
submitting an offscreen GPU capture or recording the card itself. Generation,
scene, source, size and unique-owner checks protect that path; stacked or unknown
windows use the original guarded capture. Nested controls within one trusted
card share its source. Transient foreground filters use the actual shell region,
at most about 0.72 MP, with physical-coordinate mapping and equivalent Gaussian
variance; settled content returns to direct full-resolution drawing. The clock
advances with elapsed wall time. Safe selections now apply at tap time, separately
from retained exit cleanup; navigation, destructive/save and OS handoffs keep
their existing ownership-safe completion behavior.

### 185: remove discarded layers and allocation churn

The 184 physical preview still failed the motion/performance acceptance check.
Its trusted menu source avoided offscreen capture submission as intended, but
the trace showed expensive Vulkan image allocations and layer flushing. A menu
shadow was drawn into a large intermediate image and then discarded by the
outer morph clip; menu hosts now omit that pass without changing the saved
material profile or shadows on other controls. Foreground portal capacity and
sampling scale stay fixed during one presentation instead of following each
frame's dimensions. The original spring channels and physical field mapping
are retained.

The current physical morph radius also supplies the menu-only material shape.
Kyant's lens and highlight use that same CornerBasedShape instead of a fixed
resting radius. The original resting radius, refraction height and refraction
amount remain unchanged; no second refraction-strength track is introduced.

Ordinary popups submit readiness with the open/session/source state. Native
attachment, visible-window, pre-draw and positive-child-size checks still gate
the first frame. Content-measured selectors retain their explicit size gate.
The upstream demo also accepts JavaScript open requests; its already-attached
native overlay avoids the additional Modal readiness exchange used here.

Physical performance receipts are separate from build and unit-test receipts;
a successful build is not treated as evidence of smooth animation.

### 186: bound material raster work and group-opacity layers

The 185 physical run reduced GPU time but still failed overall frame-time and
user acceptance. Its RenderThread continued allocating filtered intermediate
images; the UI thread spent most traversal time waiting for that work. Ordinary
view group opacity could also promote the full native material/body bounds to
hardware layers before the foreground portal's downsample.

Menu-only transient material drawing now uses one reserved raster scale. The
native viewport, Compose density, material-layer capacity, Gaussian radius and
backdrop recording share the same physical-to-raster transform. Float placement
remainders compensate integer layout rounding; ceil only reserves transparent
capacity and never fits/stretches the source image. Material group opacity is
applied to the bounded Compose child, and body opacity to the bounded portal
rows node. Open-and-settled drawing restores the original full resolution;
closed invisible hosts do not allocate that final full-size layer. Saved glass
profiles and non-menu drawing keep their original behavior.

Offline checks include 131,051 motion/geometry assertions, 15,213 portal checks,
and 9,901 material mapping checks with 3,240 high-contrast checkerboard samples.
They establish transform/resource invariants, not measured Samsung frame rate.
The user deferred further physical testing until after receiving this APK.

Known lifecycle difference: these are retained RN Modal windows. Unlike the
demo's in-window overlay, a closing transparent Modal continues to own input
until its native close acknowledgement. Changing that safely requires a
separate input/session handoff review; the current candidate does not silently
enable cross-window touch-through or shorten the original spring.

### 187: commit material resolution changes atomically

The 186 physical recording exposed an integration regression missed by the
static coordinate checks: native inverse scaling, Compose density/layout and
the source recording could update in different frames. The album-menu incident
also demonstrated persistent displacement when unchanged Yoga specifications
allowed Android to skip the native child layout. The old inverse scale could
remain while Compose had already returned to full-resolution drawing.

Native ComposeView bounds now remain in physical coordinates with identity
scale and opacity. A captured immutable epoch owns the inner raster constraints,
density, capacity, blur, source conversion and inverse composition scale.
Source placement uses committed physical offsets. A still-displayed old epoch
retains all of its transforms until the next complete composition is applied;
there is no screenshot freeze or new capture pipeline. Initial/changed native
viewports are established directly rather than relying on an identical parent
measure/layout pass to run again.

Additional temporal tests delay composition, skip native layouts, reverse
requests and reuse scale values. Negative controls reproduce the old mixed
scale and the incident's approximately (465,965) glass position. Source wiring
checks complement the mathematical cases; they do not replace physical visual
confirmation. The 186 frame-time recording is not evidence of 187 performance.


### 188: restore selection gestures and release rebound

The previous port included the upstream open/close motion but omitted its
menu-interaction layer. This follow-up ports `GlassJelly` at the pinned upstream
defaults, with finite, explicitly registered action bounds. The same live
rectangle drives the material, liquid outline, foreground portal and RN body;
the captured page remains fixed in screen coordinates. Press lighting is
transient and does not change the stored material recipe.

Settings dropdowns, sort/direction/column choices, speed chips, ordinary menu
actions, route/artist choices and confirmation buttons without text input
support hold-and-drag selection, a spring-driven highlight and release rebound.
Grid choices use their actual two-dimensional bounds. The native descriptor
list is capped at 256; additional mounted rows retain guarded ordinary presses. Input fields, sliders and scrollable lists keep their normal
interaction. Disabled choices cannot commit, and one native gesture cannot run
both a native selection and the original RN action. Session changes reject stale
selections and release retained gesture resources. Scroll/window clipping is
checked at press and selection, and multiple fingers cancel the selection.
Async lookup failures keep their original menu usable for retry. Closing releases the existing
Jelly state instead of resetting it before the absorption spring can draw it.
The three document/export handoffs that bypassed retained closing now wait for
the native exit acknowledgement before opening an OS window.

The 187 physical-coordinate raster epoch and bounded transient filtering remain
in place. Source/default-parameter parity, gesture/lifecycle checks and real
Samsung observations are recorded separately; automated checks do not establish
that this adaptation exactly matches the demo on every RN popup.

本预览仅在本机构建，不推送 GitHub，不发布 Release。
