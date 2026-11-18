/*
 * SPDX-License-Identifier: MIT
 * Adapted from rit3zh/expo-glass-custom-menu (GlassRenderer.drawForeground and
 * GlassMenuSession rows blur). Source revision:
 * 0021efd8ab0d068f155bbdac62c5f673ccc39a24.
 * Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).
 * See EXPO_GLASS_CUSTOM_MENU_LICENSE for the upstream MIT notice.
 */
package expo.modules.liquidglass.menumotion

import android.graphics.Canvas
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import android.util.Log
import android.view.View
import androidx.annotation.RequiresApi
import java.util.WeakHashMap
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Upstream foreground lens; the existing material remains a separate pass. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class GlassForegroundPortal(density: Float) {
  // A/B opt-out is read once for this renderer, never on the motion hot path.
  private val legacyForeground = Log.isLoggable("ResonusGlassLegacyForeground", Log.DEBUG)
  // Isolated experiments default OFF. Constructor-only reads keep the201
  // baseline graph/raster unless one specific candidate is explicitly chosen.
  private val motionRows = Log.isLoggable("ResonusGlassMotionRows", Log.DEBUG)
  private val motionClip = Log.isLoggable("ResonusGlassMotionClip", Log.DEBUG)
  private val motionBudget = Log.isLoggable("ResonusGlassMotionBudget", Log.DEBUG)
  private val samplingExtent = RectF()
  private val outputClip = RectF()
  private var samplingExtentValid = false
  private var lensDisplacement = 0f
  private var rowsGaussian: RenderEffect? = null
  private var portalEffect: RenderEffect? = null
  private var drawMode = -1
  private var fusedDraws = 0L
  private var legacyDraws = 0L
  private var groupedDraws = 0L
  private var boundaryFallbackDraws = 0L
  private val portal = RuntimeShader(GlassForegroundPortalShader)
  private val opacityPortalDelegate = lazy { RuntimeShader(GlassForegroundPortalOpacityShader) }
  private val opacityPortal by opacityPortalDelegate
  private var activePortal = portal
  private var opacityInShader = false
  private var shaderOpacityDraws = 0L
  private val texture = GlassFieldTexture()
  private val foregroundNode = RenderNode("ResonusMenu.foreground")
  private val rowsNode = RenderNode("ResonusMenu.rows")
  private val sourceCompositeNode = RenderNode("RenaMenu.sourceAndRows")
  private val raster = GlassPortalRaster(density, if (motionBudget) 480_000f else 720_000f)
  private val incoming = RectF()
  private val outgoing = RectF()
  private val contentBlur = WeakHashMap<View, Float>()
  private var hasSource = false
  private var rowsVisible = false
  private var sourceVisible = false
  private var rowsSigmaX = 0f
  private var rowsSigmaY = 0f
  private var portalBlur = 0f
  private var generation = 0L
  private var renderedGeneration = -1L
  private var effectGeneration = -1L
  private var effectLeft = Float.NaN
  private var effectTop = Float.NaN
  private var effectScale = Float.NaN
  private var rowsEffectX = Float.NaN
  private var rowsEffectY = Float.NaN
  private var compositeBlur = Float.NaN
  private var nodeWidth = 0
  private var nodeHeight = 0
  private var wasWarping = false

  var diagnosticsEnabled = false
  private var draws = 0L
  private var records = 0L
  private var invisibleSkips = 0L
  private var maxPhysicalPixels = 0L
  private var maxRasterPixels = 0L
  private var maxCompensatedBlur = 0f
  private var maxScreenBlur = 0f
  private var rasterReservations = 0L
  private var nodeResizes = 0L
  private var effectRebuilds = 0L
  private var rowsEffectRebuilds = 0L
  private var outputClipDraws = 0L
  private var outputClipSavedPixels = 0L

  /** Called at session attachment or an actual target/window layout change. */
  fun reserve(target: RectF, @Suppress("UNUSED_PARAMETER") originX: Float,
    @Suppress("UNUSED_PARAMETER") originY: Float, windowBounds: RectF, hasGlassSource: Boolean = false) {
    if (raster.reserve(target.width(), target.height(), windowBounds.width(), windowBounds.height(), hasGlassSource))
      rasterReservations++
  }

  /** `field` comes from the outline; no duplicate Gaussian CPU pass. */
  fun update(frame: GlassMorphFrame, originX: Float, originY: Float,
    hasSource: Boolean, field: GlassGaussianField?) {
    incoming.set(frame.bounds)
    incoming.offset(-originX, -originY)
    outgoing.set(frame.sourceLobe)
    outgoing.offset(-originX, -originY)
    this.hasSource = hasSource
    updateSamplingExtent(frame, field)
    val rowsOpacity = frame.rowsOpacity.coerceIn(0f, 1f)
    rowsVisible = rowsOpacity > .001f
    sourceVisible = hasSource && frame.sourceOpacity > .001f
    // Opacity belongs to the bounded raster node. Applying it to the full-size
    // RN body promotes that native View to a full physical hardware alpha layer
    // before this portal's sampling transform, defeating the pixel budget.
    // A nongroup menu has exactly one foreground image. Its uniform opacity
    // commutes with both linear filters, so keep the filtered node opaque and
    // apply the scalar in its final portal shader. This avoids HWUI's large
    // additional "alpha caused saveLayer". Group source/rows have independent
    // opacity and retain the original shader, node alpha and composition.
    opacityInShader = !hasSource && motionRows
    rowsNode.setAlpha(if (opacityInShader) 1f else rowsOpacity)
    activePortal = if (opacityInShader) opacityPortal else portal
    generation++
    // Invisible rows are skipped by GlassMenuSession before foreground draw.
    if (!rowsVisible && !sourceVisible) return
    val shader = activePortal
    if (opacityInShader) shader.setFloatUniform("contentOpacity", rowsOpacity)
    shader.setFloatUniform("center", incoming.centerX(), incoming.centerY())
    shader.setFloatUniform("halfSize", incoming.width() / 2f, incoming.height() / 2f)
    shader.setFloatUniform("cornerRadii", frame.radiusX, frame.radiusY)
    val secondary = if (hasSource) outgoing else incoming
    shader.setFloatUniform("secondaryEnabled", if (hasSource) 1f else 0f)
    shader.setFloatUniform("secondaryCenter", secondary.centerX(), secondary.centerY())
    shader.setFloatUniform("secondaryHalfSize", secondary.width() / 2f, secondary.height() / 2f)
    shader.setFloatUniform("secondaryRadii", frame.sourceRadius, frame.sourceRadius)
    shader.setFloatUniform("smoothing", frame.smoothing)
    texture.update(field)
    texture.bind(shader)
    shader.setFloatUniform("height", frame.lensHeight)
    shader.setFloatUniform("amount", frame.lensAmount)
    portalBlur = frame.portalBlur
  }

  /**
   * A session reserves filtered dimensions once. Motion moves the physical
   * origin, while rasterScale and both RenderNode capacities remain constant.
   * Raster coordinates map back to physical field/lens coordinates. Only
   * transient images are downsampled; settled native content draws directly.
   */
  fun draw(canvas: Canvas, bounds: RectF, warp: Boolean, drawContent: (Canvas) -> Unit,
    drawSource: ((Canvas) -> Unit)? = null) {
    if (!warp || !canvas.isHardwareAccelerated) {
      // As upstream, retain the fixed nodes until the presentation ends. They
      // are not drawn while settled, but closing can reuse the same capacity.
      drawContent(canvas)
      if (sourceVisible) drawSource?.invoke(canvas)
      return
    }
    val grouped = hasSource && drawSource != null
    if (!rowsVisible && !(grouped && sourceVisible)) {
      if (diagnosticsEnabled) invisibleSkips++
      return
    }
    val portalSigma = GlassPortalBlur.sigma(portalBlur)
    val blurReach = max(portalSigma, max(rowsSigmaX, rowsSigmaY))
    if (!raster.update(incoming, if (hasSource) outgoing else null, bounds, blurReach)) return
    val area = raster.bounds
    val scale = raster.scale
    val width = raster.width
    val height = raster.height
    val dimensionsChanged = nodeWidth != width || nodeHeight != height
    if (dimensionsChanged) {
      nodeWidth = width; nodeHeight = height
      rowsNode.setPosition(0, 0, width, height)
      foregroundNode.setPosition(0, 0, width, height)
      sourceCompositeNode.setPosition(0, 0, width, height)
      foregroundNode.setPivotX(0f); foregroundNode.setPivotY(0f)
      // The reserved guard already includes all filter reach. Explicit bounds
      // clipping prevents Skia from adding changing blur-outset layer sizes.
      rowsNode.setClipToBounds(true)
      foregroundNode.setClipToBounds(true)
      sourceCompositeNode.setClipToBounds(true)
      if (diagnosticsEnabled) nodeResizes++
    }
    foregroundNode.setScaleX(1f / scale)
    foregroundNode.setScaleY(1f / scale)
    foregroundNode.setTranslationX(area.left)
    foregroundNode.setTranslationY(area.top)

    // Both original Gaussian passes precede the lens. Their variances add,
    // so one anisotropic Gaussian preserves both blur phases while avoiding
    // another filtered intermediate image (RN body has no trigger composite).
    // With a real glass trigger, rows and source retain independent opacity
    // and Gaussian tracks before they meet the portal. A shared rows alpha or
    // fused rows blur would erase/blur the toolbar along the wrong timeline.
    var gaussianChanged = false
    if (rowsVisible) {
      val blurX = GlassPortalBlur.combinedRadius(rowsSigmaX, if (grouped) 0f else portalSigma, scale)
      val blurY = GlassPortalBlur.combinedRadius(rowsSigmaY, if (grouped) 0f else portalSigma, scale)
      if (blurX != rowsEffectX || blurY != rowsEffectY) {
        rowsEffectX = blurX; rowsEffectY = blurY
        rowsGaussian = if (blurX > 0f || blurY > 0f)
          RenderEffect.createBlurEffect(blurX, blurY, Shader.TileMode.DECAL) else null
        gaussianChanged = true
        if (diagnosticsEnabled) rowsEffectRebuilds++
      }
    }
    // Geometry uniforms are snapshotted by RenderEffect. Reuse an effect and
    // recording only for repeated draws of the same unchanged native frame.
    val effectChanged = effectGeneration != generation || effectLeft != area.left ||
      effectTop != area.top || effectScale != scale
    if (effectChanged) {
      effectGeneration = generation; effectLeft = area.left; effectTop = area.top; effectScale = scale
      activePortal.setFloatUniform("nodeOrigin", area.left, area.top)
      activePortal.setFloatUniform("rasterScale", scale)
      portalEffect = RenderEffect.createRuntimeShaderEffect(activePortal, "content")
      if (diagnosticsEnabled) effectRebuilds++
    }
    // The legacy intermediate clips its Gaussian output before portal sampling.
    // Fuse only if EVERY possibly nonzero portal sample is strictly inside that
    // domain, including smoothed-field interpolation and worst-case lens shift.
    // At cropped window edges we retain the original two-node path.
    val fused = !hasSource && !grouped && !legacyForeground && samplingFits(area, scale)
    val nextMode = if (grouped) 2 else if (fused) 1 else 0
    val modeChanged = drawMode != nextMode
    rowsNode.setPivotX(0f); rowsNode.setPivotY(0f)
    rowsNode.setScaleX(if (fused) 1f / scale else 1f)
    rowsNode.setScaleY(if (fused) 1f / scale else 1f)
    rowsNode.setTranslationX(if (fused) area.left else 0f)
    rowsNode.setTranslationY(if (fused) area.top else 0f)
    if (rowsVisible && (gaussianChanged || effectChanged || modeChanged)) {
      rowsNode.setRenderEffect(if (fused) rowsGaussian?.let {
        RenderEffect.createChainEffect(checkNotNull(portalEffect), it)
      } ?: portalEffect else rowsGaussian)
    }
    if (!fused && (effectChanged || modeChanged)) foregroundNode.setRenderEffect(portalEffect)
    // A grouped source can stay visible after its rows have disappeared. Do
    // not record/filter a body that the composite will not draw. Keep the last
    // recorded generation: a reverse/reveal update advances generation, so its
    // first visible draw must record current geometry and reconcile blur above.
    if (rowsVisible && (effectChanged || dimensionsChanged || renderedGeneration != generation ||
      contentBlur.keys.any { it.isDirty || it.isLayoutRequested })) {
      val recording = rowsNode.beginRecording(width, height)
      try {
        recording.scale(scale, scale)
        recording.translate(-area.left, -area.top)
        drawContent(recording)
      } finally { rowsNode.endRecording() }
      renderedGeneration = generation
      if (diagnosticsEnabled) records++
    }
    if (grouped) {
      val portalRadius = GlassPortalBlur.radius(portalSigma * scale)
      if (compositeBlur != portalRadius) {
        compositeBlur = portalRadius
        sourceCompositeNode.setRenderEffect(if (portalRadius > .01f)
          RenderEffect.createBlurEffect(portalRadius, portalRadius, Shader.TileMode.DECAL) else null)
      }
      val recording = sourceCompositeNode.beginRecording(width, height)
      try {
        if (sourceVisible) {
          val save = recording.save()
          recording.scale(scale, scale)
          recording.translate(-area.left, -area.top)
          drawSource?.invoke(recording)
          recording.restoreToCount(save)
        }
        if (rowsVisible) recording.drawRenderNode(rowsNode)
      } finally { sourceCompositeNode.endRecording() }
    }
    if (!fused && (dimensionsChanged || !foregroundNode.hasDisplayList() || grouped || modeChanged)) {
      val recording = foregroundNode.beginRecording(width, height)
      try { recording.drawRenderNode(if (grouped) sourceCompositeNode else rowsNode) } finally { foregroundNode.endRecording() }
    }
    wasWarping = true
    val node = if (fused) rowsNode else foregroundNode
    // The portal shader returns exact transparent black outside its field's
    // conservative support. Discard only that final transparent output; never
    // change a recording, intermediate clip, filter radius, sampling origin or
    // node capacity. Retain additional lens/Gaussian reach inside the output
    // clip so HWUI's filter culling has the same needed input neighbourhood.
    // The source-and-rows path keeps its original drawing byte-for-byte.
    if (!hasSource && !grouped && motionClip && prepareOutputClip(area, scale)) {
      val save = canvas.save()
      try {
        canvas.clipRect(outputClip)
        canvas.drawRenderNode(node)
      } finally { canvas.restoreToCount(save) }
      if (diagnosticsEnabled) {
        outputClipDraws++
        outputClipSavedPixels += max(0L, width.toLong() * height -
          ceil(outputClip.width() * scale).toLong() * ceil(outputClip.height() * scale).toLong())
      }
    } else canvas.drawRenderNode(node)
    drawMode = nextMode
    if (diagnosticsEnabled) {
      draws++
      if (opacityInShader) shaderOpacityDraws++
      if (grouped) groupedDraws++ else if (fused) fusedDraws++ else {
        legacyDraws++
        if (!legacyForeground) boundaryFallbackDraws++
      }
      maxPhysicalPixels = max(maxPhysicalPixels, (area.width() * area.height()).toLong())
      maxRasterPixels = max(maxRasterPixels, width.toLong() * height)
    }
  }

  /**
   * Gaussian blur commutes with scaling. Move the original compensated blur
   * from the unscaled full-layout View layer into the tight transformed rows
   * node; anisotropic radii preserve the same physical horizontal/vertical blur.
   */
  fun setContentBlur(view: View, radius: Float, scaleX: Float, scaleY: Float) {
    val scale = max(min(abs(scaleX), abs(scaleY)), MinimumRowsScale)
    val compensated = if (radius.isFinite() && radius > .01f) radius / scale else 0f
    if (!contentBlur.containsKey(view)) view.setRenderEffect(null)
    contentBlur[view] = compensated
    val sigma = GlassPortalBlur.sigma(compensated)
    rowsSigmaX = sigma * abs(scaleX)
    rowsSigmaY = sigma * abs(scaleY)
    if (diagnosticsEnabled) {
      maxCompensatedBlur = max(maxCompensatedBlur, compensated)
      maxScreenBlur = max(maxScreenBlur, GlassPortalBlur.radius(max(rowsSigmaX, rowsSigmaY)))
    }
  }

  fun diagnostics(): Map<String, Number> = mapOf("portalDraws" to draws, "portalRecords" to records,
    "portalFusedDraws" to fusedDraws, "portalLegacyDraws" to legacyDraws,
    "portalGroupedDraws" to groupedDraws, "portalBoundaryFallbackDraws" to boundaryFallbackDraws,
    "portalLegacyConfigured" to if (legacyForeground) 1 else 0,
    "portalInvisibleSkips" to invisibleSkips, "portalRasterReservations" to rasterReservations,
    "portalNodeResizes" to nodeResizes, "portalEffectRebuilds" to effectRebuilds,
    "portalRowsEffectRebuilds" to rowsEffectRebuilds, "portalMaxPhysicalPixels" to maxPhysicalPixels,
    "portalMaxRasterPixels" to maxRasterPixels, "portalMaxCompensatedBlurPx" to maxCompensatedBlur,
    "portalMaxScreenBlurPx" to maxScreenBlur, "portalOutputClipDraws" to outputClipDraws,
    "portalOutputClipSavedPixels" to outputClipSavedPixels,
    "portalShaderOpacityDraws" to shaderOpacityDraws,
    "portalMotionRowsConfigured" to if (motionRows) 1 else 0,
    "portalMotionClipConfigured" to if (motionClip) 1 else 0,
    "portalMotionBudgetConfigured" to if (motionBudget) 1 else 0)

  private fun clearTransientNodes() {
    if (!wasWarping) return
    rowsNode.setAlpha(1f)
    rowsNode.setRenderEffect(null)
    foregroundNode.setRenderEffect(null)
    rowsNode.discardDisplayList()
    foregroundNode.discardDisplayList()
    sourceCompositeNode.discardDisplayList()
    sourceCompositeNode.setRenderEffect(null)
    compositeBlur = Float.NaN
    rowsGaussian = null; portalEffect = null; drawMode = -1
    rowsNode.setScaleX(1f); rowsNode.setScaleY(1f)
    rowsNode.setTranslationX(0f); rowsNode.setTranslationY(0f)
    samplingExtentValid = false
    rowsEffectX = Float.NaN; rowsEffectY = Float.NaN
    effectGeneration = -1L; renderedGeneration = -1L
    nodeWidth = 0; nodeHeight = 0
    wasWarping = false
  }

  fun release() {
    clearTransientNodes()
    contentBlur.clear()
    rowsSigmaX = 0f; rowsSigmaY = 0f
    texture.update(null)
    texture.bind(portal)
    if (opacityPortalDelegate.isInitialized()) texture.bind(opacityPortal)
    activePortal = portal
    opacityInShader = false
    texture.release()
  }

  /**
   * Conservative analytic support proof for the unchanged shader:
   * For zMax >= 1 the continuous-corner polynomial has Bernstein coefficients
   * <= .125298 < .13, hence raw >= zMax - (.13 / .87).
   * The alternate branch is >= 1 when zMax >= 1. Thus distance >= 6 outside
   * incoming expanded by (.15 * expandedRadius + 6) / inverseAxis. The shader
   * returns exact zero when distance > 5. Degenerate radii use its box branch.
   * Inside the texture domain we assume ANY distance can cover, not that this
   * approximate field is an exact SDF. Its whole domain is included instead.
   */
  private fun updateSamplingExtent(frame: GlassMorphFrame, field: GlassGaussianField?) {
    samplingExtentValid = false
    lensDisplacement = abs(frame.lensAmount)
    val rx = abs(frame.radiusX); val ry = abs(frame.radiusY)
    if (!rx.isFinite() || !ry.isFinite() || !lensDisplacement.isFinite() || !frame.lensHeight.isFinite()) return
    val minimum = min(rx, ry)
    val growX: Float
    val growY: Float
    if (minimum <= .000001f) {
      growX = 6f; growY = 6f
    } else {
      val radius = min(max(rx, .001f), max(ry, .001f))
      val expanded = radius * 1.5286649465560913f
      growX = (.15f * expanded + 6f) * max(rx, .001f) / radius
      growY = (.15f * expanded + 6f) * max(ry, .001f) / radius
    }
    samplingExtent.set(incoming.left - growX, incoming.top - growY,
      incoming.right + growX, incoming.bottom + growY)
    if (field != null) {
      if (!field.step.isFinite() || field.step <= 0f || field.width < 2 || field.height < 2 ||
        !field.originX.isFinite() || !field.originY.isFinite()) return
      samplingExtent.set(min(samplingExtent.left, field.originX), min(samplingExtent.top, field.originY),
        max(samplingExtent.right, field.originX + field.width * field.step),
        max(samplingExtent.bottom, field.originY + field.height * field.step))
    }
    samplingExtentValid = samplingExtent.left.isFinite() && samplingExtent.top.isFinite() &&
      samplingExtent.right.isFinite() && samplingExtent.bottom.isFinite()
  }

  private fun samplingFits(area: RectF, scale: Float): Boolean {
    if (!samplingExtentValid || !scale.isFinite() || scale <= 0f) return false
    // Analytic/normalized-half gradients and cubic interpolation have each
    // component bounded by 1. Include 1% arithmetic slack plus two raster texels
    // so interpolation and clip-edge roundoff never rely on exact equality.
    val margin = lensDisplacement * 1.01f + 2f / scale
    return samplingExtent.left - margin > area.left && samplingExtent.top - margin > area.top &&
      samplingExtent.right + margin < area.right && samplingExtent.bottom + margin < area.bottom
  }

  /** Output support is independent of input image extent. This clip is placed
   * AFTER both original filters; it cannot crop a recorded source or Gaussian.
   * The existing analytic support bound above includes the complete field
   * texture domain, rather than assuming its interpolated values are an SDF.
   * Invalid inputs preserve the previous unbounded final draw.
   */
  private fun prepareOutputClip(area: RectF, scale: Float): Boolean {
    if (!samplingExtentValid || !scale.isFinite() || scale <= 0f ||
      !rowsSigmaX.isFinite() || !rowsSigmaY.isFinite() || !portalBlur.isFinite()) return false
    val sigma = max(max(abs(rowsSigmaX), abs(rowsSigmaY)), GlassPortalBlur.sigma(portalBlur))
    // A generous guard for native blur culling (not a new blur radius). The
    // shader itself is already exactly zero outside samplingExtent. Lens
    // displacement plus six sigmas and four raster texels are left untouched.
    val margin = lensDisplacement * 1.01f + 6f * sigma + 4f / scale
    if (!margin.isFinite()) return false
    val left = max(area.left, area.left + floor((samplingExtent.left - margin - area.left) * scale) / scale)
    val top = max(area.top, area.top + floor((samplingExtent.top - margin - area.top) * scale) / scale)
    val right = min(area.right, area.left + ceil((samplingExtent.right + margin - area.left) * scale) / scale)
    val bottom = min(area.bottom, area.top + ceil((samplingExtent.bottom + margin - area.top) * scale) / scale)
    if (!left.isFinite() || !top.isFinite() || !right.isFinite() || !bottom.isFinite() ||
      right <= left || bottom <= top ||
      (left <= area.left && top <= area.top && right >= area.right && bottom >= area.bottom)) return false
    outputClip.set(left, top, right, bottom)
    return true
  }

  private companion object {
    const val MinimumRowsScale = .25f
  }
}
