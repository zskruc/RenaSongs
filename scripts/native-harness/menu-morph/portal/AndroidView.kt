package android.view

import android.graphics.RenderEffect

class View {
  var dirtyReads = 0
  var dirty = false
  val isDirty: Boolean get() { dirtyReads++; return dirty }
  var isLayoutRequested = false
  fun setRenderEffect(effect: RenderEffect?) = Unit
}
