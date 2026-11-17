import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const native = new URL('modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', root);
const host = readFileSync(new URL('MenuMorphView.kt', native), 'utf8');
const material = readFileSync(new URL('LiquidGlassView.kt', native), 'utf8');
const windowBackdrop = readFileSync(new URL('WindowBackdrop.kt', native), 'utf8');
const draw = host.slice(host.indexOf('override fun dispatchDraw('), host.indexOf('override fun dispatchTouchEvent('));
assert.ok(draw.includes('drawChild(canvas, material, drawingTime)'), 'Draw the existing material at its native physical origin');
assert.doesNotMatch(draw, /canvas\.(?:scale|concat|setMatrix|translate)\s*\(/,
  'A Canvas matrix on the material would move/scale its already captured page texture');
for (const renderer of ['drawCapturedBackdrop', 'drawRecordedBackdrop']) {
  const call = new RegExp(`${renderer}\\(composeCanvas\\.nativeCanvas,[\\s\\S]{0,180}?opticalMaterialOffsetX,[\\s\\S]{0,80}?opticalMaterialOffsetY`);
  assert.match(material, call, `${renderer} must include the native viewport and child placement offsets`);
}
assert.ok(host.includes('reserveMaterialEnvelope()') && host.includes('updateMenuMorph('),
  'Reserve once and move only the native material child inside that capacity');
const menuProgram = windowBackdrop.slice(windowBackdrop.indexOf('private fun captureNativeMenu('),
  windowBackdrop.indexOf('private fun recordSource('));
assert.ok(menuProgram.includes('underlay.draw(recording)') && menuProgram.includes('recording.drawRect(captureRect, menuScrimPaint)'),
  'Native menu source must explicitly record only its Activity and literal scrim');
assert.doesNotMatch(menuProgram, /(?:root|scrim)\.draw\s*\(|withoutGlass\s*\(|syncAndDraw\s*\(/,
  'A menu must not replay its own Modal tree or wait for an offscreen GPU capture');
assert.match(windowBackdrop, /surfaces\.any\s*\{\s*nativeMenuOwner\(it\) == null \|\| it\.progressiveBlur\s*\}/,
  'The direct program must remain gated to native menu hosts');
console.log('Stationary material source contract passed (no texture transform; image and RenderNode share physical origin).');
