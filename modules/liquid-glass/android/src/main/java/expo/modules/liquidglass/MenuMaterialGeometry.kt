package expo.modules.liquidglass

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max

/**
 * Menu texture coordinates are physical screen pixels, never morph scale.
 * The Compose viewport reserves the full travel envelope once; only its glass
 * child is measured/placed at the live shell rectangle. Capture ROI remains
 * fixed while that child moves, preventing per-frame GPU image reallocation.
 */
internal class MenuMaterialGeometry {
  var active = false
    private set
  var captureLeft = 0
    private set
  var captureTop = 0
    private set
  var captureRight = 0
    private set
  var captureBottom = 0
    private set
  var left = 0
    private set
  var top = 0
    private set
  var right = 1
    private set
  var bottom = 1
    private set
  val captureWidth get() = max(captureRight - captureLeft, 1)
  val captureHeight get() = max(captureBottom - captureTop, 1)
  val width get() = max(right - left, 1)
  val height get() = max(bottom - top, 1)
  val placementX get() = left - captureLeft
  val placementY get() = top - captureTop

  fun reserve(l: Float, t: Float, r: Float, b: Float): Boolean {
    if (!finiteRect(l, t, r, b)) return false
    val nextLeft = floor(l).toInt()
    val nextTop = floor(t).toInt()
    val nextRight = ceil(r).toInt()
    val nextBottom = ceil(b).toInt()
    val changed = !active || captureLeft != nextLeft || captureTop != nextTop ||
      captureRight != nextRight || captureBottom != nextBottom
    active = true
    captureLeft = nextLeft; captureTop = nextTop
    captureRight = nextRight; captureBottom = nextBottom
    return changed
  }

  fun update(l: Float, t: Float, r: Float, b: Float): Boolean {
    if (!active || !finiteRect(l, t, r, b)) return false
    val nextLeft = floor(l).toInt()
    val nextTop = floor(t).toInt()
    val nextRight = ceil(r).toInt()
    val nextBottom = ceil(b).toInt()
    val changed = left != nextLeft || top != nextTop || right != nextRight || bottom != nextBottom
    left = nextLeft; top = nextTop; right = nextRight; bottom = nextBottom
    return changed
  }

  fun clear(): Boolean {
    if (!active) return false
    active = false
    return true
  }

  private fun finiteRect(l: Float, t: Float, r: Float, b: Float): Boolean =
    l.isFinite() && t.isFinite() && r.isFinite() && b.isFinite() && l < r && t < b
}
