package expo.modules.liquidglass

import android.view.View
import android.view.ViewGroup

class LiquidGlassView : ViewGroup()

/** Only the eligibility boundary is supplied; traversal/fingerprinting is the
 * actual production BackdropSceneChanges implementation compiled by run.sh. */
object WindowBackdrops {
  fun isGlassContainer(view: View, root: View): Boolean = view !== root && view.isFixtureGlassContainer
}
