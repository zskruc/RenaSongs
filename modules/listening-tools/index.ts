import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type LoudnessMeasurement = {
  integratedLufs: number | null;
  samplePeak: number;
  /** Absolute-gated400ms energies; merge full arrays for accurate album gating. */
  blockEnergies: number[];
  durationSec: number;
  sampleRate: number;
  channels: number;
  frames: number;
  complete: true;
  algorithm: 'bs1770-r128-v1';
};
export type LoudnessRequest = { requestId: string; uri: string; startSec?: number; endSec?: number };
export type PreparedAlignmentAudio = { uri: string; mime: 'audio/wav'; bytes: number; durationSec: number;
  physicalStartSec: number; sampleRate: 16000; channels: 1; temporary: true };
const native = Platform.OS === 'android' ? requireOptionalNativeModule<{
  analyzeLoudness(requestId: string, uri: string, startSec: number | null, endSec: number | null): Promise<LoudnessMeasurement>;
  cancelLoudness(requestId: string): void;
  prepareAlignmentAudio(requestId: string, uri: string, startSec: number | null, endSec: number | null): Promise<PreparedAlignmentAudio>;
  releaseAlignmentAudio(uri: string): void;
}>('ResonusListeningTools') : null;
export const loudnessAnalysisAvailable = !!native;
export function analyzeLoudness(request: LoudnessRequest): Promise<LoudnessMeasurement> {
  if (!native) return Promise.reject(new Error('Local loudness analysis is unavailable'));
  if (!request.requestId || request.requestId.length > 200) return Promise.reject(new Error('Invalid analysis request'));
  return native.analyzeLoudness(request.requestId, request.uri, request.startSec ?? null, request.endSec ?? null);
}
export function cancelLoudness(requestId: string): void { native?.cancelLoudness(requestId); }

/** Explicit local preparation only; never uploads or fetches audio. A request
 * exceeding600seconds is rejected rather than silently returning a partial. */
export function prepareAlignmentAudio(request: LoudnessRequest): Promise<PreparedAlignmentAudio> {
  if (!native) return Promise.reject(new Error('Local audio preparation is unavailable'));
  return native.prepareAlignmentAudio(request.requestId, request.uri, request.startSec ?? null, request.endSec ?? null);
}
export function releaseAlignmentAudio(uri: string): void { native?.releaseAlignmentAudio(uri); }

export const cancelAlignmentAudio = cancelLoudness;
