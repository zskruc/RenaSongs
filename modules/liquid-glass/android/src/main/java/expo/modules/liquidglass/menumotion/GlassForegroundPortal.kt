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
import android.graphics.Rect
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
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Upstream's foreground lens, independent of the app's existing glass
 * background. Geometry and the shared field use host-local physical pixels.
 * Only arbitrary RN foreground views are recorded here; settled material,
 * colors, parameters and input ownership stay with their existing hosts.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class GlassForegroundPortal(@Suppress("UNUSED_PARAMETER") density: Float) {
  private val portal = RuntimeShader(GlassForegroundPortalShader)
  private val texture = GlassFieldTexture()
  private val foregroundNode = RenderNode("ResonusMenu.foreground")
  private val incoming = RectF()
  private val outgoing = RectF()
  private val recordingBounds = Rect()
  private val contentBlur = WeakHashMap<View, Float>()
  private var portalBlur = 0f
  private var wasWarping = false

  /** `field` comes from the outline, avoiding a second Gaussian CPU pass. */
  fun update(frame: GlassMorphFrame, originX: Float, originY: Float,
    hasSource: Boolean, field: GlassGaussianField?) {
    incoming.set(frame.bounds)
    incoming.offset(-originX, -originY)
    outgoing.set(frame.sourceLobe)
    outgoing.offset(-originX, -originY)
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
    // The original foreground shader uses the default refraction multiplier 1.
    // It does not replace or retune the existing background optical renderer.
    portal.setFloatUniform("amount", frame.lensAmount)
    portalBlur = frame.portalBlur
  }

  /**
   * `bounds` is a fixed, window-bounded capture envelope in HOST LOCAL space,
   * not the shrinking incoming bounds. Keeping it fixed avoids reallocating
   * the GPU layer during a spring. The callback draws in the same local space.
   * Do not surround this pass with a hard incoming clip: its distance field
   * supplies the original anti-aliased portal edge and lens sampling reach.
   */
  fun draw(canvas: Canvas, bounds: RectF, warp: Boolean, drawContent: (Canvas) -> Unit) {
    if (!warp || !canvas.isHardwareAccelerated) {
      if (wasWarping) {
        foregroundNode.setRenderEffect(null)
        foregroundNode.discardDisplayList()
        wasWarping = false
      }
      drawContent(canvas)
      return
    }
    if (!bounds.left.isFinite() || !bounds.top.isFinite() || !bounds.right.isFinite() || !bounds.bottom.isFinite()) return
    recordingBounds.set(floor(bounds.left).toInt(), floor(bounds.top).toInt(),
      ceil(bounds.right).toInt(), ceil(bounds.bottom).toInt())
    if (recordingBounds.isEmpty) return
    foregroundNode.setPosition(recordingBounds)
    portal.setFloatUniform("nodeOrigin", recordingBounds.left.toFloat(), recordingBounds.top.toFloat())
    val bend = RenderEffect.createRuntimeShaderEffect(portal, "content")
    foregroundNode.setRenderEffect(if (portalBlur > .01f) {
      RenderEffect.createChainEffect(bend,
        RenderEffect.createBlurEffect(portalBlur, portalBlur, Shader.TileMode.DECAL))
    } else bend)
    val recording = foregroundNode.beginRecording(recordingBounds.width(), recordingBounds.height())
    try {
      recording.translate(-recordingBounds.left.toFloat(), -recordingBounds.top.toFloat())
      drawContent(recording)
    } finally {
      foregroundNode.endRecording()
    }
    wasWarping = true
    canvas.drawRenderNode(foregroundNode)
  }

  /** Original rows blur stays continuous and compensates for view scaling. */
  fun setContentBlur(view: View, radius: Float, scaleX: Float, scaleY: Float) {
    val scale = max(min(abs(scaleX), abs(scaleY)), MinimumRowsScale)
    val compensated = if (radius.isFinite() && radius > .01f) radius / scale else 0f
    if (contentBlur[view] == compensated) return
    contentBlur[view] = compensated
    view.setRenderEffect(if (compensated > .01f) {
      RenderEffect.createBlurEffect(compensated, compensated, Shader.TileMode.DECAL)
    } else null)
  }

  fun release() {
    foregroundNode.setRenderEffect(null)
    foregroundNode.discardDisplayList()
    wasWarping = false
    for (view in contentBlur.keys) view.setRenderEffect(null)
    contentBlur.clear()
    texture.update(null)
    texture.bind(portal)
    texture.release()
  }

  private companion object {
    const val MinimumRowsScale = .25f
  }
}
