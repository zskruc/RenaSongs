package expo.modules.liquidglass.menumotion

import kotlin.math.max
import kotlin.math.sqrt

/** Android HWUI radius/sigma conversion, not Skia sigma-as-radius semantics.
 * https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/hwui/utils/Blur.cpp
 * RenderEffect JNI calls Blur::convertRadiusToSigma before SkImageFilters::Blur.
 */
internal object GlassPortalBlur {
  fun sigma(radius: Float): Float = if (radius > .01f) SigmaScale * radius + .5f else 0f
  fun radius(sigma: Float): Float = if (sigma > .5f) (sigma - .5f) / SigmaScale else 0f
  fun combinedRadius(rowsSigma: Float, portalSigma: Float, rasterScale: Float): Float =
    radius(sqrt(rowsSigma * rowsSigma + portalSigma * portalSigma) * max(rasterScale, 0f))
  private const val SigmaScale = .57735f
}
