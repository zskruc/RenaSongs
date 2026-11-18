package expo.modules.liquidglass

import android.content.Context
import android.graphics.Canvas
import android.graphics.RectF
import android.graphics.Paint
import android.graphics.drawable.ColorDrawable
import android.provider.Settings
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.liquidglass.menumotion.GlassFrameClock
import expo.modules.liquidglass.menumotion.GlassJelly
import com.facebook.react.uimanager.BackgroundStyleApplicator

/**
 * An explicit, bounded toolbar source, matching upstream Menu.Trigger rather
 * than guessing a common ancestor from a tapped icon. Its original background,
 * children, layout and React touch handlers remain owned by React Native.
 */
class MenuTriggerGroupView(context: Context, appContext: AppContext) : ExpoView(context, appContext),
  Choreographer.FrameCallback {
  internal var jelly = GlassJelly()
    private set
  private val clock = GlassFrameClock()
  private val control = RectF()
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val pressLight by lazy { if (android.os.Build.VERSION.SDK_INT >= 33) MenuPressLight() else null }
  private var framePosted = false
  private var animationScale = 1f
  private var menuOwnsDrawing = false
  private var declaredSourceFillColor: Int? = null

  init {
    clipChildren = false
    clipToPadding = false
    setWillNotDraw(false)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  // Fabric independently lays out the original toolbar children.
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        jelly.down(event.x, event.y)
        animationScale = try {
          Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        } catch (_: RuntimeException) { 1f }
        clock.restart(animationScale)
        requestFrame()
      }
      MotionEvent.ACTION_MOVE -> { jelly.move(event.x, event.y); requestFrame() }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { jelly.release(); requestFrame() }
    }
    return super.dispatchTouchEvent(event)
  }

  override fun draw(canvas: Canvas) {
    if (menuOwnsDrawing) return
    control.set(0f, 0f, width.toFloat(), height.toFloat())
    jelly.deformControl(control, resources.displayMetrics.density, 1f)
    val color = sourceFillColor()
    if (color != null) {
      // Explicit toolbar groups are capsules. Draw their known solid recipe
      // as geometry rather than stretching a captured background/edge lens.
      fillPaint.color = color
      val radius = minOf(control.width(), control.height()) / 2f
      canvas.drawRoundRect(control, radius, radius, fillPaint)
      if (canvas.isHardwareAccelerated && jelly.glowValue > .001f) {
        val lightSave = canvas.save()
        canvas.translate(control.left, control.top)
        pressLight?.draw(canvas, control.width(), control.height(), radius,
          resources.displayMetrics.density, 1f, jelly.lightPositionX - control.left,
          jelly.lightPositionY - control.top, jelly.glowValue, trigger = true)
        canvas.restoreToCount(lightSave)
      }
    }
    val save = canvas.save()
    canvas.translate(control.left, control.top)
    canvas.scale(control.width() / width.coerceAtLeast(1), control.height() / height.coerceAtLeast(1))
    try {
      if (color != null) super.dispatchDraw(canvas) else super.draw(canvas)
    } finally { canvas.restoreToCount(save) }
  }

  /** Snapshot only the glyph/content tree; never bake the toolbar material. */
  internal fun drawMenuForeground(canvas: Canvas) = super.dispatchDraw(canvas)

  internal fun setSourceFillColor(color: Int?) { declaredSourceFillColor = color; invalidate() }

  /** JS explicitly certifies its simple color-only capsule style. The actual
   * native paint must agree; a color underneath an unknown image is not proof. */
  internal fun sourceFillColor(): Int? {
    val declared = declaredSourceFillColor ?: return null
    val density = resources.displayMetrics.density
    if (width <= 0 || height <= 0 || width > 256f * density || height > 96f * density) return null
    val actual = (background as? ColorDrawable)?.color ?: BackgroundStyleApplicator.getBackgroundColor(this)
    return declared.takeIf { it == actual }
  }

  private fun takeMenuDrawing() {
    menuOwnsDrawing = true
    // A Modal takes the source's pointer stream. Retarget release without
    // resetting the current deformation, including a long-press open.
    jelly.release()
    stopFrames()
    invalidate()
  }

  private fun releaseMenuDrawing() {
    menuOwnsDrawing = false
    invalidate()
    if (!jelly.isSettled) { clock.restart(animationScale); requestFrame() }
  }

  internal fun setMenuSourceActive(active: Boolean) {
    if (active == menuOwnsDrawing) return
    if (active) takeMenuDrawing() else releaseMenuDrawing()
  }

  private fun requestFrame() {
    if (menuOwnsDrawing || framePosted || !isAttachedToWindow || windowVisibility != View.VISIBLE) return
    framePosted = true
    Choreographer.getInstance().postFrameCallback(this)
  }

  override fun doFrame(frameTimeNanos: Long) {
    framePosted = false
    if (!isAttachedToWindow || windowVisibility != View.VISIBLE || menuOwnsDrawing) return
    jelly.advance(clock.advance(frameTimeNanos, display?.refreshRate ?: 60f))
    invalidate()
    if (!jelly.isSettled) requestFrame()
  }

  private fun stopFrames() {
    if (framePosted) Choreographer.getInstance().removeFrameCallback(this)
    framePosted = false
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != View.VISIBLE) { jelly.release(); stopFrames() }
    else if (!menuOwnsDrawing && !jelly.isSettled) { clock.restart(animationScale); requestFrame() }
  }

  override fun onDetachedFromWindow() {
    MenuTriggerSnapshots.releaseSource(this)
    stopFrames()
    jelly.release()
    menuOwnsDrawing = false
    // A pooled native host starts clean. A menu that already captured it keeps
    // its own reference to the departing Jelly state until absorption ends.
    jelly = GlassJelly()
    super.onDetachedFromWindow()
  }
}
