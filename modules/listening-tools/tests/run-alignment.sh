#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT="$ROOT/.local-cache/listening-tools-171/alignment"
CACHE="$ROOT/node_modules/.cache/native-harness/m2"
SDK=${ANDROID_HOME:-/Users/apple/LocalWork/Codex/2026-06-08/ios-users-apple-documents-lama-1/work/android-sdk}
mkdir -p "$OUT/shim" "$OUT/classes" "$OUT/fixtures"
AAR=$(find "$HOME/.gradle/caches/modules-2/files-2.1/androidx.media3/media3-common/1.9.0" -name '*.aar' -print -quit)
unzip -p "$AAR" classes.jar > "$OUT/common.jar"
ANNOTATION=$(find "$HOME/.gradle/caches/modules-2/files-2.1/androidx.annotation/annotation-experimental" -name '*.aar' -print | sort -V | tail -1)
unzip -p "$ANNOTATION" classes.jar > "$OUT/annotations.jar"
ANDROID_JAR=$(find "$SDK/platforms" -maxdepth 2 -name android.jar -print | sort -V | tail -1)
javac -d "$OUT/shim" "$ROOT/scripts/native-harness/audio-power/Build.java"
LIB="$OUT/shim:$OUT/common.jar:$OUT/annotations.jar:$ANDROID_JAR:$(find "$CACHE" -maxdepth 1 -name '*.jar' -print | paste -sd: -)"
java -cp "$LIB" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -cp "$LIB" -d "$OUT/classes" \
 "$ROOT/modules/listening-tools/android/src/main/java/expo/modules/listeningtools/WindowedPcmSink.kt" \
 "$ROOT/modules/listening-tools/android/src/main/java/expo/modules/listeningtools/AlignmentWavSink.kt" \
 "$ROOT/modules/listening-tools/tests/AlignmentWavHarness.kt"
java -Xmx128m -cp "$OUT/classes:$LIB" expo.modules.listeningtools.AlignmentWavHarnessKt "$OUT/fixtures"
