import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = new URL('../../../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', import.meta.url);
const host = readFileSync(new URL('MenuMorphView.kt', native), 'utf8');
const interaction = readFileSync(new URL('MenuMorphInteraction.kt', native), 'utf8');
const trigger = readFileSync(new URL('MenuTriggerSnapshot.kt', native), 'utf8');
const material = readFileSync(new URL('LiquidGlassView.kt', native), 'utf8');
const pressLight = readFileSync(new URL('MenuPressLight.kt', native), 'utf8');

assert.ok(host.includes('liveFrame.copyFrom(motion.frame)') &&
  host.includes('interaction.motion.deform(liveFrame.bounds,') && host.includes('val frame = liveFrame'),
  'Jelly must deform a presentation copy instead of mutating the underlying physical springs');
assert.ok(host.includes('outline.update(frame,') && host.includes('foregroundPortal?.update(frame,') &&
  host.includes('localIncoming.set(frame.bounds)'),
  'The optical outline, foreground portal and RN body must consume the same live rectangle');
assert.ok(host.includes('interaction.motion.advance(seconds)') &&
  host.includes('(requestedOpen && !interaction.motion.isSettled)'),
  'A settled open morph must continue its press/plate springs and stop once they settle');
assert.ok(host.includes('!settled || !requestedOpen || interaction.isGestureActive || !interaction.motion.isSettled'),
  'A live press deformation must retain the bounded material raster rather than restoring full-resolution per-frame layers');
assert.ok(interaction.includes('val isGestureActive get() = owning || observing || suppressUntilAllUp'),
  'The raster epoch must remain active through both owned and passive held pointer streams');
const tick = host.slice(host.indexOf('override fun doFrame('), host.indexOf('private fun applyFrame('));
assert.doesNotMatch(tick, /interaction\.isGestureActive/,
  'An idle held finger must not force continuous frame requests once the jelly/light/plate springs settle');
const retarget = host.slice(host.indexOf('if (initialized && motion.expanded != requestedOpen)'),
  host.indexOf('} else if (!initialized && !requestedOpen)'));
assert.ok(retarget.includes('interaction.close()') && retarget.includes('motion.updateSource(source, through)') &&
  retarget.includes('motion.retarget(requestedOpen)'),
  'Selection close must release live deformation and refresh the same source before absorption');
assert.doesNotMatch(retarget, /interaction\.reset\s*\(|clearMenuMorph\s*\(|resetContent\s*\(/,
  'Closing must not reset the visible jelly/material/body before its absorption animation');
assert.ok(trigger.includes('MenuTriggerSnapshots.owns(this)') &&
  trigger.includes('x - morphSourceWidth / 2f') && trigger.includes('y - morphSourceHeight / 2f'),
  'Live source refresh must retain weak-source ownership and normalized trigger dimensions');
assert.ok(host.includes('private val sourceHasGlass = false') &&
  host.includes('if (sourceHasGlass) 1f else frame.contentProgress.coerceIn(0f, 1f)') &&
  host.includes('triggerSnapshot?.updateOverlay(motion.frame)'),
  'Plain triggers must retain the upstream plain-source absorption rather than gain a fake glass lobe');
const rows = host.slice(host.indexOf('fun drawRows('), host.indexOf('if (portal != null', host.indexOf('fun drawRows(')));
assert.ok(rows.includes('interaction.drawPlate(') && rows.indexOf('interaction.drawPlate(') < rows.indexOf('drawChild(recording,'),
  'The selection plate must share the foreground portal and render below its RN rows');
assert.ok(interaction.includes('if (containsInput(hit)) return') && interaction.includes('view.rootView !== host.rootView'),
  'Finite-row capture must reject nested inputs and views belonging to another modal window');
const validation = interaction.slice(interaction.indexOf('private fun validSelection('), interaction.indexOf('private fun finishNative('));
assert.ok(validation.includes('view.getGlobalVisibleRect(visibleBounds)') &&
  validation.includes('visibleBounds.contains((hostLocation[0] + lastX).toInt(), (hostLocation[1] + lastY).toInt())'),
  'UP must remain inside the row\'s current visible window bounds, not only its old DOWN geometry');
assert.ok(interaction.includes('if (ownedStream && row != null && validSelection(row))') &&
  interaction.includes('selectionPending = !row.keepOpen'),
  'Only a valid owned gesture may select once; ordinary scroll/input ownership must remain with RN');
assert.ok(interaction.includes('motion.release(); null') && interaction.includes('motion.cancelForScroll()'),
  'A parent-owned scroll must cancel activation and release its held light on terminal UP');
const multiPointer = interaction.slice(interaction.indexOf('MotionEvent.ACTION_POINTER_DOWN ->'),
  interaction.indexOf('MotionEvent.ACTION_CANCEL ->', interaction.indexOf('MotionEvent.ACTION_POINTER_DOWN ->')));
assert.ok(multiPointer.includes('NativeGestureUtil.notifyNativeGestureStarted(host, event)') &&
  multiPointer.includes('suppressUntilAllUp = true') && multiPointer.includes('motion.cancel()'),
  'Multitouch must revoke even a passive RN press and suppress the stream until terminal UP/CANCEL');
assert.ok(interaction.includes('if (suppressUntilAllUp)') && interaction.includes('finishNative(event)'),
  'A cancelled multi-pointer stream must finish native ownership without selecting its first-finger UP');
assert.ok(pressLight.includes('if (glow <= .001f') && pressLight.includes('blendMode = BlendMode.PLUS') &&
  pressLight.includes('80f * density, .03f * glow') && pressLight.includes('.018f * glow') &&
  pressLight.includes('.12f * glow') && pressLight.includes('return half4(half3(light), 0.0)'),
  'Transient light must preserve original press radius/gains and leave the unpressed recipe/alpha untouched');
assert.ok(material.includes('resources.displayMetrics.density, epoch.scale,') &&
  material.includes('menuPressX - sampleLocation[0] - opticalMaterialOffsetX') &&
  material.includes('menuPressY - sampleLocation[1] - opticalMaterialOffsetY') &&
  pressLight.includes('float2 p = coord / rasterScale;'),
  'Press lighting must use the same committed physical source origin and captured raster epoch');
const apply = host.slice(host.indexOf('private fun applyFrame('), host.indexOf('override fun dispatchDraw('));
assert.ok(apply.indexOf('updateMenuPressLight(') < apply.indexOf('updateMenuMorph('),
  'The same frame\'s press light must publish before the existing single material Snapshot notification');
console.log('Menu interaction source contract passed (shared live bounds, retained absorption, bounded press rendering and explicit finite ownership).');
