package expo.modules.liquidglass.menumotion

import android.graphics.Path
import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.max

/**
 * Converts the upstream Gaussian signed-distance field into a hardware clip.
 * The field is bounded to 64 cells on its longest side, as in upstream. Edge
 * arrays are reused; no bitmap uploads or full-window offscreen layer is needed.
 */
internal class GlassMorphOutline(density: Float) {
  private val field = GlassGaussianField(max(density, 1f))
  private var first = IntArray(0)
  private var second = IntArray(0)
  private var visited = BooleanArray(0)
  private var xs = FloatArray(0)
  private var ys = FloatArray(0)
  private val incoming = RectF()
  private val outgoing = RectF()
  private val edges = IntArray(4)
  val path = Path()

  fun update(frame: GlassMorphFrame, originX: Float, originY: Float, settled: Boolean) {
    path.rewind()
    incoming.set(frame.bounds)
    incoming.offset(-originX, -originY)
    outgoing.set(frame.sourceLobe)
    outgoing.offset(-originX, -originY)
    if (!settled && frame.smoothing > 0.25f &&
      field.update(incoming, frame.radiusX, frame.radiusY, outgoing, frame.sourceRadius, frame.smoothing)) {
      contour()
      if (!path.isEmpty) return
    }
    path.addRoundRect(incoming, frame.radiusX, frame.radiusY, Path.Direction.CW)
    if (!settled) path.addRoundRect(outgoing, frame.sourceRadius, frame.sourceRadius, Path.Direction.CW)
  }

  private fun contour() {
    val w = field.width
    val h = field.height
    val horizontals = (w - 1) * h
    val total = horizontals + w * (h - 1)
    if (first.size < total) {
      first = IntArray(total + 128)
      second = IntArray(total + 128)
      visited = BooleanArray(total + 128)
      xs = FloatArray(total + 128)
      ys = FloatArray(total + 128)
    }
    first.fill(-1, 0, total)
    second.fill(-1, 0, total)
    visited.fill(false, 0, total)
    val distances = field.rgba
    for (row in 0 until h - 1) {
      for (column in 0 until w - 1) {
        val a = distances[(row * w + column) * 4]
        val b = distances[(row * w + column + 1) * 4]
        val c = distances[((row + 1) * w + column + 1) * 4]
        val d = distances[((row + 1) * w + column) * 4]
        var count = 0
        val left = field.originX + column * field.step
        val top = field.originY + row * field.step
        if ((a <= 0f) != (b <= 0f)) {
          val id = row * (w - 1) + column
          point(id, left + fraction(a, b) * field.step, top)
          edges[count++] = id
        }
        if ((b <= 0f) != (c <= 0f)) {
          val id = horizontals + row * w + column + 1
          point(id, left + field.step, top + fraction(b, c) * field.step)
          edges[count++] = id
        }
        if ((d <= 0f) != (c <= 0f)) {
          val id = (row + 1) * (w - 1) + column
          point(id, left + fraction(d, c) * field.step, top + field.step)
          edges[count++] = id
        }
        if ((a <= 0f) != (d <= 0f)) {
          val id = horizontals + row * w + column
          point(id, left, top + fraction(a, d) * field.step)
          edges[count++] = id
        }
        if (count == 2) connect(edges[0], edges[1])
        else if (count == 4) {
          // Resolve the saddle against the cell centre, not iteration order.
          if (((a + b + c + d) <= 0f) == (a <= 0f)) {
            connect(edges[0], edges[1]); connect(edges[2], edges[3])
          } else {
            connect(edges[0], edges[3]); connect(edges[1], edges[2])
          }
        }
      }
    }
    for (start in 0 until total) {
      if (first[start] < 0 || visited[start]) continue
      path.moveTo(xs[start], ys[start])
      var previous = -1
      var current = start
      var steps = 0
      while (current >= 0 && !visited[current] && steps++ <= total) {
        visited[current] = true
        path.lineTo(xs[current], ys[current])
        val next = if (first[current] != previous) first[current] else second[current]
        previous = current
        current = next
      }
      path.close()
    }
  }

  private fun fraction(a: Float, b: Float): Float =
    if (abs(a - b) < 0.00001f) 0.5f else (a / (a - b)).coerceIn(0f, 1f)
  private fun point(id: Int, x: Float, y: Float) { xs[id] = x; ys[id] = y }
  private fun connect(a: Int, b: Int) {
    if (first[a] < 0) first[a] = b else second[a] = b
    if (first[b] < 0) first[b] = a else second[b] = a
  }
}
