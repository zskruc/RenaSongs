import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = new URL('../../../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', import.meta.url);
const source = readFileSync(new URL('MenuTriggerSnapshot.kt', native), 'utf8');
const backdrop = readFileSync(new URL('WindowBackdrop.kt', native), 'utf8');
const owner = source.slice(source.indexOf('private val sourceOwner'), source.indexOf('fun attachOverlay('));
const suppress = source.slice(source.indexOf('fun suppressForCapture('), source.indexOf('fun restoreAfterCapture('));
const restore = source.slice(source.indexOf('fun restoreAfterCapture('), source.indexOf('fun beginClosing('));
const transaction = backdrop.slice(backdrop.indexOf('fun <T> withoutGlass('), backdrop.indexOf('private fun isDescendantOf('));
const begin = source.slice(source.indexOf('fun beginCapture('), source.indexOf('fun endCapture('));
const end = source.slice(source.indexOf('fun endCapture('), source.indexOf('fun take('));
assert.ok(owner.includes('object : View(view.context)') && owner.includes('canvas.drawBitmap(sourcePixels, null, pixelRect, sourcePaint)'),
  'The actual small View must own immutable source painting independently of capture');
assert.doesNotMatch(owner, /if\s*\(WindowBackdrops\.isCapturing[^\n]*return/,
  'Do not clear a source drawing body while capture consumes its owner dirty state');
assert.ok(source.includes('private val guard = ceil(13f * density).toInt()') &&
  source.includes('(view.width + guard * 2).toLong() * (view.height + guard * 2) > 720_000L') &&
  !source.includes('node.beginRecording(') && !source.includes('canvas.drawRenderNode(node)'),
  'Source filtering must stay inside a bounded blur-padded real View, with no extra borrowed RenderNode');
assert.ok(suppress.includes('ownerRoot === captureSource') &&
  suppress.includes('(captureSource === root && ownerRoot === activityDecor)'),
  'Only a capture that actually draws the overlay owner root may stage it; unrelated roots must stay idle');
assert.ok(suppress.includes('captureState.stage(included, MenuTriggerSnapshots.owns(this) && ownership.attached,') &&
  suppress.includes('sourceOwner.visibility == View.VISIBLE') &&
  suppress.indexOf('captureState.stage(') < suppress.indexOf('sourceOwner.visibility = View.INVISIBLE'),
  'Suppression must use the production exact-owner capture transaction before changing real View visibility');
assert.ok(suppress.includes('WindowBackdrops.onMenuSourceCaptureStaging(ownerRoot)') &&
  backdrop.includes('fun onMenuSourceCaptureStaging(root: View) { windows[root]?.onForeignCaptureStaging() }'),
  'The actually affected window must use the existing bounded capture-redraw budget');
assert.ok(restore.includes('captureState.finish(true, MenuTriggerSnapshots.owns(this) && ownership.attached && !ownership.released)') &&
  restore.includes('sourceOwner.visibility = if (groupedRendering) View.INVISIBLE else View.VISIBLE') && restore.includes('sourceOwner.invalidate()') &&
  restore.includes('overlayRoot.get()?.invalidate()'),
  'Restoration must restore visibility and dirty BOTH the source View and actual overlay host, once for the current lease');
assert.ok(begin.includes('captureDepth++') && begin.includes('capturedOwners.add(WeakReference(it))') &&
  end.includes('captureDepth = (captureDepth - 1).coerceAtLeast(0)') &&
  end.indexOf('if (captureDepth != 0) return') < end.indexOf('owners.forEach') &&
  end.includes('capturedOwners.clear()'),
  'Nested root captures must retain weak staged owners and restore only once at the outermost end');
assert.match(transaction, /try\s*\{\s*MenuMorphWindowOwners\.beginCapture\(captureSource\)\s*MenuTriggerSnapshots\.beginCapture\(root, captureSource, activityDecor\)/,
  'Capture staging must be inside the protected transaction');
assert.ok(transaction.indexOf('MenuTriggerSnapshots.beginCapture(') < transaction.indexOf('return capture()') &&
  transaction.indexOf('isCapturing = wasCapturing') < transaction.indexOf('MenuTriggerSnapshots.endCapture()'),
  'The source must be suppressed before capture and may restore only after capture mode is unwound');
assert.match(transaction, /finally\s*\{\s*try\s*\{\s*MenuTriggerSnapshots\.endCapture\(\)\s*\}\s*finally\s*\{\s*MenuMorphWindowOwners\.endCapture\(\)\s*\}/,
  'Even a failed glass/selection-host restore must unwind source capture depth in its own finally');
assert.doesNotMatch(suppress + restore + owner, /(?:postFrameCallback|postOnAnimation|postDelayed|Choreographer)/,
  'Bounded source capture restoration must not introduce an independent recurring frame loop');
assert.ok(source.includes('"sourceCaptureSuppressCount" to captureSuppressions') &&
  source.includes('"sourceCaptureRestoreCount" to captureRestores') &&
  source.includes('"sourceOwnerCaptureDraws" to captureDraws') &&
  source.includes('"sourceOwnerKind" to if (groupedRendering) "group-window-foreground" else "bounded-view"'),
  'Actual device validation must distinguish source-owner identity, capture exclusion and matched restoration');
console.log('Menu source capture contract passed (real bounded View, relevant-root staging, outermost exception-safe finally, owner-cache invalidation and no independent frame loop).');
