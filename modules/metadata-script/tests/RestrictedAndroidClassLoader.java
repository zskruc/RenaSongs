import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

/** Runs the actual compiled engine and its JUnit tests without desktop-only
 * APIs. This is not a substitute for a shrunk Android APK runtime check. */
public final class RestrictedAndroidClassLoader {
  private static final class Restricted extends URLClassLoader {
    final boolean noOptimizer;
    final Map<String, Integer> blocked = new LinkedHashMap<>();
    Restricted(URL[] urls, boolean noOptimizer) {
      super(urls, ClassLoader.getPlatformClassLoader());
      this.noOptimizer = noOptimizer;
    }
    @Override protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
      if (name.startsWith("java.beans.") || name.startsWith("jdk.dynalink.")
          || noOptimizer && name.startsWith("org.mozilla.javascript.optimizer.")) {
        blocked.merge(name, 1, Integer::sum);
        throw new ClassNotFoundException("Unavailable on the Android interpreter: " + name);
      }
      return super.loadClass(name, resolve);
    }
  }
  public static void main(String[] args) throws Exception {
    ArrayList<URL> urls = new ArrayList<>();
    for (String path : args[0].split(File.pathSeparator)) urls.add(new File(path).toURI().toURL());
    String[] tests = {"expo.modules.metadatascript.ScriptEngineTest", "expo.modules.metadatascript.ParserResourcesTest", "expo.modules.offlinetranslation.TranslationWorkGateTest"};
    for (boolean noOptimizer : new boolean[] {false, true}) {
      try (Restricted loader = new Restricted(urls.toArray(new URL[0]), noOptimizer)) {
        for (String unavailable : new String[] {"java.beans.Introspector", "jdk.dynalink.DynamicLinker"}) {
          try { loader.loadClass(unavailable); throw new AssertionError("Blocked API unexpectedly available"); }
          catch (ClassNotFoundException expected) { }
        }
        ClassLoader old = Thread.currentThread().getContextClassLoader();
        Thread.currentThread().setContextClassLoader(loader);
        try {
          Class<?>[] cases = new Class<?>[tests.length];
          for (int i = 0; i < tests.length; i++) cases[i] = loader.loadClass(tests[i]);
          Object result;
          try { result = loader.loadClass("org.junit.runner.JUnitCore").getMethod("runClasses", Class[].class).invoke(null, (Object) cases); }
          catch (InvocationTargetException error) { throw new AssertionError("Isolated test runner failed", error.getCause()); }
          Class<?> type = result.getClass();
          int count = (Integer) type.getMethod("getRunCount").invoke(result);
          int failures = (Integer) type.getMethod("getFailureCount").invoke(result);
          System.out.println("Desktop APIs denied, optimizer denied=" + noOptimizer + ": " + count + " tests, " + failures + " failures");
          System.out.println("Denied class loads: " + loader.blocked);
          if (failures != 0) throw new AssertionError(type.getMethod("getFailures").invoke(result));
        } finally { Thread.currentThread().setContextClassLoader(old); }
      }
    }
  }
}
