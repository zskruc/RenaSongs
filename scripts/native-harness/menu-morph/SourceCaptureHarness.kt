package expo.modules.liquidglass.menumotion

import kotlin.math.abs
import kotlin.math.ceil

/** Exercises the PRODUCTION capture transaction with a deliberately simple
 * cached-host fixture. The fixture models consumption of dirty state; it does
 * not emulate Android View/HWUI and cannot prove actual visible replay. */
fun main() {
  var checks = 0
  fun verify(value: Boolean, message: String) { checks++; check(value) { message } }

  // Necessary gate: neither an unrelated capture, a stale lease nor an already
  // invisible/unattached replacement may create suppression or later redraws.
  for (included in listOf(false, true)) for (currentOwner in listOf(false, true))
      for (visible in listOf(false, true)) {
    val state = MenuSourceCapture()
    val eligible = included && currentOwner && visible
    verify(state.stage(included, currentOwner, visible) == eligible,
      "Capture staged an unrelated, stale or hidden source")
    verify(!state.finish(false, currentOwner), "Nested capture restored a source before its enclosing capture finished")
    verify(state.finish(true, currentOwner) == eligible, "Outermost capture lost/created its restoration transaction")
    verify(!state.finish(true, currentOwner), "An idle/consumed capture scheduled another redraw")
  }

  val nested = MenuSourceCapture()
  verify(nested.stage(true, true, true), "The real source was not staged")
  repeat(12) {
    verify(!nested.stage(true, true, false), "Nested capture duplicated suppression while owner was invisible")
    verify(!nested.finish(false, true), "Nested finally restored a source while outer capture could still sample it")
  }
  verify(nested.finish(true, true), "Nested captures failed to restore at the outermost finally")
  repeat(12) { verify(!nested.finish(true, true), "Repeated finally kept generating owner invalidations") }

  val stale = MenuSourceCapture()
  stale.stage(true, true, true)
  verify(!stale.finish(true, false), "Stale owner restored/invalidate a replacement source")
  verify(!stale.finish(true, true), "Rejected stale restore retained a delayed pending transaction")
  val released = MenuSourceCapture()
  released.stage(true, true, true)
  released.release()
  verify(!released.finish(true, true), "Released source was revived by capture finally")
  verify(!released.stage(true, true, true), "Released source staged a later capture")
  released.release()
  verify(!released.finish(true, true), "Repeated disposal reintroduced capture work")

  // The capture may consume the ancestor's dirty bit while the replacement is
  // invisible. Valid pixels or a draw counter alone cannot repair that cached
  // ancestor: restoration must explicitly invalidate its drawing owner.
  class CachedHost(val state: MenuSourceCapture = MenuSourceCapture()) {
    var ownerVisible = true
    var currentOwner = true
    var attached = true
    var dirty = true
    var cachedGlyph = false
    var invalidations = 0
    var frameRequests = 0
    var bitmapContent = true
    fun present(): Boolean {
      if (dirty) { cachedGlyph = attached && ownerVisible && bitmapContent; dirty = false }
      return cachedGlyph
    }
    fun stage(included: Boolean): Boolean {
      if (!state.stage(included, currentOwner, attached && ownerVisible)) return false
      ownerVisible = false
      return true
    }
    fun recordBackdrop(included: Boolean): Boolean {
      if (!included) return false
      // Adversarial cache-consumption model: this is intentionally stronger
      // than a particular Android implementation and exposes missing restores.
      dirty = false
      cachedGlyph = false
      return attached && ownerVisible && bitmapContent
    }
    fun finish(outermost: Boolean, restoreOwnerDirty: Boolean = true) {
      if (!state.finish(outermost, currentOwner)) return
      ownerVisible = true
      if (restoreOwnerDirty) { dirty = true; invalidations++ }
      // A bounded invalidation is not a continuously reposting frame callback.
    }
    fun dispose() { state.release(); attached = false; ownerVisible = false; dirty = true }
  }

  val legacy = CachedHost()
  verify(legacy.present(), "Negative control did not start with valid visible glyph pixels")
  legacy.stage(true)
  verify(!legacy.recordBackdrop(true), "Capture included its own replacement source")
  legacy.finish(true, restoreOwnerDirty = false)
  verify(legacy.bitmapContent && legacy.ownerVisible && !legacy.present(),
    "Negative control no longer detects valid pixels plus an unrefreshed blank owner cache")

  val actual = CachedHost()
  verify(actual.present(), "Valid source did not initially draw")
  repeat(30) {
    verify(actual.stage(true), "Following capture did not start a fresh bounded transaction")
    verify(!actual.recordBackdrop(true), "Suppressed source contaminated backdrop pixels")
    actual.finish(false)
    verify(!actual.ownerVisible, "Inner finally exposed the source during capture")
    actual.finish(true)
    verify(actual.ownerVisible && actual.dirty, "Source visibility and actual owner dirty state were not restored together")
    verify(actual.present(), "Normal cached-host draw did not recover the immutable source glyph")
  }
  verify(actual.invalidations == 30 && actual.frameRequests == 0,
    "Source restoration scheduled duplicate/continuous redraw work")
  repeat(30) {
    actual.finish(true)
    verify(actual.present() && actual.invalidations == 30 && actual.frameRequests == 0,
      "Idle source acquired a recurring restoration/frame loop")
  }

  val unrelated = CachedHost()
  unrelated.present()
  repeat(20) {
    verify(!unrelated.stage(false), "Activity-underlay capture staged an unrelated Modal-overlay source")
    verify(!unrelated.recordBackdrop(false), "Unrelated backdrop unexpectedly saw the overlay")
    unrelated.finish(true)
    verify(unrelated.present() && unrelated.invalidations == 0,
      "Unrelated capture dirtied or lost a stable source owner")
  }

  val throws = CachedHost()
  throws.present()
  var observedFailure = false
  try {
    throws.stage(true)
    throws.recordBackdrop(true)
    throw IllegalStateException("synthetic capture failure")
  } catch (_: IllegalStateException) { observedFailure = true }
  finally { throws.finish(true) }
  verify(observedFailure && throws.present() && throws.invalidations == 1,
    "Exceptional capture failed to restore the actual drawing owner in finally")

  val old = CachedHost()
  old.present(); old.stage(true); old.recordBackdrop(true)
  old.dispose()
  val replacement = CachedHost()
  verify(replacement.present(), "Replacement source failed to establish its own visible cache")
  repeat(10) {
    old.currentOwner = false
    old.finish(true)
    verify(!old.attached && !old.ownerVisible && old.invalidations == 0,
      "Late disposed-session finally reattached/invalidated its old owner")
    verify(replacement.present() && replacement.invalidations == 0,
      "Old cleanup altered replacement source state")
  }
  verify(replacement.stage(true), "Replacement could not independently enter capture")
  verify(!replacement.recordBackdrop(true), "Replacement appeared in its own capture")
  replacement.finish(true)
  verify(replacement.present() && replacement.invalidations == 1,
    "Replacement could not independently restore normal replay")

  // Adding a 13dp blur guard to the real View must not move/rescale the glyph
  // relative to189/190's unguarded source transform. Test physical odd sizes,
  // changing scale, nonzero window origins and asymmetric source geometry.
  for (density in listOf(1f, 2.625f, 3.75f, 4f)) {
    val guard = ceil(13f * density)
    for ((width, height) in listOf(165f to 165f, 69f to 91f)) {
      for ((sx, sy) in listOf(.1f to .1f, .55f to .8f, 1f to 1f, 1.12f to 1.08f)) {
        for ((rootX, rootY) in listOf(0f to 0f, 32f to 96f, -17f to 128f)) {
          val centerX = 973.25f
          val centerY = 217.75f
          val ownerWidth = width + 2f * guard
          val ownerHeight = height + 2f * guard
          val pivotX = ownerWidth / 2f
          val pivotY = ownerHeight / 2f
          val translationX = centerX - rootX - ownerWidth / 2f
          val translationY = centerY - rootY - ownerHeight / 2f
          val guardedLeft = translationX + pivotX + (guard - pivotX) * sx
          val guardedTop = translationY + pivotY + (guard - pivotY) * sy
          val unguardedLeft = centerX - rootX - width * sx / 2f
          val unguardedTop = centerY - rootY - height * sy / 2f
          verify(abs(guardedLeft - unguardedLeft) < .001f && abs(guardedTop - unguardedTop) < .001f,
            "Small-View blur padding changed physical source position")
          verify(abs((guardedLeft + width * sx) - (centerX - rootX + width * sx / 2f)) < .001f &&
            abs((guardedTop + height * sy) - (centerY - rootY + height * sy / 2f)) < .001f,
            "Small-View blur padding changed source size/end position")
        }
      }
    }
  }

  println("Source capture harness passed: $checks checks; production stage/finally gates, nested/throw/dispose/replacement and unrelated roots, cached-owner blank-replay negative control, bounded restore without idle tick and physical blur-padding alignment (actual HWUI remains device-only).")
}
