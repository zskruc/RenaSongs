/** Official, unmodified attribution badge distributed for Translation API use. */
import { Image, Linking, Pressable } from 'react-native';
import { useLyricDisplayMode } from '@/hooks/useLyricDisplay';
export function TranslationAttribution({ provider, force = false }: { provider?: 'google-mlkit'; force?: boolean }) {
  const mode = useLyricDisplayMode();
  if (provider !== 'google-mlkit' || !force && (mode === 'original' || mode === 'romanization')) return null;
  return <Pressable accessibilityRole="link" accessibilityLabel="Powered by Google Translate" onPress={() => { void Linking.openURL('https://translate.google.com').catch(() => {}); }}
    style={{ alignSelf: 'flex-start', backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 4, marginVertical: 4 }}>
    <Image source={require('../../assets/google-translate/color-regular.png')} style={{ width: 176, height: 16 }} resizeMode="contain" />
  </Pressable>;
}
