/*
 * SPDX-License-Identifier: MIT
 * Frame scheduling policy adapted from rit3zh/expo-glass-custom-menu
 * GlassMenuOverlay @ 0021efd8ab0d068f155bbdac62c5f673ccc39a24.
 * See EXPO_GLASS_CUSTOM_MENU_LICENSE for the upstream MIT notice.
 */
package expo.modules.liquidglass.menumotion

import kotlin.math.max
import kotlin.math.min

/** Upstream startup/skip policy, independent of Android for deterministic tests. */
internal class GlassFrameClock {
  private var lastFrameNanos = 0L
  private var startupFrames = 4
  private var animationScale = 1f

  fun restart(scale: Float) {
    lastFrameNanos = 0L
    startupFrames = 4
    animationScale = scale.takeIf { it.isFinite() && it >= 0f } ?: 1f
  }

  fun advance(frameTimeNanos: Long, refreshRate: Float): Float {
    val hz = if (refreshRate.isFinite()) max(refreshRate, 30f) else 60f
    val interval = 1f / hz
    val elapsed = if (lastFrameNanos == 0L) interval / 2f
      else max((frameTimeNanos - lastFrameNanos) / 1_000_000_000f, 0f)
    val limit = interval * if (startupFrames > 0) 1f else 2.5f
    startupFrames = max(startupFrames - 1, 0)
    lastFrameNanos = frameTimeNanos
    return if (animationScale == 0f) 10f else min(elapsed, limit) / animationScale
  }
}
