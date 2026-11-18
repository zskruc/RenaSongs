package expo.modules.liquidglass

import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Animatable
import android.graphics.drawable.Drawable
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import com.facebook.react.uimanager.BackgroundStyleApplicator

/**
 * Checks view metadata before a background window draws, never its pixels.
 * Dirty ancestors alone are insufficient: restoring an excluded glass card
 * invalidates its ancestors even though the captured scene has not changed.
 */
internal class BackdropSceneChanges(
  private val includeGlassContent: Boolean = false,
  private val observeLeafDirty: Boolean = true
) {
  private val matrixValues = FloatArray(9)
  private var initialized = false
  private var lastSignature = 0L
  private var dirtyLeaf = false
  var signatureChangeCount = 0L
    private set
  var leafOnlyObservationCount = 0L
    private set

  fun hasChanged(root: View): Boolean {
    dirtyLeaf = false
    val signature = visit(root, root)
    val signatureChanged = !initialized || signature != lastSignature
    if (signatureChanged) signatureChangeCount++
    else if (dirtyLeaf) leafOnlyObservationCount++
    // isDirty is level-triggered and a manual GPU-source traversal or async
    // completion may observe the same leaf repeatedly without a ViewRoot draw.
    // Trusted menu snapshots use metadata plus the actual Activity OnDraw
    // observer; ordinary live capture retains its original dirty-leaf rule.
    val changed = signatureChanged || (observeLeafDirty && dirtyLeaf)
    initialized = true
    lastSignature = signature
    return changed
  }

  /** Also used for the few fixed menu/scrim views; no subtree walk. */
  fun properties(view: View): Long {
    var hash = System.identityHashCode(view).toLong()
    hash = mix(hash, view.left)
    hash = mix(hash, view.top)
    hash = mix(hash, view.right)
    hash = mix(hash, view.bottom)
    hash = mix(hash, view.scrollX)
    hash = mix(hash, view.scrollY)
    hash = mix(hash, view.visibility)
    hash = mix(hash, view.alpha.toRawBits())
    hash = mix(hash, view.elevation.toRawBits())
    hash = mix(hash, view.translationZ.toRawBits())
    view.matrix.getValues(matrixValues)
    for (value in matrixValues) hash = mix(hash, value.toRawBits())
    val background = view.background
    hash = drawableProperties(hash, background)
    if (background != null) {
      hash = mix(hash, if (background is ColorDrawable) background.color
        else BackgroundStyleApplicator.getBackgroundColor(view) ?: 0)
    }
    // An earlier background capture can consume leaf dirty flags before this
    // observer runs. Content metadata remains observable even after drawing.
    if (view is ImageView) {
      hash = drawableProperties(hash, view.drawable)
      hash = mix(hash, view.imageAlpha)
      view.imageMatrix.getValues(matrixValues)
      for (value in matrixValues) hash = mix(hash, value.toRawBits())
    }
    if (view is TextView) {
      val text = view.text
      var textHash = 0
      for (index in 0 until text.length) textHash = textHash * 31 + text[index].code
      hash = mix(hash, textHash)
      hash = mix(hash, view.currentTextColor)
      hash = mix(hash, view.textSize.toRawBits())
      hash = mix(hash, System.identityHashCode(view.typeface))
    }
    if (view is ProgressBar) {
      hash = mix(hash, view.progress)
      hash = mix(hash, view.secondaryProgress)
      hash = drawableProperties(hash, view.progressDrawable)
      if (view.isIndeterminate) hash = drawableProperties(hash, view.indeterminateDrawable)
    }
    return hash
  }

  private fun visit(view: View, root: View): Long {
    if (view is LiquidGlassView || (!includeGlassContent && WindowBackdrops.isGlassContainer(view, root))) return 0L
    var signature = properties(view)
    if (view.visibility != View.VISIBLE || view.alpha <= 0f) return signature
    var physicalChildren = 0
    if (view is ViewGroup) {
      // ReactModalHostView forwards these getters to a separate Dialog root.
      // Metadata must follow the same physical parents as Activity drawing,
      // never those virtual children (including their animated scrim).
      for (index in 0 until view.childCount) {
        if (view.getChildAt(index)?.parent === view) physicalChildren++
      }
      if (physicalChildren > 0) {
        signature = mix(signature, physicalChildren)
        for (index in 0 until view.childCount) {
          val child = view.getChildAt(index) ?: continue
          if (child.parent === view) signature = signature * 31L + visit(child, root)
        }
      }
    }
    if (physicalChildren == 0 && view.isDirty) {
      // Image/text/Canvas leaf invalidations still refresh an animated scene.
      // Skip parent dirty flags propagated from omitted foreground material.
      dirtyLeaf = true
    }
    return signature
  }

  private fun mix(hash: Long, value: Int): Long = hash * 31L + value

  private fun drawableProperties(hash: Long, drawable: Drawable?): Long {
    var result = mix(hash, System.identityHashCode(drawable))
    if (drawable != null) {
      result = mix(result, drawable.alpha)
      result = mix(result, drawable.level)
      for (state in drawable.state) result = mix(result, state)
      if (drawable is Animatable) result = mix(result, if (drawable.isRunning) 1 else 0)
    }
    return result
  }
}
