import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const native = new URL('../../../modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/', import.meta.url);
const read = (name) => readFileSync(new URL(name, native), 'utf8');
const host = read('MenuMorphView.kt'), snapshot = read('MenuTriggerSnapshot.kt');
const group = read('MenuTriggerGroupView.kt'), owner = read('MenuMorphWindowOwner.kt');
const foreground = read('MenuGroupForeground.kt'), portal = read('menumotion/GlassForegroundPortal.kt');
const material = read('LiquidGlassView.kt'), optics = read('MenuMorphFieldOptics.kt');
const shaders = read('MenuMorphFieldShaders.kt'), backdrop = read('WindowBackdrop.kt');
const sourceOwnership = read('menumotion/MenuSourceOwnership.kt');
const kyantShaders = readFileSync(new URL('../../../modules/liquid-glass/android/vendor/backdrop-1.0.0/src/main/java/com/kyant/backdrop/Shaders.kt', import.meta.url), 'utf8');
const start = host.slice(host.indexOf('private fun requestStart('), host.indexOf('private fun updateTarget('));
assert.ok(start.includes('menuSourceTag(rect?.getOrNull(6))') &&
  start.includes('appContext.findView<View>(tag) as? MenuTriggerGroupView') &&
  start.includes('isGroupDescendant(buttonView, it)') && start.includes('through.set(source)') &&
  start.includes('setScreenBounds(it, through, normalizeTouch = true)') &&
  start.includes('setScreenBounds(groupView, source, normalizeTouch = false)'),
  'A declared native group and its exact descendant button must remain separate source/through identities; no heuristic ancestor takeover');
assert.ok(start.includes('sourceHasGlass = groupView != null && triggerSnapshot?.isGroupedSource == true') &&
  start.includes('pixels != null && drawing.attach(rootView, captureEnvelope)') &&
  start.indexOf('drawing.attach(') < start.indexOf('triggerSnapshot?.setGroupedRendering(true)') &&
  start.includes('MenuTriggerSnapshots.take(source, buttonView)'),
  'Whole-group takeover requires actual immutable pixels and a successful window owner; rejected groups retain the ordinary single-control fallback');
assert.ok(snapshot.includes('val groupedSource = authorizedGroup && view is MenuTriggerGroupView') &&
  snapshot.includes('if (authorizedGroup && !groupedSource) return null') &&
  snapshot.includes('if (!groupedSource && interactiveCount(view, 0) > 1) return null') &&
  snapshot.includes('if (groupedSource && interactiveCount(view, 0, 6) > 6) return null') &&
  snapshot.includes('view.width > 256f * density || view.height > 96f * density') &&
  snapshot.includes('MAX_PIXEL_COUNT = 360_000L'),
  'Only bounded, explicitly registered groups may hold several controls; plain rows/pages keep strict single-source rejection');
assert.ok(snapshot.includes('if (groupedSource) (view as MenuTriggerGroupView).drawMenuForeground(software)') &&
  group.includes('internal fun drawMenuForeground(canvas: Canvas) = super.dispatchDraw(canvas)') &&
  snapshot.includes('(isGroupedSource && !groupedRendering)') &&
  snapshot.includes('sourceOwner.visibility = if (groupedRendering) View.INVISIBLE else View.VISIBLE'),
  'Group immutable capture is foreground-only and only the real window portal may display it; the old small View must not double-paint group glyphs');
assert.ok(group.includes('MotionEvent.ACTION_DOWN') && group.includes('jelly.down(') &&
  group.includes('jelly.move(') && group.includes('jelly.release()') &&
  group.includes('jelly.deformControl(') && group.includes('if (menuOwnsDrawing || framePosted') &&
  group.includes('MenuTriggerSnapshots.releaseSource(this)'),
  'Permanent group press/drag/release deformation must exist before opening; native menu ownership suppresses a second frame clock and detach returns the source');
