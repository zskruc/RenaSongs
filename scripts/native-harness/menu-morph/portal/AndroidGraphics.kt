package android.graphics

/** Call/accounting fixture only. No claim of Android pixels or GPU effects. */
open class Canvas(val isHardwareAccelerated: Boolean = true) {
  val replayed = ArrayList<String>()
  val clips = ArrayList<RectF>()
  var saves = 0
  var restores = 0
  fun save(): Int { saves++; return saves }
  fun restoreToCount(value: Int) { restores++ }
  fun clipRect(rect: RectF): Boolean {
    clips += RectF(rect.left, rect.top, rect.right, rect.bottom)
    return rect.width() > 0f && rect.height() > 0f
  }
  fun scale(x: Float, y: Float) = Unit
  fun translate(x: Float, y: Float) = Unit
  fun drawRenderNode(node: RenderNode) { replayed += node.name }
}

class RenderNode(val name: String) {
  companion object { val instances = ArrayList<RenderNode>() }
  init { instances += this }
  var recordings = 0
  var effectUpdates = 0
  var effect: RenderEffect? = null
    private set
  var recordingWidth = 0
  var recordingHeight = 0
  var currentCanvas = Canvas()
    private set
  var alphaValue = 1f
    private set
  private var displayList = false
  fun setPosition(left: Int, top: Int, right: Int, bottom: Int) = Unit
  var actualPivotX = Float.NaN; private set
  var actualPivotY = Float.NaN; private set
  var actualScaleX = 1f; private set
  var actualScaleY = 1f; private set
  var actualTranslationX = 0f; private set
  var actualTranslationY = 0f; private set
  var clipped = false; private set
  fun setPivotX(value: Float) { actualPivotX = value }
  fun setPivotY(value: Float) { actualPivotY = value }
  fun setScaleX(value: Float) { actualScaleX = value }
  fun setScaleY(value: Float) { actualScaleY = value }
  fun setTranslationX(value: Float) { actualTranslationX = value }
  fun setTranslationY(value: Float) { actualTranslationY = value }
  fun setClipToBounds(value: Boolean) { clipped = value }
  fun setAlpha(value: Float) { alphaValue = value }
  fun setRenderEffect(value: RenderEffect?) { effectUpdates++; effect = value }
  fun beginRecording(width: Int, height: Int): Canvas {
    recordings++; recordingWidth = width; recordingHeight = height
    currentCanvas = Canvas()
    return currentCanvas
  }
  fun endRecording() { displayList = true }
  fun hasDisplayList() = displayList
  fun discardDisplayList() { displayList = false }
}

open class Shader { enum class TileMode { DECAL } }
class RuntimeShader(val source: String) : Shader() {
  val floats = LinkedHashMap<String, FloatArray>()
  fun setFloatUniform(name: String, vararg values: Float) { floats[name] = values }
}
class RenderEffect(val kind: String, val x: Float = 0f, val y: Float = 0f, val outer: RenderEffect? = null, val inner: RenderEffect? = null, val shader: RuntimeShader? = null) {
  companion object {
    fun createBlurEffect(x: Float, y: Float, mode: Shader.TileMode) = RenderEffect("blur", x, y)
    fun createChainEffect(outer: RenderEffect, inner: RenderEffect) = RenderEffect("chain", outer = outer, inner = inner)
    fun createRuntimeShaderEffect(shader: RuntimeShader, input: String) = RenderEffect("shader", shader = shader)
  }
}
