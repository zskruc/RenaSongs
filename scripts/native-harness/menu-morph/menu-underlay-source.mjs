import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = new URL('../../../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', import.meta.url);
const source = readFileSync(new URL('WindowBackdrop.kt', native), 'utf8');
const material = readFileSync(new URL('LiquidGlassView.kt', native), 'utf8');
const scene = readFileSync(new URL('BackdropSceneChanges.kt', native), 'utf8');
const policy = readFileSync(new URL('MenuUnderlayCachePolicy.kt', native), 'utf8');
const bridge = readFileSync(new URL('RecordedBackdropBridge.kt', native), 'utf8');
const section = (start, end) => {
  const lo = source.indexOf(start), hi = source.indexOf(end, lo + start.length);
  assert.ok(lo >= 0 && hi > lo, `Missing production section: ${start}`);
  return source.slice(lo, hi);
};
const capture = section('private fun captureNativeMenu(', 'internal fun drawMenuScrim(');
const key = section('private fun currentMenuKey(', 'private fun trySubmitMenuRaster(');
const submit = section('private fun trySubmitMenuRaster(', 'private fun abortMenuRaster(');
const abort = section('private fun abortMenuRaster(', 'private fun recordSource(');
const complete = section('private fun completeAsyncImage(', 'private fun updateCaptureWatchdog(');
const release = section('private fun releaseCapture(', 'private fun closeUnusedReaders(');
const readers = section('private fun closeUnusedReaders(', 'fun diagnostics(');
const publish = section('private fun publishFrame(', 'private fun notifyBackdropDrawingChanged(');
const preDraw = section('override fun onPreDraw(', 'private fun capture(');

assert.ok(capture.includes('underlay.draw(recording)') &&
  !capture.includes('root.draw(') && !capture.includes('scrim.draw(') && !capture.includes('syncAndDraw('),
  'Initial direct fallback must publish the Activity-only program without drawing a Modal tree or waiting for optional GPU raster');
assert.ok(capture.includes('RecordedBackdropEligibility.MODAL_DIRECT_SAFETY') &&
  capture.includes('nativeMenuOwner(it)') && capture.includes('underlay.rootView === root'),
  'Menu caching must retain strict canonical-owner/separate-window eligibility, not relax ordinary direct safety');
assert.ok(key.includes('nativeMenuScrim() ?: return null') && key.includes('program.scrim.get() !== scrim') &&
  key.includes('!root.isAttachedToWindow || !root.isShown') &&
  key.includes('!source.isAttachedToWindow || !source.isShown') &&
  key.includes('surfaces.any { nativeMenuOwner(it) !== owner }'),
  'Draw source identity/visibility and the one trusted owner must be revalidated at completion, not only submission');
for (const field of ['pageEpoch', 'generation', 'rootWidth', 'rootHeight', 'rootX', 'rootY',
  'sourceWidth', 'sourceHeight', 'sourceX', 'sourceY', 'sceneVersion', 'materialVersion', 'scrollVersion'])
  assert.ok(key.includes(`${field} =`), `Current cache validation omits live ${field}`);
assert.ok(policy.includes('pending !== ticket') && policy.includes('latest != current || ticket.key != current') &&
  policy.includes('if (pending != null || cached == key || failed == key) return null'),
  'Dedicated menu tickets must strictly fence the full key, coalesce in flight and latch same-key failure');
assert.doesNotMatch(policy, /directSerial|recordSerial/,
  'The menu async cache serial must be independent from ordinary direct-publication/image fencing');
assert.ok(submit.includes('!asynchronous || closed || inFlightTickets.isNotEmpty()') &&
  submit.includes('synchronized(ticketLock) { queuedTickets.isNotEmpty() }') &&
  submit.includes('retiredImages.size >= MAX_RETIRED_IMAGES - MAX_IN_FLIGHT - 2') &&
  submit.includes('currentMenuKey()?.takeIf { it == program.key }') &&
  submit.includes('menuUnderlayPolicy.begin(key) ?: return'),
  'Optional raster must be single-flight, source-current and retirement-budgeted before creating/submitting work');
