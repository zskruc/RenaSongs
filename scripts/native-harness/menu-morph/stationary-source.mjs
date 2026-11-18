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
assert.ok(/if \(!geometryChanged && !radiusChanged && !rasterChanged && !opacityChanged(?: && !menuPressDirty)?\) return/.test(material),
  'A stationary integer box must still update its changing optical radius');
console.log('Stationary material source contract passed (no texture transform; image and RenderNode share physical origin).');

assert.ok(material.includes('val epoch = remember(menuRasterScale) { MenuMaterialRasterEpoch(menuRasterScale) }') &&
  material.includes('Density(physicalDensity.density * epoch.scale, physicalDensity.fontScale)') &&
  material.includes('CompositionLocalProvider(LocalDensity provides density) { GlassMaterial(epoch) }'),
  'One immutable composition epoch must own the material density and its source callback');
const nativeLayout = material.slice(material.indexOf('override fun onLayout('), material.indexOf('override open fun dispatchTouchEvent('));
assert.ok(nativeLayout.includes('composeView.scaleX = 1f') && nativeLayout.includes('composeView.scaleY = 1f') &&
  nativeLayout.includes('composeView.alpha = 1f') &&
  nativeLayout.includes('menuMaterial.captureRight, menuMaterial.captureBottom'),
  'The native Compose viewport must retain physical bounds and identity scale/alpha during a pending composition');
assert.doesNotMatch(nativeLayout, /menuRaster\.|menuRasterScale|epoch\./,
  'Native layout must not apply a new requested raster scale before composition commits');
const reserve = material.slice(material.indexOf('internal fun reserveMenuMorph('), material.indexOf('private fun commitDrawingViewport('));
const directViewport = material.slice(material.indexOf('private fun commitDrawingViewport('), material.indexOf('internal fun menuRasterDiagnostics('));
const update = material.slice(material.indexOf('internal fun updateMenuMorph('), material.indexOf('internal fun clearMenuMorph('));
const clear = material.slice(material.indexOf('internal fun clearMenuMorph('), material.indexOf('internal fun getSelectionBoundsOnScreen('));
assert.ok(reserve.includes('if (geometryChanged) commitDrawingViewport(menuMaterial.captureLeft, menuMaterial.captureTop,') &&
  reserve.includes('menuMaterial.captureWidth, menuMaterial.captureHeight)'),
  'Initial/changed capture geometry must bypass cached parent Yoga layout and directly place its physical viewport');
assert.ok(directViewport.includes('composeView.measure(') && directViewport.includes('composeView.layout(left, top,') &&
  directViewport.includes('composeView.scaleX = 1f') && directViewport.includes('composeView.scaleY = 1f') &&
  directViewport.includes('composeView.alpha = 1f'),
  'A capture viewport commit must update the actual child dimensions and nonzero/negative origin at identity transform');
assert.doesNotMatch(directViewport, /menuRaster\.|menuRasterScale|epoch\./,
  'The initial native viewport must remain independent of requested raster density');
assert.doesNotMatch(update, /commitDrawingViewport\s*\(|measureAndLayout\s*\(/,
  'Ordinary spring frames and resolution handoffs must not trigger platform viewport layout');
assert.ok(clear.includes('commitDrawingViewport(0, 0, width, height)'),
  'Clearing a menu must restore the ordinary physical card viewport without depending on a parent relayout');
const epochRendering = material.slice(material.indexOf('private fun GlassMaterial(epoch:'), material.lastIndexOf('\n}'));
assert.doesNotMatch(epochRendering, /\bmenuRaster\.|\bmenuRasterScale\b/,
  'A retained draw/layout callback must never late-read the owner\'s requested scale');
const rasterLayout = material.slice(material.indexOf('private fun MenuRasterLayout('), material.indexOf('private fun DockMaterialCapacity('));
assert.ok(rasterLayout.includes('epoch.pixels(physicalWidth), epoch.pixels(physicalHeight)') &&
  rasterLayout.includes('scaleX = epoch.inverseScale') && rasterLayout.includes('scaleY = epoch.inverseScale') &&
  rasterLayout.includes('transformOrigin = TransformOrigin(0f, 0f)') && rasterLayout.includes('alpha = menuGroupOpacity'),
  'Raster dimensions, inverse scale and opacity must commit together in the same Compose layer');
assert.ok(material.includes('epoch.pixels(menuCapacity.width)') && material.includes('epoch.pixels(menuCapacity.height)') &&
  material.includes('DockMaterialCapacity(epoch)') && material.includes('DockMaterialLayout(epoch)'),
  'Kyant filtered layer capacities must be rasterized, not left at full physical resolution');
assert.ok(material.includes('materialOffsetX = menuMaterial.placementX') && material.includes('materialOffsetY = menuMaterial.placementY') &&
  material.includes('val rasterX = materialOffsetX * epoch.scale') && material.includes('val rasterY = materialOffsetY * epoch.scale') &&
  material.includes('translationX = rasterX - x') && material.includes('translationY = rasterY - y'),
  'Sampling origins remain physical while raster placement compensates subpixel rounding');
assert.equal((material.match(/canvas\.scale\(epoch\.scale, epoch\.scale\)/g) ?? []).length, 2,
  'Only captured-image and recorded-node replay apply one physical-to-raster transform');
assert.ok(material.includes('composeView.left + materialOffsetX') && material.includes('composeView.top + materialOffsetY'),
  'Source replay must read the committed physical child placement, not a pending animation rectangle');
assert.ok(material.includes('if (menuMaterial.active && !menuRasterCompositionAttached) return') &&
  rasterLayout.includes('menuRasterCompositionAttached = true'),
  'The first menu draw must wait for its first coherent Compose placement');
const portal = readFileSync(new URL('menumotion/GlassForegroundPortal.kt', native), 'utf8');
assert.ok(portal.includes('rowsNode.setAlpha(rowsOpacity)'),
  'Foreground reveal must live on the compact rows node instead of a full native body alpha layer');
console.log('Menu material epoch source contract passed (captured cohort, identity native viewport, committed source origins, compact alpha groups).');

assert.ok(material.includes('epoch.blurRadius(rasterBlur / epoch.scale)'),
  'The menu material must scale Android Gaussian sigma, including its half-pixel term');
assert.match(host, /child\.alpha = if \(foregroundPortal != null && isHardwareAccelerated\) 1f else reveal/,
  'Only the hardware portal may take ownership of native foreground reveal');
assert.ok(host.includes('!settled || !requestedOpen'),
  'A closed invisible menu must not allocate a hidden full-resolution material before teardown');
