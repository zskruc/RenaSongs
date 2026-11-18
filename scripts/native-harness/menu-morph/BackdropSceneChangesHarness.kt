package expo.modules.liquidglass.menumotion

import android.graphics.drawable.AnimatedDrawable
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import expo.modules.liquidglass.BackdropSceneChanges
import expo.modules.liquidglass.LiquidGlassView

/** Runs the PRODUCTION tree visitor against controlled Android metadata. These
 * fixtures model metadata and dirty flags only; real draw callbacks, image
 * loading and GPU pixels remain covered by source wiring/device validation. */
fun main() {
  var checks = 0
  fun verify(value: Boolean, message: String) { checks++; check(value) { message } }

  class Scene {
    val root = ViewGroup()
    val content = ViewGroup()
    val title = TextView().apply { text = "A long song title"; typeface = Any() }
    val cover = ImageView().apply { drawable = Drawable() }
    val progress = ProgressBar().apply { progressDrawable = Drawable() }
    val canvas = View()
    val glassWrapper = ViewGroup().apply { isFixtureGlassContainer = true }
    val glass = LiquidGlassView()
    val nestedTitle = TextView().apply { text = "Mini Player artist" }
    init {
      root.addView(content)
      for (view in listOf(title, cover, progress, canvas, glassWrapper)) content.addView(view)
      glassWrapper.addView(glass); glassWrapper.addView(nestedTitle)
      root.background = ColorDrawable(0xff151515.toInt())
    }
    fun dirty(value: Boolean) {
      for (view in listOf(root, content, title, cover, progress, canvas, glassWrapper, glass, nestedTitle))
        view.isDirty = value
    }
  }

  // This is the incident's negative control: recording a View does not promise
  // to consume every descendant dirty bit before the next metadata observation.
  val persistent = Scene()
  persistent.dirty(true)
  val ordinary = BackdropSceneChanges()
  val menu = BackdropSceneChanges(includeGlassContent = true, observeLeafDirty = false)
  verify(ordinary.hasChanged(persistent.root), "Ordinary mode missed its initial scene")
  verify(menu.hasChanged(persistent.root), "Menu metadata mode missed its initial scene")
  repeat(500) { frame ->
    verify(ordinary.hasChanged(persistent.root), "Default raw-dirty behavior changed at frame $frame")
    verify(!menu.hasChanged(persistent.root), "Unchanged persistent dirty leaf invalidated menu GPU cache at frame $frame")
  }
  verify(ordinary.signatureChangeCount == 1L && menu.signatureChangeCount == 1L,
    "Unchanged dirty flags were incorrectly reported as metadata signature changes")
  verify(ordinary.leafOnlyObservationCount == 500L && menu.leafOnlyObservationCount == 500L,
    "Disabling dirty scheduling must retain honest raw-leaf diagnostic observations")
  persistent.dirty(false)
  verify(!ordinary.hasChanged(persistent.root) && !menu.hasChanged(persistent.root),
    "A clean unchanged scene should remain stable in both modes")
  verify(ordinary.leafOnlyObservationCount == 500L && menu.leafOnlyObservationCount == 500L,
    "Clean observations inflated raw-leaf diagnostics")

  // Each mutation is applied to an otherwise clean tree so the ordinary mode
  // cannot accidentally pass on raw dirty rather than detecting real metadata.
  val mutations: List<Pair<String, (Scene) -> Unit>> = listOf(
    "song title" to { it.title.text = "A different song title" },
    "in-place mutable text" to { val text = StringBuilder("Original"); it.title.text = text; text.append(" changed") },
    "text foreground" to { it.title.currentTextColor = 0xffa1c4e5.toInt() },
    "text size" to { it.title.textSize = 18.5f },
    "text typeface identity" to { it.title.typeface = Any() },
    "cover identity" to { it.cover.drawable = Drawable() },
    "cover alpha" to { it.cover.drawable!!.alpha = 170 },
    "cover level" to { it.cover.drawable!!.level = 23 },
    "cover drawable state" to { it.cover.drawable!!.state = intArrayOf(17, 29) },
    "cover view alpha" to { it.cover.imageAlpha = 201 },
    "cover image matrix" to { it.cover.imageMatrix.setValue(2, 31.25f) },
    "view translation matrix" to { it.content.matrix.setValue(5, -48.5f) },
    "view scale matrix" to { it.title.matrix.setValue(0, 1.125f) },
    "view left" to { it.content.left = 3 },
    "view top" to { it.content.top = 7 },
    "view right" to { it.content.right = 171 },
    "view bottom" to { it.content.bottom = 219 },
    "horizontal scroll" to { it.content.scrollX = 11 },
    "vertical scroll" to { it.content.scrollY = 37 },
    "view alpha" to { it.content.alpha = .625f },
    "view elevation" to { it.content.elevation = 4.5f },
    "view Z translation" to { it.content.translationZ = 2.5f },
    "view visibility" to { it.content.visibility = View.INVISIBLE },
    "background color" to { (it.root.background as ColorDrawable).color = 0xffeeeeee.toInt() },
    "background identity" to { it.root.background = ColorDrawable(0xff151515.toInt()) },
    "background alpha" to { it.root.background!!.alpha = 192 },
    "background drawable level" to { it.root.background!!.level = 6 },
    "React background color" to { it.content.background = Drawable(); it.content.reactBackgroundColor = 0xff332211.toInt() },
    "playback progress" to { it.progress.progress = 37 },
    "buffered progress" to { it.progress.secondaryProgress = 61 },
    "progress drawable identity" to { it.progress.progressDrawable = Drawable() },
    "progress drawable level" to { it.progress.progressDrawable!!.level = 24 },
    "indeterminate progress" to { it.progress.isIndeterminate = true; it.progress.indeterminateDrawable = Drawable() },
    "visible child insertion" to { it.content.addView(TextView().apply { text = "New artist" }) },
    "visible child removal" to { it.content.removeView(it.title) }
  )
  for ((name, mutate) in mutations) {
    val scene = Scene()
    val modes = listOf(BackdropSceneChanges(), BackdropSceneChanges(includeGlassContent = true, observeLeafDirty = false))
    modes.forEach { verify(it.hasChanged(scene.root), "$name fixture failed to initialize") }
    modes.forEach { verify(!it.hasChanged(scene.root), "$name unchanged baseline was not stable") }
    mutate(scene)
    modes.forEach { observer ->
      verify(observer.hasChanged(scene.root), "Real $name change was missed without a raw dirty bit")
      verify(observer.signatureChangeCount == 2L, "$name did not advance the actual metadata signature")
      verify(!observer.hasChanged(scene.root), "Unchanged $name kept scheduling repeated captures")
      verify(observer.leafOnlyObservationCount == 0L, "$name clean fixture was misdiagnosed as raw dirty")
    }
  }

  // Metadata still wins when the raw dirty bit never clears: only that one real
  // source change refreshes the menu, then subsequent observations are stable.
  for ((name, mutate) in mutations) {
    val scene = Scene().apply { dirty(true) }
    val observer = BackdropSceneChanges(includeGlassContent = true, observeLeafDirty = false)
    verify(observer.hasChanged(scene.root), "Dirty $name scene was not initialized")
    verify(!observer.hasChanged(scene.root), "Dirty $name scene did not become stable")
    mutate(scene)
    verify(observer.hasChanged(scene.root), "Disabling raw dirty suppressed actual $name metadata")
    repeat(3) { verify(!observer.hasChanged(scene.root), "Persistent dirty after $name repeatedly invalidated cache") }
  }

  // The text can mutate without replacing its CharSequence. Production hashes
  // characters, rather than retaining the previous mutable text object.
  val mutableScene = Scene()
  val text = StringBuilder("Mutable title")
  mutableScene.title.text = text
  val mutableObserver = BackdropSceneChanges(observeLeafDirty = false)
  mutableObserver.hasChanged(mutableScene.root)
  text.append(" extended")
  verify(mutableObserver.hasChanged(mutableScene.root), "An in-place CharSequence update escaped the metadata fingerprint")
  verify(!mutableObserver.hasChanged(mutableScene.root), "Stable mutable text generated continuous refreshes")

  // Include actual controls alongside the glass surface, never the glass's own
  // animated drawing subtree. A paused title/cover is still source content.
  val nested = Scene()
  val defaultNested = BackdropSceneChanges()
  val menuNested = BackdropSceneChanges(includeGlassContent = true, observeLeafDirty = false)
  defaultNested.hasChanged(nested.root); menuNested.hasChanged(nested.root)
  nested.nestedTitle.text = "New Mini Player song"
  verify(!defaultNested.hasChanged(nested.root), "Default mode stopped omitting its known glass container")
  verify(menuNested.hasChanged(nested.root), "Menu cache failed to observe real title content beside glass")
  nested.glass.addView(TextView().apply { this.text = "Transient Compose shape"; isDirty = true })
  nested.glass.matrix.setValue(0, .75f)
  nested.glass.isDirty = true
  verify(!menuNested.hasChanged(nested.root), "Glass material's own animation entered the underlay metadata key")
  nested.nestedTitle.currentTextColor = 0xffdd8800.toInt()
  verify(menuNested.hasChanged(nested.root), "Theme/foreground change beside excluded glass was frozen")

  // Animated drawable metadata and real progress remain observable even though
  // the menu no longer treats an unchanged raw dirty flag as new content.
  val animated = Scene()
  val coverAnimation = AnimatedDrawable()
  val spinner = AnimatedDrawable()
  animated.cover.drawable = coverAnimation
  animated.progress.isIndeterminate = true
  animated.progress.indeterminateDrawable = spinner
  val animationObserver = BackdropSceneChanges(includeGlassContent = true, observeLeafDirty = false)
  animationObserver.hasChanged(animated.root)
  coverAnimation.isRunning = true
  verify(animationObserver.hasChanged(animated.root), "Actual cover animation state was not observed")
  verify(!animationObserver.hasChanged(animated.root), "Unchanged running-state metadata was treated as a pixel clock")
  coverAnimation.level = 66
  verify(animationObserver.hasChanged(animated.root), "A new cover animation level was not observed")
  spinner.isRunning = true
  verify(animationObserver.hasChanged(animated.root), "Indeterminate progress animation state was not observed")
  spinner.level = 14
  verify(animationObserver.hasChanged(animated.root), "Indeterminate progress drawable level was not observed")
  animated.progress.progress = 78
  verify(animationObserver.hasChanged(animated.root), "Progress update during animation was lost")

  println("Backdrop scene changes harness passed ($checks assertions: production visitor, persistent-dirty negative control, default compatibility, complete metadata mutations, glass-content exclusion and honest diagnostics; actual OnDraw/GPU remains device-only).")
}
