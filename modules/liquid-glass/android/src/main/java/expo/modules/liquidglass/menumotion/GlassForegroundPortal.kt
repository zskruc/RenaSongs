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
import android.view.View
import androidx.annotation.RequiresApi
import java.util.WeakHashMap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Upstream foreground lens; the existing material remains a separate pass. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class GlassForegroundPortal(density: Float) {
  private val portal = RuntimeShader(GlassForegroundPortalShader)
  private val texture = GlassFieldTexture()
  private val foregroundNode = RenderNode("ResonusMenu.foreground")
  private val rowsNode = RenderNode("ResonusMenu.rows")
  private val raster = GlassPortalRaster(density)
  private val incoming = RectF()
  private val outgoing = RectF()
  private val contentBlur = WeakHashMap<View, Float>()
  private var hasSource = false
  private var rowsVisible = false
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

  /** Called at session attachment or an actual target/window layout change. */
  fun reserve(target: RectF, @Suppress("UNUSED_PARAMETER") originX: Float,
    @Suppress("UNUSED_PARAMETER") originY: Float, windowBounds: RectF) {
    if (raster.reserve(target.width(), target.height(), windowBounds.width(), windowBounds.height(), hasSource))
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
    rowsVisible = frame.rowsOpacity > .001f
    generation++
    // Invisible rows are skipped by GlassMenuSession before foreground draw.
    if (!rowsVisible) return
    portal.setFloatUniform("center", incoming.centerX(), incoming.centerY())
    portal.setFloatUniform("halfSize", incoming.width() / 2f, incoming.height() / 2f)
    portal.setFloatUniform("cornerRadii", frame.radiusX, frame.radiusY)
    val secondary = if (hasSource) outgoing else incoming
    portal.setFloatUniform("secondaryEnabled", if (hasSource) 1f else 0f)
    portal.setFloatUniform("secondaryCenter", secondary.centerX(), secondary.centerY())
    portal.setFloatUniform("secondaryHalfSize", secondary.width() / 2f, secondary.height() / 2f)
    portal.setFloatUniform("secondaryRadii", frame.sourceRadius, frame.sourceRadius)
    portal.setFloatUniform("smoothing", frame.smoothing)
    texture.update(field)
    texture.bind(portal)
    portal.setFloatUniform("height", frame.lensHeight)
    portal.setFloatUniform("amount", frame.lensAmount)
    portalBlur = frame.portalBlur
  }

  /**
   * A session reserves filtered dimensions once. Motion moves the physical
   * origin, while rasterScale and both RenderNode capacities remain constant.
   * Raster coordinates map back to physical field/lens coordinates. Only
   * transient images are downsampled; settled native content draws directly.
   */
  fun draw(canvas: Canvas, bounds: RectF, warp: Boolean, drawContent: (Canvas) -> Unit) {
    if (!warp || !canvas.isHardwareAccelerated) {
      // As upstream, retain the fixed nodes until the presentation ends. They
      // are not drawn while settled, but closing can reuse the same capacity.
      drawContent(canvas)
      return
    }
    if (!rowsVisible) {
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
      foregroundNode.setPivotX(0f); foregroundNode.setPivotY(0f)
      // The reserved guard already includes all filter reach. Explicit bounds
      // clipping prevents Skia from adding changing blur-outset layer sizes.
      rowsNode.setClipToBounds(true)
      foregroundNode.setClipToBounds(true)
      if (diagnosticsEnabled) nodeResizes++
    }
    foregroundNode.setScaleX(1f / scale)
    foregroundNode.setScaleY(1f / scale)
    foregroundNode.setTranslationX(area.left)
    foregroundNode.setTranslationY(area.top)

    // Both original Gaussian passes precede the lens. Their variances add,
    // so one anisotropic Gaussian preserves both blur phases while avoiding
    // another filtered intermediate image (RN body has no trigger composite).
    val blurX = GlassPortalBlur.combinedRadius(rowsSigmaX, portalSigma, scale)
    val blurY = GlassPortalBlur.combinedRadius(rowsSigmaY, portalSigma, scale)
    if (blurX != rowsEffectX || blurY != rowsEffectY) {
      rowsEffectX = blurX; rowsEffectY = blurY
      rowsNode.setRenderEffect(if (blurX > 0f || blurY > 0f)
        RenderEffect.createBlurEffect(blurX, blurY, Shader.TileMode.DECAL) else null)
      if (diagnosticsEnabled) rowsEffectRebuilds++
    }
    // Geometry uniforms are snapshotted by RenderEffect. Reuse an effect and
    // recording only for repeated draws of the same unchanged native frame.
    val effectChanged = effectGeneration != generation || effectLeft != area.left ||
      effectTop != area.top || effectScale != scale
    if (effectChanged) {
      effectGeneration = generation; effectLeft = area.left; effectTop = area.top; effectScale = scale
      portal.setFloatUniform("nodeOrigin", area.left, area.top)
      portal.setFloatUniform("rasterScale", scale)
      foregroundNode.setRenderEffect(RenderEffect.createRuntimeShaderEffect(portal, "content"))
      if (diagnosticsEnabled) effectRebuilds++
    }
    if (effectChanged || dimensionsChanged || renderedGeneration != generation ||
      contentBlur.keys.any { it.isDirty || it.isLayoutRequested }) {
      val recording = rowsNode.beginRecording(width, height)
      try {
        recording.scale(scale, scale)
        recording.translate(-area.left, -area.top)
        drawContent(recording)
      } finally { rowsNode.endRecording() }
      renderedGeneration = generation
      if (diagnosticsEnabled) records++
    }
    if (dimensionsChanged || !foregroundNode.hasDisplayList()) {
      val recording = foregroundNode.beginRecording(width, height)
      try { recording.drawRenderNode(rowsNode) } finally { foregroundNode.endRecording() }
    }
    wasWarping = true
    canvas.drawRenderNode(foregroundNode)
    if (diagnosticsEnabled) {
      draws++
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
    "portalInvisibleSkips" to invisibleSkips, "portalRasterReservations" to rasterReservations,
    "portalNodeResizes" to nodeResizes, "portalEffectRebuilds" to effectRebuilds,
    "portalRowsEffectRebuilds" to rowsEffectRebuilds, "portalMaxPhysicalPixels" to maxPhysicalPixels,
    "portalMaxRasterPixels" to maxRasterPixels, "portalMaxCompensatedBlurPx" to maxCompensatedBlur,
    "portalMaxScreenBlurPx" to maxScreenBlur)

  private fun clearTransientNodes() {
    if (!wasWarping) return
    rowsNode.setRenderEffect(null)
    foregroundNode.setRenderEffect(null)
    rowsNode.discardDisplayList()
    foregroundNode.discardDisplayList()
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
    texture.release()
  }

  private companion object {
    const val MinimumRowsScale = .25f
  }
}
