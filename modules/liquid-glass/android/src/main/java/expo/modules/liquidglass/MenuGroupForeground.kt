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

/** Independent immutable toolbar pixels, with the original trigger tracks. */
@RequiresApi(Build.VERSION_CODES.S)
internal class MenuGroupForeground(private val bitmap: Bitmap, private val sourceWidth: Float,
  private val sourceHeight: Float) {
  private val node = RenderNode("RenaMenu.toolbarForeground")
  private var lastBlur = Float.NaN

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

  fun draw(canvas: Canvas) { if (node.alpha > .001f) canvas.drawRenderNode(node) }
  fun release() { node.discardDisplayList(); node.setRenderEffect(null) }
}
