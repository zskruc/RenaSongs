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
const handoffPatch = read('MenuHandoffPatch.kt');
const handoffGeometry = read('MenuHandoffPatchGeometry.kt');
const atomic = read('MenuAtomicSourceHandoff.kt');
const atomicPolicy = read('menumotion/MenuAtomicHandoffPolicy.kt');
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
assert.ok(foreground.includes('recording.drawBitmap(bitmap, null, bitmapRect, bitmapPaint)') &&
  foreground.includes('private val bitmapRect = RectF(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat())') &&
  foreground.includes('node.setAlpha(frame.sourceOpacity.coerceIn(0f, 1f))') &&
  foreground.includes('frame.sourceZoom') && foreground.includes('frame.sourceBlur'),
  'All captured group glyphs need independent source opacity/zoom/blur tracks, not the rows fade');
assert.doesNotMatch(foreground, /(?:getPixels|Bitmap\.createBitmap|\.recycle|\.draw\(software)\s*\(/,
  'Animated group replay may not recapture or recycle immutable source pixels');
const groupReplay = foreground.slice(foreground.indexOf('fun draw(canvas:'), foreground.indexOf('fun diagnostics('));
assert.ok(groupReplay.includes('if (node.alpha <= .001f) return') &&
  groupReplay.includes('if (lastBlur <= .01f)') &&
  groupReplay.includes('node.translationX + bitmap.width / 2f, node.translationY + bitmap.height / 2f') &&
  groupReplay.includes('canvas.scale(node.scaleX, node.scaleY)') &&
  groupReplay.includes('directPaint.alpha = (node.alpha * 255f).roundToInt().coerceIn(0, 255)') &&
  groupReplay.includes('canvas.drawBitmap(bitmap, null, directRect, directPaint)') &&
  groupReplay.includes('canvas.drawRenderNode(node)') &&
  foreground.includes('RenderEffect.createBlurEffect(lastBlur, lastBlur, Shader.TileMode.DECAL)'),
  'Only the already-unblurred source phase may draw immutable pixels directly with the same center/pivot/alpha; active sourceBlur must retain its independent Gaussian track');
const sourceRecording = foreground.slice(foreground.indexOf('private fun recordBitmap('), foreground.indexOf('fun update('));
assert.ok(sourceRecording.includes('node.beginRecording(bitmap.width, bitmap.height)') &&
  sourceRecording.includes('recording.drawBitmap(bitmap, null, bitmapRect, bitmapPaint)') &&
  sourceRecording.includes('finally { node.endRecording() }') &&
  groupReplay.includes('if (!node.hasDisplayList()) { recordBitmap(); rerecords++ }') &&
  groupReplay.indexOf('if (!node.hasDisplayList())') < groupReplay.indexOf('canvas.drawRenderNode(node)'),
  'A source RenderNode evicted while absorbed must re-record the same immutable pixels before its active-blur replay');
assert.doesNotMatch(sourceRecording, /(?:setAlpha|setScale|setTranslation|setRenderEffect|\.draw\(software|Bitmap\.createBitmap|recycle)\s*\(/,
  'Re-recording missing source pixels must not change physical pose/alpha/sourceBlur or capture live views again');
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
const patchPrepare = backdrop.slice(backdrop.indexOf('internal fun prepareMenuHandoffPatch('), backdrop.indexOf('internal fun isMenuHandoffPatchCurrent('));
assert.ok(patchPrepare.includes('sourceView.transitionAlpha != 0f') &&
  patchPrepare.includes('val key = captured.menuUnderlay ?: return null') &&
  patchPrepare.includes('!menuUnderlayPolicy.hasCached || currentMenuKey() != key || program.key != key') &&
  patchPrepare.includes('program.owner.get() !== owner || program.source.get() !== sourceRoot') &&
  patchPrepare.includes('captured.sourceRecordedAtUptime <= hiddenAtUptime') &&
  patchPrepare.includes('captured.submittedAtUptime <= hiddenAtUptime') &&
  patchPrepare.includes('!nativePage.policy.accepts(key.pageEpoch)') &&
  patchPrepare.includes('hasDynamicHandoffSource(sourceRoot)') &&
  patchPrepare.includes('menuHandoffPatchRegion('),
  'A handoff patch must come from the same accepted raw Activity image/owner/page recorded after the real source was hidden, with covered bounded ROI and dynamic-source rejection');
assert.ok(backdrop.includes('val sourceRecordedAtUptime: Long = 0L') &&
  backdrop.includes('val menuSourceRecordedAtUptime: Long = 0L') &&
  backdrop.includes('program.recordedAtUptime)') && backdrop.includes('ticket.menuSourceRecordedAtUptime)') &&
  snapshot.indexOf('view.transitionAlpha = 0f') < snapshot.indexOf('sourceHiddenAtUptime = SystemClock.uptimeMillis()'),
  'The actual producer-record time must survive the immutable GPU ticket/frame; a late submission/publish timestamp cannot authorize a pre-hide source image');
const activityRecord = backdrop.slice(backdrop.indexOf('private fun captureNativeMenu('), backdrop.indexOf('internal fun drawMenuScrim('));
assert.ok(activityRecord.indexOf('underlay.draw(recording)') < activityRecord.indexOf('MenuProgram(key, node,') &&
  activityRecord.includes('WeakReference(scrim),\n      SystemClock.uptimeMillis())'),
  'Producer timestamp must be generated after the actual Activity drawing, not when an older node is rebound or its image submitted');
assert.ok(handoffPatch.includes('picture.beginRecording(region.width, region.height)') &&
  handoffPatch.includes('recording.drawBitmap(frame.bitmap,') &&
  handoffPatch.includes('Bitmap.createBitmap(picture, region.width, region.height, Bitmap.Config.ARGB_8888)') &&
  handoffPatch.includes('pixels === frame.bitmap || pixels.config != Bitmap.Config.ARGB_8888 || pixels.isMutable') &&
  handoffPatch.includes('pixels.density = Bitmap.DENSITY_NONE') &&
  handoffPatch.includes('pixels.getPixels(') && handoffPatch.includes('(it ushr 24) != 255'),
  'Only an independent immutable software ARGB ROI with every pixel opaque may cover the original source; no full producer screenshot readback or assumed opacity');
assert.doesNotMatch(handoffPatch, /(?:createBitmap\(frame\.bitmap|\.copy\(|retireImage\(|releaseCapture\(|syncAndDraw\(|acquireNextImage\(|\.recycle\()/,
  'Patch preparation must not copy the full producer, hold/change Image retirement, enqueue another capture or recycle pixels still used by HWUI');
assert.ok(patchPrepare.includes('catch (failure: RuntimeException)') && patchPrepare.includes('catch (_: OutOfMemoryError)') &&
  patchPrepare.includes('return null'),
  'Unavailable hardware-to-small-software copy must fall back without crashing or blocking source return');
const patchCurrent = backdrop.slice(backdrop.indexOf('internal fun isMenuHandoffPatchCurrent('), backdrop.indexOf('internal fun menuHandoffPatchDiagnostics('));
assert.ok(patchCurrent.includes('observeBackgroundScene(source)') && patchCurrent.includes('menuHandoffPatchKeyMatches(') &&
  patchCurrent.includes('menuBackgroundChanges.signatureChangeCount') &&
  handoffGeometry.includes('if (!handoff) return expected == current') &&
  handoffGeometry.includes('elapsedHandoffMs in 0L..200L') &&
  handoffGeometry.includes('current.copy(sceneVersion = expected.sceneVersion) == expected'),
  'Open/rest reuse must match the exact source identity; only a locked <=200ms terminal transaction may freeze across its known restore draw while metadata and every other key remain strict');
const queuePatch = host.slice(host.indexOf('private fun queueHandoffPatchPreparation('), host.indexOf('private fun beginSourceHandoff('));
assert.ok(complete.includes('if (open) queueHandoffPatchPreparation()') &&
  queuePatch.includes('activeSession != session || !requestedOpen || !settled || !sourceHasGlass || !isAttachedToWindow') &&
  queuePatch.includes('snapshot.sourceForHandoff()') && queuePatch.includes('snapshot.sourceHiddenAtUptime') &&
  queuePatch.includes('mainHandler.postDelayed(preparation, 48L)') &&
  queuePatch.includes('mainHandler.removeCallbacks(it)') &&
  host.includes('cancelHandoffPatchPreparation()\n    preparedHandoffPatch = null'),
  'Small raw-patch preparation is once after settled open; stale delayed work, quick close, detach and reopen must not install a patch into another presentation');
assert.ok(beginHandoff.indexOf('isMenuHandoffPatchCurrent(patch, this)') < beginHandoff.indexOf('patch.beginHandoff()') &&
  beginHandoff.indexOf('patch.beginHandoff()') < beginHandoff.indexOf('snapshot.restoreSourceForHandoff') &&
  terminal.indexOf('patch.draw(canvas, target.left, target.top, sourceFillBounds, liveFrame.sourceRadius)') < terminal.indexOf('drawSourceFill(canvas, 0f, false)') &&
  terminal.includes('preparedHandoffPatch = null'),
  'Only an exact pre-return patch may lock for handoff; terminal draws raw background before unchanged source fill/glyphs and rejects invalidated patches');
const atomicAvailable = host.slice(host.indexOf('private fun atomicSourceHandoffAvailable('), host.indexOf('private fun tryBeginAtomicSourceHandoff('));
const beginAtomic = host.slice(host.indexOf('private fun tryBeginAtomicSourceHandoff('), host.indexOf('private fun finishSourceHandoff('));
assert.ok(atomicAvailable.includes('Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE') &&
  beginAtomic.includes('Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE') &&
  beginHandoff.indexOf('if (tryBeginAtomicSourceHandoff(snapshot, ticket)) return true') < beginHandoff.indexOf('snapshot.restoreSourceForHandoff') &&
  atomic.includes('sourceRoot !== targetRoot') && atomic.includes('sourceRoot.isAttachedToWindow && targetRoot.isAttachedToWindow') &&
  atomic.includes('sourceRoot.isHardwareAccelerated && targetRoot.isHardwareAccelerated') &&
  atomic.includes('sourceRoot.rootSurfaceControl != null && targetRoot.rootSurfaceControl != null'),
  'API34 distinct attached hardware roots must qualify before primary atomic handoff; unsupported roots retain the existing fallback');
assert.ok(atomic.includes('SurfaceSyncGroup("RenaSongsMenuSource")') &&
  atomic.includes('addSource = { group.add(sourceRoot.rootSurfaceControl, null) }') &&
  atomic.includes('addTarget = { group.add(targetRoot.rootSurfaceControl, null) }') &&
  atomic.includes('commit.addTransactionCommittedListener(executor) { weak.get()?.onCommitted() }') &&
  atomic.includes('group.addTransaction(commit)') && !atomic.includes('addSyncCompleteCallback('),
  'Atomic source return must join both roots without add-runnable mutations and observe the merged SurfaceControl transaction commit, not merely sync readiness');
assert.ok(atomicPolicy.indexOf('sourceJoined = addSource()') < atomicPolicy.indexOf('targetJoined = addTarget()') &&
  atomicPolicy.indexOf('targetJoined = addTarget()') < atomicPolicy.indexOf('installCommit()') &&
  atomicPolicy.indexOf('installCommit()') < atomicPolicy.indexOf('staged = stage()') &&
  atomicPolicy.includes('stageUncertain = phase == "stage"') &&
  atomicPolicy.includes('finally {\n    try {\n      markReady()'),
  'Both membership successes and commit registration must precede stage; every created-group failure attempts readiness and stage exceptions cannot promise rollback');
assert.ok(atomic.includes('try { sourceRoot.invalidate(); targetRoot.invalidate() }') &&
  atomic.includes('finally { group.markSyncReady() }') &&
  atomic.includes('try { transaction?.close() }') &&
  atomic.includes('val weak = WeakReference(this)') && atomic.includes('fun cancel() { completion = null }') &&
  atomic.includes('if (committed) return') && atomic.includes('completion = null'),
  'Partial groups must trigger bounded root traversal and readiness, close only their donor transaction and leave no strong menu callback in the unremovable platform listener');
assert.ok(beginAtomic.includes('handoffTicket == ticket && isAttachedToWindow') &&
  beginAtomic.includes('activeSession == ticket.session && !requestedOpen && isAttachedToWindow') &&
  beginAtomic.indexOf('snapshot.restoreSourceForHandoff') < beginAtomic.indexOf('drawing.hideForAtomicHandoff()') &&
  beginAtomic.includes('if (!result.staged && !result.stageUncertain)') &&
  beginAtomic.includes('mainHandler.postDelayed(timeout, 2_000L)') &&
  !beginAtomic.includes('registerFrameCommitCallback('),
  'Atomic stage must revalidate the exact presentation, return source and hide Dialog together; a possibly staged group waits for its own commit/watchdog instead of launching parallel fallback');
assert.ok(finishHandoff.includes('atomicSourceHandoff?.cancel()') &&
  finishHandoff.includes('atomicSourceHandoff = null') &&
  owner.includes('visibility = if (atomicHandoffHidden) INVISIBLE else VISIBLE') &&
  owner.includes('if (!suppressed && !atomicHandoffHidden) visibility = VISIBLE'),
  'Reopen/detach/disposal must revoke the coordinator callback; capture restoration cannot resurrect the Dialog source hidden by an atomic handoff');
console.log('Whole-toolbar source contract passed (explicit group/through, independent tracks/optics, bounded fallback patch and dual-root atomic handoff lifecycle; actual compositor presentation still requires device pixels).');
