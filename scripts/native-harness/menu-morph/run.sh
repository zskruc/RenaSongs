#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
HERE="$ROOT/scripts/native-harness/menu-morph"
SOURCE="$ROOT/modules/liquid-glass/android/src/main/java/expo/modules/liquidglass/menumotion"
CACHE="$ROOT/node_modules/.cache/native-harness/m2"
OUT="$ROOT/.local-cache/menu-morph/jvm"
JAVA="${JAVA_HOME:+$JAVA_HOME/bin/}java"
LIBS=$(find "$CACHE" -maxdepth 1 -name '*.jar' -print | paste -sd: -)
mkdir -p "$OUT"
"$JAVA" -cp "$LIBS" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -cp "$LIBS" -d "$OUT" \
  "$SOURCE"/*.kt "$SOURCE/../MenuMaterialGeometry.kt" "$HERE/AndroidGraphics.kt" "$HERE/MenuMorphHarness.kt"
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.MenuMorphHarnessKt
node "$HERE/stationary-source.mjs"
