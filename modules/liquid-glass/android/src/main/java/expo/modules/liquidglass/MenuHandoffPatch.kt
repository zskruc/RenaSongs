package expo.modules.liquidglass

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Picture
import android.graphics.Rect
import android.graphics.RectF
import android.os.SystemClock

/** CPU-owned immutable pixels only. Image/Reader/producer ownership never
 * escapes the synchronous MAIN preparation call. No modal scrim is recorded. */
internal class MenuHandoffPatch private constructor(val key: MenuUnderlayKey,
  val metadataVersion: Long, private val region: MenuHandoffPatchRegion, private val pixels: Bitmap,
  val preparedAt: Long, val preparationMs: Long) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val bitmapRect = Rect(0, 0, pixels.width, pixels.height)
  private val destination = RectF()
  var handoff = false
    private set
  var handoffAtUptime = 0L
    private set
  var draws = 0L
    private set

  fun beginHandoff() { handoff = true; handoffAtUptime = SystemClock.uptimeMillis() }

  fun draw(canvas: Canvas, originX: Float, originY: Float, bounds: RectF): Boolean {
    if (!handoff || bounds.left + originX < region.left || bounds.top + originY < region.top ||
      bounds.right + originX > region.right || bounds.bottom + originY > region.bottom) return false
    // The entire tiny raw ROI is opaque. Masking it to the capsule's AA edge
    // would let the already-restored capsule leak through that edge, doubling
    // its fill. Paint the original page pixels first, then the capsule once.
    destination.set(region.left - originX, region.top - originY, region.right - originX, region.bottom - originY)
    canvas.drawBitmap(pixels, bitmapRect, destination, paint)
    draws++
    return true
  }

  fun diagnostics(): Map<String, Any> = mapOf("handoffPatchReady" to true,
    "handoffPatchPixels" to pixels.width.toLong() * pixels.height, "handoffPatchOpaque" to true,
    "handoffPatchConfig" to (pixels.config?.name ?: "unknown"), "handoffPatchMutable" to pixels.isMutable,
    "handoffPatchPreparationMs" to preparationMs, "handoffPatchDraws" to draws,
    "handoffPatchActive" to handoff)

  companion object {
    fun prepare(frame: BackdropFrame, metadataVersion: Long, region: MenuHandoffPatchRegion): MenuHandoffPatch? {
      val key = frame.menuUnderlay ?: return null
      val started = SystemClock.uptimeMillis()
      val picture = Picture()
      val recording = picture.beginRecording(region.width, region.height)
      try {
        recording.drawBitmap(frame.bitmap,
          Rect(region.pixelLeft, region.pixelTop, region.pixelRight, region.pixelBottom),
          RectF(region.destinationLeft, region.destinationTop, region.destinationRight, region.destinationBottom),
          Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
      } finally { picture.endRecording() }
      // Public Bitmap(Picture) creates only this ROI-sized GPU target and then
      // copies it to immutable ARGB_8888. Do not createBitmap(HARDWARE, subset):
      // AOSP first reads back that entire producer image before subsetting.
      val pixels = Bitmap.createBitmap(picture, region.width, region.height, Bitmap.Config.ARGB_8888)
      if (pixels === frame.bitmap || pixels.config != Bitmap.Config.ARGB_8888 || pixels.isMutable ||
        pixels.width != region.width || pixels.height != region.height) return null
      pixels.density = Bitmap.DENSITY_NONE
      val rgba = IntArray(pixels.width * pixels.height)
      pixels.getPixels(rgba, 0, pixels.width, 0, 0, pixels.width, pixels.height)
      if (rgba.any { (it ushr 24) != 255 }) return null
      return MenuHandoffPatch(key, metadataVersion, region, pixels, started, SystemClock.uptimeMillis() - started)
    }
  }
}