assert.ok(submit.includes('recording.drawRenderNode(program.node)') &&
  !submit.includes('underlay.draw(') && !submit.includes('root.draw(') && !submit.includes('scrim.draw('),
  'GPU raster must reuse the one Activity recording, without a second live-root traversal');
assert.ok(submit.includes('setWaitForPresent(false)') && submit.includes('SYNC_FRAME_DROPPED') &&
  submit.includes('abortMenuRaster()') && !submit.includes('failCapture('),
  'Optional GPU failure must not block on present or disable the existing direct fallback');
assert.ok(submit.includes('PendingCapture(') && submit.includes('SystemClock.elapsedRealtimeNanos(), ticket)') &&
  submit.includes('queuedTickets.addLast(pending)'),
  'FIFO image ownership must carry the dedicated menu ticket through worker delivery');
assert.doesNotMatch(submit, /(?:getPixels|copyPixelsToBuffer|PixelCopy|compress|toSoftware)\s*\(/,
  'Menu caching must remain GPU-backed, not add CPU readback/export to the animation path');
const menuComplete = complete.slice(complete.indexOf('if (ticket.menuTicket != null)'),
  complete.indexOf('if (!nativePage.policy.accepts(ticket.pageEpoch)'));
assert.ok(menuComplete.includes('observeBackgroundScene(it)') && menuComplete.includes('val current = currentMenuKey()') &&
  menuComplete.includes('menuUnderlayPolicy.complete(ticket.menuTicket, current,') &&
  menuComplete.includes('MenuUnderlayCachePolicy.Completion.ACCEPT') && menuComplete.includes('publishFrame(result.frame,'),
  'GPU publication must require the exact dedicated ticket, freshly observed page/scene and all current source keys');
assert.ok(menuComplete.includes('result.frame?.image?.let { retireImage(it) }') &&
  menuComplete.includes('MenuUnderlayCachePolicy.Completion.FAILED') && menuComplete.includes('abortMenuRaster()'),
  'Stale pixels must retire themselves; failed optional cache must restore direct drawing');
assert.ok(complete.includes('!recordedBridge.acceptsImage(ticket.recordSerial)') &&
  bridge.includes('fun acceptsImage(serial: Long): Boolean = serial > directSerial'),
  'Ordinary async images must retain the original strict directSerial fence');
assert.ok(abort.includes('recordedBridge.value?.takeIf { it.content.menuProgram }') &&
  abort.indexOf('releaseCapture(keepDisplayedFrames = true)') < abort.indexOf('recordedBridge.publish(') &&
  abort.includes('program.key.copy(generation = generation)') && abort.includes('menuUnderlayPolicy.fail(key)'),
  'Aborting optional GPU setup/delivery must recover the already valid direct bridge with the new generation and bounded retry policy');
assert.ok(release.includes('menuProgram = null') && release.includes('menuUnderlayPolicy.clear()') &&
  release.includes('generation++') && release.includes('queuedTickets.clear()') &&
  release.includes('inFlightTickets.clear()') && release.includes('setOnImageAvailableListener(null, null)'),
  'Close/resize/release must invalidate pending menu work and detach producer callbacks symmetrically');
assert.ok(publish.includes('frames.addLast(captured)') &&
  publish.includes('while (frames.size > 2) retireImage(frames.removeFirst().image)') &&
  readers.includes('frames.none { it.source === source }') && readers.includes('drainRetiredImages(); source.close()'),
  'Retain both displayed image cohorts and keep their reader alive; retire on the existing bounded worker path');
const scrim = section('internal fun drawMenuScrim(', 'private fun currentMenuKey(');
assert.ok(scrim.includes('opacity *= ancestor.alpha.coerceIn(0f, 1f)') &&
  scrim.includes('Color.alpha(color) * opacity') && scrim.includes('geometry.localX(0f, originX)') &&
  scrim.includes('geometry.localY(0f, originY)'),
  'The live literal scrim must retain ancestor alpha and the source physical sampling origin');
assert.doesNotMatch(scrim, /trySubmitMenuRaster|syncAndDraw|\.draw\(canvas\)|requestFrameClock/,
  'Scrim consumption must be a pure paint operation, not another capture or feedback loop');
assert.ok(material.includes('captured.menuUnderlay?.let {') &&
  material.includes('snapshot?.drawMenuScrim(canvas, it.geometry, originX, originY)') &&
  material.includes('if (recorded.content.menuProgram)') &&
  material.includes('snapshot?.drawMenuScrim(canvas, recorded.geometry, originX, originY)'),
  'Cached and immediate inputs must paint the same current scrim before blur/lens, without baking opacity into the cache key');
assert.ok(preDraw.includes('if (liveMenuPaint) notifyBackdropDrawingChanged(visible)') &&
  source.includes('BackdropSceneChanges(includeGlassContent = true, observeLeafDirty = false)') &&
  scene.includes('(!includeGlassContent && WindowBackdrops.isGlassContainer(view, root))'),
  'Scrim-only animation must repaint live; real underlay labels/artwork/status must still invalidate cached content');
assert.ok(scene.includes('private val observeLeafDirty: Boolean = true') &&
  scene.includes('val changed = signatureChanged || (observeLeafDirty && dirtyLeaf)') &&
  scene.includes('else if (dirtyLeaf) leafOnlyObservationCount++') &&
  scene.includes('else if (view.isDirty)') &&
  source.includes('private val backgroundChanges = BackdropSceneChanges()'),
  'Only trusted-menu metadata mode may ignore level-triggered leaf dirtiness; ordinary capture must preserve it and observations remain counted');
for (const metadata of ['view.matrix.getValues', 'view.scrollY', 'view.visibility',
  'view.alpha.toRawBits()', 'view.imageMatrix.getValues', 'view.currentTextColor',
  'text[index].code', 'view.progress', 'drawable.level', 'drawable.state'])
  assert.ok(scene.includes(metadata), `The menu dirty-level fix must retain real source metadata: ${metadata}`);
const activityDraw = section('private val menuUnderlayDrawListener =', 'private var failureClass');
assert.ok(activityDraw.includes('!WindowBackdrops.isCapturing && !menuSourceRecording') &&
  activityDraw.includes('menuProgram != null && nativeMenuScrim() != null') &&
  activityDraw.includes('sceneVersion++') && activityDraw.includes('requestFrameClock()') &&
  activityDraw.includes('root.invalidate()') &&
  source.includes('addOnDrawListener(menuUnderlayDrawListener)') &&
  source.includes('removeOnDrawListener(menuUnderlayDrawListener)'),
  'Trusted menu must still invalidate custom Canvas/drawable content on a real Activity draw, with paired observer lifetime and manual-record guards');
assert.ok(source.includes('"menuMetadataChanges" to menuBackgroundChanges.signatureChangeCount') &&
  source.includes('"menuLeafOnlyObservations" to menuBackgroundChanges.leafOnlyObservationCount'),
  'Cache proof must distinguish metadata changes from repeated dirty-only observations without per-frame logging');
const bounds = material.slice(material.indexOf('internal fun getMaterialBoundsOnScreen('), material.indexOf('internal fun reserveMenuMorph('));
assert.ok(bounds.includes('if (menuMaterial.active)') && bounds.includes('menuMaterial.captureLeft') &&
  bounds.includes('menuMaterial.captureRight') && !bounds.includes('menuMaterial.width'),
  'Menu source geometry must be the frozen capture envelope, not the changing optical shell; real ROI changes still invalidate');
console.log('Menu GPU underlay source contract passed (Activity-only single recording, strict async key, live scrim, independent serial, bounded ownership and direct failure recovery).');
