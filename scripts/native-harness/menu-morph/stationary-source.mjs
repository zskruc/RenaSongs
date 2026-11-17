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
  const call = new RegExp(`${renderer}\\((?:composeCanvas\\.nativeCanvas|canvas),[\\s\\S]{0,180}?opticalMaterialOffsetX,[\\s\\S]{0,80}?opticalMaterialOffsetY`);
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
assert.match(material, /shadow = if \(officialMaterial && menuMaterialCapacity == IntSize\.Zero\)/,
  'Only the already-clipped native menu may skip its invisible shadow; normal materials must retain their shadow');
assert.ok(material.includes('val glassShape = menuMorphShape ?:') &&
  material.includes('menuMorphShape = RoundedCornerShape((radius / resources.displayMetrics.density).dp)'),
  'The native menu material, lens and highlight must share the current physical spring radius');
assert.ok(/if \(!geometryChanged && !radiusChanged(?: && !rasterChanged)?\) return/.test(material),
  'A stationary integer box must still update its changing optical radius');
console.log('Stationary material source contract passed (no texture transform; image and RenderNode share physical origin).');

assert.ok(material.includes('Density(physicalDensity.density * menuRasterScale, physicalDensity.fontScale)'),
  'Only the menu material raster density may scale its physical DP recipe');
assert.ok(material.includes('composeView.pivotX = 0f') && material.includes('composeView.pivotY = 0f') &&
  material.includes('composeView.scaleX = menuRaster.inverseScale') && material.includes('composeView.scaleY = menuRaster.inverseScale'),
  'The rasterized native material must composite from its unchanged physical top-left origin');
assert.ok(material.includes('menuRaster.pixels(menuCapacity.width)') && material.includes('menuRaster.pixels(menuCapacity.height)'),
  'Kyant filtered layer capacities must be rasterized, not left at full physical resolution');
assert.ok(material.includes('materialOffsetX = menuMaterial.placementX') && material.includes('materialOffsetY = menuMaterial.placementY') &&
  material.includes('translationX = rasterX - x') && material.includes('translationY = rasterY - y'),
  'Sampling origins remain physical while raster placement compensates subpixel rounding');
assert.equal((material.match(/canvas\.scale\(menuRasterScale, menuRasterScale\)/g) ?? []).length, 2,
  'Only captured-image and recorded-node replay apply one physical-to-raster transform');
assert.ok(material.includes('alpha = 1f') && material.includes('composeView.alpha = opacity.coerceIn(0f, 1f)'),
  'Material group opacity must live on the compact Compose viewport, not its physical host');
const portal = readFileSync(new URL('menumotion/GlassForegroundPortal.kt', native), 'utf8');
assert.ok(portal.includes('rowsNode.setAlpha(rowsOpacity)'),
  'Foreground reveal must live on the compact rows node instead of a full native body alpha layer');
console.log('Menu material raster source contract passed (physical source origins, single raster conversion, compact alpha groups).');

assert.ok(material.includes('menuRaster.blurRadius(rasterBlur / menuRasterScale)'),
  'The menu material must scale Android Gaussian sigma, including its half-pixel term');
assert.match(host, /child\.alpha = if \(foregroundPortal != null && isHardwareAccelerated\) 1f else reveal/,
  'Only the hardware portal may take ownership of native foreground reveal');
assert.ok(host.includes('!settled || !requestedOpen'),
  'A closed invisible menu must not allocate a hidden full-resolution material before teardown');
