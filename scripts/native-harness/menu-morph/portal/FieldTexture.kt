package expo.modules.liquidglass.menumotion

import android.graphics.RuntimeShader

/** Texture uploads are GPU-only; lifecycle decisions use the real Portal. */
internal class GlassFieldTexture {
  fun update(field: GlassGaussianField?) = Unit
  fun bind(shader: RuntimeShader) = Unit
  fun release() = Unit
}
