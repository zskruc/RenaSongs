#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT="$ROOT/.local-cache/metadata-script-171/jvm"
CACHE="$ROOT/node_modules/.cache/native-harness/m2"
mkdir -p "$OUT"
RHINO=$(find "$HOME/.gradle/caches/modules-2/files-2.1/org.mozilla/rhino/1.8.0" -name '*.jar' -print -quit)
JUNIT=$(find "$HOME/.gradle/caches/modules-2/files-2.1/junit/junit/4.13.2" -name '*.jar' -print -quit)
HAMCREST=$(find "$HOME/.gradle/caches/modules-2/files-2.1/org.hamcrest/hamcrest-core" -name '*.jar' -print -quit)
JSON="$ROOT/.local-cache/metadata-script-171/json-20240303.jar"
if [ ! -f "$JSON" ]; then curl -fsSL --max-time 20 https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar -o "$JSON"; fi
LIB="$RHINO:$JUNIT:$HAMCREST:$JSON:$(find "$CACHE" -maxdepth 1 -name '*.jar' -print | paste -sd: -)"
java -cp "$LIB" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -cp "$LIB" -d "$OUT" \
 "$ROOT/modules/metadata-script/android/src/main/java/expo/modules/metadatascript/ScriptEngine.kt" \
 "$ROOT/modules/metadata-script/android/src/main/java/expo/modules/metadatascript/ScraperDataCodec.kt" \
 "$ROOT/modules/metadata-script/android/src/main/java/expo/modules/metadatascript/ParserResources.kt" \
 "$ROOT/modules/metadata-script/android/src/test/java/expo/modules/metadatascript/ParserResourcesTest.kt" \
 "$ROOT/modules/metadata-script/android/src/test/java/expo/modules/metadatascript/ScriptEngineTest.kt" \
 "$ROOT/modules/offline-translation/android/src/main/java/expo/modules/offlinetranslation/TranslationWorkGate.kt" \
 "$ROOT/modules/offline-translation/android/src/test/java/expo/modules/offlinetranslation/TranslationWorkGateTest.kt"
java -Xmx128m -cp "$OUT:$LIB" org.junit.runner.JUnitCore expo.modules.metadatascript.ScriptEngineTest expo.modules.metadatascript.ParserResourcesTest expo.modules.offlinetranslation.TranslationWorkGateTest
# The platform loader has desktop modules on a Mac. Deny them explicitly in a
# separate loader, then repeat with Rhino's entire optional optimizer absent.
javac -d "$OUT" "$ROOT/modules/metadata-script/tests/RestrictedAndroidClassLoader.java"
java -Xmx128m -cp "$OUT" RestrictedAndroidClassLoader "$OUT:$LIB"
