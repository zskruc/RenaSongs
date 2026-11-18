package android.widget

import android.graphics.Matrix
import android.graphics.drawable.Drawable
import android.view.View

open class ImageView : View() {
  var drawable: Drawable? = null
  var imageAlpha = 255
  val imageMatrix = Matrix()
}

open class TextView : View() {
  var text: CharSequence = ""
  var currentTextColor = -1
  var textSize = 16f
  var typeface: Any? = null
}

open class ProgressBar : View() {
  var progress = 0
  var secondaryProgress = 0
  var progressDrawable: Drawable? = null
  var isIndeterminate = false
  var indeterminateDrawable: Drawable? = null
}
