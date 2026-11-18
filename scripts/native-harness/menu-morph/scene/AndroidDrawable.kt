package android.graphics.drawable

open class Drawable {
  var alpha = 255
  var level = 0
  var state = intArrayOf()
}

class ColorDrawable(var color: Int) : Drawable()
interface Animatable { val isRunning: Boolean }
class AnimatedDrawable(override var isRunning: Boolean = false) : Drawable(), Animatable
