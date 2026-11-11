import { requireOptionalNativeModule } from 'expo';
interface NativeTranslation {
  languages(): string[]; models(): Promise<string[]>;
  prepare(id: string, from: string, to: string, wifiOnly: boolean): Promise<void>;
  removeModel(language: string): Promise<void>;
  translate(id: string, from: string, to: string, lines: string[]): Promise<string[]>;
  cancel(id: string): void;
}
export const offlineTranslation = requireOptionalNativeModule<NativeTranslation>('OfflineTranslation');