assert.ok(group.includes('val declared = declaredSourceFillColor ?: return null') &&
  group.includes('BackgroundStyleApplicator.getBackgroundColor(this)') &&
  group.includes('return declared.takeIf { it == actual }'),
  'Whole-group takeover must preserve an explicitly certified actual solid capsule color, not invent a sampled/tinted fill for arbitrary backgrounds');
assert.ok(owner.includes('window.overlay.add(this)') && owner.includes('return parent != null') &&
  owner.includes('alpha = 1f') && owner.includes('owner.drawWindowFrame(canvas)') &&
  owner.includes('owner.menuTargetLeft - location[0] - left') &&
  owner.includes('owner.menuTargetTop - location[1] - top') &&
  owner.includes('envelope.left - location[0]'),
  'The full transition must be drawn by a real root-local window View beyond the fixed card ancestor clip, with bounded physical envelope coordinates');
assert.doesNotMatch(owner, /(?:setRenderEffect|setLayerType|saveLayer|Bitmap\.createBitmap)\s*\(/,
  'The window drawing owner must not introduce a full-window alpha/filter/capture FBO');
assert.ok(owner.includes('if (ancestor === captureSource)') && owner.includes('capture.stage(relevant,') &&
  owner.includes('capture.finish(true, parent != null)') && owner.includes('visibility = INVISIBLE') &&
  owner.includes('if (depth == 0) owners.toList().forEach { it.get()?.restore() }') &&
  backdrop.includes('MenuMorphWindowOwners.beginCapture(captureSource)') &&
  backdrop.includes('MenuMorphWindowOwners.beginCapture(underlay)'),
  'Actual drawing owners must be excluded only from relevant manual captures and restored once after nested captures');
assert.ok(foreground.includes('recording.drawBitmap(bitmap, null, RectF(') &&
  foreground.includes('node.setAlpha(frame.sourceOpacity.coerceIn(0f, 1f))') &&
  foreground.includes('frame.sourceZoom') && foreground.includes('frame.sourceBlur'),
  'All captured group glyphs need independent source opacity/zoom/blur tracks, not the rows fade');
assert.doesNotMatch(foreground, /(?:getPixels|Bitmap\.createBitmap|\.recycle|\.draw\(software)\s*\(/,
  'Animated group replay may not recapture or recycle immutable source pixels');
assert.ok(portal.includes('val grouped = hasSource && drawSource != null') &&
  portal.includes('rowsNode.setAlpha(rowsOpacity)') &&
  portal.includes('GlassPortalBlur.combinedRadius(rowsSigmaX, if (grouped) 0f else portalSigma, scale)') &&
  portal.includes('sourceCompositeNode.setRenderEffect(') &&
  portal.includes('drawSource?.invoke(recording)') &&
  portal.includes('if (rowsVisible) recording.drawRenderNode(rowsNode)') &&
  portal.includes('recording.drawRenderNode(if (grouped) sourceCompositeNode else rowsNode)') &&
  portal.includes('foregroundNode.setRenderEffect(RenderEffect.createRuntimeShaderEffect(portal, "content"))'),
  'Group source and rows must retain independent blur/reveal then compose before common portal blur/lens; ordinary fused-row behavior stays separate');
assert.ok(material.includes('menuFieldShape ?: menuMorphShape ?: restingGlassShape') &&
  material.includes('menuFieldOptics!!.applyLens(this, epoch.scale, menuCommittedOpticalOrigin(),') &&
  material.includes('highlight.copy(style = menuFieldOptics!!.highlightStyle(highlight.style, epoch.scale, ::menuCommittedOpticalOrigin))') &&
  material.includes('menuFieldOptics?.drawPressLight('),
  'Union path clipping, lens, highlight and press light must share the same geometry; a bounding rounded rectangle is insufficient');
assert.ok(optics.includes('texture.update(field)') && optics.includes('texture.bind(shader)') &&
  optics.includes('field !== lastField') && optics.includes('texture.update(null)') &&
  optics.includes('coordinates.localOriginX, coordinates.localOriginY') &&
  optics.includes('"offset", -coordinates.padding, -coordinates.padding') &&
  shaders.includes('(coord + offset) / rasterScale + nodeOrigin') &&
  shaders.includes('field.x * rasterScale'),
  'Physical shared-field coordinates must map once through a captured epoch, including effect padding and new-session field identity');
assert.doesNotMatch(optics, /(?:GlassGaussianField\(|postFrameCallback|sendApplyNotifications|createChainEffect\(.*createBlur)/,
  'Field geometry reuse must not add a second CPU field, independent clock or material blur pass');
const lens = optics.slice(optics.indexOf('fun applyLens('), optics.indexOf('/** Keep the original width/blur/opacity'));
assert.ok(lens.includes('!menuFieldLensInputsReady(scope.size.width, scope.size.height,') &&
  lens.includes('refractionHeight, refractionAmount, scope.padding)') &&
  lens.indexOf('!menuFieldLensInputsReady(') < lens.indexOf('padding = max(') &&
  lens.indexOf('!menuFieldLensInputsReady(') < lens.indexOf('MenuMorphFieldCoordinates('),
  'Attach-before-measure Backdrop evaluation must defer unspecified/nonfinite lens inputs before padding mutation or coordinate construction');
assert.ok(optics.includes('override val color get() = base.color') &&
  optics.includes('override val blendMode get() = base.blendMode') &&
  optics.includes('refractionAmount", -refractionAmount') &&
  optics.includes('(if (trigger) 38f else 80f) * density') &&
  optics.includes('(if (trigger) .07f else .03f) * glow') &&
  optics.includes('(if (trigger) .055f else .018f) * glow') &&
  optics.includes('(if (trigger) .3f else .12f) * glow') &&
  optics.includes('trigger: Boolean = false') && shaders.includes('return half4(half3(light), 0.0)'),
  'Existing recipe colors, directional highlight and original transient light coefficients/alpha must be retained');
const dispersionRecipe = (text) => {
  const start = text.indexOf('    half4 color = half4(0.0);');
  const end = text.indexOf('    return color;', start);
  assert.ok(start >= 0 && end > start, 'Missing actual Kyant dispersion recipe');
  return text.slice(start, end + '    return color;'.length);
};
assert.equal(dispersionRecipe(shaders), dispersionRecipe(kyantShaders),
  'All seven original Kyant dispersion sample/channel/alpha weights must remain exact when replacing geometry');
assert.ok(shaders.includes('float intensity = pow(abs(d), falloff);') &&
  shaders.includes('float2 normal = float2(cos(angle), sin(angle));') &&
  !shaders.includes('glassFace(') && !optics.includes('tintColor'),
  'Field optics must retain the existing angular highlight and color recipe, not import another material tint/fill model');
assert.ok(host.includes('sourceFillPaint.color = color') &&
  host.includes('menuGroupSourceFillAlpha(color, progress)') &&
  host.includes('drawSourceFill(canvas, liveFrame.contentProgress, true)') &&
  host.includes('GlassMorphTuning(null,') && host.includes('.48'),
  'The actual source ARGB fill must keep its original endpoint and use the demo-specific group absorb timing, without coupling glyph reveal');
const drawFrame = host.slice(host.indexOf('internal fun drawWindowFrame('), host.indexOf('private fun drawSourceFill('));
assert.ok(drawFrame.indexOf('drawSourceFill(canvas, liveFrame.contentProgress, true)') < drawFrame.indexOf('drawMenuWindowPressLight(') &&
  drawFrame.indexOf('drawMenuWindowPressLight(') < drawFrame.indexOf('portal.draw(') &&
  material.includes('width, height, 1f, Offset(screenLeft, screenTop)') &&
  material.includes('menuPressY, menuPressGlow, menuPressTrigger') &&
  material.includes('if (menuFieldShape == null) {\n                    menuPressLight?.draw('),
  'Group light must be one physical field pass after original source fill and before foreground; it must not be attenuated twice by menu material opacity');
const registration = sourceOwnership.slice(sourceOwnership.indexOf('internal fun handoffMenuSourceAfterRegistration('), sourceOwnership.indexOf('/** Main-thread lifecycle boundary'));
assert.ok(registration.indexOf('if (!valid()) return false') < registration.indexOf('register()') &&
  registration.indexOf('if (!registered || !valid()) return false') < registration.indexOf('restore()'),
  'The real shared handoff helper must register before restoration and revalidate after registration; failed/stale registration cannot return the source');
const restore = snapshot.slice(snapshot.indexOf('internal fun restoreSourceForHandoff('), snapshot.indexOf('/** A bounded View owns pixels/filtering'));
assert.ok(restore.includes('isGroupedSource && !ownership.released && !sourceLeaseReturned') &&
  restore.includes('view.id == sourceId') && restore.includes('sameSourcePlacement(view)') &&
  restore.includes('view.transitionAlpha == 0f') &&
  restore.includes('root.isAttachedToWindow && root.isHardwareAccelerated && root.isShown') &&
  restore.includes('register = { registerBeforeRestore(root) }') &&
  restore.includes('restore = { returnSourceLease(view) }') &&
  !restore.includes('release()') && !restore.includes('bitmap'),
  'Only a valid same-root group lease can register/return at handoff; returning it must keep immutable foreground pixels alive');
const beginHandoff = host.slice(host.indexOf('private fun beginSourceHandoff('), host.indexOf('private fun finishSourceHandoff('));
assert.ok(beginHandoff.includes('sourceHandoff.begin(activeSession)') &&
  beginHandoff.includes('snapshot.restoreSourceForHandoff { sourceRoot ->') &&
  beginHandoff.includes('observer.registerFrameCommitCallback(callback)') &&
  beginHandoff.includes('mainHandler.post { finishSourceHandoff(ticket, true, "source-buffer-committed") }') &&
  beginHandoff.includes('mainHandler.postDelayed(timeout, 200L)') &&
  beginHandoff.includes('if (!registered) {\n      cancelSourceHandoff()'),
  'Group completion must observe the real source window commit with a session ticket, main-thread callback and finite fallback; no fixed extra animation delay');
const finishHandoff = host.slice(host.indexOf('private fun finishSourceHandoff('), host.indexOf('private fun resetContent('));
assert.ok(finishHandoff.includes('if (!sourceHandoff.finish(ticket, activeSession, requestedOpen)) return') &&
  finishHandoff.includes('mainHandler.removeCallbacks(it)') &&
  finishHandoff.includes('observer.unregisterFrameCommitCallback(callback)') &&
  finishHandoff.includes('sourceHandoff.cancel()') &&
  finishHandoff.includes('emitComplete(false, allowHandoff = false)'),
  'Reopen/dispose/timeout must revoke the exact commit observer and ticket, so a late callback cannot close a new menu');
const terminal = host.slice(host.indexOf('private fun drawTerminalSource('), host.indexOf('private fun updateSourcePose('));
assert.ok(drawFrame.includes('if (sourceHandoff.pending) drawTerminalSource(canvas)') &&
  terminal.includes('liveFrame.copyFrom(motion.frame)') && terminal.includes('updateSourcePose(liveFrame)') &&
  terminal.includes('drawSourceFill(canvas, 0f, false)') && terminal.includes('groupForeground?.draw(canvas)'),
  'The pending window owner must retain the whole terminal source with its current jelly pose until the original source is committed');
assert.doesNotMatch(terminal, /(?:clipPath\(|drawRows\(|portal\.draw\(|drawChild\()/,
  'Terminal source handoff must not be cut into the incoming circle or retain menu material/rows/portal warp');
const complete = host.slice(host.indexOf('private fun emitComplete('), host.indexOf('private fun beginSourceHandoff('));
assert.ok(complete.includes('if (!open && allowHandoff && sourceHasGlass && beginSourceHandoff()) return') &&
  complete.indexOf('releaseTrigger()') < complete.indexOf('onMotionComplete('),
  'Group close waits for source handoff before the JS completion; final source cleanup precedes modal lifetime completion');
console.log('Whole-toolbar source contract passed (explicit group/through, window ownership, independent tracks, shared optics, press presets and bounded source-buffer handoff; complete device phases still required).');
