# Listening tools native checks

Run from the repository with the existing Kotlin/compiler and Android SDK caches:

```sh
modules/listening-tools/tests/run.sh
modules/listening-tools/tests/run-alignment.sh
bash scripts/native-harness/audio-power/run.sh
modules/silence-trim/tests/run-mp4-harness.sh
```

`run.sh` compiles actual production `PlaybackRangePolicy`, the streaming
BS.1770/R128 analyzer and PCM window reader. It covers cancelled/stale A-B
callbacks, source ABA, finite bounds, mono/stereo weighting, sample rates,
absolute/relative gates, album block aggregation, truncated audio and an
independent FFmpeg `ebur128` result. It does not emulate Android MediaCodec.

`run-alignment.sh` runs the production WAV sink against the actual Media3 1.9.0
Sonic processor, using generated PCM at8–96kHz. It checks duration/format,
chunk-independent output, CUE-relative regions, cancellation and anti-aliasing.
The test-only Android Build identity only permits loading Media3 on the JVM;
there is no mocked resampler or encoder.

Existing ALAC packet/parser and background power checks are rerun because this
module exposes the same MP4 parser with a separate explicit inspection budget.
Legacy callers retain their24MiB/8second defaults. Analysis is single-worker,
local-only, <=1GiB input, <=4hour range and <=120seconds wall time. Invalid,
unsupported, cancelled or incomplete input rejects; it never returns a partial
normalization result. Mono/stereo only; peak means sample peak, not true peak.
No per-tick work is added when these explicit tools are unused.

The optional alignment output is16kHz mono PCM16 WAV, <=600seconds and
19,200,044bytes. Media3 rate conversion is preceded by an8th-order6.5kHz
Butterworth low-pass when downsampling. The native method never uploads. Caller
must explicitly upload to its chosen service and finally release the returned
private-cache URI. A range longer than600seconds rejects instead of silently
truncating. These checks and Kotlin compilation do not replace device playback,
seek, JNI codec or audio-route acceptance.
