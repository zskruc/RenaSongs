import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/WindowBackdrop.kt', import.meta.url), 'utf8');

// These native integration gates keep ownership on the actual cross-window
// suppression path, where changing transition alpha dirties the Activity.
test('a modal marks existing foreign capture owners before changing or restoring source alpha', () => {
  const start = source.indexOf('fun <T> withoutGlass(');
  const end = source.indexOf('private fun isDescendantOf(', start);
  const capture = source.slice(start, end);
  const ownership = capture.indexOf('windows[surface.rootView]?.onForeignCaptureStaging()');
  assert.ok(ownership > 0);
  assert.match(capture, /if \(surface\.rootView !== root\) windows\[surface\.rootView\]\?\.onForeignCaptureStaging\(\)/,
    'only an already attached foreign window receives ownership; sampling must not create a new owner');
  assert.ok(ownership < capture.indexOf('excluded.forEach { it.transitionAlpha = 0f }'));
  assert.ok(ownership < capture.indexOf('capturedSurfaces.forEach { it.suppressSelectionOverlayForCapture() }'));
  assert.ok(capture.indexOf('restoreDisplayListAfterCapture()') > ownership);
});

test('foreign staging grants a finite budget without clearing genuine scene work or scheduling another frame', () => {
  const method = source.match(/internal fun onForeignCaptureStaging\(\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(method);
  assert.match(method, /if \(closed\) return/);
  assert.match(method, /ownRedrawsToSkip = maxOf\(ownRedrawsToSkip, OWN_REDRAW_TRAVERSALS\)/);
  assert.doesNotMatch(method, /(?:scrollVersion|materialVersion|sceneVersion|captured\w+Version)\s*[+=]/);
  assert.doesNotMatch(method, /(?:requestFrameClock|invalidate|postDelayed|removeCallbacks)\(/);
  assert.match(source, /OWN_REDRAW_TRAVERSALS = 2\b/);
  assert.match(source, /if \(ownRedrawsToSkip > 0 && !scrollDirty && !materialDirty && !sceneDirty\) \{\s*ownRedrawsToSkip--/,
    'real scroll, material or scene changes must still capture immediately; only owned redraws spend the budget');
});
