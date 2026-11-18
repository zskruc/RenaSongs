package expo.modules.liquidglass

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import expo.modules.liquidglass.menumotion.GlassMorphFrame
import kotlin.math.max
import kotlin.math.roundToInt

/** Independent immutable toolbar pixels, with the original trigger tracks. */
@RequiresApi(Build.VERSION_CODES.S)
internal class MenuGroupForeground(private val bitmap: Bitmap, private val sourceWidth: Float,
  private val sourceHeight: Float) {
  private val node = RenderNode("RenaMenu.toolbarForeground")
  private var lastBlur = Float.NaN
  private val directPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val directRect = RectF(-bitmap.width / 2f, -bitmap.height / 2f, bitmap.width / 2f, bitmap.height / 2f)
  private var directDraws = 0L
  private var nodeDraws = 0L

  init {
    node.setPosition(0, 0, bitmap.width, bitmap.height)
    node.setClipToBounds(false)
    node.setPivotX(bitmap.width / 2f)
    node.setPivotY(bitmap.height / 2f)
    val recording = node.beginRecording(bitmap.width, bitmap.height)
    try {
      recording.drawBitmap(bitmap, null, RectF(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat()),
        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    } finally { node.endRecording() }
  }

  fun update(frame: GlassMorphFrame, originX: Float, originY: Float) {
    node.setScaleX(frame.sourceLobe.width() / max(sourceWidth, 1f) * frame.sourceZoom)
    node.setScaleY(frame.sourceLobe.height() / max(sourceHeight, 1f) * frame.sourceZoom)
    node.setTranslationX(frame.sourceLobe.centerX() - originX - bitmap.width / 2f)
    node.setTranslationY(frame.sourceLobe.centerY() - originY - bitmap.height / 2f)
    node.setAlpha(frame.sourceOpacity.coerceIn(0f, 1f))
    if (lastBlur != frame.sourceBlur) {
      lastBlur = frame.sourceBlur
      node.setRenderEffect(if (lastBlur > .01f)
        RenderEffect.createBlurEffect(lastBlur, lastBlur, Shader.TileMode.DECAL) else null)
    }
  }

  fun draw(canvas: Canvas) {
    if (node.alpha <= .001f) return
    if (lastBlur <= .01f) {
      // This phase already has no Gaussian effect in the original path. Replay
      // actual immutable pixels into the current portal recording, rather than
      // depending on a separately alpha/transform-staged custom RenderNode.
      val save = canvas.save()
      canvas.translate(node.translationX + bitmap.width / 2f, node.translationY + bitmap.height / 2f)
      canvas.scale(node.scaleX, node.scaleY)
      directPaint.alpha = (node.alpha * 255f).roundToInt().coerceIn(0, 255)
      canvas.drawBitmap(bitmap, null, directRect, directPaint)
      canvas.restoreToCount(save)
      directDraws++
    } else {
      // Keep the original independent sourceBlur track while it is active.
      canvas.drawRenderNode(node)
      nodeDraws++
    }
  }
  fun diagnostics(): Map<String, Any> = mapOf("sourceDirectBitmapDraws" to directDraws,
    "sourceCustomNodeDraws" to nodeDraws, "sourceCustomNodeHasDisplayList" to node.hasDisplayList(),
    "sourceForegroundAlpha" to node.alpha, "sourceForegroundBlur" to lastBlur,
    "sourceForegroundTranslation" to listOf(node.translationX, node.translationY),
    "sourceForegroundScale" to listOf(node.scaleX, node.scaleY))
  fun release() { node.discardDisplayList(); node.setRenderEffect(null) }
}
