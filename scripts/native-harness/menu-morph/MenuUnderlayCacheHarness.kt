package expo.modules.liquidglass.menumotion

import expo.modules.liquidglass.BoundedRetirementQueue
import expo.modules.liquidglass.MenuUnderlayCachePolicy
import expo.modules.liquidglass.MenuUnderlayKey
import expo.modules.liquidglass.RecordedBackdropBridge
import expo.modules.liquidglass.RecordedBackdropEligibility
import expo.modules.liquidglass.RecordedBackdropGeometry
import java.util.ArrayDeque

/** Production request/fence policies with delayed/reordered completions. The
 * resource fixture models retained consumers; it does not emulate HWUI fences
 * or establish that an Image is actually sampled on a physical device. */
fun main() {
  var checks = 0
  fun verify(value: Boolean, message: String) { checks++; check(value) { message } }
  val accepted = MenuUnderlayCachePolicy.Completion.ACCEPT
  val stale = MenuUnderlayCachePolicy.Completion.STALE
  val failed = MenuUnderlayCachePolicy.Completion.FAILED
  val base = MenuUnderlayKey(pageEpoch = 41L, generation = 17L,
    rootIdentity = 101, sourceIdentity = 102, ownerIdentity = 103, scrimIdentity = 104,
    rootWidth = 1440, rootHeight = 3120, rootX = 9, rootY = 27,
    sourceWidth = 1440, sourceHeight = 3120, sourceX = 11, sourceY = 31,
    geometry = RecordedBackdropGeometry(.375f, 128, 448, 480, 736),
    sceneVersion = 71L, materialVersion = 81L, scrollVersion = 91L)

  // Every independently changing coordinate/owner/content dimension must fence
  // the old texture, even when all other fields (including ROI size) match.
  val changes: List<Pair<String, (MenuUnderlayKey) -> MenuUnderlayKey>> = listOf(
    "page epoch" to { it.copy(pageEpoch = it.pageEpoch + 1) },
    "GPU generation" to { it.copy(generation = it.generation + 1) },
    "root identity" to { it.copy(rootIdentity = it.rootIdentity + 1) },
    "source identity" to { it.copy(sourceIdentity = it.sourceIdentity + 1) },
    "owner identity" to { it.copy(ownerIdentity = it.ownerIdentity + 1) },
    "scrim identity" to { it.copy(scrimIdentity = it.scrimIdentity + 1) },
    "window width" to { it.copy(rootWidth = it.rootWidth + 1) },
    "window height" to { it.copy(rootHeight = it.rootHeight + 1) },
    "window x" to { it.copy(rootX = it.rootX + 1) },
    "window y" to { it.copy(rootY = it.rootY + 1) },
    "source width" to { it.copy(sourceWidth = it.sourceWidth + 1) },
    "source height" to { it.copy(sourceHeight = it.sourceHeight + 1) },
    "source x" to { it.copy(sourceX = it.sourceX + 1) },
    "source y" to { it.copy(sourceY = it.sourceY + 1) },
    "sample scale" to { it.copy(geometry = it.geometry.copy(scale = .5f)) },
    "ROI x" to { it.copy(geometry = it.geometry.copy(screenX = it.geometry.screenX + 64)) },
    "ROI y" to { it.copy(geometry = it.geometry.copy(screenY = it.geometry.screenY + 64)) },
    "ROI width" to { it.copy(geometry = it.geometry.copy(pixelWidth = it.geometry.pixelWidth + 32)) },
    "ROI height" to { it.copy(geometry = it.geometry.copy(pixelHeight = it.geometry.pixelHeight + 32)) },
    "scene version" to { it.copy(sceneVersion = it.sceneVersion + 1) },
    "material version" to { it.copy(materialVersion = it.materialVersion + 1) },
    "scroll version" to { it.copy(scrollVersion = it.scrollVersion + 1) }
  )
  for ((name, change) in changes) for (observedBeforeDelivery in listOf(false, true)) {
    val policy = MenuUnderlayCachePolicy()
    val ticket = policy.begin(base) ?: error("Initial request rejected")
    val current = change(base)
    verify(current != base, "$name negative control did not change its key")
    if (observedBeforeDelivery) policy.observe(current)
    verify(policy.complete(ticket, current, true) == stale, "A delayed texture survived changed $name")
    val replacement = policy.begin(current)
    verify(replacement != null && replacement.serial > ticket.serial, "Changed $name could not request a fresh texture")
    verify(policy.complete(ticket, base, true) == stale, "Old $name completion stole a replacement's pending slot")
    verify(policy.complete(replacement!!, current, true) == accepted, "Current $name request did not publish")
    verify(policy.begin(current.copy()) == null, "Equal cached $name key resubmitted GPU work")
  }

  // Observe many newer intents while A is outstanding. Only the latest C may
  // start after A; there is no queued B or one request per animation frame.
  repeat(120) { iteration ->
    val policy = MenuUnderlayCachePolicy()
    val first = base.copy(sceneVersion = iteration.toLong() * 1000L)
    val pending = policy.begin(first) ?: error("No initial single-flight ticket")
    var latest = first
    repeat(40) { update ->
      latest = first.copy(sceneVersion = first.sceneVersion + update + 1)
      policy.observe(latest)
      verify(policy.begin(latest) == null, "Coalescing allowed simultaneous GPU requests")
    }
    verify(policy.complete(pending, latest, true) == stale, "Coalescing published an obsolete requested scene")
    val newest = policy.begin(latest) ?: error("Latest intent was lost after old delivery")
    verify(newest.key == latest && newest.serial == pending.serial + 1L,
      "Intermediate coalesced intents allocated hidden queued tickets")
    repeat(10) {
      verify(policy.begin(latest.copy()) == null, "Repeated frames submitted duplicate work while awaiting the same image")
      verify(policy.complete(pending, first, true) == stale, "Duplicate old completion cleared a current inflight ticket")
    }
    verify(policy.complete(newest, latest, true) == accepted, "Latest coalesced request failed to publish")
    repeat(20) { verify(policy.begin(latest) == null, "Stable scrim/motion frames rerendered a cached underlay") }
  }

  // A->B->A can reuse A's actual in-flight pixels because all source identity,
  // geometry and content versions have genuinely returned to the same key.
  val aba = MenuUnderlayCachePolicy()
  val abaTicket = aba.begin(base)!!
  aba.observe(base.copy(scrollVersion = base.scrollVersion + 1)); aba.observe(base.copy())
  verify(aba.complete(abaTicket, base.copy(), true) == accepted, "A matching current content key was rejected after coalescing")

  // Disposal must invalidate ticket identity without reusing its serial. A
  // same-shaped reopened menu cannot be cancelled/published by an old result.
  val disposed = MenuUnderlayCachePolicy()
  val disposedTicket = disposed.begin(base)!!
  disposed.clear(); disposed.clear()
  verify(disposed.complete(disposedTicket, base, true) == stale, "Disposed request survived without a pending owner")
  val reopened = disposed.begin(base)!!
  verify(reopened !== disposedTicket && reopened.serial > disposedTicket.serial,
    "Reopen reused an old request identity/serial")
  verify(disposed.complete(disposedTicket, base, true) == stale, "Old completion published into a same-key reopen")
  verify(disposed.begin(base) == null, "Stale completion removed the reopened single-flight owner")
  verify(disposed.complete(reopened, base, true) == accepted, "Old delivery disturbed the actual reopened request")

  val exact = MenuUnderlayCachePolicy()
  val exactTicket = exact.begin(base)!!
  val impostor = MenuUnderlayCachePolicy.Ticket(base, exactTicket.serial)
  verify(exact.complete(impostor, base, true) == stale,
    "Equal key/serial from another ticket acquired exact pending ownership")
  verify(exact.complete(exactTicket, base, true) == accepted,
    "An unowned callback released the actual inflight request")

  val newerIntent = MenuUnderlayCachePolicy()
  val earlierIntent = newerIntent.begin(base)!!
  newerIntent.observe(base.copy(sceneVersion = base.sceneVersion + 1))
  verify(newerIntent.complete(earlierIntent, base, true) == stale,
    "A current argument from an older observer overrode the latest content intent")

  val missingOwner = MenuUnderlayCachePolicy()
  val noOwnerTicket = missingOwner.begin(base)!!
  verify(missingOwner.complete(noOwnerTicket, null, true) == stale, "A detached/absent owner accepted late GPU pixels")
  val recoveredOwner = missingOwner.begin(base)!!
  verify(missingOwner.complete(recoveredOwner, base, true) == accepted, "An absent-owner result poisoned a later valid presentation")

  // Complete-with-failure is finite for that exact key; a genuine source change
  // may try again, and a stale failure may not poison a successful newer scene.
  val failures = MenuUnderlayCachePolicy()
  val bad = failures.begin(base)!!
  verify(failures.complete(bad, base, false) == failed, "Current GPU failure was not classified separately")
  repeat(80) { verify(failures.begin(base) == null, "Failed key caused an every-frame GPU retry loop") }
  val changed = base.copy(sceneVersion = base.sceneVersion + 1)
  val good = failures.begin(changed)!!
  verify(failures.complete(bad, base, false) == stale, "Stale failure stole newer request ownership")
  verify(failures.complete(good, changed, true) == accepted, "A genuine source change could not recover from GPU failure")

  // Setup can fail before the image reader ever posts a callback. Cancelling
  // that exact failed setup must release its single-flight slot immediately.
  val setupFailure = MenuUnderlayCachePolicy()
  val abandonedSetup = setupFailure.begin(base)!!
  setupFailure.fail(base)
  repeat(30) { verify(setupFailure.begin(base) == null, "Failed synchronous setup retried continuously") }
  val recoveredSetup = setupFailure.begin(changed)
  verify(recoveredSetup != null, "Setup failure without a callback permanently occupied the single-flight slot")
  verify(setupFailure.complete(abandonedSetup, base, true) == stale,
    "Late success from an aborted setup revived failed source ownership")
  setupFailure.fail(base)
  verify(setupFailure.complete(recoveredSetup!!, changed, true) == accepted,
    "A stale old-key failure poisoned an already changed content request")

  // The WindowBackdrop abort route first disposes its GPU generation and then
  // marks the retained direct fallback's new-generation key as a finite failure.
  val abortedGeneration = MenuUnderlayCachePolicy()
  val preAbort = abortedGeneration.begin(base)!!
  val fallbackKey = base.copy(generation = base.generation + 1)
  abortedGeneration.clear(); abortedGeneration.fail(fallbackKey)
  verify(abortedGeneration.complete(preAbort, base, true) == stale,
    "An aborted GPU generation published after direct fallback recovery")
  repeat(30) { verify(abortedGeneration.begin(fallbackKey) == null, "Recovered fallback restarted the same failed raster every frame") }
  val afterAbortKey = fallbackKey.copy(sceneVersion = fallbackKey.sceneVersion + 1)
  val afterAbort = abortedGeneration.begin(afterAbortKey)!!
  verify(abortedGeneration.complete(afterAbort, afterAbortKey, true) == accepted,
    "A real post-abort content change could not replace the direct fallback")

  // The opportunistic menu request serial is deliberately independent of the
  // ordinary direct-record/image fence. Simulate direct scrim updates advancing
  // while the worker prepares one legal menu texture.
  val bridge = RecordedBackdropBridge<String>()
  val menu = MenuUnderlayCachePolicy()
  val menuTicket = menu.begin(base)!!
  val ordinaryImageSerial = bridge.beginRecord()
  var newestDirect = 0L
  repeat(80) { index ->
    newestDirect = bridge.beginRecord()
    verify(bridge.publish("direct-$index", base.geometry, base.pageEpoch, base.generation,
      newestDirect, base.pageEpoch, base.generation, true,
      RecordedBackdropEligibility.MODAL_DIRECT_SAFETY or RecordedBackdropEligibility.RECORDED, direct = true),
      "Normal direct scrim program failed to publish")
    verify(!bridge.acceptsImage(ordinaryImageSerial), "Ordinary image crossed the existing directSerial fence")
    verify(!bridge.acceptsImage(newestDirect), "Equal-serial image replaced its direct program")
    verify(bridge.acceptsImage(newestDirect + 1L), "Direct fence incorrectly rejected a genuinely later ordinary request")
  }
  verify(menu.complete(menuTicket, base, true) == accepted,
    "Newer direct scrim serials starved a valid same-content asynchronous menu texture")
  verify(bridge.current(base.pageEpoch, base.generation, true)?.content == "direct-79",
    "Completing an independent menu texture altered the ordinary direct bridge")
  verify(!bridge.acceptsImage(ordinaryImageSerial), "Menu publication loosened the ordinary direct image fence")
  val failedMenu = MenuUnderlayCachePolicy()
  val fallbackTicket = failedMenu.begin(base)!!
  verify(failedMenu.complete(fallbackTicket, base, false) == failed, "Menu failure fixture was not a real failure")
  verify(bridge.current(base.pageEpoch, base.generation, true)?.serial == newestDirect,
    "Opportunistic texture failure cleared a usable direct fallback")

  // Resource boundary fixture: production policy decides which result may be
  // published, while a bounded queue releases only non-displayed resources.
  // Two retained display cohorts deliberately outlive the latest publication.
  class Image(val name: String) {
    var closes = 0
    fun close() { closes++ }
  }
  class Consumers {
    val displayed = ArrayDeque<Image>()
    val retired = BoundedRetirementQueue<Image>(8)
    fun publish(image: Image) {
      displayed.addLast(image)
      while (displayed.size > 2) check(retired.offer(displayed.removeFirst()))
    }
    fun reject(image: Image) { check(retired.offer(image)) }
    fun dispose() { while (displayed.isNotEmpty()) check(retired.offer(displayed.removeFirst())) }
    fun drain() { while (true) (retired.poll() ?: break).close() }
  }
  val resources = Consumers()
  val resourcePolicy = MenuUnderlayCachePolicy()
  val images = ArrayList<Image>()
  repeat(60) { index ->
    val key = base.copy(sceneVersion = index.toLong())
    val ticket = resourcePolicy.begin(key)!!
    val image = Image("accepted-$index").also { images.add(it) }
    verify(resourcePolicy.complete(ticket, key, true) == accepted, "Resource fixture failed to publish the current result")
    resources.publish(image)
    val late = Image("stale-$index")
    verify(resourcePolicy.complete(ticket, key, true) == stale, "Repeated completion reacquired resource ownership")
    resources.reject(late); resources.drain()
    verify(late.closes == 1, "Rejected worker result leaked or closed twice")
    images.forEachIndexed { imageIndex, retained ->
      verify(retained.closes == if (imageIndex < index - 1) 1 else 0,
        "Displayed/preceding cohort closed early or a retired image leaked")
    }
  }
  // Closing is not disposal: the valid last textures remain live until the
  // menu window's actual completion detaches its consumers.
  val closingImages = resources.displayed.toList()
  repeat(30) { resources.drain(); verify(closingImages.all { it.closes == 0 }, "Closing animation lost its sampled GPU image") }
  resourcePolicy.clear(); resources.dispose(); resources.drain()
  verify(images.all { it.closes == 1 }, "Completed window disposal leaked/double-closed an accepted image")
  val replacementKey = base.copy(ownerIdentity = base.ownerIdentity + 1)
  val replacementTicket = resourcePolicy.begin(replacementKey)!!
  val replacementImage = Image("replacement")
  verify(resourcePolicy.complete(replacementTicket, replacementKey, true) == accepted, "Replacement presentation failed to acquire its own image")
  resources.publish(replacementImage)
  val veryLate = Image("disposed-generation")
  verify(resourcePolicy.complete(disposedTicket, base, true) == stale, "Cross-policy old completion claimed the replacement slot")
  resources.reject(veryLate); resources.drain()
  verify(replacementImage.closes == 0 && veryLate.closes == 1,
    "Stale delivery cleanup closed the replacement's current image")
  resources.dispose(); resources.drain()
  verify(replacementImage.closes == 1, "Replacement image was not released by its own disposal")

  // Queue capacity is not an implicit release. Duplicate identity consumes no
  // extra slot, and overflow transfers no ownership to the queue.
  val bounded = BoundedRetirementQueue<Image>(1)
  val owned = Image("owned")
  val overflow = Image("overflow")
  verify(bounded.offer(owned) && bounded.offer(owned) && bounded.size == 1,
    "Duplicate retirement changed bounded ownership")
  verify(!bounded.offer(overflow) && overflow.closes == 0,
    "Overflow unexpectedly transferred/released caller-owned image")
  verify(bounded.poll() === owned && bounded.poll() == null, "Retirement queue duplicated its retained image")

  println("Menu underlay cache harness passed ($checks assertions: complete identity/ROI/content keys, current serial, latest-only single flight, unchanged ordinary direct fence, finite failure fallback and retained consumer retirement model).")
}
