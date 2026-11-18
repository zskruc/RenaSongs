package expo.modules.liquidglass

import android.os.Build
import android.os.Handler
import android.view.SurfaceControl
import android.view.View
import android.window.SurfaceSyncGroup
import androidx.annotation.RequiresApi
import expo.modules.liquidglass.menumotion.MenuAtomicHandoffResult
import expo.modules.liquidglass.menumotion.runMenuAtomicHandoff
import java.lang.ref.WeakReference
import java.util.concurrent.Executor

/** Public API34 buffer synchronization; not a presentation-fence guarantee.
 * The compositor listener retains only a weak coordinator, never menu Views,
 * source pixels or an Activity. SurfaceSyncGroup has no public cancel API.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
internal class MenuAtomicSourceHandoff(
  handler: Handler,
  onCommitted: () -> Unit
) {
  private val executor = Executor { runnable -> handler.post(runnable); Unit }
  private var completion: (() -> Unit)? = onCommitted
  private var committed = false

  fun begin(sourceRoot: View, targetRoot: View, stage: () -> Boolean): MenuAtomicHandoffResult {
    val group = try { SurfaceSyncGroup("RenaSongsMenuSource") }
      catch (_: RuntimeException) { return rejected("group-exception") }
      catch (_: LinkageError) { return rejected("group-unavailable") }
    val weak = WeakReference(this)
    var transaction: SurfaceControl.Transaction? = null
    return try {
      runMenuAtomicHandoff(
        // Null callbacks deliberately make no mutations: add(false) is not a
        // transactional rollback of an add runnable on all Android versions.
        addSource = { group.add(sourceRoot.rootSurfaceControl, null) },
        addTarget = { group.add(targetRoot.rootSurfaceControl, null) },
        installCommit = {
          val commit = SurfaceControl.Transaction()
          transaction = commit
          commit.addTransactionCommittedListener(executor) { weak.get()?.onCommitted() }
          group.addTransaction(commit)
        },
        stage = stage,
        markReady = {
          // A half-joined group still needs a traversal/empty transaction.
          // VRI's added-to-sync listener also schedules one, but explicitly
          // dirty the two participating roots before releasing this group.
          try { sourceRoot.invalidate(); targetRoot.invalidate() }
          finally { group.markSyncReady() }
        }
      )
    } finally {
      // addTransaction merges into the group's own native transaction. Closing
      // this empty donor does not close the group's pending buffer transaction.
      try { transaction?.close() } catch (_: RuntimeException) { }
    }
  }

  private fun onCommitted() {
    if (committed) return
    committed = true
    val callback = completion
    completion = null
    callback?.invoke()
  }

  fun cancel() { completion = null }

  companion object {
    fun eligible(sourceRoot: View, targetRoot: View): Boolean =
      sourceRoot !== targetRoot && sourceRoot.isAttachedToWindow && targetRoot.isAttachedToWindow &&
        sourceRoot.isHardwareAccelerated && targetRoot.isHardwareAccelerated &&
        sourceRoot.isShown && targetRoot.isShown &&
        sourceRoot.windowVisibility == View.VISIBLE && targetRoot.windowVisibility == View.VISIBLE &&
        sourceRoot.width > 0 && sourceRoot.height > 0 && targetRoot.width > 0 && targetRoot.height > 0 &&
        sourceRoot.rootSurfaceControl != null && targetRoot.rootSurfaceControl != null &&
        sourceRoot.rootSurfaceControl !== targetRoot.rootSurfaceControl

    private fun rejected(reason: String) = MenuAtomicHandoffResult(false, false, false, false, false, reason)
  }
}
