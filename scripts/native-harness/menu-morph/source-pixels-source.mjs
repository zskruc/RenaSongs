import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = new URL('../../../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', import.meta.url);
const source = readFileSync(new URL('MenuTriggerSnapshot.kt', native), 'utf8');
const take = source.slice(source.indexOf('fun take('), source.indexOf('internal fun owns('));
const attach = source.slice(source.indexOf('fun attachOverlay('), source.indexOf('fun detachOverlay('));
const owner = source.slice(source.indexOf('private val sourceOwner'), source.indexOf('fun attachOverlay('));
const replay = source.slice(source.indexOf('fun updateOverlay('), source.lastIndexOf('fun release('));
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
  take.indexOf('mutable.copy(') < take.indexOf('val snapshot = MenuTriggerSnapshot('),
  'Empty rendered pixels must be rejected before publishing the immutable source owner');
assert.ok(take.includes('mutable.copy(Bitmap.Config.ARGB_8888, false)') &&
  take.includes('if (immutable.isMutable)') &&
  source.includes('private val sourcePixels: Bitmap'),
  'Replay pixels must be an immutable copy retained by the snapshot independently of the live trigger');
assert.ok(take.includes('catch (error: RuntimeException)') && take.includes('catch (_: OutOfMemoryError)') &&
  take.includes('"empty-rejected"') && take.includes('"software-unsupported"') && take.includes('"memory-rejected"'),
  'Empty, unsupported software rendering and allocation failures must return no replacement source');
assert.ok(take.includes('finally {') && take.includes('mutable?.recycle()'),
  'Only the unsubmitted temporary software bitmap should be recycled after copying');
assert.doesNotMatch(source, /(?:immutable|sourcePixels)\??\.recycle\s*\(/,
  'The replay bitmap must not be recycled while a RenderThread/diagnostic writer may still reference it');
assert.ok(source.includes('private val pixelRect = Rect(guard, guard, guard + view.width, guard + view.height)') &&
  owner.includes('canvas.drawBitmap(sourcePixels, null, pixelRect, sourcePaint)'),
  'Explicit source/destination pixel rectangles must avoid Bitmap/RecordingCanvas density rescaling');
assert.ok(owner.includes('object : View(view.context)') && owner.includes('override fun onDraw(canvas: Canvas)'),
  'Immutable pixels must be painted by their real small View drawing owner');
assert.doesNotMatch(owner, /if\s*\(WindowBackdrops\.isCapturing[^\n]*return/,
  'The actual source drawing body must not be erased while capture consumes owner dirty state');
assert.doesNotMatch(owner, /(?:view\.draw|drawRenderNode)\s*\(/,
  'The replay owner must not retain live trigger child display-list references or a borrowed manual RenderNode');
assert.doesNotMatch(replay, /(?:view\.draw|Bitmap\.createBitmap|\.copy\(|getPixels|menuSourcePixels)\s*\(/,
  'Per-frame replay must not recapture, copy or scan the live View/pixels');
assert.doesNotMatch(take, /transitionAlpha\s*=\s*0f/,
  'Capturing valid pixels alone cannot authorize hiding the source');
assert.ok(attach.indexOf('ownership.attach(') < attach.indexOf('view.transitionAlpha = 0f') &&
  release.includes('detachOverlay()'),
  'Immutable pixels still require a ready exact-owner overlay and symmetric owner disposal');
assert.ok(take.includes('Log.isLoggable("ResonusGlassSource", Log.DEBUG)') &&
  take.includes('immutable.compress(Bitmap.CompressFormat.PNG') &&
  take.includes('metadata["sourceBitmapAlphaPixels"]') && take.includes('metadata["sourceBitmapSha256"]') &&
  take.includes('metadata["sourceCapturePng"]'),
  'Device acceptance must be able to inspect the actual source PNG and nonempty pixel/hash evidence');
console.log('Menu source pixels contract passed (one bounded software capture, empty/unsupported rejection, immutable density-safe small-View replay and independent device pixel evidence).');
