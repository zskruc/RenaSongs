package expo.modules.liquidglass

/** Original source RGBA and existing menu optics meet without changing either
 * resting recipe. Glyph opacity is deliberately a separate upstream channel. */
internal fun menuGroupSourceFillAlpha(argb: Int, contentProgress: Float): Int {
  val progress = if (contentProgress.isFinite()) contentProgress.coerceIn(0f, 1f) else 0f
  return (((argb ushr 24) and 0xff) * (1f - progress)).toInt().coerceIn(0, 255)
}
