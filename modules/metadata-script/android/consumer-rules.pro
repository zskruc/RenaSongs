# Rhino initializes JavaScript built-ins through reflection. Keep its engine and
# member names in release builds as well as the unminified JVM harness.
-keep class org.mozilla.javascript.** { *; }
-keepattributes InnerClasses,EnclosingMethod,Signature
