package expo.modules.liquidglass

import android.graphics.Canvas
import android.graphics.RectF
import android.view.View
import android.view.ViewGroup
import expo.modules.liquidglass.menumotion.MenuSourceCapture
import java.lang.ref.WeakReference
import kotlin.math.ceil
import kotlin.math.floor

/**
 * A real window-level drawing owner for a whole-toolbar morph. It has no alpha
 * or RenderEffect layer of its own: only the already bounded material/portal
 * children filter pixels. React retains every child, layout and touch owner.
 */
internal class MenuMorphWindowOwner(host: MenuMorphView) : View(host.context) {
  private val host = WeakReference(host)
  private var root = WeakReference<ViewGroup>(null)
  private var capture = MenuSourceCapture()
  private val location = IntArray(2)
  private val envelope = RectF()
  private var recordings = 0L
  private var suppressions = 0L
  private var restorations = 0L
  private var suppressed = false
  private var atomicHandoffHidden = false

  init {
    setWillNotDraw(false)
    isClickable = false; isFocusable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    isForceDarkAllowed = false
    alpha = 1f
  }

  fun attach(window: View, screenEnvelope: RectF): Boolean {
    if (window !is ViewGroup || !window.isAttachedToWindow || !window.isHardwareAccelerated ||
      window.width <= 0 || window.height <= 0 || screenEnvelope.isEmpty) return false
    if (root.get() !== window) {
      detach()
      try { window.overlay.add(this) } catch (_: RuntimeException) {
        try { window.overlay.remove(this) } catch (_: RuntimeException) { }
        return false
      }
      root = WeakReference(window)
      capture = MenuSourceCapture()
      MenuMorphWindowOwners.add(this)
    }
    envelope.set(screenEnvelope)
    updateBounds()
    if (!suppressed && !atomicHandoffHidden) visibility = VISIBLE
    invalidate()
    return parent != null
  }

  fun updateBounds() {
    val window = root.get() ?: return
    window.getLocationOnScreen(location)
    val left = floor(envelope.left - location[0]).toInt()
    val top = floor(envelope.top - location[1]).toInt()
    val right = ceil(envelope.right - location[0]).toInt()
    val bottom = ceil(envelope.bottom - location[1]).toInt()
    if (this.left != left || this.top != top || this.right != right || this.bottom != bottom) {
      measure(MeasureSpec.makeMeasureSpec((right - left).coerceAtLeast(1), MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec((bottom - top).coerceAtLeast(1), MeasureSpec.EXACTLY))
      layout(left, top, right, bottom)
    }
  }

  override fun onDraw(canvas: Canvas) {
    val owner = host.get() ?: return
    val window = root.get() ?: return
    window.getLocationOnScreen(location)
    val save = canvas.save()
    recordings++
    canvas.translate(owner.menuTargetLeft - location[0] - left,
      owner.menuTargetTop - location[1] - top)
    try { owner.drawWindowFrame(canvas) } finally { canvas.restoreToCount(save) }
  }

  fun suppress(captureSource: View) {
    val window = root.get() ?: return
    // A ViewOverlay is painted only by its actual host, not an arbitrary child
    // capture. Activity-only menu underlay never traverses the Modal owner.
    var ancestor: View? = window
    var relevant = false
    while (ancestor != null) {
      if (ancestor === captureSource) { relevant = true; break }
      ancestor = ancestor.parent as? View
    }
    if (capture.stage(relevant, parent != null, visibility == VISIBLE)) {
      suppressions++
      suppressed = true
      WindowBackdrops.onMenuSourceCaptureStaging(window)
      visibility = INVISIBLE
    }
  }

  fun restore() {
    if (!capture.finish(true, parent != null)) return
    restorations++
    suppressed = false
    visibility = if (atomicHandoffHidden) INVISIBLE else VISIBLE
    invalidate()
    root.get()?.invalidate()
  }

  /** Only this independently owned Dialog drawing disappears in the same
   * buffer transaction that restores the original Activity source. */
  fun atomicHandoffRoot(): View? = root.get()?.takeIf {
    parent != null && !suppressed && !atomicHandoffHidden && visibility == VISIBLE &&
      it.isAttachedToWindow && it.isShown && it.windowVisibility == VISIBLE
  }

  fun hideForAtomicHandoff() {
    atomicHandoffHidden = true
    visibility = INVISIBLE
    invalidate()
    root.get()?.invalidate()
  }

  fun detach() {
    capture.release()
    suppressed = false
    atomicHandoffHidden = false
    visibility = INVISIBLE
    try { root.get()?.overlay?.remove(this) } catch (_: RuntimeException) { }
    finally { root.clear(); MenuMorphWindowOwners.remove(this) }
  }

  fun diagnostics(): Map<String, Any> = mapOf("groupWindowAttached" to (parent != null),
    "groupWindowAlpha" to alpha, "groupWindowVisibility" to visibility,
    "groupWindowRecordings" to recordings, "groupWindowCaptureSuppressions" to suppressions,
    "groupWindowCaptureRestorations" to restorations,
    "groupWindowAtomicHidden" to atomicHandoffHidden,
    "groupWindowViewportPixels" to width.toLong() * height,
    "groupWindowOrigin" to listOf(left, top))
}

internal object MenuMorphWindowOwners {
  private val owners = ArrayList<WeakReference<MenuMorphWindowOwner>>()
  private var depth = 0
  fun add(owner: MenuMorphWindowOwner) { owners.removeAll { it.get() == null || it.get() === owner }; owners.add(WeakReference(owner)) }
  fun remove(owner: MenuMorphWindowOwner) { owners.removeAll { it.get() == null || it.get() === owner } }
  fun beginCapture(source: View) { depth++; owners.toList().forEach { it.get()?.suppress(source) } }
  fun endCapture() {
    depth = (depth - 1).coerceAtLeast(0)
    if (depth == 0) owners.toList().forEach { it.get()?.restore() }
  }
}
