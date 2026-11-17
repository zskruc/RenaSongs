package expo.modules.liquidglass.menumotion

/** Plain values at the native boundary; upstream default spring parameters are unchanged. */
internal data class GlassShrinkRecord(val duration: Float? = null, val damping: Float? = null, val scale: Float? = null)
internal data class GlassAbsorbRecord(val duration: Float? = null, val damping: Float? = null)
