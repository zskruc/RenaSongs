import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = new URL('../../../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', import.meta.url);
const source = readFileSync(new URL('MenuTriggerSnapshot.kt', native), 'utf8');
const take = source.slice(source.indexOf('fun take('), source.indexOf('internal fun owns('));
const attach = source.slice(source.indexOf('fun attachOverlay('), source.indexOf('fun detachOverlay('));
const replay = source.slice(source.indexOf('private fun drawSource('), source.lastIndexOf('fun release('));
const release = source.slice(source.lastIndexOf('fun release('));
assert.ok(source.includes('private const val MAX_PIXEL_COUNT = 360_000L') &&
  take.indexOf('view.width.toLong() * view.height > MAX_PIXEL_COUNT') < take.indexOf('Bitmap.createBitmap('),
  'The small source capture must be budget-gated before allocating pixels, with overflow-safe arithmetic');
assert.ok(source.includes('view is SurfaceView || view is TextureView') &&
  take.includes('view.scrollX != 0 || view.scrollY != 0') && take.includes('containsGlass(view, 0)'),
  'Non-software and scrolled/native glass sources must fail closed without hiding the real control');
assert.equal((take.match(/view\.draw\(software\)/g) ?? []).length, 1,
  'Each source capture must execute exactly one software View draw');
assert.ok(take.includes('val software = Canvas(mutable)') &&
  take.includes('software.clipRect(0, 0, view.width, view.height)') &&
  take.includes('mutable.density = view.resources.displayMetrics.densityDpi'),
  'The software capture must preserve physical source size and its resource density');
assert.ok(take.indexOf('view.draw(software)') < take.indexOf('menuSourcePixels(') &&
  take.indexOf('if (!stats.hasContent)') < take.indexOf('mutable.copy(') &&
  take.indexOf('mutable.copy(') < take.indexOf('val node = RenderNode('),
  'Empty rendered pixels must be rejected before publishing an immutable replay node');
assert.ok(take.includes('mutable.copy(Bitmap.Config.ARGB_8888, false)') &&
  take.includes('if (immutable.isMutable)') &&
  source.includes('private val sourcePixels: Bitmap'),
  'Replay pixels must be an immutable copy retained by the snapshot independently of live View nodes');
assert.ok(take.includes('catch (error: RuntimeException)') && take.includes('catch (_: OutOfMemoryError)') &&
  take.includes('"empty-rejected"') && take.includes('"software-unsupported"') && take.includes('"memory-rejected"'),
  'Empty, unsupported software rendering and allocation failures must return no replacement source');
assert.ok(take.includes('finally {') && take.includes('mutable?.recycle()'),
  'Only the unsubmitted temporary software bitmap should be recycled after copying');
assert.doesNotMatch(source, /(?:immutable|sourcePixels)\??\.recycle\s*\(/,
  'The replay bitmap must not be recycled while a RenderThread/diagnostic writer may still reference it');
const record = take.slice(take.indexOf('val recording = node.beginRecording('), take.indexOf('metadata["sourceCaptureResult"] = "immutable-ready"'));
assert.ok(record.includes('recording.drawBitmap(immutable, null, Rect(0, 0, view.width, view.height),'),
  'Explicit source/destination pixel rectangles must avoid Bitmap/RecordingCanvas density rescaling');
assert.doesNotMatch(record, /(?:view\.draw|drawRenderNode)\s*\(/,
  'The immutable replay display list must not retain live child RenderNode references');
assert.doesNotMatch(replay, /(?:view\.draw|Bitmap\.createBitmap|\.copy\(|getPixels|menuSourcePixels)\s*\(/,
  'Per-frame replay must not recapture, copy or scan the live View/pixels');
assert.doesNotMatch(take, /transitionAlpha\s*=\s*0f/,
  'Capturing valid pixels alone cannot authorize hiding the source');
assert.ok(attach.indexOf('ownership.attach(') < attach.indexOf('view.transitionAlpha = 0f') &&
  release.includes('node.discardDisplayList()'),
  'Immutable pixels still require a ready exact-owner overlay and symmetric recorded-node disposal');
assert.ok(take.includes('Log.isLoggable("ResonusGlassSource", Log.DEBUG)') &&
  take.includes('immutable.compress(Bitmap.CompressFormat.PNG') &&
  take.includes('metadata["sourceBitmapAlphaPixels"]') && take.includes('metadata["sourceBitmapSha256"]') &&
  take.includes('metadata["sourceCapturePng"]'),
  'Device acceptance must be able to inspect the actual source PNG and nonempty pixel/hash evidence');
console.log('Menu source pixels contract passed (one bounded software capture, empty/unsupported rejection, immutable density-safe replay and independent device pixel evidence).');
