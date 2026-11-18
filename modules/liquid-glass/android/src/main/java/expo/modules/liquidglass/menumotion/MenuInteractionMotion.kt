/*
 * SPDX-License-Identifier: MIT
 * Adapted from GlassMenuSession in rit3zh/expo-glass-custom-menu
 * @0021efd8ab0d068f155bbdac62c5f673ccc39a24 (Expo MIT notice alongside module).
 */
package expo.modules.liquidglass.menumotion

import android.graphics.RectF

internal data class MenuInteractionRow(val id: String, val rect: RectF, val enabled: Boolean = true,
  val keepOpen: Boolean = false, val fullWidth: Boolean = true)

/** Pure motion/selection state; native Views and RN callbacks are never retained here. */
internal class MenuInteractionMotion(private val density: Float) {
  private val jelly = GlassJelly()
  private val plateTop = GlassSpring(.25f, 8f)
  private val plateHeight = GlassSpring(.25f, 8f)
  private val plateLeft = GlassSpring(.25f, 8f)
  private val plateWidth = GlassSpring(.25f, 8f)
  private val alpha = GlassSpring(.004f, .05f)
  private var rows: List<MenuInteractionRow> = emptyList()
  private var active: MenuInteractionRow? = null
  private var plateVisible = false
  private var pressed = false
  private var menuWidth = 0f
  var rowChanges = 0
    private set
  val isSettled get() = jelly.isSettled && plateTop.isSettled && plateHeight.isSettled &&
    plateLeft.isSettled && plateWidth.isSettled && alpha.isSettled
  val jellySettled get() = jelly.isSettled
  val isPressed get() = pressed
  val plateAlpha get() = alpha.value.coerceIn(0f, 1f)
  val glowValue get() = jelly.glowValue
  val lightPositionX get() = jelly.lightPositionX
  val lightPositionY get() = jelly.lightPositionY
  val plateRect = RectF()

  fun setRows(value: List<MenuInteractionRow>) {
    rows = value
    active = null
    plateVisible = false
    alpha.reset(0f)
  }
  fun down(x: Float, y: Float, touchX: Float = x, touchY: Float = y): Boolean {
    val row = exactRow(x, y) ?: return false
    pressed = true
    jelly.down(touchX, touchY)
    highlight(row, true)
    return true
  }
  fun move(x: Float, y: Float, touchX: Float = x, touchY: Float = y) {
    if (!pressed) return
    jelly.move(touchX, touchY)
    highlight(nearestRow(x, y), false)
  }
  fun up(x: Float, y: Float): MenuInteractionRow? {
    val selection = if (pressed) exactRow(x, y) else null
    release()
    return selection
  }
  fun cancel() = release()
  fun release() {
    pressed = false
    jelly.release()
    highlight(null, false)
  }
  fun cancelForScroll() {
    pressed = false
    jelly.releaseDrag()
    highlight(null, false)
  }
  fun advance(seconds: Float) {
    jelly.advance(seconds)
    plateTop.advance(seconds)
    plateHeight.advance(seconds)
    plateLeft.advance(seconds)
    plateWidth.advance(seconds)
    alpha.advance(seconds)
  }
  fun deform(out: RectF, awayX: Float, awayY: Float, amount: Float = 1f) =
    jelly.deformMenu(out, awayX, awayY, density, amount)

  fun updatePlate(width: Float) {
    menuWidth = width
    val top = plateTop.value
    plateRect.set(plateLeft.value, top, plateLeft.value + plateWidth.value, top + plateHeight.value)
  }
  private fun exactRow(x: Float, y: Float): MenuInteractionRow? = rows.firstOrNull {
    it.enabled && x >= it.rect.left && x < it.rect.right && y >= it.rect.top && y < it.rect.bottom
  }
  private fun nearestRow(x: Float, y: Float): MenuInteractionRow? {
    exactRow(x, y)?.let { return it }
    val slack = 24f * density
    val left = rows.minOfOrNull { it.rect.left } ?: return null
    val right = rows.maxOfOrNull { it.rect.right } ?: return null
    val top = rows.minOf { it.rect.top }
    val bottom = rows.maxOf { it.rect.bottom }
    if (x < left - slack || x > right + slack || y < top - slack || y > bottom + slack) return null
    return rows.filter { it.enabled }.minByOrNull {
      val dx = when { x < it.rect.left -> it.rect.left - x; x > it.rect.right -> x - it.rect.right; else -> 0f }
      val dy = when { y < it.rect.top -> it.rect.top - y; y > it.rect.bottom -> y - it.rect.bottom; else -> 0f }
      dx * dx + dy * dy
    }
  }
  private fun highlight(row: MenuInteractionRow?, immediate: Boolean) {
    if (active?.id == row?.id) return
    val hadRow = active != null
    active = row
    if (row == null) {
      plateVisible = false
      alpha.target(0f, PlateFade)
    } else {
      val wideRow = row.fullWidth && (menuWidth <= 0f || row.rect.width() >= menuWidth * .65f)
      val left = if (wideRow) 8f * density else row.rect.left
      val width = if (wideRow && menuWidth > 0f) menuWidth - 16f * density else row.rect.width()
      if (!plateVisible && !hadRow) {
        plateTop.reset(row.rect.top)
        plateHeight.reset(row.rect.height())
        plateLeft.reset(left)
        plateWidth.reset(width)
      } else {
        plateTop.target(row.rect.top, PlateSlide)
        plateHeight.target(row.rect.height(), PlateSlide)
        plateLeft.target(left, PlateSlide)
        plateWidth.target(width, PlateSlide)
        rowChanges++
      }
      plateVisible = true
      if (immediate) alpha.reset(1f) else alpha.target(1f, PlateFade)
    }
  }
  private companion object {
    val PlateSlide = GlassSpringSpec(.85f, .13f)
    val PlateFade = GlassSpringSpec(1f, .14f)
  }
}
