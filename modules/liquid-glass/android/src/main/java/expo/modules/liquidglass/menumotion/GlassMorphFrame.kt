/*
 * SPDX-License-Identifier: MIT
 * Adapted from rit3zh/expo-glass-custom-menu (motion/field implementation).
 * Source revision: 0021efd8ab0d068f155bbdac62c5f673ccc39a24.
 * Copyright (c) 2015-present 650 Industries, Inc. (aka Expo).
 * See EXPO_GLASS_CUSTOM_MENU_LICENSE for the upstream MIT notice.
 * Package names and record boundary adapted for Resonus Glass.
 */
package expo.modules.liquidglass.menumotion

import android.graphics.RectF

internal class GlassMorphFrame {
  /** Presentation-only copy: Jelly must never modify the underlying springs. */
  fun copyFrom(other: GlassMorphFrame) {
    bounds.set(other.bounds); radiusX = other.radiusX; radiusY = other.radiusY
    contentProgress = other.contentProgress; rowsOpacity = other.rowsOpacity
    sourceLobe.set(other.sourceLobe); sourceRadius = other.sourceRadius; smoothing = other.smoothing
    sourceOpacity = other.sourceOpacity; sourceBlur = other.sourceBlur; sourceZoom = other.sourceZoom
    contentBlur = other.contentBlur; contentZoom = other.contentZoom; portalBlur = other.portalBlur
    lensHeight = other.lensHeight; lensAmount = other.lensAmount
  }
  val bounds = RectF()
  var radiusX = 0f
  var radiusY = 0f
  var contentProgress = 0f
  var rowsOpacity = 0f
  val sourceLobe = RectF()
  var sourceRadius = 0f
  var smoothing = 0f
  var sourceOpacity = 1f
  var sourceBlur = 0f
  var sourceZoom = 1f
  var contentBlur = 0f
  var contentZoom = 1f
  var portalBlur = 0f
  var lensHeight = 0f
  var lensAmount = 0f
}
