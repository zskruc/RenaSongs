/*
 * SPDX-License-Identifier: MIT
 * Adapted from rit3zh/expo-glass-custom-menu (motion/field implementation).
 * Source revision: 0021efd8ab0d068f155bbdac62c5f673ccc39a24.
 * Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).
 * See EXPO_GLASS_CUSTOM_MENU_LICENSE for the upstream MIT notice.
 * Package names and record boundary adapted for Resonus Glass.
 */
package expo.modules.liquidglass.menumotion

import kotlin.math.max

internal class GlassMorphTuning(shrink: GlassShrinkRecord?, absorb: GlassAbsorbRecord?) {
  private val shrinkDuration = max(shrink?.duration ?: DefaultShrinkDuration, MinimumDuration)
  private val shrinkDamping = shrink?.damping?.coerceIn(MinimumDamping, 1f)

  val shrinkScale = (shrink?.scale ?: DefaultShrinkScale).coerceIn(.05f, 1f)
  val collapse = GlassSpringSpec(shrinkDamping ?: 1f, shrinkDuration)
  val eject = GlassSpringSpec(shrinkDamping ?: DefaultEjectDamping, shrinkDuration * EjectRatio)
  val absorb = GlassSpringSpec(
    absorb?.damping?.coerceIn(MinimumDamping, 1f) ?: DefaultAbsorbDamping,
    max(absorb?.duration ?: DefaultAbsorbDuration, MinimumDuration),
  )
  val neckHold = max(shrinkDuration / DefaultShrinkDuration, 1f)

  private companion object {
    const val DefaultShrinkDuration = .21f
    const val DefaultShrinkScale = .25f
    const val DefaultEjectDamping = .75f
    const val DefaultAbsorbDuration = .35f
    const val DefaultAbsorbDamping = .8f
    const val EjectRatio = .32f / .21f
    const val MinimumDuration = .02f
    const val MinimumDamping = .1f
  }
}
