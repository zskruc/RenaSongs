import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = new URL('../../../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', import.meta.url);
const host = readFileSync(new URL('MenuMorphView.kt', native), 'utf8');
const source = readFileSync(new URL('MenuTriggerSnapshot.kt', native), 'utf8');
const measurement = host.slice(host.indexOf('internal fun measureMenuOrigin('));
assert.doesNotMatch(measurement, /MenuTriggerSnapshots\.(?:register|take)\s*\(/,
  'Generic origin measurement must remain read-only and cannot authorize hiding a source');
assert.ok(host.includes('menuSourceTag(rect?.getOrNull(5))') && host.includes('takeIf { it.id == tag }') &&
  host.includes('MenuTriggerSnapshots.take(source, groupView ?: buttonView,') &&
  host.includes('authorizedGroup = groupView != null'),
  'Only an explicit validated source tag resolved synchronously to the same native View may own a clone');
assert.ok(source.includes('if (!groupedSource && interactiveCount(view, 0) > 1) return null') &&
  source.includes('val groupedSource = authorizedGroup && view is MenuTriggerGroupView') &&
  source.includes('if (authorizedGroup && !groupedSource) return null') && source.includes('containsGlass(view, 0)'),
  'A small toolbar or unsupported glass hierarchy must not be hidden as one ordinary trigger');
assert.doesNotMatch(source, /\binit\s*\{\s*view\.transitionAlpha\s*=\s*0f/,
  'Capturing pixels must not hide a source before its replacement View has attached');
const attach = source.slice(source.indexOf('fun attachOverlay('), source.indexOf('fun detachOverlay('));
assert.ok(attach.includes('!hasFrame') && attach.includes('!root.isHardwareAccelerated') &&
  attach.includes('root !is ViewGroup') && attach.includes('sourceOwner.parent != null'),
  'Overlay takeover requires a first source frame, usable ViewGroup window and actually attached small View');
assert.ok(attach.indexOf('root.overlay.add(sourceOwner)') < attach.indexOf('ownership.attach(') &&
  attach.indexOf('ownership.attach(') < attach.indexOf('view.transitionAlpha = 0f'),
  'The original source must hide only after the real window View owner and exact-source lease succeed');
assert.ok(attach.includes('sourceOwner.measure(') && attach.includes('sourceOwner.layout(0, 0, ownerWidth, ownerHeight)') &&
  attach.indexOf('applyOwnerFrame()') < attach.indexOf('view.transitionAlpha = 0f'),
  'The real replacement must have physical dimensions and the current transform before its source hides');
const failedAttach = attach.slice(attach.indexOf('catch (_: RuntimeException)'), attach.indexOf('if (!ownership.attach('));
assert.ok(failedAttach.includes('root.overlay.remove(sourceOwner)') &&
  failedAttach.includes('if (sourceOwner.parent == null) overlayRoot.clear()'),
  'Failed attachment must remove the small View or retain its weak root for cleanup retry without hiding the source');
const requestStart = host.slice(host.indexOf('private fun requestStart('), host.indexOf('private fun updateTarget('));
assert.ok(requestStart.indexOf('applyFrame()') < requestStart.indexOf('attachOverlay(rootView)'),
  'The overlay replacement must receive its initial source frame before taking visibility ownership');
const placement = source.slice(source.indexOf('private fun applyOwnerFrame('), source.indexOf('fun suppressForCapture('));
assert.ok(placement.includes('root.getLocationOnScreen(overlayLocation)') &&
  placement.includes('frame.sourceLobe.centerX() - overlayLocation[0] - sourceOwner.width / 2f') &&
  placement.includes('frame.sourceLobe.centerY() - overlayLocation[1] - sourceOwner.height / 2f') &&
  placement.includes('sourceOwner.pivotX = sourceOwner.width / 2f') &&
  placement.includes('sourceOwner.alpha = frame.sourceOpacity.coerceIn(0f, 1f)'),
  'Source View transforms must use current root-local physical origin, center pivot and original motion alpha');
const dispatch = host.slice(host.indexOf('override fun dispatchDraw('), host.indexOf('override fun dispatchTouchEvent('));
assert.doesNotMatch(dispatch, /triggerSnapshot\?\.(?:draw|drawSource)\s*\(/,
  'The source clone must no longer be drawn through the fixed menu host\'s possible ancestor clips');
assert.ok(source.includes('canvas.getClipBounds(clip)') && source.includes('"lastRecordedLocalClip" to if (draws > 0L)') &&
  source.includes('"bounds" to listOf(glyphBounds.left, glyphBounds.top, glyphBounds.right, glyphBounds.bottom)') &&
  source.includes('"sourceAlpha" to sourceOwner.alpha') && source.includes('"sampleOrigin" to "view-properties"') &&
  source.includes('"lastRecordingAgeMs" to if (lastRecordingAt > 0L)'),
  'Distinguish current View properties from the last real Canvas recording clip; cached pixels are not a new onDraw per GPU frame');
const updateOwner = source.slice(source.indexOf('fun updateOverlay('), source.indexOf('private fun applyOwnerFrame('));
assert.doesNotMatch(updateOwner, /(?:sourceOwner|root|overlayRoot\.get\(\)\??)\.invalidate\s*\(/,
  'Transform-only source motion must reuse its immutable drawing body instead of re-recording identical bitmap pixels');
assert.ok(attach.includes('sourceOwner.invalidate()') && attach.includes('root.invalidate()'),
  'Initial takeover must still dirty both replacement pixels and the actual host');
const ownerDrawing = source.slice(source.indexOf('override fun onDraw(canvas: Canvas)'), source.indexOf('fun attachOverlay('));
assert.ok(ownerDrawing.indexOf('canvas.drawBitmap(') < ownerDrawing.indexOf('if (diagnosticsEnabled)') &&
  /if \(diagnosticsEnabled\)\s*\{[\s\S]*?recordDraw\(canvas\)/.test(ownerDrawing),
  'Ordinary source drawing must paint pixels while clip/uptime diagnostics remain DEBUG-only');
const applyOwner = source.slice(source.indexOf('private fun applyOwnerFrame('), source.indexOf('fun suppressForCapture('));
assert.ok(applyOwner.includes('if (diagnosticsEnabled) recordOwnerFrame()') &&
  source.includes('private val diagnosticsEnabled = Log.isLoggable("ResonusGlass", Log.DEBUG) ||') &&
  source.includes('Log.isLoggable("ResonusGlassSource", Log.DEBUG)') &&
  source.includes('"sourceOwnerDiagnosticsEnabled" to diagnosticsEnabled') &&
  source.includes('"sourceOwnerDisplayListRecordings" to draws'),
  'Resolve diagnostic ownership once per source session and label display-list recordings separately from visible frames');
const closeDiagnostics = source.slice(source.indexOf('fun beginClosing('), source.indexOf('fun diagnostics('));
assert.ok(closeDiagnostics.indexOf('if (!diagnosticsEnabled) return') < closeDiagnostics.indexOf('SystemClock.uptimeMillis()'),
  'Normal close must not start phase-clock/sample allocation merely for diagnostics');
const detach = source.slice(source.indexOf('fun detachOverlay('), source.indexOf('fun updateOverlay('));
const sourceLease = source.slice(source.indexOf('private fun returnSourceLease('), source.indexOf('private fun sameSourcePlacement('));
assert.ok(detach.includes('remove(sourceOwner)') && detach.includes('overlayRoot.clear()') &&
  detach.includes('returnSourceLease(view)') && sourceLease.includes('ownership.returnSource(') &&
  sourceLease.includes('view?.transitionAlpha = originalTransitionAlpha'),
  'Window detach must remove its small View and conditionally restore only the exact active source\'s own hidden alpha');
assert.ok(attach.includes('view.id != sourceId') && source.includes('view.id != sourceId || !view.isShown'),
  'Cloning/refresh must still reject a recycled tag even when cleanup restores the same weak physical instance');
assert.ok(detach.includes('catch (_: RuntimeException)') && detach.includes('finally'),
  'A failed overlay removal must not block node disposal or native motion completion');
assert.ok(detach.indexOf('returnSourceLease(view)') < detach.indexOf('remove(sourceOwner)'),
  'A window handoff must restore its exact source before removing the replacement View');
assert.ok(sourceLease.includes('if (sourceLeaseReturned) return') &&
  sourceLease.includes('val exactSource = view != null && source.get() === view') &&
  !sourceLease.includes('view.id == sourceId') &&
  sourceLease.includes('view?.transitionAlpha == 0f') &&
  attach.includes('view.addOnAttachStateChangeListener(sourceAttachListener)') &&
  source.includes('override fun onViewDetachedFromWindow(view: View) { onSourceDetached(view) }'),
  'Early detach must return a lease once; same weak owned instance may repair its own zero alpha if a tag changed first, while capture/attach remain tag-strict');
const sourceDetached = source.slice(source.indexOf('internal fun onSourceDetached('), source.indexOf('private fun returnSourceLease('));
assert.ok(sourceDetached.indexOf('returnSourceLease(view)') < sourceDetached.indexOf('source.clear()') &&
  sourceDetached.includes('sourceParent.clear()') && sourceDetached.includes('sourceRoot.clear()'),
  'Detach returns the original source before clearing weak identities; a later animation close cannot change a newly pooled source');
const release = source.slice(source.lastIndexOf('fun release('));
assert.ok(release.includes('if (!ownership.release()) return') && release.includes('detachOverlay()') &&
  release.includes('source.clear()') && release.includes('captureState.release()') && release.includes('sourceOwner.setRenderEffect(null)'),
  'Release must be idempotent and symmetrically release overlay, weak source, pending capture and filtered owner');
console.log('Menu source overlay contract passed (explicit identity, attached small-View takeover, root-local physical replay, real local Canvas clips and symmetric cleanup).');
