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
# GPU helpers are compiled by Android Gradle, not the lightweight JVM stubs.
MOTION_SOURCES=()
for motion_source in "$SOURCE"/*.kt; do
  case "$motion_source" in
    */GlassForegroundPortal.kt|*/GlassFieldTexture.kt) ;;
    *) MOTION_SOURCES+=("$motion_source") ;;
  esac
done
"$JAVA" -cp "$LIBS" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -cp "$LIBS" -d "$OUT" \
  "${MOTION_SOURCES[@]}" "$SOURCE/../MenuMaterialGeometry.kt" "$SOURCE/../MenuMaterialRaster.kt" "$HERE/AndroidGraphics.kt" "$HERE/MenuMorphHarness.kt" "$HERE/PortalRasterHarness.kt" "$HERE/MaterialRasterHarness.kt" "$HERE/MaterialRasterEpochHarness.kt" "$HERE/JellyInteractionHarness.kt" "$HERE/SourceOwnershipHarness.kt" "$HERE/SourcePixelsHarness.kt" "$HERE/SourceCaptureHarness.kt"
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.MenuMorphHarnessKt
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.PortalRasterHarnessKt
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.MaterialRasterHarnessKt
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.MaterialRasterEpochHarnessKt
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.JellyInteractionHarnessKt
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.SourceOwnershipHarnessKt
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.SourcePixelsHarnessKt
"$JAVA" -cp "$OUT:$LIBS" expo.modules.liquidglass.menumotion.SourceCaptureHarnessKt
node "$HERE/stationary-source.mjs"
node "$HERE/interaction-source.mjs"
node "$HERE/source-overlay-source.mjs"
node "$HERE/source-pixels-source.mjs"
node "$HERE/source-capture-source.mjs"
