import { Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { GlassPressable } from '@/components/glass';
import { SwitchList } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { fontSize, spacing, themed, useTheme } from '@/theme';
import type { ScrapeCandidate, ScrapeField } from '@/lib/metadata/models';

export const FIELD_LABELS: Record<ScrapeField, string> = { title: 'Title', artist: 'Artist', albumArtist: 'Album artist', album: 'Album', year: 'Year', genres: 'Genres',
  track: 'Track number', discNumber: 'Disc number', cover: 'Artwork', lyrics: 'Lyrics', mediaKind: 'Media classification' };
export function MetadataButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  useTheme(); return <GlassPressable buttonMaterial={false} accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={[metadataStyles.button, disabled && { opacity: 0.4 }]}>
    <Text style={metadataStyles.action}>{title}</Text></GlassPressable>;
}
export function MetadataInput({ label, value, onChangeText, multiline, secure, placeholder, editable = true }: { label: string; value: string; onChangeText: (value: string) => void;
  multiline?: boolean; secure?: boolean; placeholder?: string; editable?: boolean }) {
  const palette = useTheme(); return <View style={metadataStyles.field}><Text style={metadataStyles.label}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} editable={editable} multiline={multiline} secureTextEntry={secure} placeholder={placeholder}
      placeholderTextColor={palette.textMuted} autoCapitalize="none" autoCorrect={false} maxLength={multiline ? 131072 : 2048}
      style={[metadataStyles.input, multiline && { minHeight: 130, textAlignVertical: 'top' }]} /></View>;
}
export function MetadataFields({ fields, onChange, available }: { fields: readonly ScrapeField[]; onChange: (fields: ScrapeField[]) => void; available?: readonly ScrapeField[] }) {
  const t = useT(); return <SwitchList options={(available ?? (Object.keys(FIELD_LABELS) as ScrapeField[]).filter((field) => field !== 'mediaKind')).map((field) => ({ label: t(FIELD_LABELS[field]), value: fields.includes(field),
    onChange: (value) => onChange(value ? [...fields, field] : fields.filter((entry) => entry !== field)) }))} />;
}
export function MetadataCandidateCard({ candidate, selected, onPress }: { candidate: ScrapeCandidate; selected?: boolean; onPress: () => void }) {
  useTheme(); const t = useT(); return <GlassPressable buttonMaterial={false} accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} style={[metadataStyles.candidate, selected && metadataStyles.selected]}>
    {candidate.coverUrl ? <Image source={{ uri: candidate.coverUrl }} contentFit="cover" style={metadataStyles.thumbnail} cachePolicy="disk" /> : null}
    <View style={{ flex: 1, gap: 4 }}><Text style={metadataStyles.label} numberOfLines={2}>{candidate.fields.title || t('Untitled')}</Text>
      <Text style={metadataStyles.note} numberOfLines={2}>{[candidate.fields.artist, candidate.fields.album, candidate.fields.year].filter(Boolean).join(' · ')}</Text>
      <Text style={metadataStyles.small}>{candidate.provider}{candidate.duration ? ` · ${Math.round(candidate.duration)} s` : ''} · {t(candidate.confident ? 'Recording matches' : 'Check this recording')}</Text>
      {candidate.reasons?.length ? <Text style={metadataStyles.warning}>{candidate.reasons.map((reason) => t(reason)).join(' · ')}</Text> : null}</View>
  </GlassPressable>;
}
export const metadataStyles = themed((palette) => ({
  note: { fontSize: fontSize.sm, color: palette.textSecondary, lineHeight: 21 }, small: { fontSize: fontSize.xs, color: palette.textMuted },
  label: { fontSize: fontSize.md, color: palette.text, fontWeight: '600' }, title: { fontSize: fontSize.lg, color: palette.text, fontWeight: '600', marginVertical: spacing.md },
  warning: { fontSize: fontSize.sm, color: palette.textSecondary, lineHeight: 21 }, field: { gap: 7, marginVertical: spacing.sm },
  input: { padding: 12, backgroundColor: palette.surfaceHighlight, borderRadius: 12, fontSize: fontSize.md, color: palette.text },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 10, borderRadius: 12, backgroundColor: palette.surfaceHighlight, marginVertical: 5 },
  action: { color: palette.accent, fontWeight: '600', fontSize: fontSize.md },
  candidate: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, marginVertical: 5, backgroundColor: palette.surface },
  selected: { borderWidth: 1, borderColor: palette.accent }, thumbnail: { width: 66, height: 66, borderRadius: 10 },
  separator: { height: 1, backgroundColor: palette.border, marginVertical: 10 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
}));
