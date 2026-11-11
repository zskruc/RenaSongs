#!/usr/bin/env bash
# Compile the current production resolveSessionPlayer method, with a test-only
# command-set/player boundary. The complete Expo module checks real Media3 APIs.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
CACHE="$ROOT/node_modules/.cache/native-harness/m2"
OUT="$ROOT/.local-cache/upstream-13-171/session-commands"
mkdir -p "$OUT"
[ -f "$CACHE/kotlin-compiler-embeddable-2.1.20.jar" ] || { echo 'Prepare the compiler with scripts/native-harness/audio-power/run.sh first.' >&2; exit 2; }
python3 - "$ROOT" "$OUT" <<'PY'
import pathlib,sys
root,out=map(pathlib.Path,sys.argv[1:])
source=(root/'node_modules/expo-audio/android/src/main/java/expo/modules/audio/service/AudioControlsService.kt').read_text()
start=source.index('  private fun resolveSessionPlayer('); opening=source.index('{',start);depth=1;end=opening+1
while depth:
 depth += (source[end]=='{')-(source[end]=='}');end+=1
method=source[start:end].replace('private fun resolveSessionPlayer','fun resolveSessionPlayer',1)
(rootpath:=out/'ActualSession.kt').write_text((root/'scripts/native-harness/session-commands/Boundary.kt').read_text()+'\nclass ActualService {\n'+method+'\n}\n'+(root/'scripts/native-harness/session-commands/Assertions.kt').read_text())
PY
LIBS=$(find "$CACHE" -maxdepth 1 -name '*.jar' -print | paste -sd: -)
JAVACMD="${JAVA_HOME:+$JAVA_HOME/bin/}java"
"$JAVACMD" -cp "$LIBS" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -cp "$LIBS" -d "$OUT/classes" "$OUT/ActualSession.kt"
"$JAVACMD" -cp "$OUT/classes:$LIBS" ActualSessionKt
