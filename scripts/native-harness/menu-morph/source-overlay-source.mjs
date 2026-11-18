import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = new URL('../../../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', import.meta.url);
const host = readFileSync(new URL('MenuMorphView.kt', native), 'utf8');
const source = readFileSync(new URL('MenuTriggerSnapshot.kt', native), 'utf8');
const measurement = host.slice(host.indexOf('internal fun measureMenuOrigin('));
assert.doesNotMatch(measurement, /MenuTriggerSnapshots\.(?:register|take)\s*\(/,
  'Generic origin measurement must remain read-only and cannot authorize hiding a source');
assert.ok(host.includes('menuSourceTag(rect?.getOrNull(5))') && host.includes('takeIf { it.id == tag }') &&
  host.includes('MenuTriggerSnapshots.take(source, sourceView)'),
  'Only an explicit validated source tag resolved synchronously to the same native View may own a clone');
assert.ok(source.includes('interactiveCount(view, 0) > 1') && source.includes('containsGlass(view, 0)'),
  'A small toolbar or unsupported glass hierarchy must not be hidden as one ordinary trigger');
assert.doesNotMatch(source, /\binit\s*\{\s*view\.transitionAlpha\s*=\s*0f/,
  'Recording a snapshot must not hide a source before a replacement Drawable has attached');
const attach = source.slice(source.indexOf('fun attachOverlay('), source.indexOf('fun detachOverlay('));
assert.ok(attach.includes('!hasFrame') && attach.includes('!root.isHardwareAccelerated') &&
  attach.includes('!node.hasDisplayList()') && attach.includes('overlayDrawable.callback != null'),
  'Overlay takeover requires a real first frame, usable window/RenderNode and an actual Drawable callback');
assert.ok(attach.indexOf('root.overlay.add(overlayDrawable)') < attach.indexOf('ownership.attach(') &&
  attach.indexOf('ownership.attach(') < attach.indexOf('view.transitionAlpha = 0f'),
  'A source must be hidden only after the real window overlay and exact-source lease both succeed');
const failedAttach = attach.slice(attach.indexOf('catch (_: RuntimeException)'), attach.indexOf('if (!ownership.attach('));
assert.ok(failedAttach.includes('root.overlay.remove(overlayDrawable)') &&
  failedAttach.includes('if (overlayDrawable.callback == null) overlayRoot.clear()'),
  'A partially failed Drawable attachment must remove itself or retain its weak root for cleanup retry without hiding the source');
const requestStart = host.slice(host.indexOf('private fun requestStart('), host.indexOf('private fun updateTarget('));
assert.ok(requestStart.indexOf('applyFrame()') < requestStart.indexOf('attachOverlay(rootView)'),
  'The overlay replacement must receive its initial source frame before taking visibility ownership');
const drawable = source.slice(source.indexOf('private val overlayDrawable'), source.indexOf('fun attachOverlay('));
assert.ok(drawable.includes('WindowBackdrops.isCapturing') && drawable.includes('root.getLocationOnScreen(overlayLocation)') &&
  drawable.includes('drawSource(canvas, overlayFrame, overlayLocation[0].toFloat(), overlayLocation[1].toFloat())'),
  'The source Drawable must bypass capture recursion and sample the current root-window screen origin');
const dispatch = host.slice(host.indexOf('override fun dispatchDraw('), host.indexOf('override fun dispatchTouchEvent('));
assert.doesNotMatch(dispatch, /triggerSnapshot\?\.(?:draw|drawSource)\s*\(/,
  'The source clone must no longer be drawn through the fixed menu host\'s possible ancestor clips');
assert.ok(source.includes('canvas.getClipBounds(clip)') && source.includes('"clip" to listOf(clip.left, clip.top, clip.right, clip.bottom)') &&
  source.includes('"bounds" to listOf(glyphBounds.left, glyphBounds.top, glyphBounds.right, glyphBounds.bottom)') &&
  source.includes('"sourceAlpha" to frame.sourceOpacity'),
  'Record actual source-draw Canvas clipping/geometry/alpha for real-device acceptance instead of assuming JVM visibility');
const detach = source.slice(source.indexOf('fun detachOverlay('), source.indexOf('fun updateOverlay('));
assert.ok(detach.includes('remove(overlayDrawable)') && detach.includes('overlayRoot.clear()') &&
  detach.includes('ownership.detach(MenuTriggerSnapshots.owns(this), view != null, view?.transitionAlpha == 0f)') &&
  detach.includes('view?.transitionAlpha = originalTransitionAlpha'),
  'Window detach must remove its Drawable and conditionally restore only the exact active source\'s own hidden alpha');
assert.ok(attach.includes('view.id != sourceId') && source.includes('view.id != sourceId || !view.isShown'),
  'Cloning/refresh must still reject a recycled tag even when cleanup restores the same weak physical instance');
assert.ok(detach.includes('catch (_: RuntimeException)') && detach.includes('finally'),
  'A failed overlay removal must not block node disposal or native motion completion');
assert.ok(detach.indexOf('view?.transitionAlpha = originalTransitionAlpha') < detach.indexOf('remove(overlayDrawable)'),
  'A window handoff must restore its exact source before removing the replacement Drawable');
const release = source.slice(source.lastIndexOf('fun release('));
assert.ok(release.includes('if (!ownership.release()) return') && release.includes('detachOverlay()') &&
  release.includes('source.clear()') && release.includes('node.discardDisplayList()'),
  'Release must be idempotent and symmetrically release overlay, weak source and recorded pixels');
console.log('Menu source overlay contract passed (explicit identity, attach-before-hide, root-local replay, capture exclusion, real Canvas clip diagnostics and symmetric cleanup).');
