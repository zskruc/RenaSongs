package expo.modules.metadatascript
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.CountDownLatch

class ParserResourcesTest {
  @Test fun secondDescriptorOpenFailureClosesActualFirstDescriptor() {
    val file=File.createTempFile("parser-fd-", ".tmp")
    val input=FileInputStream(file)
    try {
      assertThrows(IOException::class.java) {withParserDescriptors({input},{throw IOException("cannot open output")}) {_,_->error("must not send")}}
      assertFalse(input.fd.valid())
    } finally {input.close();file.delete()}
  }
  @Test fun binderSendFailureClosesBothActualDescriptors() {
    val source=File.createTempFile("parser-in-", ".tmp");val destination=File.createTempFile("parser-out-", ".tmp")
    val input=FileInputStream(source);val output=FileOutputStream(destination)
    try {
      assertThrows(IOException::class.java) {withParserDescriptors({input},{output}) {_,_->throw IOException("binder died")}}
      assertFalse(input.fd.valid());assertFalse(output.fd.valid())
    } finally {input.close();output.close();source.delete();destination.delete()}
  }
  @Test fun ordinarySendAlsoClosesOriginalDescriptorsOnceTransferCompletes() {
    val source=File.createTempFile("parser-in-", ".tmp");val destination=File.createTempFile("parser-out-", ".tmp")
    val input=FileInputStream(source);val output=FileOutputStream(destination)
    try {
      assertEquals("sent",withParserDescriptors({input},{output}) {a,b->assertTrue(a.fd.valid());assertTrue(b.fd.valid());"sent"})
      assertFalse(input.fd.valid());assertFalse(output.fd.valid())
    } finally {input.close();output.close();source.delete();destination.delete()}
  }
  @Test fun destructionBeforeStartNeverEnqueuesAndDuringPreparationDefersShutdownUntilCleanup() {
    val closed=ParserHostLifecycle();assertTrue(closed.destroy());assertFalse(closed.submit{error("must not enqueue")})
    val active=ParserHostLifecycle();var queued=false;assertTrue(active.submit{queued=true});assertTrue(queued)
    assertFalse(active.destroy());assertFalse(active.submit{error("must not enqueue")});assertTrue(active.complete())
  }
  @Test fun failedEnqueueReleasesAdmissionAndTwoConcurrentRunsCannotOverlap() {
    val lifecycle=ParserHostLifecycle();assertThrows(IOException::class.java){lifecycle.submit{throw IOException("rejected executor")}}
    val barrier=CountDownLatch(1);val accepted=java.util.concurrent.atomic.AtomicInteger()
    val threads=(1..8).map{Thread{barrier.await();if(lifecycle.submit{})accepted.incrementAndGet()}.apply{start()}}
    barrier.countDown();threads.forEach{it.join()};assertEquals(1,accepted.get());assertFalse(lifecycle.complete())
    assertTrue(lifecycle.submit{});assertFalse(lifecycle.destroy());assertTrue(lifecycle.complete())
  }
}
