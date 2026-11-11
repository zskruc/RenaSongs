#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
HERE="$ROOT/modules/listening-tools/tests"
OUT="$ROOT/.local-cache/listening-tools-171/jvm"
CACHE="$ROOT/node_modules/.cache/native-harness/m2"
mkdir -p "$OUT"
LIB=$(find "$CACHE" -maxdepth 1 -name '*.jar' -print | paste -sd: -)
java -cp "$LIB" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -cp "$LIB" -d "$OUT" \
 "$ROOT/node_modules/expo-audio/android/src/main/java/expo/modules/audio/PlaybackRangePolicy.kt" \
 "$ROOT/modules/listening-tools/android/src/main/java/expo/modules/listeningtools/LoudnessAnalyzer.kt" \
 "$ROOT/modules/listening-tools/android/src/main/java/expo/modules/listeningtools/WindowedPcmSink.kt" \
 "$ROOT/modules/listening-tools/android/src/main/java/expo/modules/listeningtools/LoudnessPcmSink.kt" "$HERE/ListeningToolsHarness.kt"
# A real PCM fixture and an independent ffmpeg R128 measurement; no media from
# the user's library, device, network, or mocked decoder is used.
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=1000:sample_rate=48000:duration=3' -filter_complex 'pan=stereo|c0=c0|c1=c0,volume=0.8' -f s16le -y "$OUT/tone.pcm"
ffmpeg -hide_banner -f s16le -ar 48000 -ac 2 -i "$OUT/tone.pcm" -af ebur128 -f null - > "$OUT/ffmpeg.log" 2>&1
python3 - "$OUT" <<'PY'
import re,sys,pathlib
p=pathlib.Path(sys.argv[1]);values=re.findall(r'I:\s+(-?[\d.]+) LUFS', (p/'ffmpeg.log').read_text());assert values
(p/'expected.txt').write_text(values[-1])
PY
java -Xmx128m -cp "$OUT:$LIB" expo.modules.listeningtools.ListeningToolsHarnessKt "$OUT/tone.pcm" "$OUT/expected.txt"
