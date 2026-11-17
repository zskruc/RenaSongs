package android.graphics

/** Deterministic JVM geometry boundary; production spring/field code is unmodified. */
class RectF(var left: Float = 0f, var top: Float = 0f, var right: Float = 0f, var bottom: Float = 0f) {
  fun set(a: Float, b: Float, c: Float, d: Float) { left = a; top = b; right = c; bottom = d }
  fun set(other: RectF) = set(other.left, other.top, other.right, other.bottom)
  fun width() = right - left
  fun height() = bottom - top
  fun centerX() = (left + right) / 2f
  fun centerY() = (top + bottom) / 2f
  fun offset(x: Float, y: Float) { left += x; right += x; top += y; bottom += y }
}

class Path {
  enum class Direction { CW }
  val points = ArrayList<Pair<Float, Float>>()
  var contours = 0
  var rectangles = 0
  var lastRoundRect: RectF? = null
  val isEmpty: Boolean get() = points.isEmpty() && rectangles == 0
  fun rewind() { points.clear(); contours = 0; rectangles = 0; lastRoundRect = null }
  fun moveTo(x: Float, y: Float) { points.add(x to y) }
  fun lineTo(x: Float, y: Float) { points.add(x to y) }
  fun close() { contours++ }
  fun addRoundRect(rect: RectF, rx: Float, ry: Float, direction: Direction) {
    check(rx.isFinite() && ry.isFinite())
    rectangles++
    lastRoundRect = RectF(rect.left, rect.top, rect.right, rect.bottom)
  }
}
