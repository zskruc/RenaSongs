package expo.modules.offlinetranslation
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

class TranslationWorkGateTest {
  @Test fun capacityAndDuplicateCreationAreAtomic() {
    val gate=TranslationWorkGate<Any>();val admitted=AtomicInteger();val start=CountDownLatch(1)
    val threads=(0..11).map { i->Thread {start.await();runCatching {gate.begin("$i"){Any()}}.onSuccess{admitted.incrementAndGet()} }.apply{start()} }
    start.countDown();threads.forEach{it.join()};assertEquals(2,admitted.get())
  }
  @Test fun closedGateCannotCreateClientsAfterDestruction() {
    val gate=TranslationWorkGate<Any>();val first=gate.begin("one"){Any()};assertEquals(first,gate.close().single().second)
    assertThrows(IllegalArgumentException::class.java){gate.begin("two"){error("must not allocate")}}
    gate.remove("one",first);assertTrue(gate.close().isEmpty())
  }
  @Test fun oldAccountCallbackCannotRemoveAReusedTaskId() {
    val gate=TranslationWorkGate<Any>();val a=gate.begin("same"){Any()};gate.remove("same",a)
    val b=gate.begin("same"){Any()};gate.remove("same",a);assertSame(b,gate.entry("same"))
  }
  @Test fun canceledModelDownloadRemainsProtectedUntilGoogleTaskActuallyCompletes() {
    val gate=TranslationWorkGate<Any>();val a=gate.begin("download"){Any()}
    gate.startDownload("download",a){};gate.remove("download",a)
    assertThrows(IllegalArgumentException::class.java){gate.startDeletion{error("must not delete")}}
    gate.downloadFinished(a);var deleted=false;gate.startDeletion{deleted=true};assertTrue(deleted)
    assertThrows(IllegalArgumentException::class.java){gate.begin("race"){Any()}}
    gate.deletionFinished();assertNotNull(gate.begin("new"){Any()})
  }
  @Test fun synchronousStartFailuresReleaseModelLocks() {
    val gate=TranslationWorkGate<Any>();val a=gate.begin("download"){Any()}
    assertThrows(IllegalStateException::class.java){gate.startDownload("download",a){error("SDK closed")}}
    gate.remove("download",a)
    assertThrows(IllegalStateException::class.java){gate.startDeletion{error("SDK closed")}}
    gate.startDeletion{};gate.deletionFinished()
  }
}
