/*
 * Geometry adaptation of Backdrop 1.0.0 (Kyant, Apache-2.0) and
 * rit3zh/expo-glass-custom-menu 0021efd8 (MIT). Existing color, blur, tint,
 * refraction and highlight parameters remain owned by the caller.
 */
package expo.modules.liquidglass

import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.graphics.RectF
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.BlendMode
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.drawscope.DrawScope
import com.kyant.backdrop.BackdropEffectScope
import com.kyant.backdrop.RuntimeShaderCache
import com.kyant.backdrop.effects.effect
import com.kyant.backdrop.highlight.HighlightStyle
import expo.modules.liquidglass.menumotion.GlassFieldTexture
import expo.modules.liquidglass.menumotion.GlassGaussianField
import expo.modules.liquidglass.menumotion.GlassMorphFrame
import kotlin.math.PI
import kotlin.math.max

/** Menu-group motion only. Shares the outline's Gaussian field; creates no
 * second field, capture, frame clock or offscreen RenderNode. The draw caller
 * supplies its immutable epoch scale and committed physical material origin. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class MenuMorphFieldOptics {
  private val texture = GlassFieldTexture()
  private val incoming = RectF()
  private val source = RectF()
  private var fieldOriginX = 0f
  private var fieldOriginY = 0f
  private var radiusX = 0f
  private var radiusY = 0f
  private var sourceRadius = 0f
  private var smoothing = 0f
  private var hasSource = false
  private var ready = false
  private var lastField: GlassGaussianField? = null
  private var pressShader: RuntimeShader? = null
  private val pressPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { blendMode = BlendMode.PLUS }
  private var updates = 0L
  private var lensApplications = 0L
  private var highlightApplications = 0L
  private var pressLightApplications = 0L
  private var sharedFieldBindings = 0L

  /** All rectangles and the shared field become target-local physical pixels,
   * matching GlassMorphOutline/GlassForegroundPortal. No Snapshot mutation. */
  fun update(frame: GlassMorphFrame, fieldOriginX: Float, fieldOriginY: Float,
    hasSource: Boolean, field: GlassGaussianField?) {
    this.fieldOriginX = fieldOriginX
    this.fieldOriginY = fieldOriginY
    incoming.set(frame.bounds)
    incoming.offset(-fieldOriginX, -fieldOriginY)
    source.set(frame.sourceLobe)
    source.offset(-fieldOriginX, -fieldOriginY)
    radiusX = frame.radiusX
    radiusY = frame.radiusY
    sourceRadius = frame.sourceRadius
    smoothing = frame.smoothing
    this.hasSource = hasSource
    // Generations belong to one field instance. A newly attached session may
    // start at generation1 again; do not reuse another field's texture upload.
    if (field !== lastField) texture.update(null)
    lastField = field
    texture.update(field)
    ready = true
    updates++
  }

  /** Same Kyant circle-map, depth/dispersion formula and effect ordering.
   * Only the rounded-rectangle distance/normal become the shared union field. */
  fun applyLens(scope: BackdropEffectScope, rasterScale: Float, materialOrigin: Offset,
    refractionHeight: Float, refractionAmount: Float, depthEffect: Boolean,
    chromaticAberration: Boolean) {
    if (!ready || !menuFieldLensInputsReady(scope.size.width, scope.size.height,
        refractionHeight, refractionAmount, scope.padding)) return
    with(scope) {
      if (padding > 0f) padding = max(padding - refractionHeight, 0f)
      val shader = obtainRuntimeShader("MenuMorphFieldRefraction", MenuMorphFieldRefractionShader)
      bind(shader, MenuMorphFieldCoordinates(rasterScale, materialOrigin.x, materialOrigin.y,
        fieldOriginX, fieldOriginY, padding))
      shader.setFloatUniform("size", size.width, size.height)
      shader.setFloatUniform("refractionHeight", refractionHeight)
      shader.setFloatUniform("refractionAmount", -refractionAmount)
      shader.setFloatUniform("depthEffect", if (depthEffect) 1f else 0f)
      shader.setFloatUniform("chromaticAberration", if (chromaticAberration) 1f else 0f)
      effect(RenderEffect.createRuntimeShaderEffect(shader, "content"))
      lensApplications++
    }
  }

  /** Keep the original width/blur/opacity/color/blend and angular recipe. The
   * caller's outline must also be the union path; a bounding RRect stroke is
   * insufficient even when this paint shader has the correct normal. */
  fun highlightStyle(base: HighlightStyle, rasterScale: Float,
    materialOrigin: () -> Offset): HighlightStyle = when (base) {
      is HighlightStyle.Default, is HighlightStyle.Ambient ->
        FieldHighlight(this, base, rasterScale, materialOrigin)
      else -> base // Plain has no angular shader; preserve custom styles too.
    }

  /** Original menu (80dp/.03/.018/.12) and source (38dp/.07/.055/.3)
   * transient light presets. Positions and density are physical, not raster. */
  fun drawPressLight(canvas: Canvas, width: Float, height: Float, rasterScale: Float,
    materialOrigin: Offset, density: Float, pressX: Float, pressY: Float, glow: Float,
    trigger: Boolean = false) {
    if (!ready || glow <= .001f || width <= 0f || height <= 0f) return
    val shader = pressShader ?: RuntimeShader(MenuMorphFieldPressLightShader).also { pressShader = it }
    bind(shader, MenuMorphFieldCoordinates(rasterScale, materialOrigin.x, materialOrigin.y,
      fieldOriginX, fieldOriginY))
    shader.setFloatUniform("density", density)
    shader.setFloatUniform("press", pressX - fieldOriginX, pressY - fieldOriginY,
      (if (trigger) 38f else 80f) * density, (if (trigger) .07f else .03f) * glow)
    shader.setFloatUniform("pressLift", (if (trigger) .055f else .018f) * glow)
    shader.setFloatUniform("rimLift", (if (trigger) .3f else .12f) * glow)
    pressPaint.shader = shader
    canvas.drawRect(0f, 0f, width, height, pressPaint)
    pressLightApplications++
  }

  private fun bind(shader: RuntimeShader, coordinates: MenuMorphFieldCoordinates) {
    shader.setFloatUniform("rasterScale", coordinates.rasterScale)
    shader.setFloatUniform("nodeOrigin", coordinates.localOriginX, coordinates.localOriginY)
    shader.setFloatUniform("offset", -coordinates.padding, -coordinates.padding)
    shader.setFloatUniform("center", incoming.centerX(), incoming.centerY())
    shader.setFloatUniform("halfSize", incoming.width() / 2f, incoming.height() / 2f)
    shader.setFloatUniform("cornerRadii", radiusX, radiusY)
    val secondary = if (hasSource) source else incoming
    shader.setFloatUniform("secondaryEnabled", if (hasSource) 1f else 0f)
    shader.setFloatUniform("secondaryCenter", secondary.centerX(), secondary.centerY())
    shader.setFloatUniform("secondaryHalfSize", secondary.width() / 2f, secondary.height() / 2f)
    shader.setFloatUniform("secondaryRadii", sourceRadius, sourceRadius)
    shader.setFloatUniform("smoothing", smoothing)
    texture.bind(shader)
    if (lastField != null) sharedFieldBindings++
  }

  private data class FieldHighlight(
    val owner: MenuMorphFieldOptics,
    val base: HighlightStyle,
    val rasterScale: Float,
    val materialOrigin: () -> Offset
  ) : HighlightStyle {
    override val color get() = base.color
    override val blendMode get() = base.blendMode

    override fun DrawScope.createShader(shape: androidx.compose.ui.graphics.Shape,
      runtimeShaderCache: RuntimeShaderCache): Shader? {
      if (!owner.ready) return with(base) { createShader(shape, runtimeShaderCache) }
      val ambient = base is HighlightStyle.Ambient
      val shader = runtimeShaderCache.obtainRuntimeShader("MenuMorphFieldHighlight", MenuMorphFieldHighlightShader)
      val origin = materialOrigin()
      owner.bind(shader, MenuMorphFieldCoordinates(rasterScale, origin.x, origin.y,
        owner.fieldOriginX, owner.fieldOriginY))
      val style = base as? HighlightStyle.Default
      shader.setFloatUniform("angle", ((style?.angle ?: 45f) * PI / 180f).toFloat())
      shader.setFloatUniform("falloff", style?.falloff ?: 1f)
      shader.setFloatUniform("ambient", if (ambient) 1f else 0f)
      owner.highlightApplications++
      return shader
    }
  }

  fun release() {
    ready = false
    lastField = null
    pressPaint.shader = null
    pressShader = null
    texture.release() // Never recycle a bitmap still referenced by HWUI.
  }

  /** Draw-path setup counters, not GPU-visible frames. Retained after release
   * so motion completion can prove the field branch actually ran. */
  fun diagnostics(): Map<String, Any> = mapOf(
    "fieldUpdates" to updates,
    "fieldLensApplications" to lensApplications,
    "fieldHighlightApplications" to highlightApplications,
    "fieldPressLightApplications" to pressLightApplications,
    "fieldReady" to ready,
    "fieldSharedTexture" to (sharedFieldBindings > 0L),
    "fieldSharedTextureBindings" to sharedFieldBindings,
    "fieldCurrentSharedTexture" to (lastField != null)
  )

  fun resetDiagnostics() {
    updates = 0L; lensApplications = 0L; highlightApplications = 0L
    pressLightApplications = 0L; sharedFieldBindings = 0L
  }
}
