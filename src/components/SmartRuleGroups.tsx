import { Text, View } from 'react-native';
import { GlassPressable, GlassTextInput } from './glass';
import { SelectList, SettingsGroup, settingsStyles } from './SettingsUI';
import { useT } from '@/i18n';
import type { SmartCondition, SmartRule, SmartRuleGroup } from '@/lib/smartRules';
import { fontSize, radius, spacing, themed, useTheme } from '@/theme';
export function SmartRuleGroups({ rule, onChange }: { rule: SmartRule; onChange: (groups: SmartRuleGroup[], match: 'all' | 'any') => void }) {
  useTheme(); const t = useT(), groups = rule.groups ?? [], match = rule.groupMatch ?? 'all';
  const updateGroup = (at: number, value: SmartRuleGroup) => onChange(groups.map((group, index) => index === at ? value : group), match);
  const updateCondition = (group: number, index: number, value: SmartCondition) => updateGroup(group, { ...groups[group], conditions: groups[group].conditions.map((condition, at) => at === index ? value : condition) });
  const fields: { value: SmartCondition['field']; label: string }[] = [
    { value: 'favorite', label: t('Favorite') }, { value: 'plays', label: t('Play count') }, { value: 'rating', label: t('Rating') },
    { value: 'year', label: t('Release year') }, { value: 'genre', label: t('Genre') }, { value: 'artist', label: t('Artist') }, { value: 'added-days', label: t('Added within days') },
  ];
  function forField(field: SmartCondition['field']): SmartCondition {
    return field === 'favorite' ? { field, operator: 'is', value: true }
      : field === 'genre' || field === 'artist' ? { field, operator: 'contains', value: '' }
        : field === 'added-days' ? { field, operator: 'within', value: 30 }
          : { field, operator: 'at-least', value: field === 'year' ? 2000 : 0 };
  }
  return <View>
    <Text style={settingsStyles.sectionTitle}>{t('Advanced condition groups')}</Text>
    <Text style={settingsStyles.sectionDescription}>{t('Basic filters are combined with these groups using AND. Inside and between groups, choose AND or OR. Up to 8 groups and 12 conditions per group.')}</Text>
    {groups.length ? <SelectList label={t('Between groups')} value={match} options={[{ value: 'all', label: t('AND — match every group') }, { value: 'any', label: t('OR — match any group') }]} onChange={(value) => onChange(groups, value)} /> : null}
    {groups.map((group, at) => <SettingsGroup key={at}>
      <View style={styles.group}>
        <Text style={styles.label}>{t('Condition group {n}', { n: at + 1 })}</Text>
        <SelectList label={t('Within this group')} value={group.match} options={[{ value: 'all', label: t('AND — all conditions') }, { value: 'any', label: t('OR — any condition') }]} onChange={(value) => updateGroup(at, { ...group, match: value })} />
        {group.conditions.map((condition, index) => <View key={index} style={styles.condition}>
          <SelectList label={t('Condition {n}', { n: index + 1 })} value={condition.field} options={fields} onChange={(field) => updateCondition(at, index, forField(field))} />
          {condition.field === 'favorite' ? <SelectList label={t('Matches')} value={condition.value} options={[{ value: true, label: t('Favorite') }, { value: false, label: t('Not a favorite') }]} onChange={(value) => updateCondition(at, index, { ...condition, value })} />
            : condition.field === 'genre' || condition.field === 'artist' ? <>
              <SelectList label={t('Comparison')} value={condition.operator} options={[{ value: 'contains', label: t('Contains') }, { value: 'not-contains', label: t('Does not contain') }]} onChange={(operator) => updateCondition(at, index, { ...condition, operator })} />
              <GlassTextInput style={styles.input} accessibilityLabel={t('Condition text')} value={condition.value} maxLength={100} onChangeText={(value) => updateCondition(at, index, { ...condition, value })} />
            </> : <>
              {condition.field !== 'added-days' ? <SelectList label={t('Comparison')} value={condition.operator} options={[{ value: 'at-least', label: t('At least') }, { value: 'at-most', label: t('At most') }, { value: 'equals', label: t('Equals') }]} onChange={(operator) => updateCondition(at, index, { ...condition, operator } as SmartCondition)} /> : null}
              <GlassTextInput style={styles.input} accessibilityLabel={t('Condition number')} keyboardType="number-pad" value={Number.isFinite(condition.value) ? String(condition.value) : ''} maxLength={7} onChangeText={(text) => updateCondition(at, index, { ...condition, value: text ? Number(text.replace(/\D/g, '')) : Number.NaN } as SmartCondition)} />
            </>}
          <GlassPressable style={styles.button} onPress={() => updateGroup(at, { ...group, conditions: group.conditions.filter((_, i) => i !== index) })}><Text style={styles.danger}>{t('Remove condition')}</Text></GlassPressable>
        </View>)}
        <View style={styles.buttons}>
          <GlassPressable style={styles.button} disabled={group.conditions.length >= 12} onPress={() => updateGroup(at, { ...group, conditions: [...group.conditions, forField('genre')] })}><Text style={styles.action}>{t('Add condition')}</Text></GlassPressable>
          <GlassPressable style={styles.button} onPress={() => onChange(groups.filter((_, index) => index !== at), match)}><Text style={styles.danger}>{t('Remove group')}</Text></GlassPressable>
        </View>
      </View>
    </SettingsGroup>)}
    <GlassPressable style={styles.button} disabled={groups.length >= 8} onPress={() => onChange([...groups, { match: 'all', conditions: [forField('genre')] }], match)}><Text style={styles.action}>{t('Add condition group')}</Text></GlassPressable>
  </View>;
}
const styles = themed((theme) => ({
  group: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, label: { color: theme.text, fontWeight: '600', fontSize: fontSize.sm },
  condition: { paddingVertical: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: theme.border },
  input: { backgroundColor: theme.surface, color: theme.text, minHeight: 44, borderRadius: radius.md, paddingHorizontal: spacing.md },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { backgroundColor: theme.surface, borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center', marginVertical: spacing.sm },
  action: { color: theme.accent, fontWeight: '600' }, danger: { color: theme.danger },
}));
