package android.view

import android.graphics.Matrix
import android.graphics.drawable.Drawable

/** Deterministic metadata/dirty fixture, with no Android drawing semantics. */
open class View {
  var left = 0
  var top = 0
  var right = 100
  var bottom = 100
  var scrollX = 0
  var scrollY = 0
  var visibility = VISIBLE
  var alpha = 1f
  var elevation = 0f
  var translationZ = 0f
  val matrix = Matrix()
  var background: Drawable? = null
  var isDirty = false
  var reactBackgroundColor: Int? = null
  var isFixtureGlassContainer = false

  companion object {
    const val VISIBLE = 0
    const val INVISIBLE = 4
    const val GONE = 8
  }
}

open class ViewGroup : View() {
  private val children = ArrayList<View>()
  val childCount get() = children.size
  fun getChildAt(index: Int): View = children[index]
  fun addView(view: View) { children.add(view) }
  fun removeView(view: View) { children.remove(view) }
}
