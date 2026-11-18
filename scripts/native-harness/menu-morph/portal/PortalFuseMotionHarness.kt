package expo.modules.liquidglass.menumotion
import android.graphics.Canvas
import android.graphics.RectF
import android.util.Log
import android.view.View

fun main() {
  Log.legacy = false
  val source = RectF(1200f, 1880f, 1320f, 2000f)
  val target = RectF(330f, 280f, 1050f, 1580f)
  val density = 3f
  val limits = RectF(-144f, -144f, 1134f, 1864f)
  val body = View()
  val motion = GlassMotion().apply { initialize(source, target, 84f, density, source, false, GlassMorphTuning(null, null)); retarget(true) }
  val outline = GlassMorphOutline(density)
  val portal = GlassForegroundPortal(density).apply { diagnosticsEnabled = true; reserve(target, target.left, target.top, limits) }
  val canvas = Canvas()
  val buckets = Array(3) { IntArray(2) }
  var settled = false
  for (tick in 1..120) {
    settled = motion.advanceBy(1f/120f)
    val f = motion.frame
    outline.update(f, target.left, target.top, settled, false, 15f)
    portal.update(f, target.left, target.top, false, outline.smoothedField)
    portal.setContentBlur(body, f.contentBlur, f.bounds.width() / target.width() * f.contentZoom, f.bounds.height() / target.height() * f.contentZoom)
    val before = portal.diagnostics()["portalFusedDraws"]!!.toLong()
    portal.draw(canvas, limits, true, {})
    if (f.rowsOpacity > .001f) {
      val bucket = if (tick <= 24) 0 else if (tick <= 48) 1 else 2
      buckets[bucket][if (portal.diagnostics()["portalFusedDraws"]!!.toLong() > before) 0 else 1]++
    }
  }
  check(portal.diagnostics()["portalFusedDraws"]!!.toLong() > 0)
  println("Private real-motion support eligibility at illustrative geometry (not captured device geometry): 0–200ms fused/legacy=${buckets[0].toList()}, 200–400=${buckets[1].toList()}, 400–1000=${buckets[2].toList()}; no FPS/pixel claim.")
}
