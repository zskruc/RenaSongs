package android.graphics

/** Call/accounting fixture only. No claim of Android pixels or GPU effects. */
open class Canvas(val isHardwareAccelerated: Boolean = true) {
  val replayed = ArrayList<String>()
  fun save(): Int = 1
  fun restoreToCount(value: Int) = Unit
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
  fun setPivotX(value: Float) = Unit
  fun setPivotY(value: Float) = Unit
  fun setScaleX(value: Float) = Unit
  fun setScaleY(value: Float) = Unit
  fun setTranslationX(value: Float) = Unit
  fun setTranslationY(value: Float) = Unit
  fun setClipToBounds(value: Boolean) = Unit
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
class RuntimeShader(source: String) : Shader() {
  fun setFloatUniform(name: String, vararg values: Float) = Unit
}
class RenderEffect(val kind: String, val x: Float = 0f, val y: Float = 0f) {
  companion object {
    fun createBlurEffect(x: Float, y: Float, mode: Shader.TileMode) = RenderEffect("blur", x, y)
    fun createRuntimeShaderEffect(shader: RuntimeShader, input: String) = RenderEffect("shader")
  }
}
