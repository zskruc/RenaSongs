package expo.modules.liquidglass.menumotion

/** Identity is explicit; invalid/geometry-only origins never authorize hiding. */
internal fun menuSourceTag(value: Double?): Int? = value?.takeIf {
  it.isFinite() && it > 0.0 && it <= Int.MAX_VALUE.toDouble() && it == kotlin.math.floor(it)
}?.toInt()

/** Main-thread lifecycle boundary, independent of Android's rendering timing. */
internal class MenuSourceOwnership {
  var attached = false
    private set
  var hidden = false
    private set
  var released = false
    private set
  fun attach(currentOwner: Boolean, exactSource: Boolean, drawableReady: Boolean): Boolean {
    if (released || !currentOwner || !exactSource || !drawableReady) return false
    attached = true
    hidden = true
    return true
  }
  /** Restore only our own zeroed alpha; never overwrite another animation. */
  fun detach(currentOwner: Boolean, exactSource: Boolean, alphaStillHidden: Boolean): Boolean {
    val restore = hidden && currentOwner && exactSource && alphaStillHidden
    attached = false
    hidden = false
    return restore
  }
  fun release(): Boolean {
    if (released) return false
    released = true
    return true
  }
}
