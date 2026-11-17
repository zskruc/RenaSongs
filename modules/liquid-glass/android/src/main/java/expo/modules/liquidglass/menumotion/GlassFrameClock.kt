/*
 * SPDX-License-Identifier: MIT
 * Frame scheduling policy adapted from rit3zh/expo-glass-custom-menu
 * GlassMenuOverlay @ 0021efd8ab0d068f155bbdac62c5f673ccc39a24.
 * See EXPO_GLASS_CUSTOM_MENU_LICENSE for the upstream MIT notice.
 */
package expo.modules.liquidglass.menumotion

import kotlin.math.max
import kotlin.math.min

/** Analytic spring time follows wall time even when another RN traversal stalls. */
internal class GlassFrameClock {
  private var lastFrameNanos = 0L
  private var animationScale = 1f

  fun restart(scale: Float) {
    lastFrameNanos = 0L
    animationScale = scale.takeIf { it.isFinite() && it >= 0f } ?: 1f
  }

  fun advance(frameTimeNanos: Long, refreshRate: Float): Float {
    val hz = if (refreshRate.isFinite()) max(refreshRate, 30f) else 60f
    val interval = 1f / hz
    val elapsed = if (lastFrameNanos == 0L) interval / 2f
      else max((frameTimeNanos - lastFrameNanos) / 1_000_000_000f, 0f)
    lastFrameNanos = frameTimeNanos
    // The standalone demo caps to 2.5 display intervals. In a large RN window
    // that turns a 100ms render stall into only 20ms of spring time at 120Hz,
    // visibly slowing the whole interaction. GlassSpring solves analytically;
    // allow bounded catch-up rather than tying motion speed to missed VSyncs.
    return if (animationScale == 0f) 10f else min(elapsed, 0.5f) / animationScale
  }
}
