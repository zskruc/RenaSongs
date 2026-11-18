package expo.modules.liquidglass.menumotion

/** One actual capture exclusion, restored once after the outermost transaction. */
internal class MenuSourceCapture {
  private var pending = false
  private var released = false
  fun stage(included: Boolean, currentOwner: Boolean, visible: Boolean): Boolean {
    if (released || pending || !included || !currentOwner || !visible) return false
    pending = true
    return true
  }
  fun finish(outermost: Boolean, currentOwner: Boolean): Boolean {
    if (!outermost || !pending) return false
    pending = false
    return !released && currentOwner
  }
  fun release() { released = true; pending = false }
}
